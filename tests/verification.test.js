import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  ROUND_ALGORITHM,
  computeCommitmentHash,
  deriveRoundHash,
  recomputeCrashPoint,
  verifyRoundRecord,
} from '../shared/verification.js';
import { crashPointFromHash } from '../shared/game-math.js';

const SEED = 'a'.repeat(64);
const OTHER_SEED = 'b'.repeat(64);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/* -------------------------------------------------------------------------- */
/* Shared verification primitives                                             */
/* -------------------------------------------------------------------------- */

test('commitment and derivation match independent SHA-256 calculations', () => {
  assert.equal(computeCommitmentHash(SEED), sha256(SEED));
  assert.equal(deriveRoundHash(SEED, 7), sha256(`${SEED}:7`));
  assert.equal(recomputeCrashPoint(SEED, 7), crashPointFromHash(sha256(`${SEED}:7`)));
  assert.equal(ROUND_ALGORITHM.id, 'patapotea-sha256-v1');
});

test('a valid record verifies commitment and crash point', () => {
  const crashPoint = recomputeCrashPoint(SEED, 12);
  const result = verifyRoundRecord({
    serverSeed: SEED,
    roundNo: 12,
    seedHash: computeCommitmentHash(SEED),
    crashPoint,
  });
  assert.equal(result.verified, true);
  assert.equal(result.commitmentMatches, true);
  assert.equal(result.crashMatches, true);
  assert.equal(result.computedCrashPoint, crashPoint);
  assert.deepEqual(result.errors, []);
});

test('uppercase seeds and numeric strings are accepted and normalised', () => {
  const upper = SEED.toUpperCase();
  const crashPoint = recomputeCrashPoint(upper, '3');
  const result = verifyRoundRecord({
    serverSeed: upper,
    roundNo: '3',
    seedHash: computeCommitmentHash(SEED),
    crashPoint,
  });
  assert.equal(result.verified, true);
  assert.equal(result.commitmentHash, computeCommitmentHash(SEED));
});

test('a tampered seed fails both the commitment and the outcome check', () => {
  const result = verifyRoundRecord({
    serverSeed: OTHER_SEED,
    roundNo: 12,
    seedHash: computeCommitmentHash(SEED),
    crashPoint: recomputeCrashPoint(SEED, 12),
  });
  assert.equal(result.verified, false);
  assert.equal(result.commitmentMatches, false);
  assert.equal(result.crashMatches, false);
  assert.equal(result.errors.length, 2);
});

test('a tampered crash multiplier fails only the outcome check', () => {
  const crashPoint = recomputeCrashPoint(SEED, 12);
  const result = verifyRoundRecord({
    serverSeed: SEED,
    roundNo: 12,
    seedHash: computeCommitmentHash(SEED),
    crashPoint: Number((crashPoint + 0.01).toFixed(2)),
  });
  assert.equal(result.verified, false);
  assert.equal(result.commitmentMatches, true);
  assert.equal(result.crashMatches, false);
  assert.equal(result.errors.length, 1);
});

test('invalid seeds are rejected without throwing', () => {
  const cases = [null, '', 'abc', 'z'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 12345, {}];
  for (const seed of cases) {
    const result = verifyRoundRecord({ serverSeed: seed, roundNo: 1 });
    assert.equal(result.verified, false, `seed ${String(seed)}`);
    assert.ok(result.errors.length >= 1);
    assert.equal(result.computedCrashPoint, null);
  }
});

test('invalid round numbers are rejected', () => {
  for (const roundNo of [0, -1, 1.5, 'abc', null, undefined, Number.NaN, Infinity]) {
    const result = verifyRoundRecord({ serverSeed: SEED, roundNo });
    assert.equal(result.verified, false, `roundNo ${String(roundNo)}`);
    assert.ok(result.errors.some((e) => /round number/i.test(e)));
  }
});

test('invalid commitment hashes and crash points are rejected', () => {
  const badHash = verifyRoundRecord({ serverSeed: SEED, roundNo: 1, seedHash: 'not-a-hash' });
  assert.equal(badHash.verified, false);
  assert.ok(badHash.errors.some((e) => /commitment hash/i.test(e)));

  for (const crashPoint of [0, -2, 501, Number.NaN, 'abc']) {
    const result = verifyRoundRecord({ serverSeed: SEED, roundNo: 1, crashPoint });
    assert.equal(result.verified, false, `crash ${String(crashPoint)}`);
    assert.ok(result.errors.some((e) => /crash point/i.test(e)));
  }
});

test('verification is pure — repeated calls produce identical results', () => {
  const input = {
    serverSeed: SEED,
    roundNo: 42,
    seedHash: computeCommitmentHash(SEED),
    crashPoint: recomputeCrashPoint(SEED, 42),
  };
  const first = verifyRoundRecord(input);
  const second = verifyRoundRecord(input);
  assert.deepEqual(first, second);
});

test('documented limitations explicitly state the scheme is not audited', () => {
  const text = ROUND_ALGORITHM.name;
  assert.match(text, /demo/i);
});
