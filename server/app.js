/**
 * PATAPOTEA HTTP application.
 *
 * The HTTP layer is a thin, stateless shell around the authoritative CrashEngine:
 * it authenticates the player, validates input, then delegates every rule about
 * timing, stakes and payouts to the engine. No game state lives here.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameError } from './game/engine.js';
import { CONFIG } from '../shared/config.js';
import {
  ValidationError, validateEmail, validateUsername, validatePassword, validateSettings,
} from './validate.js';
import { parseStake } from '../shared/game-math.js';
import { buildRoundDetail, buildRoundSummary } from '../shared/round-record.js';
import {
  FAIRNESS_DISCLAIMER, ROUND_ALGORITHM, VERIFICATION_LIMITATIONS,
} from '../shared/verification.js';
import crypto from 'node:crypto';
import { newToken, verifyPassword } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_COOKIE = 'pp_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Small utilities                                                            */
/* -------------------------------------------------------------------------- */

const toCredits = (cents) => Math.round(Number(cents) || 0) / 100;

function userDto(user) {
  if (!user) return null;
  let settings = { sound: true, autoCashOut: null };
  try { settings = { ...settings, ...JSON.parse(user.settings || '{}') }; } catch { /* ignore */ }
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    balance: toCredits(user.balance_cents),
    isDemo: true,
    settings,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}

const betDto = (b) => ({
  id: b.id,
  roundId: b.roundId,
  roundNo: b.roundNo,
  slot: b.slot,
  stake: toCredits(b.stake),
  status: b.status,
  multiplier: b.multiplier,
  payout: toCredits(b.payout),
  crashPoint: b.crashPoint,
  placedAt: b.placedAt,
  cashedAt: b.cashedAt,
  roundStatus: b.roundStatus,
});

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** In-memory fixed-window rate limiter (per-process, demo scale). */
function rateLimiter({ windowMs, max, key = (req) => req.ip, message }) {
  const buckets = new Map();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let b = buckets.get(k);
    if (!b || b.reset < now) {
      b = { count: 0, reset: now + windowMs };
      buckets.set(k, b);
    }
    b.count += 1;
    if (buckets.size > 5000) {
      for (const [key2, val] of buckets) if (val.reset < now) buckets.delete(key2);
    }
    if (b.count > max) {
      res.set('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).json({ error: message || 'Too many requests. Slow down.', code: 'RATE_LIMITED' });
    }
    next();
  };
}

/* -------------------------------------------------------------------------- */
/* App factory                                                                */
/* -------------------------------------------------------------------------- */

export function createApp({ repo, engine, isProd = false, sessionTtlMs = SESSION_TTL_MS, maxSseClients = 200 }) {
  const app = express();
  app.disable('x-powered-by');
  // Only trust proxy headers when explicitly deployed behind a reverse proxy.
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

  /* -------------------------- baseline headers ------------------------- */
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.set('Cross-Origin-Opener-Policy', 'same-origin');
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; " +
      "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    next();
  });

  app.use(express.json({ limit: '32kb' }));

  /* ---------------------------- cookies/auth --------------------------- */
  app.use((req, _res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    next();
  });

  const authLimiter = rateLimiter({ windowMs: 15 * 60 * 1000, max: 60, message: 'Too many attempts. Try again in a few minutes.' });
  const actionLimiter = rateLimiter({ windowMs: 1000, max: 12, key: (req) => `act:${req.user?.id || req.ip}` });

  /** Attach req.user when a valid session cookie is present. */
  const attachUser = (req, _res, next) => {
    const token = req.cookies[SESSION_COOKIE];
    const user = token ? repo.getUserBySession(token) : null;
    req.user = user || null;
    req.sessionToken = token || null;
    next();
  };
  app.use('/api', attachUser);

  const requireAuth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.', code: 'UNAUTHENTICATED' });
    next();
  };
  const requireAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.', code: 'UNAUTHENTICATED' });
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.', code: 'FORBIDDEN' });
    next();
  };

  /** Lightweight CSRF guard: custom header + same-origin check on mutations. */
  const csrfGuard = (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (req.get('x-requested-with') !== 'patapotea') {
      return res.status(403).json({ error: 'Missing request header.', code: 'CSRF_REJECTED' });
    }
    const origin = req.get('origin');
    if (origin) {
      try {
        if (new URL(origin).host !== req.get('host')) {
          return res.status(403).json({ error: 'Cross-origin request rejected.', code: 'CSRF_REJECTED' });
        }
      } catch {
        return res.status(403).json({ error: 'Invalid origin.', code: 'CSRF_REJECTED' });
      }
    }
    next();
  };
  app.use('/api', csrfGuard);

  /* ------------------------------- auth -------------------------------- */

  app.post('/api/auth/register', authLimiter, (req, res, next) => {
    try {
      const email = validateEmail(req.body?.email);
      const username = validateUsername(req.body?.username);
      const password = validatePassword(req.body?.password);
      if (repo.getUserByEmail(email)) {
        return res.status(409).json({ error: 'An account with that email already exists.', code: 'EMAIL_TAKEN', field: 'email' });
      }
      if (repo.getUserByUsername(username)) {
        return res.status(409).json({ error: 'That username is taken.', code: 'USERNAME_TAKEN', field: 'username' });
      }
      const user = repo.createUser({ email, username, password, role: 'player' });
      startSession(res, repo, user, req, sessionTtlMs, isProd);
      repo.audit('register', user.id, { email });
      res.status(201).json({ user: userDto(user), demo: true });
    } catch (err) { next(err); }
  });

  app.post('/api/auth/login', authLimiter, (req, res, next) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.', code: 'VALIDATION_ERROR' });
      }
      const user = repo.getUserByEmail(email);
      // Uniform response + hash comparison even on unknown email to limit enumeration.
      const ok = user
        ? verifyPassword(password, user.password_hash)
        : verifyPassword(password, '$scrypt$00000000000000000000000000000000$' + '0'.repeat(128));
      if (!user || !ok) {
        return res.status(401).json({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
      }
      repo.touchLogin(user.id);
      startSession(res, repo, user, req, sessionTtlMs, isProd);
      repo.audit('login', user.id, null);
      res.json({ user: userDto(user), demo: true });
    } catch (err) { next(err); }
  });

  function startSession(res, repo2, user, req, ttl, prod) {
    const token = newToken();
    repo2.createSession(user.id, token, ttl, req.get('user-agent') || '');
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: prod, maxAge: ttl, path: '/',
    });
    return token;
  }

  app.post('/api/auth/logout', (req, res) => {
    if (req.sessionToken) repo.deleteSession(req.sessionToken);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.json({ user: null, demo: true });
    res.json({ user: userDto(repo.getUser(req.user.id)), demo: true });
  });

  app.patch('/api/auth/profile', requireAuth, (req, res, next) => {
    try {
      const settings = validateSettings(req.body?.settings || req.body || {});
      const user = repo.updateUserSettings(req.user.id, settings);
      res.json({ user: userDto(user) });
    } catch (err) { next(err); }
  });

  app.post('/api/auth/password', requireAuth, authLimiter, (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      const fresh = repo.getUser(req.user.id);
      if (!verifyPassword(String(currentPassword || ''), fresh.password_hash)) {
        return res.status(401).json({ error: 'Current password is incorrect.', code: 'INVALID_CREDENTIALS' });
      }
      repo.updatePassword(req.user.id, validatePassword(newPassword, 'newPassword'));
      // Invalidate every other session, then issue a fresh one.
      repo.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
      startSession(res, repo, fresh, req, sessionTtlMs, isProd);
      repo.audit('password_change', req.user.id, null);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  /* ------------------------------- game -------------------------------- */

  app.get('/api/game/state', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(publicState(engine, req.user?.id));
  });

  app.get('/api/game/history', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || CONFIG.historySize, 1), 100);
    res.json({ history: engine.history.slice(0, limit), serverTime: Date.now() });
  });

  /* ---------------------- public round history ------------------------ */
  // These routes only expose SETTLED demo rounds. A live round never reveals
  // its seed or crash point, and no player email/password data is included.

  app.get('/api/fairness', (_req, res) => {
    res.json({
      algorithm: ROUND_ALGORITHM,
      limitations: VERIFICATION_LIMITATIONS,
      disclaimer: FAIRNESS_DISCLAIMER,
      demo: true,
    });
  });

  app.get('/api/rounds', (req, res, next) => {
    try {
      const limit = parsePositiveInt(req.query.limit, 'limit', 20, 100);
      const before = req.query.before === undefined
        ? null
        : parsePositiveInt(req.query.before, 'before', null, Number.MAX_SAFE_INTEGER);
      const rows = repo.listSettledRounds(limit + 1, before);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).map((r) => buildRoundSummary(r, {
        betCount: r.bet_count,
        stakedCents: r.staked_cents,
        paidCents: r.paid_cents,
      }));
      res.set('Cache-Control', 'no-store');
      res.json({
        rounds: page,
        total: repo.countSettledRounds(),
        hasMore,
        nextBefore: hasMore ? page[page.length - 1].roundNo : null,
        algorithm: ROUND_ALGORITHM,
        disclaimer: FAIRNESS_DISCLAIMER,
        demo: true,
      });
    } catch (err) { next(err); }
  });

  app.get('/api/rounds/:id/verify', (req, res, next) => {
    try {
      const row = loadSettledRound(repo, req.params.id);
      const detail = buildRoundDetail(row, repo.listRoundBets(row.id));
      res.set('Cache-Control', 'no-store');
      res.json({
        roundId: detail.roundId,
        roundNo: detail.roundNo,
        crashPoint: detail.crashPoint,
        seedHash: detail.seedHash,
        serverSeed: detail.serverSeed,
        timestamps: detail.timestamps,
        verification: detail.verification,
        algorithm: ROUND_ALGORITHM,
        limitations: VERIFICATION_LIMITATIONS,
        disclaimer: FAIRNESS_DISCLAIMER,
        demo: true,
      });
    } catch (err) { next(err); }
  });

  app.get('/api/rounds/:id', (req, res, next) => {
    try {
      const row = loadSettledRound(repo, req.params.id);
      const detail = buildRoundDetail(row, repo.listRoundBets(row.id));
      res.set('Cache-Control', 'no-store');
      res.json({
        round: detail,
        algorithm: ROUND_ALGORITHM,
        disclaimer: FAIRNESS_DISCLAIMER,
        demo: true,
      });
    } catch (err) { next(err); }
  });

  app.post('/api/game/bet', requireAuth, actionLimiter, (req, res, next) => {
    try {
      const slot = Number(req.body?.slot);
      const stake = parseStake(req.body?.stake);
      if (stake === null) {
        throw new ValidationError('Enter a valid stake amount.', 'stake');
      }
      // normalize credits limits to cents inside engine
      const bet = engine.placeBet(req.user.id, slot, stake);
      const fresh = repo.getUser(req.user.id);
      res.status(201).json({
        bet: {
          id: bet.id, slot: bet.slot, stake: toCredits(bet.stake),
          status: bet.status, roundId: bet.roundId,
        },
        balance: toCredits(fresh.balance_cents),
        demo: true,
      });
    } catch (err) { next(err); }
  });

  app.post('/api/game/cashout', requireAuth, actionLimiter, (req, res, next) => {
    try {
      const slot = Number(req.body?.slot);
      const settled = engine.cashOut(req.user.id, slot);
      const fresh = repo.getUser(req.user.id);
      repo.audit('cashout', req.user.id, { roundId: settled.roundId, multiplier: settled.multiplier });
      res.json({
        cashout: {
          slot: settled.slot, multiplier: settled.multiplier,
          payout: toCredits(settled.payout), stake: toCredits(settled.stake),
          roundId: settled.roundId,
        },
        balance: toCredits(fresh.balance_cents),
        demo: true,
      });
    } catch (err) { next(err); }
  });

  /* --------------------------- player wallet --------------------------- */

  app.get('/api/me/bets', requireAuth, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    res.json({ bets: repo.getUserBets(req.user.id, limit).map(betDto) });
  });

  app.get('/api/me/transactions', requireAuth, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    res.json({
      transactions: repo.getUserTransactions(req.user.id, limit).map((t) => ({
        id: t.id,
        type: t.type,
        amount: toCredits(t.amount_cents),
        balanceAfter: toCredits(t.balance_after_cents),
        note: t.note,
        roundId: t.round_id,
        createdAt: t.created_at,
      })),
    });
  });

  app.post('/api/wallet/demo-topup', requireAuth, actionLimiter, (req, res) => {
    const last = repo.db.prepare(
      `SELECT created_at FROM transactions WHERE user_id=? AND type='demo_topup' ORDER BY created_at DESC LIMIT 1`,
    ).get(req.user.id);
    const cooldown = 5 * 60 * 1000;
    if (last && Date.now() - last.created_at < cooldown) {
      const wait = Math.ceil((cooldown - (Date.now() - last.created_at)) / 1000);
      return res.status(429).json({
        error: `Demo top-up available again in ${wait}s.`,
        code: 'TOPUP_COOLDOWN',
        retryAfter: wait,
      });
    }
    const amount = 2500_00;
    repo.tx(() => {
      repo.q(`UPDATE users SET balance_cents = balance_cents + ? WHERE id=?`).run(amount, req.user.id);
      const after = repo.getUser(req.user.id).balance_cents;
      repo.q(
        `INSERT INTO transactions (id,user_id,type,amount_cents,balance_after_cents,note,created_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(crypto.randomUUID(), req.user.id, 'demo_topup', amount, after,
        'DEMO top-up — virtual credits with no cash value', Date.now());
    });
    res.json({ balance: toCredits(repo.getUser(req.user.id).balance_cents), amount: toCredits(amount), demo: true });
  });

  /* -------------------------------- admin ------------------------------ */

  app.get('/api/admin/overview', requireAdmin, (req, res) => {
    const s = repo.stats();
    res.json({
      stats: {
        users: s.users, bots: s.bots, rounds: s.rounds, bets: s.bets,
        wagered: toCredits(s.wagered), paid: toCredits(s.paid),
        houseNet: toCredits(s.wagered - s.paid), balances: toCredits(s.balances),
      },
      currentRound: engine.getSnapshot(),
      demo: true,
    });
  });

  app.get('/api/admin/users', requireAdmin, (req, res) => {
    res.json({
      users: repo.listUsers({ includeBots: req.query.bots === '1' }).map((u) => ({
        id: u.id, email: u.email, username: u.username, role: u.role,
        balance: toCredits(u.balance_cents), isBot: !!u.is_bot,
        betCount: u.bet_count, createdAt: u.created_at, lastLoginAt: u.last_login_at,
      })),
    });
  });

  app.get('/api/admin/rounds', requireAdmin, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200);
    res.json({
      rounds: repo.listRounds(limit).map((r) => ({
        id: r.id, roundNo: r.round_no,
        // Never expose an unrevealed crash point, not even to the admin UI.
        crashPoint: r.status === 'crashed' ? r.crash_point : null,
        status: r.status,
        startedAt: r.started_at, crashedAt: r.crashed_at,
        betCount: r.bet_count, staked: toCredits(r.staked_cents), paid: toCredits(r.paid_cents),
        seedHash: r.seed_hash, serverSeed: r.status === 'crashed' ? r.server_seed : null,
      })),
    });
  });

  app.get('/api/admin/rounds/:id', requireAdmin, (req, res) => {
    const round = repo.getRound(req.params.id);
    if (!round) return res.status(404).json({ error: 'Round not found.', code: 'NOT_FOUND' });
    res.json({
      round: {
        id: round.id, roundNo: round.round_no, crashPoint: round.crash_point,
        status: round.status, startedAt: round.started_at, crashedAt: round.crashed_at,
        seedHash: round.seed_hash, serverSeed: round.server_seed,
      },
      bets: repo.listRoundBets(round.id).map((b) => ({
        id: b.id, username: b.username, slot: b.slot, stake: toCredits(b.stake),
        status: b.status, multiplier: b.multiplier, payout: toCredits(b.payout),
        isBot: b.isBot, placedAt: b.placedAt, cashedAt: b.cashedAt,
      })),
    });
  });

  /* --------------------------- live stream (SSE) ----------------------- */

  const sseClients = new Set();
  engine.subscribe((event) => {
    if (!event) return;
    for (const client of sseClients) {
      try { sendSse(client, event); } catch { sseClients.delete(client); }
    }
  });

  app.get('/api/game/stream', (req, res) => {
    if (sseClients.size >= maxSseClients) {
      return res.status(503).json({ error: 'Live stream is at capacity.', code: 'STREAM_FULL' });
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const client = { res };
    sseClients.add(client);
    sendSse(client, { type: 'state', state: engine.getSnapshot(req.user?.id) });

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* closed */ }
    }, 15000);
    if (heartbeat.unref) heartbeat.unref();

    const cleanup = () => {
      clearInterval(heartbeat);
      sseClients.delete(client);
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
  });

  /* --------------------------- static client --------------------------- */

  const dist = path.resolve(__dirname, '../dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    app.get('/', (_req, res) => {
      res.type('text/plain').send(
        'PATAPOTEA API is running. Client build not found — run `npm run build`, or use `npm run dev`.',
      );
    });
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' }));

  /* ----------------------------- errors -------------------------------- */

  app.use((err, _req, res, _next) => {
    if (err instanceof GameError) {
      return res.status(err.status || 400).json({ error: err.message, code: err.code });
    }
    if (err instanceof ValidationError) {
      return res.status(err.status || 400).json({ error: err.message, code: err.code, field: err.field });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed request body.', code: 'BAD_JSON' });
    }
    console.error('[patapotea] unhandled error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'INTERNAL' });
  });

  return app;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Strict positive-integer query parameter parsing. */
function parsePositiveInt(raw, field, fallback, max) {
  if (raw === undefined || raw === '') {
    if (fallback === null) return null;
    return fallback;
  }
  const value = String(raw).trim();
  if (!/^[0-9]+$/.test(value)) {
    throw new ValidationError(`${field} must be a positive integer.`, field);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new ValidationError(`${field} must be a positive integer.`, field);
  }
  return Math.min(n, max);
}

/** Fetch a round that is safe to disclose publicly. */
function loadSettledRound(repo, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new ValidationError('Invalid round ID.', 'id');
  }
  const row = repo.getRound(id);
  if (!row) throw new GameError('ROUND_NOT_FOUND', 'Round not found.', 404);
  if (row.status !== 'crashed') {
    throw new GameError(
      'ROUND_NOT_SETTLED',
      'This round has not settled yet. Its seed and crash point stay hidden until it crashes.',
      409,
    );
  }
  return row;
}

function publicState(engine, userId) {
  const snap = engine.getSnapshot(userId || null);
  return {
    ...snap,
    bets: snap.bets.map((b) => ({
      id: b.id, userId: b.userId, username: b.username, slot: b.slot,
      stake: toCredits(b.stake), status: b.status, multiplier: b.multiplier,
      payout: toCredits(b.payout), isBot: b.isBot, mine: !!userId && b.userId === userId,
    })),
    demo: true,
  };
}

function sendSse(client, event) {
  const payload = { ...event };
  if (payload.state) {
    payload.state = { ...payload.state, bets: payload.state.bets.map((b) => ({
      id: b.id, userId: b.userId, username: b.username, slot: b.slot,
      stake: toCredits(b.stake), status: b.status, multiplier: b.multiplier,
      payout: toCredits(b.payout), isBot: b.isBot,
    })), demo: true };
  }
  if (typeof payload.payout === 'number') payload.payout = toCredits(payload.payout);
  if (typeof payload.stake === 'number') payload.stake = toCredits(payload.stake);
  client.res.write(`event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`);
}
