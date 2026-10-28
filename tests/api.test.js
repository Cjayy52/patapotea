import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDatabase, SqliteRepo, seedDemoAccounts } from '../server/db.js';
import { CrashEngine } from '../server/game/engine.js';
import { createApp } from '../server/app.js';
import { durationForMultiplier } from '../shared/game-math.js';

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

async function makeServer() {
  const db = createDatabase(':memory:');
  const repo = new SqliteRepo(db);
  const clock = { t: 1_700_000_000_000 };
  const engine = new CrashEngine({
    repo,
    now: () => clock.t,
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 29 + 7) % 256),
    bots: false,
    config: { bettingMs: 2000, crashedMs: 500 },
  });
  seedDemoAccounts(repo, { adminPassword: 'AdminPass123', playerPassword: 'PlayerPass123' });
  engine.beginBetting();

  const app = createApp({ repo, engine, isProd: false, sessionTtlMs: 60_000 });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const request = async (path, { method = 'GET', body, cookie, csrf = true } = {}) => {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf) headers['X-Requested-With'] = 'patapotea';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const cookieOut = setCookies.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, data, cookie: cookieOut, headers: res.headers };
  };

  return {
    db, repo, engine, clock, server, request,
    advance(ms) { clock.t += ms; engine.tick(); },
    async close() { await new Promise((r) => server.close(r)); db.close(); },
  };
}

async function registerUser(world, suffix = 'a') {
  const res = await world.request('/auth/register', {
    method: 'POST',
    body: { email: `user${suffix}@example.com`, username: `user${suffix}`, password: 'Password123' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return { cookie: res.cookie, user: res.data.user };
}

/* -------------------------------------------------------------------------- */
/* Auth                                                                       */
/* -------------------------------------------------------------------------- */

test('registration validates input and grants demo credits', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());

  const badEmail = await world.request('/auth/register', {
    method: 'POST', body: { email: 'nope', username: 'validname', password: 'Password123' },
  });
  assert.equal(badEmail.status, 400);
  assert.equal(badEmail.data.field, 'email');

  const badPassword = await world.request('/auth/register', {
    method: 'POST', body: { email: 'x@example.com', username: 'validname', password: 'short' },
  });
  assert.equal(badPassword.status, 400);
  assert.equal(badPassword.data.field, 'password');

  const badUsername = await world.request('/auth/register', {
    method: 'POST', body: { email: 'x@example.com', username: 'no spaces!', password: 'Password123' },
  });
  assert.equal(badUsername.status, 400);
  assert.equal(badUsername.data.field, 'username');

  const ok = await registerUser(world, 'one');
  assert.equal(ok.user.balance, 10000);
  assert.equal(ok.user.isDemo, true);
  assert.equal(ok.user.role, 'player');
  assert.match(ok.cookie, /pp_session=/);

  const me = await world.request('/auth/me', { cookie: ok.cookie });
  assert.equal(me.data.user.username, 'userone');

  const dupe = await world.request('/auth/register', {
    method: 'POST', body: { email: 'userone@example.com', username: 'other', password: 'Password123' },
  });
  assert.equal(dupe.status, 409);
  assert.equal(dupe.data.code, 'EMAIL_TAKEN');
});

test('login rejects bad credentials and accepts seeded demo accounts', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());

  const bad = await world.request('/auth/login', {
    method: 'POST', body: { email: 'player@patapotea.demo', password: 'wrong-password' },
  });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.code, 'INVALID_CREDENTIALS');

  const ok = await world.request('/auth/login', {
    method: 'POST', body: { email: 'player@patapotea.demo', password: 'PlayerPass123' },
  });
  assert.equal(ok.status, 200);
  assert.match(ok.cookie, /pp_session=/);
  assert.equal(ok.data.user.role, 'player');
});

test('mutations require the CSRF header and authentication', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());

  const noCsrf = await world.request('/auth/login', {
    method: 'POST', body: { email: 'player@patapotea.demo', password: 'PlayerPass123' }, csrf: false,
  });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.data.code, 'CSRF_REJECTED');

  const anon = await world.request('/game/bet', { method: 'POST', body: { slot: 0, stake: 10 } });
  assert.equal(anon.status, 401);

  const anonCash = await world.request('/game/cashout', { method: 'POST', body: { slot: 0 } });
  assert.equal(anonCash.status, 401);
});

test('logout invalidates the session', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());
  const { cookie } = await registerUser(world, 'logout');

  const out = await world.request('/auth/logout', { method: 'POST', cookie });
  assert.equal(out.status, 200);
  const me = await world.request('/auth/me', { cookie });
  assert.equal(me.data.user, null);
});

/* -------------------------------------------------------------------------- */
/* HTTP game flow                                                             */
/* -------------------------------------------------------------------------- */

test('full HTTP bet → cash-out flow with ledger and balance updates', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());
  const { cookie, user } = await registerUser(world, 'flow');

  const state = await world.request('/game/state', { cookie });
  assert.equal(state.status, 200);
  assert.equal(state.data.phase, 'betting');
  assert.equal(state.data.crashPoint, null);

  const bet = await world.request('/game/bet', { method: 'POST', cookie, body: { slot: 0, stake: 100 } });
  assert.equal(bet.status, 201, JSON.stringify(bet.data));
  assert.equal(bet.data.balance, 9900);
  assert.equal(bet.data.bet.stake, 100);

  const duplicate = await world.request('/game/bet', { method: 'POST', cookie, body: { slot: 0, stake: 50 } });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.code, 'SLOT_TAKEN');

  // second concurrent slot is allowed
  const second = await world.request('/game/bet', { method: 'POST', cookie, body: { slot: 1, stake: 50 } });
  assert.equal(second.status, 201);
  assert.equal(second.data.balance, 9850);

  const negative = await world.request('/game/bet', { method: 'POST', cookie, body: { slot: 0, stake: -100 } });
  assert.equal(negative.status, 400);
  assert.equal(negative.data.code, 'STAKE_TOO_LOW');
  const tooBig = await world.request('/game/bet', { method: 'POST', cookie, body: { slot: 1, stake: 999999 } });
  assert.equal(tooBig.status, 400);
  assert.equal(tooBig.data.code, 'STAKE_TOO_HIGH');

  world.advance(2000); // take off
  const flying = await world.request('/game/state', { cookie });
  assert.equal(flying.data.phase, 'flying');
  assert.equal(flying.data.serverSeed, null);

  world.advance(1500);
  const cash = await world.request('/game/cashout', { method: 'POST', cookie, body: { slot: 0 } });
  assert.equal(cash.status, 200, JSON.stringify(cash.data));
  assert.ok(cash.data.cashout.multiplier >= 1.1);
  assert.equal(cash.data.balance, 9850 + cash.data.cashout.payout);

  const again = await world.request('/game/cashout', { method: 'POST', cookie, body: { slot: 0 } });
  assert.equal(again.status, 409);
  assert.equal(again.data.code, 'ALREADY_SETTLED');

  const me = await world.request('/auth/me', { cookie });
  assert.equal(me.data.user.balance, cash.data.balance);

  const tx = await world.request('/me/transactions', { cookie });
  const types = tx.data.transactions.map((x) => x.type);
  assert.ok(types.includes('signup_bonus'));
  assert.ok(types.includes('bet_stake'));
  assert.ok(types.includes('cashout_credit'));
  assert.equal(types.filter((x) => x === 'cashout_credit').length, 1);

  const bets = await world.request('/me/bets', { cookie });
  assert.equal(bets.data.bets.length, 2);
  assert.equal(bets.data.bets.find((b) => b.slot === 0).status, 'cashed');
  assert.equal(bets.data.bets.find((b) => b.slot === 1).status, 'active');

  // crash: slot 1 is lost, history reveals the outcome
  const crashDuration = durationForMultiplier(world.engine.round.crashPoint);
  world.advance(crashDuration + 10);
  const crashed = await world.request('/game/state', { cookie });
  assert.equal(crashed.data.phase, 'crashed');
  assert.equal(crashed.data.crashPoint, world.engine.round.crashPoint);
  assert.ok(crashed.data.serverSeed);
  assert.equal(crashed.data.bets.find((b) => b.slot === 1).status, 'lost');

  const late = await world.request('/game/cashout', { method: 'POST', cookie, body: { slot: 1 } });
  assert.equal(late.status, 409);
  assert.equal(late.data.code, 'ROUND_NOT_ACTIVE');
  assert.equal((await world.request('/auth/me', { cookie })).data.user.balance, cash.data.balance);
});

test('server rejects bets outside the betting window', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());
  const { cookie } = await registerUser(world, 'window');

  world.advance(2001);
  const res = await world.request('/game/bet', { method: 'POST', cookie, body: { slot: 0, stake: 100 } });
  assert.equal(res.status, 409);
  assert.equal(res.data.code, 'BETTING_CLOSED');
});

test('stake and slot payloads are validated at the HTTP boundary', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());
  const { cookie } = await registerUser(world, 'valid');

  for (const stake of ['abc', null, '', '1.234', -10]) {
    const res = await world.request('/game/bet', { method: 'POST', cookie, body: { slot: 0, stake } });
    assert.equal(res.status, 400, `stake ${stake} -> ${res.status}`);
  }
  const slot = await world.request('/game/bet', { method: 'POST', cookie, body: { slot: 9, stake: 10 } });
  assert.equal(slot.status, 400);
  assert.equal(slot.data.code, 'INVALID_SLOT');
});

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

test('admin endpoints require the admin role and hide unrevealed crash points', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());

  const player = await registerUser(world, 'pleb');
  const forbidden = await world.request('/admin/overview', { cookie: player.cookie });
  assert.equal(forbidden.status, 403);

  const adminLogin = await world.request('/auth/login', {
    method: 'POST', body: { email: 'admin@patapotea.demo', password: 'AdminPass123' },
  });
  assert.equal(adminLogin.status, 200);
  const cookie = adminLogin.cookie;

  const overview = await world.request('/admin/overview', { cookie });
  assert.equal(overview.status, 200);
  assert.equal(overview.data.stats.users >= 1, true);
  assert.equal(overview.data.currentRound.crashPoint, null);
  assert.equal(overview.data.currentRound.serverSeed, null);

  const rounds = await world.request('/admin/rounds', { cookie });
  assert.equal(rounds.status, 200);
  assert.ok(rounds.data.rounds.every((r) => r.status === 'crashed' || r.crashPoint === null));
  assert.ok(rounds.data.rounds.every((r) => r.status !== 'crashed' || typeof r.crashPoint === 'number'));

  const users = await world.request('/admin/users', { cookie });
  assert.equal(users.status, 200);
  assert.ok(users.data.users.some((u) => u.role === 'admin'));
  assert.ok(users.data.users.every((u) => u.isBot === false || u.isBot === true));
  assert.ok(users.data.users.every((u) => typeof u.balance === 'number'));
});

/* -------------------------------------------------------------------------- */
/* Wallet                                                                     */
/* -------------------------------------------------------------------------- */

test('demo top-up is rate limited and clearly labelled', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());
  const { cookie } = await registerUser(world, 'topup');

  const first = await world.request('/wallet/demo-topup', { method: 'POST', cookie });
  assert.equal(first.status, 200);
  assert.equal(first.data.amount, 2500);
  assert.equal(first.data.balance, 12500);

  const second = await world.request('/wallet/demo-topup', { method: 'POST', cookie });
  assert.equal(second.status, 429);
  assert.equal(second.data.code, 'TOPUP_COOLDOWN');

  const tx = await world.request('/me/transactions', { cookie });
  const topup = tx.data.transactions.find((x) => x.type === 'demo_topup');
  assert.match(topup.note, /DEMO/i);
});

test('profile settings validate auto cash-out bounds', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());
  const { cookie } = await registerUser(world, 'settings');

  const bad = await world.request('/auth/profile', {
    method: 'PATCH', cookie, body: { settings: { sound: false, autoCashOut: 0.5 } },
  });
  assert.equal(bad.status, 400);

  const ok = await world.request('/auth/profile', {
    method: 'PATCH', cookie, body: { settings: { sound: false, autoCashOut: 2.5 } },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.settings.autoCashOut, 2.5);
  assert.equal(ok.data.user.settings.sound, false);
});

test('unknown API routes return a JSON 404', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());
  const res = await world.request('/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.data.code, 'NOT_FOUND');
});
