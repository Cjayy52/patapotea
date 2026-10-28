/**
 * Deterministic, side-effect free crash math.
 * Shared verbatim by the authoritative server and the offline preview build,
 * so gameplay is identical in both environments.
 */
import { CONFIG } from './config.js';

/** 32-bit float-safe clamp of the multiplier floor. */
export const MIN_MULTIPLIER = 1;

/**
 * Convert a uniform [0,1) sample into a crash multiplier with a house edge.
 * Uses the standard crash-game distribution: P(crash >= m) = (1 - edge) / m.
 *
 * @param {number} u uniform sample in [0, 1)
 * @returns {number} crash multiplier rounded down to 2 decimals, >= 1.00
 */
export function crashPointFromUniform(u) {
  const clamped = Math.min(Math.max(Number(u) || 0, 0), 0.9999999999);
  const raw = (1 - CONFIG.houseEdge) / (1 - clamped);
  const floored = Math.floor(Math.min(raw, CONFIG.maxMultiplier) * 100) / 100;
  return Math.max(MIN_MULTIPLIER, floored);
}

/**
 * Derive a crash multiplier from a hex hash (HMAC / SHA-256 output).
 * Uses the first 13 hex chars (52 bits) for a uniform sample.
 *
 * @param {string} hash hex string
 * @returns {number} crash multiplier
 */
export function crashPointFromHash(hash) {
  if (typeof hash !== 'string' || hash.length < 13) {
    throw new Error('crashPointFromHash requires a hex hash of at least 13 chars');
  }
  const slice = hash.slice(0, 13);
  const int = Number.parseInt(slice, 16);
  if (!Number.isFinite(int)) throw new Error('invalid hash');
  return crashPointFromUniform(int / 2 ** 52);
}

/**
 * Multiplier at a given elapsed time. Exponential, starting at 1.00x.
 *
 * @param {number} elapsedMs milliseconds since the plane took off
 * @returns {number} multiplier, rounded down to 2 decimals
 */
export function multiplierAt(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return MIN_MULTIPLIER;
  const seconds = elapsedMs / 1000;
  const raw = Math.exp(CONFIG.growthRate * seconds);
  return Math.max(MIN_MULTIPLIER, Math.floor(raw * 100) / 100);
}

/**
 * Inverse of multiplierAt — how long a round with `m` crash point flies for.
 *
 * @param {number} multiplier crash point
 * @returns {number} duration in milliseconds
 */
export function durationForMultiplier(multiplier) {
  const m = Math.max(MIN_MULTIPLIER, Number(multiplier) || MIN_MULTIPLIER);
  return Math.ceil((Math.log(m) / CONFIG.growthRate) * 1000);
}

/**
 * Virtual payout in credit-cents. Rounded half-up to the nearest cent,
 * never negative, never NaN.
 *
 * @param {number} stakeCents integer stake
 * @param {number} multiplier payout multiplier
 * @returns {number} integer payout in credit-cents
 */
export function payoutFor(stakeCents, multiplier) {
  const stake = Number(stakeCents);
  const mult = Number(multiplier);
  if (!Number.isFinite(stake) || stake <= 0) return 0;
  if (!Number.isFinite(mult) || mult <= 1) return Math.round(stake);
  return Math.round(stake * mult);
}

/** Format credit-cents for display. */
export function formatCredits(cents) {
  return (Math.round(Number(cents) || 0) / 100).toFixed(2);
}

/** Parse a user supplied credit string/number into integer cents or null. */
export function parseStake(value) {
  if (typeof value === 'string' && !value.trim()) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const cents = Math.round(num * 100);
  if (Math.abs(cents / 100 - num) > 1e-9) return null; // reject sub-cent precision
  return cents;
}
