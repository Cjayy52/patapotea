/**
 * SQLite persistence layer for PATAPOTEA.
 *
 * Money is stored as INTEGER credit-cents. Every balance mutation happens inside
 * a transaction together with its ledger entry, and every guard that matters
 * (balance >= stake, one bet per slot, settle-once) is enforced in SQL with a
 * conditional UPDATE so concurrent requests cannot double-spend or double-pay.
 */
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, BET_STATUS } from '../shared/config.js';
import { GameError } from './game/engine.js';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player','admin')),
  balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  is_demo       INTEGER NOT NULL DEFAULT 1,
  is_bot        INTEGER NOT NULL DEFAULT 0,
  settings      TEXT NOT NULL DEFAULT '{"sound":true,"autoCashOut":null}',
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS rounds (
  id              TEXT PRIMARY KEY,
  round_no        INTEGER NOT NULL UNIQUE,
  seed_hash       TEXT NOT NULL,
  server_seed     TEXT,
  crash_point     REAL,
  status          TEXT NOT NULL CHECK (status IN ('betting','flying','crashed','void')),
  started_at      INTEGER NOT NULL,
  betting_ends_at INTEGER,
  flying_at       INTEGER,
  crash_at        INTEGER,
  crashed_at      INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(status);

CREATE TABLE IF NOT EXISTS bets (
  id           TEXT PRIMARY KEY,
  round_id     TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot         INTEGER NOT NULL CHECK (slot >= 0 AND slot < 2),
  stake_cents  INTEGER NOT NULL CHECK (stake_cents > 0),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cashed','lost')),
  multiplier   REAL,
  payout_cents INTEGER NOT NULL DEFAULT 0 CHECK (payout_cents >= 0),
  placed_at    INTEGER NOT NULL,
  cashed_at    INTEGER,
  is_bot       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (round_id, user_id, slot)
);
CREATE INDEX IF NOT EXISTS idx_bets_round ON bets(round_id);
CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id, placed_at DESC);

CREATE TABLE IF NOT EXISTS transactions (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  round_id           TEXT,
  bet_id             TEXT,
  type               TEXT NOT NULL,
  amount_cents       INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  note               TEXT,
  created_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  action     TEXT NOT NULL,
  meta       TEXT,
  created_at INTEGER NOT NULL
);
`;

export function createDatabase(file = 'data/patapotea.db') {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

/* -------------------------------------------------------------------------- */
/* Password hashing & tokens                                                  */
/* -------------------------------------------------------------------------- */

const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/* -------------------------------------------------------------------------- */
/* Repository                                                                 */
/* -------------------------------------------------------------------------- */

export class SqliteRepo {
  constructor(db) {
    this.db = db;
    this.stmts = new Map();
  }

  /** Cache prepared statements. */
  q(sql) {
    let stmt = this.stmts.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmts.set(sql, stmt);
    }
    return stmt;
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    }
  }

  now() {
    return Date.now();
  }

  /* --------------------------- users ---------------------------------- */

  createUser({ email, username, password, role = 'player', balanceCents = CONFIG.startingBalance * 100, isBot = 0, isDemo = 1, settings }) {
    const id = crypto.randomUUID();
    const now = this.now();
    const hash = hashPassword(password);
    const tx = this.tx(() => {
      this.q(`INSERT INTO users (id,email,username,password_hash,role,balance_cents,is_demo,is_bot,settings,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        id, email, username, hash, role, balanceCents, isDemo, isBot,
        JSON.stringify(settings || { sound: true, autoCashOut: null }), now,
      );
      if (balanceCents > 0) {
        this.q(`INSERT INTO transactions (id,user_id,type,amount_cents,balance_after_cents,note,created_at)
                VALUES (?,?,?,?,?,?,?)`).run(
          crypto.randomUUID(), id, 'signup_bonus', balanceCents, balanceCents,
          'DEMO / VIRTUAL CREDIT starting grant — no cash value', now,
        );
      }
      return id;
    });
    return this.getUser(tx);
  }

  getUser(id) {
    return this.q(`SELECT * FROM users WHERE id = ?`).get(id) || null;
  }

  getUserByEmail(email) {
    return this.q(`SELECT * FROM users WHERE email = ?`).get(String(email)) || null;
  }

  getUserByUsername(username) {
    return this.q(`SELECT * FROM users WHERE username = ?`).get(String(username)) || null;
  }

  updateUserSettings(id, settings) {
    this.q(`UPDATE users SET settings = ? WHERE id = ?`).run(JSON.stringify(settings), id);
    return this.getUser(id);
  }

  updatePassword(id, password) {
    this.q(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(password), id);
  }

  touchLogin(id) {
    this.q(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(this.now(), id);
  }

  listUsers({ includeBots = false } = {}) {
    return this.q(
      `SELECT id,email,username,role,balance_cents,is_demo,is_bot,created_at,last_login_at,
              (SELECT COUNT(*) FROM bets b WHERE b.user_id = users.id) AS bet_count
       FROM users ${includeBots ? '' : 'WHERE is_bot = 0'} ORDER BY created_at DESC`,
    ).all();
  }

  listBots() {
    return this.q(`SELECT id, username FROM users WHERE is_bot = 1`).all();
  }

  /* --------------------------- sessions ------------------------------- */

  createSession(userId, token, ttlMs, userAgent = '') {
    const now = this.now();
    this.q(`INSERT INTO sessions (token_hash,user_id,created_at,expires_at,user_agent) VALUES (?,?,?,?,?)`)
      .run(tokenHash(token), userId, now, now + ttlMs, String(userAgent).slice(0, 200));
  }

  getUserBySession(token) {
    if (!token) return null;
    const row = this.q(
      `SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    ).get(tokenHash(token));
    if (!row) return null;
    if (row.expires_at < this.now()) {
      this.deleteSession(token);
      return null;
    }
    return row;
  }

  deleteSession(token) {
    if (!token) return;
    this.q(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash(token));
  }

  purgeExpiredSessions() {
    this.q(`DELETE FROM sessions WHERE expires_at < ?`).run(this.now());
  }

  /* --------------------------- rounds --------------------------------- */

  nextRoundNumber() {
    const row = this.q(`SELECT COALESCE(MAX(round_no), 0) AS n FROM rounds`).get();
    return Number(row.n) + 1;
  }

  createRound(round) {
    this.q(
      `INSERT INTO rounds (id,round_no,seed_hash,server_seed,crash_point,status,started_at,betting_ends_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      round.id, round.roundNo, round.seedHash, round.serverSeed, round.crashPoint,
      'betting', round.startedAt, round.bettingEndsAt, round.startedAt,
    );
  }

  setRoundFlying(id, at, crashAt) {
    this.q(`UPDATE rounds SET status='flying', flying_at=?, crash_at=? WHERE id=?`).run(at, crashAt, id);
  }

  setRoundCrashed(id, at, seed, crashPoint) {
    this.q(`UPDATE rounds SET status='crashed', crashed_at=?, server_seed=?, crash_point=? WHERE id=?`)
      .run(at, seed, crashPoint, id);
  }

  recentCrashedRounds(limit = 20) {
    return this.q(
      `SELECT id, round_no, crash_point, crashed_at FROM rounds WHERE status='crashed' ORDER BY round_no DESC LIMIT ?`,
    ).all(limit);
  }

  listRounds(limit = 50) {
    return this.q(
      `SELECT r.*,
              (SELECT COUNT(*) FROM bets b WHERE b.round_id = r.id) AS bet_count,
              (SELECT COALESCE(SUM(b.stake_cents),0) FROM bets b WHERE b.round_id = r.id) AS staked_cents,
              (SELECT COALESCE(SUM(b.payout_cents),0) FROM bets b WHERE b.round_id = r.id) AS paid_cents
       FROM rounds r ORDER BY r.round_no DESC LIMIT ?`,
    ).all(limit);
  }

  getRound(id) {
    return this.q(`SELECT * FROM rounds WHERE id=?`).get(id) || null;
  }

  /** Settled rounds only, newest first, with aggregate bet totals. */
  listSettledRounds(limit = 20, beforeRoundNo = null) {
    const base = `
      SELECT r.id, r.round_no, r.status, r.crash_point, r.seed_hash, r.server_seed,
             r.started_at, r.betting_ends_at, r.flying_at, r.crash_at, r.crashed_at,
             (SELECT COUNT(*) FROM bets b WHERE b.round_id = r.id) AS bet_count,
             (SELECT COALESCE(SUM(b.stake_cents),0) FROM bets b WHERE b.round_id = r.id) AS staked_cents,
             (SELECT COALESCE(SUM(b.payout_cents),0) FROM bets b WHERE b.round_id = r.id) AS paid_cents
      FROM rounds r
      WHERE r.status = 'crashed'`;
    if (beforeRoundNo) {
      return this.q(`${base} AND r.round_no < ? ORDER BY r.round_no DESC LIMIT ?`)
        .all(beforeRoundNo, limit);
    }
    return this.q(`${base} ORDER BY r.round_no DESC LIMIT ?`).all(limit);
  }

  countSettledRounds() {
    return Number(this.q(`SELECT COUNT(*) AS c FROM rounds WHERE status='crashed'`).get().c);
  }

  roundBetTotals(roundId) {
    const row = this.q(
      `SELECT COUNT(*) AS bet_count,
              COALESCE(SUM(stake_cents),0) AS staked_cents,
              COALESCE(SUM(payout_cents),0) AS paid_cents
       FROM bets WHERE round_id = ?`,
    ).get(roundId);
    return {
      betCount: Number(row.bet_count) || 0,
      stakedCents: Number(row.staked_cents) || 0,
      paidCents: Number(row.paid_cents) || 0,
    };
  }

  /* ---------------------------- bets ---------------------------------- */

  placeBet({ id, roundId, userId, slot, stakeCents, isBot = false, now }) {
    return this.tx(() => {
      const user = this.q(`SELECT id, username, balance_cents FROM users WHERE id=?`).get(userId);
      if (!user) throw new GameError('NO_USER', 'Unknown player.', 404);
      if (user.balance_cents < stakeCents) {
        throw new GameError('INSUFFICIENT_BALANCE', 'Not enough virtual credits for that stake.', 402);
      }

      // Atomic debit that cannot go negative under concurrency.
      const debit = this.q(`UPDATE users SET balance_cents = balance_cents - ? WHERE id=? AND balance_cents >= ?`)
        .run(stakeCents, userId, stakeCents);
      if (Number(debit.changes) !== 1) {
        throw new GameError('INSUFFICIENT_BALANCE', 'Not enough virtual credits for that stake.', 402);
      }

      const balanceAfter = user.balance_cents - stakeCents;
      try {
        this.q(
          `INSERT INTO bets (id,round_id,user_id,slot,stake_cents,status,placed_at,is_bot)
           VALUES (?,?,?,?,?,'active',?,?)`,
        ).run(id, roundId, userId, slot, stakeCents, now, isBot ? 1 : 0);
      } catch (err) {
        // Unique (round,user,slot) violation -> roll back the debit.
        throw new GameError('SLOT_TAKEN', 'That bet slot is already in use this round.', 409);
      }

      this.q(
        `INSERT INTO transactions (id,user_id,round_id,bet_id,type,amount_cents,balance_after_cents,note,created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        crypto.randomUUID(), userId, roundId, id, 'bet_stake', -stakeCents, balanceAfter,
        'DEMO stake debit', now,
      );

      return {
        id, roundId, userId, username: user.username, slot, stake: stakeCents,
        status: BET_STATUS.ACTIVE, multiplier: null, payout: 0, placedAt: now,
        isBot: !!isBot,
      };
    });
  }

  getBet(roundId, userId, slot) {
    const row = this.q(
      `SELECT b.*, u.username FROM bets b JOIN users u ON u.id=b.user_id
       WHERE b.round_id=? AND b.user_id=? AND b.slot=?`,
    ).get(roundId, userId, slot);
    return row ? mapBet(row) : null;
  }

  getBetById(id) {
    const row = this.q(`SELECT b.*, u.username FROM bets b JOIN users u ON u.id=b.user_id WHERE b.id=?`).get(id);
    return row ? mapBet(row) : null;
  }

  listRoundBets(roundId) {
    return this.q(
      `SELECT b.*, u.username FROM bets b JOIN users u ON u.id=b.user_id
       WHERE b.round_id=? ORDER BY b.placed_at ASC`,
    ).all(roundId).map(mapBet);
  }

  /**
   * Settle a cash-out exactly once. Returns the settled bet, or null if the
   * guarded UPDATE found no active row (duplicate / already lost).
   */
  settleCashout({ betId, roundId, userId, multiplier, payoutCents, now }) {
    return this.tx(() => {
      const bet = this.q(`SELECT b.*, u.username FROM bets b JOIN users u ON u.id=b.user_id WHERE b.id=?`).get(betId);
      if (!bet) return null;

      const upd = this.q(
        `UPDATE bets SET status='cashed', multiplier=?, payout_cents=?, cashed_at=?
         WHERE id=? AND status='active'`,
      ).run(multiplier, payoutCents, now, betId);
      if (Number(upd.changes) !== 1) return null; // already cashed or lost

      this.q(`UPDATE users SET balance_cents = balance_cents + ? WHERE id=?`).run(payoutCents, userId);
      const after = this.q(`SELECT balance_cents FROM users WHERE id=?`).get(userId).balance_cents;

      this.q(
        `INSERT INTO transactions (id,user_id,round_id,bet_id,type,amount_cents,balance_after_cents,note,created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        crypto.randomUUID(), userId, roundId, betId, 'cashout_credit', payoutCents, after,
        `DEMO cash-out at ${multiplier.toFixed(2)}x`, now,
      );

      return {
        id: betId, roundId, userId, username: bet.username, slot: bet.slot,
        stake: bet.stake_cents, status: BET_STATUS.CASHED, multiplier, payout: payoutCents,
        isBot: !!bet.is_bot,
      };
    });
  }

  loseRemainingBets(roundId) {
    const res = this.q(
      `UPDATE bets SET status='lost', payout_cents=0 WHERE round_id=? AND status='active'`,
    ).run(roundId);
    return Number(res.changes);
  }

  getUserBets(userId, limit = 50) {
    return this.q(
      `SELECT b.*, r.round_no, r.crash_point, r.crashed_at, r.status AS round_status
       FROM bets b JOIN rounds r ON r.id=b.round_id
       WHERE b.user_id=? ORDER BY b.placed_at DESC LIMIT ?`,
    ).all(userId, limit).map((b) => ({
      id: b.id, roundId: b.round_id, roundNo: b.round_no, slot: b.slot,
      stake: b.stake_cents, status: b.status, multiplier: b.multiplier,
      payout: b.payout_cents, crashPoint: b.crash_point, placedAt: b.placed_at,
      cashedAt: b.cashed_at, roundStatus: b.round_status,
    }));
  }

  getUserTransactions(userId, limit = 50) {
    return this.q(
      `SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT ?`,
    ).all(userId, limit);
  }

  /* ---------------------------- admin --------------------------------- */

  stats() {
    const users = this.q(`SELECT COUNT(*) AS c FROM users WHERE is_bot=0`).get().c;
    const bots = this.q(`SELECT COUNT(*) AS c FROM users WHERE is_bot=1`).get().c;
    const rounds = this.q(`SELECT COUNT(*) AS c FROM rounds WHERE status='crashed'`).get().c;
    const bets = this.q(`SELECT COUNT(*) AS c FROM bets`).get().c;
    const wagered = this.q(`SELECT COALESCE(SUM(stake_cents),0) AS s FROM bets`).get().s;
    const paid = this.q(`SELECT COALESCE(SUM(payout_cents),0) AS s FROM bets`).get().s;
    const balances = this.q(`SELECT COALESCE(SUM(balance_cents),0) AS s FROM users WHERE is_bot=0`).get().s;
    return { users, bots, rounds, bets, wagered, paid, balances };
  }

  audit(action, userId = null, meta = null) {
    this.q(`INSERT INTO audit_log (id,user_id,action,meta,created_at) VALUES (?,?,?,?,?)`)
      .run(crypto.randomUUID(), userId, action, meta ? JSON.stringify(meta) : null, this.now());
  }
}

function mapBet(b) {
  return {
    id: b.id,
    roundId: b.round_id,
    userId: b.user_id,
    username: b.username,
    slot: b.slot,
    stake: b.stake_cents,
    status: b.status,
    multiplier: b.multiplier,
    payout: b.payout_cents,
    placedAt: b.placed_at,
    cashedAt: b.cashed_at,
    isBot: !!b.is_bot,
  };
}

/* -------------------------------------------------------------------------- */
/* Seed helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Create the demo admin, a demo player and a set of simulated bot accounts.
 * Idempotent. Credentials are printed by the server on first boot.
 */
export function seedDemoAccounts(repo, { adminPassword, playerPassword } = {}) {
  const created = [];
  const mk = (email, username, password, opts = {}) => {
    if (repo.getUserByEmail(email)) return null;
    const user = repo.createUser({ email, username, password, ...opts });
    created.push({ email, username, password, role: opts.role || 'player' });
    return user;
  };

  mk('admin@patapotea.demo', 'admin', adminPassword || 'AdminDemo!2025', { role: 'admin' });
  mk('player@patapotea.demo', 'player', playerPassword || 'PlayerDemo!2025', {});

  for (const [name] of BOT_SEED) {
    mk(`${name.toLowerCase()}@bots.patapotea.demo`, name, crypto.randomBytes(18).toString('hex'), {
      isBot: 1, balanceCents: 100_000_00,
    });
  }
  return created;
}

const BOT_SEED = [
  ['AceOfSpades'], ['Mira_V'], ['KofiRuns'], ['Nina99'],
  ['CrashKing'], ['LuckyTunde'], ['SkyRider'], ['ZaraBet'],
];

export { BOT_SEED };
