import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, SqliteRepo, seedDemoAccounts } from '../server/db.js';
import { CrashEngine } from '../server/game/engine.js';
import { CONFIG, PHASE } from '../shared/config.js';
import {
  crashPointFromHash, crashPointFromUniform, durationForMultiplier,
  multiplierAt, payoutFor, parseStake,
} from '../shared/game-math.js';
import { sha256Hex } from '../shared/sha256.js';
import { multiplierAt as multAt } from '../shared/game-math.js';

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

function makeWorld(overrides = {}) {
  const db = createDatabase(':memory:');
  const repo = new SqliteRepo(db);
  const clock = { t: 1_700_000_000_000 };
  const engine = new CrashEngine({
    repo,
    now: () => clock.t,
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 17 + 3) % 256),
    bots: false,
    config: { bettingMs: 1000, crashedMs: 500, tickMs: 50, ...overrides },
  });
  const users = seedDemoAccounts(repo, { adminPassword: 'AdminPass123', playerPassword: 'PlayerPass123' });
  const player = repo.getUserByEmail('player@patapotea.demo');
  const admin = repo.getUserByEmail('admin@patapotea.demo');
  return { db, repo, engine, clock, player, admin, users };
}

const advance = (clock, engine, ms) => {
  clock.t += ms;
  engine.tick();
};

/* -------------------------------------------------------------------------- */
/* Shared math                                                                */
/* -------------------------------------------------------------------------- */

test('sha256 matches known vectors', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('crash point generation respects edge, floor and ceiling', () => {
  assert.equal(crashPointFromUniform(0), 1);
  assert.equal(crashPointFromUniform(0.5), 1.94);
  assert.ok(crashPointFromUniform(0.999999) <= CONFIG.maxMultiplier);
  const fromHash = crashPointFromHash('fffffffffffff0000');
  assert.ok(fromHash >= 1);
  // distribution sanity: median should sit near 2x with a 3% edge
  const samples = Array.from({ length: 3000 }, (_, i) => crashPointFromHash(sha256Hex(`s${i}`)));
  const median = samples.sort((a, b) => a - b)[1500];
  assert.ok(median > 1.7 && median < 2.1, `median ${median}`);
  assert.ok(samples.every((x) => x >= 1 && x <= CONFIG.maxMultiplier));
});

test('multiplier and payout math are monotonic and safe', () => {
  assert.equal(multiplierAt(500), 1.04);
  assert.equal(multiplierAt(10_000), 2.45);
  assert.equal(multiplierAt(-5), 1);
  assert.equal(multiplierAt(Number.NaN), 1);
  const t = durationForMultiplier(2.45);
  assert.ok(Math.abs(multiplierAt(t) - 2.45) <= 0.01);
  assert.equal(payoutFor(10_000, 2.5), 25_000);
  assert.equal(payoutFor(0, 5), 0);
  assert.equal(payoutFor(-100, 5), 0);
  assert.equal(parseStake('12.34'), 1234);
  assert.equal(parseStake('12.345'), null);
  assert.equal(parseStake(''), null);
  assert.equal(parseStake('-5'), -500);
});

/* -------------------------------------------------------------------------- */
/* Betting                                                                    */
/* -------------------------------------------------------------------------- */

test('betting debits credits and records a ledger entry', () => {
  const { repo, engine, clock, player } = makeWorld();
  engine.beginBetting();
  const before = repo.getUser(player.id).balance_cents;
  const bet = engine.placeBet(player.id, 0, 5000);
  assert.equal(bet.stake, 5000);
  assert.equal(repo.getUser(player.id).balance_cents, before - 5000);
  const tx = repo.getUserTransactions(player.id).find((t) => t.type === 'bet_stake');
  assert.ok(tx);
  assert.equal(tx.amount_cents, -5000);
  assert.equal(tx.balance_after_cents, before - 5000);
  assert.equal(engine.getSnapshot().bets.length, 1);
  assert.equal(clock.t >= 0, true);
});

test('invalid stakes are rejected without touching the balance', () => {
  const { repo, engine, player } = makeWorld();
  engine.beginBetting();
  const before = repo.getUser(player.id).balance_cents;

  for (const stake of [-100, 0, 99, 500001]) {
    assert.throws(() => engine.placeBet(player.id, 0, stake), (err) => err.code === 'STAKE_TOO_LOW' || err.code === 'STAKE_TOO_HIGH');
  }
  assert.throws(() => engine.placeBet(player.id, 0, 10.5), (err) => err.code === 'INVALID_STAKE');
  assert.equal(repo.getUser(player.id).balance_cents, before);
  assert.equal(repo.getUserBets(player.id).length, 0);
});

test('negative and out-of-range slots are rejected', () => {
  const { engine, player } = createWorldWithRound();
  assert.throws(() => engine.placeBet(player.id, -1, 1000), (e) => e.code === 'INVALID_SLOT');
  assert.throws(() => engine.placeBet(player.id, 2, 1000), (e) => e.code === 'INVALID_SLOT');
  assert.throws(() => engine.placeBet(player.id, 1.5, 1000), (e) => e.code === 'INVALID_SLOT');
});

test('a player can hold two simultaneous bets, but not two in one slot', () => {
  const { engine, player, repo } = createWorldWithRound();
  engine.placeBet(player.id, 0, 1000);
  assert.throws(() => engine.placeBet(player.id, 0, 1000), (e) => e.code === 'SLOT_TAKEN');
  engine.placeBet(player.id, 1, 2500);
  assert.equal(repo.listRoundBets(engine.round.id).length, 2);
  // A second player trying the same slot is fine (unique is per player+slot).
  const bot = repo.listBots()[0];
  engine.placeBet(bot.id, 0, 1000);
  assert.equal(repo.listRoundBets(engine.round.id).length, 3);
});

test('insufficient balance is rejected', () => {
  const { engine, player, repo } = makeWorld();
  engine.beginBetting();
  repo.db.prepare('UPDATE users SET balance_cents = 100 WHERE id = ?').run(player.id);
  assert.throws(() => engine.placeBet(player.id, 0, 5000), (e) => e.code === 'INSUFFICIENT_BALANCE');
  assert.equal(repo.getUser(player.id).balance_cents, 100);
  assert.equal(repo.getUserBets(player.id).length, 0);
});

test('bets are refused once the flight has started', () => {
  const { engine, clock, player } = makeWorld();
  engine.beginBetting();
  advance(clock, engine, 1001);
  assert.equal(engine.round.phase, PHASE.FLYING);
  assert.throws(() => engine.placeBet(player.id, 0, 1000), (e) => e.code === 'BETTING_CLOSED');
});

/* -------------------------------------------------------------------------- */
/* Cash-outs                                                                  */
/* -------------------------------------------------------------------------- */

function createWorldWithRound(overrides) {
  const world = makeWorld(overrides);
  world.engine.beginBetting();
  return world;
}

test('cash out pays stake × server multiplier and credits the balance once', () => {
  const { engine, repo, clock, player } = createWorldWithRound();
  engine.placeBet(player.id, 0, 10_000);
  const balanceAfterBet = repo.getUser(player.id).balance_cents;

  advance(clock, engine, 1000); // start flight
  assert.equal(engine.round.phase, PHASE.FLYING);
  const elapsed = 3000;
  const expectedMultiplier = multAt(elapsed);
  advance(clock, engine, elapsed);

  const settled = engine.cashOut(player.id, 0);
  assert.equal(settled.status, 'cashed');
  assert.equal(settled.multiplier, expectedMultiplier);
  const expectedPayout = payoutFor(10_000, expectedMultiplier);
  assert.equal(settled.payout, expectedPayout);
  assert.equal(repo.getUser(player.id).balance_cents, balanceAfterBet + expectedPayout);

  const credits = repo.getUserTransactions(player.id).filter((t) => t.type === 'cashout_credit');
  assert.equal(credits.length, 1);
  assert.equal(credits[0].amount_cents, expectedPayout);
});

test('duplicate cash-outs are refused and never double-credit', () => {
  const { engine, clock, player, repo } = createWorldWithRound();
  engine.placeBet(player.id, 0, 5000);
  advance(clock, engine, 1000);
  advance(clock, engine, 2000);
  const first = engine.cashOut(player.id, 0);
  const balance = repo.getUser(player.id).balance_cents;

  assert.throws(() => engine.cashOut(player.id, 0), (e) => e.code === 'ALREADY_SETTLED');
  assert.equal(repo.getUser(player.id).balance_cents, balance);
  assert.equal(repo.getUserTransactions(player.id).filter((t) => t.type === 'cashout_credit').length, 1);
  assert.ok(first.multiplier >= 1);
});

test('cash-outs are refused after the crash, and the bet is lost', () => {
  const { engine, clock, player, repo } = createWorldWithRound();
  engine.placeBet(player.id, 0, 5000);
  const balanceAfterBet = repo.getUser(player.id).balance_cents;
  advance(clock, engine, 1000);
  const crashDuration = durationForMultiplier(engine.round.crashPoint);
  advance(clock, engine, crashDuration + 10);

  assert.equal(engine.round.phase, PHASE.CRASHED);
  assert.throws(() => engine.cashOut(player.id, 0), (e) => e.code === 'ROUND_NOT_ACTIVE');
  assert.equal(repo.getUser(player.id).balance_cents, balanceAfterBet);
  assert.equal(repo.getUserBets(player.id)[0].status, 'lost');
});

test('cash out is refused before the plane takes off', () => {
  const { engine, player } = createWorldWithRound();
  engine.placeBet(player.id, 0, 5000);
  assert.throws(() => engine.cashOut(player.id, 0), (e) => e.code === 'ROUND_NOT_ACTIVE');
});

test('cash out without a bet is refused', () => {
  const { engine, clock, player } = createWorldWithRound();
  advance(clock, engine, 1000);
  advance(clock, engine, 500);
  assert.throws(() => engine.cashOut(player.id, 0), (e) => e.code === 'NO_BET');
});

test('cash out refuses a slot the player did not use', () => {
  const { engine, clock, player } = createWorldWithRound();
  engine.placeBet(player.id, 0, 1000);
  advance(clock, engine, 1000);
  advance(clock, engine, 500);
  assert.throws(() => engine.cashOut(player.id, 1), (e) => e.code === 'NO_BET');
});

test('only the remaining bet is lost when one slot cashes out', () => {
  const { engine, clock, player, repo } = createWorldWithRound();
  engine.placeBet(player.id, 0, 1000);
  engine.placeBet(player.id, 1, 1000);
  advance(clock, engine, 1000);
  advance(clock, engine, 1000);
  engine.cashOut(player.id, 0);
  const crashDuration = durationForMultiplier(engine.round.crashPoint);
  advance(clock, engine, crashDuration + 10);

  const bets = repo.getUserBets(player.id);
  assert.equal(bets.find((b) => b.slot === 0).status, 'cashed');
  assert.equal(bets.find((b) => b.slot === 1).status, 'lost');
  assert.equal(engine.history[0].crashPoint, engine.round.crashPoint);
});

/* -------------------------------------------------------------------------- */
/* Round lifecycle                                                            */
/* -------------------------------------------------------------------------- */

test('round transitions betting → flying → crashed → next betting', () => {
  const { engine, clock, repo } = makeWorld();
  engine.beginBetting();
  const firstRoundNo = engine.round.roundNo;
  assert.equal(engine.round.phase, PHASE.BETTING);

  advance(clock, engine, 1000);
  assert.equal(engine.round.phase, PHASE.FLYING);

  const crashDuration = durationForMultiplier(engine.round.crashPoint);
  advance(clock, engine, crashDuration + 5);
  assert.equal(engine.round.phase, PHASE.CRASHED);

  advance(clock, engine, 500);
  assert.equal(engine.round.phase, PHASE.BETTING);
  assert.equal(engine.round.roundNo, firstRoundNo + 1);
  assert.equal(repo.recentCrashedRounds(5).length, 1);
});

test('crash point is hidden while betting and revealed only after the crash', () => {
  const { engine, clock } = makeWorld();
  engine.beginBetting();
  const snapBetting = engine.getSnapshot();
  assert.equal(snapBetting.crashPoint, null);
  assert.equal(snapBetting.serverSeed, null);
  assert.ok(snapBetting.seedHash);

  advance(clock, engine, 1000);
  assert.equal(engine.getSnapshot().crashPoint, null);
  assert.equal(engine.getSnapshot().serverSeed, null);

  const crashDuration = durationForMultiplier(engine.round.crashPoint);
  advance(clock, engine, crashDuration + 5);
  const snapCrashed = engine.getSnapshot();
  assert.equal(snapCrashed.crashPoint, engine.round.crashPoint);
  assert.equal(sha256Hex(snapCrashed.serverSeed), snapCrashed.seedHash);
});

test('round identifiers, outcomes and crash points are persisted', () => {
  const { engine, clock, repo } = makeWorld();
  engine.beginBetting();
  const roundId = engine.round.id;
  advance(clock, engine, 1000);
  const crashDuration = durationForMultiplier(engine.round.crashPoint);
  advance(clock, engine, crashDuration + 5);

  const row = repo.getRound(roundId);
  assert.equal(row.status, 'crashed');
  assert.equal(row.crash_point, engine.round.crashPoint);
  assert.ok(row.server_seed);
  assert.ok(row.crashed_at);
  assert.equal(sha256Hex(row.server_seed), row.seed_hash);
});

test('history survives an engine restart and stays newest-first', () => {
  const { engine, clock, repo } = makeWorld();
  engine.beginBetting();
  advance(clock, engine, 1000);
  advance(clock, engine, durationForMultiplier(engine.round.crashPoint) + 5);
  advance(clock, engine, 500);
  advance(clock, engine, 1000);
  advance(clock, engine, durationForMultiplier(engine.round.crashPoint) + 5);

  const second = new CrashEngine({ repo, now: () => clock.t, bots: false, config: { bettingMs: 1000, crashedMs: 500 } });
  second.start();
  try {
    assert.equal(second.history.length, 2);
    assert.ok(second.history[0].crashedAt >= second.history[1].crashedAt);
    assert.ok(second.history.every((h) => typeof h.crashPoint === 'number' && h.crashPoint >= 1));
  } finally {
    second.stop();
  }
});

test('the engine cannot start a second round twice on one tick', () => {
  const { engine, clock } = makeWorld();
  engine.beginBetting();
  const roundNo = engine.round.roundNo;
  advance(clock, engine, 1000);
  engine.tick();
  engine.tick();
  assert.equal(engine.round.roundNo, roundNo);
});

test('bot bets are marked and are placed only while betting is open', () => {
  const { engine, clock, repo } = makeWorld();
  engine.botsEnabled = true;
  engine.beginBetting();
  // force a bot plan immediately
  engine.botPlan = [{ at: clock.t, botId: repo.listBots()[0].id, slot: 0, stakeCents: 1000 }];
  engine.tick();
  const bets = repo.listRoundBets(engine.round.id);
  assert.equal(bets.length, 1);
  assert.equal(bets[0].isBot, true);
});
