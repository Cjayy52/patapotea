/**
 * PATAPOTEA round verification (demo).
 *
 * Scheme (v1):
 *   1. The server generates a 32-byte random `serverSeed` (64 hex chars).
 *   2. Before betting opens it publishes `seedHash = SHA256(serverSeed)`.
 *   3. The crash point is derived from
 *        roundHash = SHA256(serverSeed + ":" + roundNo)
 *      using the first 13 hex chars (52 bits) as a uniform sample:
 *        u = parseInt(first13, 16) / 2^52
 *        crash = max(1, floor(min((1 - houseEdge) / (1 - u), maxMultiplier) * 100) / 100)
 *   4. After the round crashes, `serverSeed` is revealed so anyone can recompute
 *      both the commitment hash and the crash point.
 *
 * This is a commit-and-reveal scheme, NOT an independently audited or
 * "provably fair" system. See LIMITATIONS below.
 */
import { CONFIG } from './config.js';
import { crashPointFromHash } from './game-math.js';
import { sha256Hex } from './sha256.js';

const SEED_RE = /^[0-9a-f]{64}$/i;

export const ROUND_ALGORITHM = Object.freeze({
  id: 'patapotea-sha256-v1',
  name: 'SHA-256 commit-and-reveal (demo)',
  hash: 'SHA-256',
  seedFormat: '64 hexadecimal characters (32 random bytes)',
  commitment: 'seedHash = SHA256(serverSeed)',
  derivation: 'roundHash = SHA256(serverSeed + ":" + roundNo)',
  uniform: 'u = parseInt(roundHash.slice(0, 13), 16) / 2^52',
  crashFormula:
    'crashPoint = max(1, floor(min((1 - houseEdge) / (1 - u), maxMultiplier) * 100) / 100)',
  houseEdge: CONFIG.houseEdge,
  maxMultiplier: CONFIG.maxMultiplier,
  growthRate: CONFIG.growthRate,
});

export const VERIFICATION_LIMITATIONS = Object.freeze([
  'This is a demo scheme. It has not been reviewed or certified by any independent testing laboratory, regulator or auditor.',
  'The operator generates and stores the server seed, so a valid hash proves the outcome is consistent with the revealed seed — it does not prove the seed was chosen before betting or that the published commitment was not replaced.',
  'The commitment is only as trustworthy as the record in which it was published. There is no external timestamp, transparency log or third-party witness in this demo.',
  'Only the mathematical relationship between the revealed seed, the round number and the recorded crash point can be checked. Displayed timings come from the same server clock.',
  'Round history in this demo is local to this deployment. Past rounds may be reset or lost if the demo database is cleared.',
  'This demo uses virtual credits only. No real-money outcome, payout or regulatory requirement is represented here.',
]);

export const FAIRNESS_DISCLAIMER =
  'Commit-and-reveal demo only — not independently audited and not certified. ' +
  'Verification shows that a recorded outcome matches its revealed seed; it does not establish trust in the operator.';

export function isValidServerSeed(value) {
  return typeof value === 'string' && SEED_RE.test(value.trim());
}

export function isValidRoundNumber(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1;
}

/** SHA-256 commitment published before the round. */
export function computeCommitmentHash(serverSeed) {
  const seed = String(serverSeed || '').trim().toLowerCase();
  if (!isValidServerSeed(seed)) {
    throw new TypeError('serverSeed must be exactly 64 hexadecimal characters');
  }
  return sha256Hex(seed);
}

/** Deterministic per-round hash derived from the seed and round number. */
export function deriveRoundHash(serverSeed, roundNo) {
  const seed = String(serverSeed || '').trim().toLowerCase();
  if (!isValidServerSeed(seed)) {
    throw new TypeError('serverSeed must be exactly 64 hexadecimal characters');
  }
  if (!isValidRoundNumber(roundNo)) {
    throw new TypeError('roundNo must be a positive integer');
  }
  return sha256Hex(`${seed}:${Number(roundNo)}`);
}

/** Recompute the crash multiplier from the revealed seed and round number. */
export function recomputeCrashPoint(serverSeed, roundNo) {
  return crashPointFromHash(deriveRoundHash(serverSeed, roundNo));
}

/**
 * Verify a recorded round against its revealed seed.
 * Never throws for invalid user input — returns structured errors instead.
 *
 * @param {object} input
 * @param {string} input.serverSeed revealed seed
 * @param {number|string} input.roundNo round number
 * @param {string} [input.seedHash] recorded commitment
 * @param {number|string} [input.crashPoint] recorded crash multiplier
 * @returns {{
 *   algorithm: string,
 *   verified: boolean,
 *   commitmentMatches: boolean|null,
 *   crashMatches: boolean|null,
 *   commitmentHash: string|null,
 *   roundHash: string|null,
 *   computedCrashPoint: number|null,
 *   errors: string[]
 * }}
 */
export function verifyRoundRecord({ serverSeed, roundNo, seedHash, crashPoint } = {}) {
  const errors = [];
  const result = {
    algorithm: ROUND_ALGORITHM.id,
    verified: false,
    commitmentMatches: null,
    crashMatches: null,
    commitmentHash: null,
    roundHash: null,
    computedCrashPoint: null,
    errors,
  };

  if (!isValidServerSeed(serverSeed)) {
    errors.push('Server seed must be exactly 64 hexadecimal characters.');
  }
  if (!isValidRoundNumber(roundNo)) {
    errors.push('Round number must be a positive integer.');
  }
  if (seedHash !== undefined && (typeof seedHash !== 'string' || !/^[0-9a-f]{64}$/i.test(seedHash.trim()))) {
    errors.push('Commitment hash must be exactly 64 hexadecimal characters.');
  }
  if (crashPoint !== undefined && crashPoint !== null) {
    const cp = Number(crashPoint);
    if (!Number.isFinite(cp) || cp < 1 || cp > CONFIG.maxMultiplier) {
      errors.push(`Crash point must be a number between 1 and ${CONFIG.maxMultiplier}.`);
    }
  }

  if (errors.length) return result;

  const seed = serverSeed.trim().toLowerCase();
  result.commitmentHash = computeCommitmentHash(seed);
  result.roundHash = deriveRoundHash(seed, roundNo);
  result.computedCrashPoint = crashPointFromHash(result.roundHash);

  if (seedHash !== undefined) {
    result.commitmentMatches = result.commitmentHash === seedHash.trim().toLowerCase();
  }
  if (crashPoint !== undefined && crashPoint !== null) {
    result.crashMatches = Math.abs(result.computedCrashPoint - Number(crashPoint)) < 1e-9;
  }

  result.verified = result.commitmentMatches === true && result.crashMatches === true;
  if (result.commitmentMatches === false) errors.push('Commitment hash does not match the revealed seed.');
  if (result.crashMatches === false) errors.push('Recorded crash point does not match the recomputed crash point.');
  return result;
}
