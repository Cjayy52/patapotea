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
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 11) % 256),
    bots: false,
    config: { bettingMs: 1000, crashedMs: 300, tickMs: 50 },
  });
  seedDemoAccounts(repo, { adminPassword: 'AdminPass123', playerPassword: 'PlayerPass123' });
  engine.beginBetting();

  const app = createApp({ repo, engine });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const request = async (path, { method = 'GET', body, cookie } = {}) => {
    const headers = { Accept: 'application/json', 'X-Requested-With': 'patapotea' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
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
    return {
      status: res.status,
      data,
      cookie: setCookies.map((c) => c.split(';')[0]).join('; '),
    };
  };

  return {
    db,
    repo,
    engine,
    clock,
    server,
    request,
    advance(ms) { clock.t += ms; engine.tick(); },
    /** Advance from the current betting window through takeoff and crash. */
    settle() {
      this.advance(1000);
      this.advance(durationForMultiplier(engine.round.crashPoint) + 5);
    },
    /** Move from a crashed round into the next betting window. */
    nextRound() {
      this.advance(300);
    },
    async close() { await new Promise((r) => server.close(r)); db.close(); },
  };
}

async function loginPlayer(world) {
  const res = await world.request('/auth/login', {
    method: 'POST',
    body: { email: 'player@patapotea.demo', password: 'PlayerPass123' },
  });
  assert.equal(res.status, 200);
  return res.cookie;
}

/* -------------------------------------------------------------------------- */
/* Public round history                                                       */
/* -------------------------------------------------------------------------- */

test('public round list only contains settled rounds and exposes no seed', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());

  const empty = await world.request('/rounds');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.data.rounds, []);
  assert.equal(empty.data.total, 0);

  const cookie = await loginPlayer(world);
  await world.request('/game/bet', { method: 'POST', cookie, body: { slot: 0, stake: 100 } });
  world.settle();

  const settled = await world.request('/rounds');
  assert.equal(settled.status, 200);
  assert.equal(settled.data.total, 1);
  assert.equal(settled.data.rounds.length, 1);
  const round = settled.data.rounds[0];
  assert.equal(round.status, 'crashed');
  assert.equal(typeof round.roundId, 'string');
  assert.ok(round.roundId.length >= 8);
  assert.equal(round.stats.betCount, 1);
  assert.equal(round.stats.staked, 100);
  assert.equal('serverSeed' in round, false, 'list must not reveal seeds');

  // Start the next (active) round — it must not appear in history.
  world.nextRound();
  assert.equal(world.engine.round.phase, 'betting');
  const after = await world.request('/rounds');
  assert.equal(after.data.total, 1);
  assert.equal(after.data.rounds.length, 1);
  assert.ok(after.data.rounds.every((r) => r.roundId !== world.engine.round.id));
});

test('round records include unique ids, timestamps, commitment and verification', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());

  const cookie = await loginPlayer(world);
  await world.request('/game/bet', { method: 'POST', cookie, body: { slot: 0, stake: 250 } });
  world.settle();
  const firstId = world.engine.round.id;
  const firstNo = world.engine.round.roundNo;

  world.nextRound();
  world.settle();
  const secondId = world.engine.round.id;

  assert.notEqual(firstId, secondId, 'each round must have a unique id');

  const list = await world.request('/rounds');
  assert.equal(list.data.total, 2);

  const detail = await world.request(`/rounds/${firstId}`);
  assert.equal(detail.status, 200);
  const r = detail.data.round;
  assert.equal(r.roundId, firstId);
  assert.equal(r.roundNo, firstNo);
  assert.equal(r.status, 'crashed');
  assert.equal(r.crashPoint, world.engine.history.find((h) => h.roundId === firstId).crashPoint);
  assert.equal(r.seedHash.length, 64);
  assert.equal(r.serverSeed.length, 64);

  const ts = r.timestamps;
  assert.ok(ts.startedAt > 0);
  assert.ok(ts.bettingEndsAt >= ts.startedAt);
  assert.ok(ts.flyingAt >= ts.bettingEndsAt);
  assert.ok(ts.crashAt >= ts.flyingAt);
  assert.ok(ts.crashedAt >= ts.crashAt);
  assert.ok(r.flightDurationMs > 0);
  assert.ok(detail.data.round.flightDurationMs >= ts.crashAt - ts.flyingAt);

  assert.equal(r.verification.verified, true);
  assert.equal(r.verification.commitmentMatches, true);
  assert.equal(r.verification.crashMatches, true);
  assert.equal(r.verification.computedCrashPoint, r.crashPoint);
  assert.equal(r.bets.length, 1);
  assert.ok(['cashed', 'lost'].includes(r.bets[0].status));
  assert.equal(r.bets[0].stake, 250);

  // No credentials or email addresses in a public round record.
  assert.equal(JSON.stringify(detail.data).includes('@'), false);
  assert.equal(JSON.stringify(detail.data).toLowerCase().includes('password'), false);
});

test('round detail and verification endpoints are idempotent', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());
  world.settle();
  const id = world.engine.round.id;

  const a = await world.request(`/rounds/${id}`);
  const b = await world.request(`/rounds/${id}`);
  const c = await world.request(`/rounds/${id}`);
  assert.equal(a.status, 200);
  assert.deepEqual(a.data, b.data);
  assert.deepEqual(b.data, c.data);

  const v1 = await world.request(`/rounds/${id}/verify`);
  const v2 = await world.request(`/rounds/${id}/verify`);
  const v3 = await world.request(`/rounds/${id}/verify`);
  assert.equal(v1.status, 200);
  assert.deepEqual(v1.data, v2.data);
  assert.deepEqual(v2.data, v3.data);
  assert.equal(v1.data.verification.verified, true);
  assert.equal(v1.data.roundId, id);
  assert.equal(v1.data.algorithm.id, 'patapotea-sha256-v1');
  assert.ok(v1.data.limitations.length >= 5);
  assert.match(v1.data.disclaimer, /not independently audited/i);
});

test('verification reveals nothing about a round that has not settled', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());
  world.settle();
  world.nextRound(); // active betting round
  const active = world.engine.round;

  const detail = await world.request(`/rounds/${active.id}`);
  assert.equal(detail.status, 409);
  assert.equal(detail.data.code, 'ROUND_NOT_SETTLED');
  assert.equal(JSON.stringify(detail.data).includes(active.serverSeed), false);

  const verify = await world.request(`/rounds/${active.id}/verify`);
  assert.equal(verify.status, 409);
  assert.equal(verify.data.code, 'ROUND_NOT_SETTLED');
  assert.equal(JSON.stringify(verify.data).includes(active.serverSeed), false);
  assert.equal(JSON.stringify(verify.data).includes('crashPoint'), false);

  // The public list still contains only the earlier settled round.
  const list = await world.request('/rounds');
  assert.equal(list.data.rounds.length, 1);
  assert.ok(list.data.rounds.every((r) => r.roundId !== active.id));
});

test('unknown and malformed round ids are refused', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());

  const unknown = await world.request('/rounds/11111111-2222-3333-4444-555555555555');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.data.code, 'ROUND_NOT_FOUND');

  for (const id of ['bad$id', '%20', 'a'.repeat(200), 'id with spaces']) {
    const res = await world.request(`/rounds/${encodeURIComponent(id)}`);
    assert.equal(res.status, 400, `id ${id} -> ${res.status}`);
    assert.equal(res.data.code, 'VALIDATION_ERROR');
  }
});

/* -------------------------------------------------------------------------- */
/* Pagination / invalid inputs                                                */
/* -------------------------------------------------------------------------- */

test('pagination validates input, clamps limits and pages backwards', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());

  world.settle();
  const newer = world.engine.round.roundNo;
  world.nextRound();
  world.settle();
  const older = world.engine.round.roundNo;

  for (const query of ['limit=abc', 'limit=0', 'limit=-1', 'limit=1.5', 'before=abc', 'before=0']) {
    const res = await world.request(`/rounds?${query}`);
    assert.equal(res.status, 400, query);
    assert.equal(res.data.code, 'VALIDATION_ERROR');
  }

  const huge = await world.request('/rounds?limit=9999');
  assert.equal(huge.status, 200);
  assert.ok(huge.data.rounds.length <= 100);

  const page1 = await world.request('/rounds?limit=1');
  assert.equal(page1.status, 200);
  assert.equal(page1.data.rounds.length, 1);
  assert.equal(page1.data.hasMore, true);
  assert.equal(page1.data.rounds[0].roundNo, older);
  assert.equal(page1.data.nextBefore, older);

  const page2 = await world.request(`/rounds?limit=1&before=${page1.data.nextBefore}`);
  assert.equal(page2.status, 200);
  assert.equal(page2.data.rounds[0].roundNo, newer);
  assert.equal(page2.data.hasMore, false);
});

/* -------------------------------------------------------------------------- */
/* Algorithm disclosure                                                       */
/* -------------------------------------------------------------------------- */

test('fairness metadata discloses the scheme and its limitations', async (t) => {
  const world = await makeServer();
  t.after(() => world.close());

  const res = await world.request('/fairness');
  assert.equal(res.status, 200);
  assert.equal(res.data.algorithm.id, 'patapotea-sha256-v1');
  assert.match(res.data.algorithm.derivation, /serverSeed.*roundNo/);
  assert.equal(res.data.algorithm.houseEdge, 0.03);
  assert.ok(res.data.limitations.length >= 5);
  assert.match(res.data.limitations.join(' '), /not been reviewed|certified|audited/i);
  assert.match(res.data.disclaimer, /not independently audited/i);
  assert.equal(res.data.demo, true);
});
