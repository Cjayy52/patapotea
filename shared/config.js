/**
 * PATAPOTEA — shared game configuration.
 *
 * Everything here is DEMO / VIRTUAL CREDIT only. No real money, no cash value,
 * no deposits or withdrawals are possible anywhere in this codebase.
 *
 * All monetary values inside the engine are integer "credit cents" (1 credit = 100).
 */

export const CREDIT = 100;

export const CONFIG = {
  /** Duration of the betting/countdown window (ms). */
  bettingMs: 7000,
  /** Duration the crash result stays on screen before the next round (ms). */
  crashedMs: 4500,
  /** Engine tick interval (ms). */
  tickMs: 100,
  /** Exponential growth constant: multiplier = e^(GROWTH_RATE * seconds). */
  growthRate: 0.09,
  /** House edge applied to the crash distribution (3%). Demo only. */
  houseEdge: 0.03,
  /** Hard ceiling so a freak round cannot run forever. */
  maxMultiplier: 500,
  /** Virtual-credit stake limits, in credits. */
  minStake: 1,
  maxStake: 5000,
  /** Starting virtual balance for new demo accounts, in credits. */
  startingBalance: 10000,
  /** Number of recent crash multipliers exposed to clients. */
  historySize: 24,
  /** Max simultaneous virtual bets per player per round. */
  betSlots: 2,
  /** Simulated bot players keep the room feeling alive. Clearly labelled SIM. */
  botsEnabled: true,
};

export const PHASE = Object.freeze({
  BETTING: 'betting',
  FLYING: 'flying',
  CRASHED: 'crashed',
});

export const BET_STATUS = Object.freeze({
  ACTIVE: 'active',
  CASHED: 'cashed',
  LOST: 'lost',
});
