/**
 * Browser-side repository used ONLY by the offline preview build.
 *
 * It implements the same repository contract as the SQLite adapter, so the
 * authoritative crash engine runs unchanged. Data lives in localStorage.
 * This is a demo convenience, not a security boundary — the real server uses
 * SQLite, hashed passwords and httpOnly sessions.
 */
import { sha256Hex } from './sha256.js';

const KEY = 'patapotea_preview_v2';

const BOTS = [
  ['AceOfSpades', 'ace@bots.demo'],
  ['Mira_V', 'mira@bots.demo'],
  ['KofiRuns', 'kofi@bots.demo'],
  ['Nina99', 'nina@bots.demo'],
  ['CrashKing', 'king@bots.demo'],
  ['LuckyTunde', 'tunde@bots.demo'],
  ['SkyRider', 'sky@bots.demo'],
  ['ZaraBet', 'zara@bots.demo'],
];

export function previewHash(password) {
  return sha256Hex(`patapotea-preview::${password}`);
}

const uid = () =>
  (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`);

const memoryStorage = (() => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
})();

export class LocalRepo {
  constructor(storage) {
    // localStorage can be unavailable (private mode, file://) — fall back to memory.
    try {
      this.storage = storage || globalThis.localStorage || memoryStorage;
      const probe = '__pp_probe__';
      this.storage.setItem(probe, '1');
      this.storage.removeItem(probe);
    } catch {
      this.storage = memoryStorage;
    }
    this.data = this.load();
    if (!this.data) {
      this.data = { users: [], rounds: [], bets: [], transactions: [], topups: [], createdAt: Date.now() };
      this.seed();
      this.save();
    }
  }

  load() {
    try {
      const raw = this.storage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.users)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  save() {
    try {
      // Keep the ledger bounded so localStorage never grows without limit.
      if (this.data.transactions.length > 600) this.data.transactions = this.data.transactions.slice(0, 600);
      this.storage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage full / disabled — the session still works in memory */
    }
  }

  reset() {
    this.storage.removeItem(KEY);
  }

  seed() {
    const now = Date.now();
    const add = (email, username, password, opts = {}) => {
      const user = {
        id: uid(),
        email,
        username,
        password_hash: previewHash(password),
        role: opts.role || 'player',
        balance_cents: opts.balance ?? 1000000,
        is_bot: opts.isBot ? 1 : 0,
        settings: JSON.stringify({ sound: true, autoCashOut: null }),
        created_at: now,
        last_login_at: null,
      };
      this.data.users.push(user);
      this.ledger(user.id, null, null, 'signup_bonus', user.balance_cents, user.balance_cents,
        'DEMO / VIRTUAL CREDIT starting grant — no cash value', now);
      return user;
    };
    add('admin@patapotea.demo', 'admin', 'AdminDemo!2025', { role: 'admin' });
    add('player@patapotea.demo', 'player', 'PlayerDemo!2025', {});
    for (const [name, email] of BOTS) {
      add(email, name, `bot-${uid()}`, { isBot: true, balance: 10000000 });
    }
  }

  ledger(userId, roundId, betId, type, amount, balanceAfter, note, at) {
    this.data.transactions.unshift({
      id: uid(), user_id: userId, round_id: roundId, bet_id: betId, type,
      amount_cents: amount, balance_after_cents: balanceAfter, note, created_at: at,
    });
  }

  /* ---------------------------- engine contract ---------------------------- */

  nextRoundNumber() {
    return this.data.rounds.reduce((max, r) => Math.max(max, r.round_no), 0) + 1;
  }

  createRound(round) {
    this.data.rounds.unshift({
      id: round.id, round_no: round.roundNo, seed_hash: round.seedHash,
      server_seed: round.serverSeed, crash_point: round.crashPoint, status: 'betting',
      started_at: round.startedAt, betting_ends_at: round.bettingEndsAt,
      flying_at: null, crash_at: null, crashed_at: null, created_at: round.startedAt,
    });
    this.save();
  }

  setRoundFlying(id, at, crashAt) {
    const r = this.data.rounds.find((x) => x.id === id);
    if (r) { r.status = 'flying'; r.flying_at = at; r.crash_at = crashAt; this.save(); }
  }

  setRoundCrashed(id, at, seed, crashPoint) {
    const r = this.data.rounds.find((x) => x.id === id);
    if (r) { r.status = 'crashed'; r.crashed_at = at; r.server_seed = seed; r.crash_point = crashPoint; this.save(); }
  }

  recentCrashedRounds(limit = 20) {
    return this.data.rounds.filter((r) => r.status === 'crashed').slice(0, limit).map((r) => ({
      id: r.id, roundNo: r.round_no, crashPoint: r.crash_point, crashedAt: r.crashed_at,
    }));
  }

  listRoundBets(roundId) {
    return this.data.bets
      .filter((b) => b.round_id === roundId)
      .map((b) => {
        const u = this.data.users.find((x) => x.id === b.user_id);
        return {
          id: b.id, roundId: b.round_id, userId: b.user_id, username: u?.username || 'unknown',
          slot: b.slot, stake: b.stake_cents, status: b.status, multiplier: b.multiplier,
          payout: b.payout_cents, isBot: !!b.is_bot, placedAt: b.placed_at, cashedAt: b.cashed_at,
        };
      });
  }

  getBet(roundId, userId, slot) {
    return this.listRoundBets(roundId).find((b) => b.userId === userId && b.slot === slot) || null;
  }

  placeBet({ id, roundId, userId, slot, stakeCents, isBot, now }) {
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) throw new Error('Unknown player');
    if (user.balance_cents < stakeCents) {
      const err = new Error('Not enough virtual credits for that stake.');
      err.code = 'INSUFFICIENT_BALANCE';
      throw err;
    }
    if (this.data.bets.some((b) => b.round_id === roundId && b.user_id === userId && b.slot === slot)) {
      const err = new Error('That bet slot is already in use this round.');
      err.code = 'SLOT_TAKEN';
      throw err;
    }
    user.balance_cents -= stakeCents;
    this.data.bets.push({
      id, round_id: roundId, user_id: userId, slot, stake_cents: stakeCents,
      status: 'active', multiplier: null, payout_cents: 0,
      placed_at: now, cashed_at: null, is_bot: isBot ? 1 : 0,
    });
    this.ledger(userId, roundId, id, 'bet_stake', -stakeCents, user.balance_cents, 'DEMO stake debit', now);
    this.save();
    return {
      id, roundId, userId, username: user.username, slot, stake: stakeCents,
      status: 'active', multiplier: null, payout: 0, isBot: !!isBot, placedAt: now,
    };
  }

  settleCashout({ betId, roundId, userId, multiplier, payoutCents, now }) {
    const bet = this.data.bets.find((b) => b.id === betId);
    if (!bet || bet.status !== 'active') return null;
    bet.status = 'cashed';
    bet.multiplier = multiplier;
    bet.payout_cents = payoutCents;
    bet.cashed_at = now;
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) return null;
    user.balance_cents += payoutCents;
    this.ledger(userId, roundId, betId, 'cashout_credit', payoutCents, user.balance_cents,
      `DEMO cash-out at ${multiplier.toFixed(2)}x`, now);
    this.save();
    return {
      id: betId, roundId, userId, username: user.username, slot: bet.slot,
      stake: bet.stake_cents, status: 'cashed', multiplier, payout: payoutCents, isBot: !!bet.is_bot,
    };
  }

  loseRemainingBets(roundId) {
    let n = 0;
    for (const b of this.data.bets) {
      if (b.round_id === roundId && b.status === 'active') { b.status = 'lost'; b.payout_cents = 0; n++; }
    }
    if (n) this.save();
    return n;
  }

  listBots() {
    return this.data.users.filter((u) => u.is_bot).map((u) => ({ id: u.id, username: u.username }));
  }

  /* ------------------------------ app helpers ------------------------------ */

  findUser(pred) { return this.data.users.find(pred) || null; }

  createUser({ email, username, password, role = 'player', balanceCents = 1000000 }) {
    const now = Date.now();
    const user = {
      id: uid(), email, username, password_hash: previewHash(password), role,
      balance_cents: balanceCents, is_bot: 0,
      settings: JSON.stringify({ sound: true, autoCashOut: null }),
      created_at: now, last_login_at: null,
    };
    this.data.users.push(user);
    this.ledger(user.id, null, null, 'signup_bonus', balanceCents, balanceCents,
      'DEMO / VIRTUAL CREDIT starting grant — no cash value', now);
    this.save();
    return user;
  }

  updateSettings(userId, settings) {
    const user = this.findUser((u) => u.id === userId);
    if (user) { user.settings = JSON.stringify(settings); this.save(); }
    return user;
  }

  updatePassword(userId, password) {
    const user = this.findUser((u) => u.id === userId);
    if (user) { user.password_hash = previewHash(password); this.save(); }
    return user;
  }

  myBets(userId, limit = 50) {
    return this.data.bets
      .filter((b) => b.user_id === userId)
      .sort((a, b) => b.placed_at - a.placed_at)
      .slice(0, limit)
      .map((b) => {
        const round = this.data.rounds.find((r) => r.id === b.round_id);
        return {
          id: b.id, round_id: b.round_id, round_no: round?.round_no, slot: b.slot,
          stake_cents: b.stake_cents, status: b.status, multiplier: b.multiplier,
          payout_cents: b.payout_cents, crash_point: round?.crash_point,
          placed_at: b.placed_at, cashed_at: b.cashed_at, roundStatus: round?.status,
        };
      });
  }

  myTransactions(userId, limit = 50) {
    return this.data.transactions.filter((t) => t.user_id === userId).slice(0, limit);
  }

  lastTopup(userId) {
    return this.data.transactions.find((t) => t.user_id === userId && t.type === 'demo_topup') || null;
  }

  topup(userId, amount, now) {
    const user = this.findUser((u) => u.id === userId);
    if (!user) return null;
    user.balance_cents += amount;
    this.ledger(userId, null, null, 'demo_topup', amount, user.balance_cents,
      'DEMO top-up — virtual credits with no cash value', now);
    this.save();
    return user;
  }

  /** Settled rounds newest first, shaped like the SQL public-history query. */
  listSettledRounds(limit = 20, beforeRoundNo = null) {
    const settled = this.data.rounds
      .filter((r) => r.status === 'crashed')
      .filter((r) => !beforeRoundNo || r.round_no < beforeRoundNo)
      .sort((a, b) => b.round_no - a.round_no)
      .slice(0, limit);
    return settled.map((r) => {
      const bets = this.data.bets.filter((b) => b.round_id === r.id);
      return {
        ...r,
        bet_count: bets.length,
        staked_cents: bets.reduce((sum, b) => sum + b.stake_cents, 0),
        paid_cents: bets.reduce((sum, b) => sum + b.payout_cents, 0),
      };
    });
  }

  countSettledRounds() {
    return this.data.rounds.filter((r) => r.status === 'crashed').length;
  }

  getRoundRaw(id) {
    return this.data.rounds.find((r) => r.id === id) || null;
  }

  stats() {
    const humans = this.data.users.filter((u) => !u.is_bot);
    const bets = this.data.bets;
    const wagered = bets.reduce((s, b) => s + b.stake_cents, 0);
    const paid = bets.reduce((s, b) => s + b.payout_cents, 0);
    return {
      users: humans.length,
      bots: this.data.users.length - humans.length,
      rounds: this.data.rounds.filter((r) => r.status === 'crashed').length,
      bets: bets.length,
      wagered, paid,
      balances: humans.reduce((s, u) => s + u.balance_cents, 0),
    };
  }

  listRounds(limit = 30) {
    return this.data.rounds.slice(0, limit).map((r) => ({
      id: r.id, roundNo: r.round_no, crashPoint: r.crash_point, status: r.status,
      startedAt: r.started_at, crashedAt: r.crashed_at,
      betCount: this.data.bets.filter((b) => b.round_id === r.id).length,
      staked: this.data.bets.filter((b) => b.round_id === r.id).reduce((s, b) => s + b.stake_cents, 0),
      paid: this.data.bets.filter((b) => b.round_id === r.id).reduce((s, b) => s + b.payout_cents, 0),
      seedHash: r.seed_hash, serverSeed: r.status === 'crashed' ? r.server_seed : null,
    }));
  }
}
