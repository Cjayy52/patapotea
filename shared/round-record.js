/**
 * Shared round-record serialisation, used by the HTTP API and the offline
 * preview adapter so both expose identical verification data.
 */
import { ROUND_ALGORITHM, FAIRNESS_DISCLAIMER, verifyRoundRecord } from './verification.js';

const credits = (cents) => Math.round(Number(cents) || 0) / 100;

function flightDuration(row) {
  const start = row.flying_at ?? row.flyingAt;
  const end = row.crashed_at ?? row.crashedAt;
  if (!start || !end) return null;
  return Math.max(0, end - start);
}

/**
 * Public summary of a settled round. Never includes an unrevealed seed and
 * never includes player identity beyond a display username.
 */
export function buildRoundSummary(row, stats = null) {
  return {
    roundId: row.id,
    roundNo: row.round_no ?? row.roundNo,
    status: row.status,
    crashPoint: row.status === 'crashed' ? row.crash_point ?? row.crashPoint : null,
    seedHash: row.seed_hash ?? row.seedHash,
    timestamps: {
      startedAt: row.started_at ?? row.startedAt ?? null,
      bettingEndsAt: row.betting_ends_at ?? row.bettingEndsAt ?? null,
      flyingAt: row.flying_at ?? row.flyingAt ?? null,
      crashAt: row.crash_at ?? row.crashAt ?? null,
      crashedAt: row.crashed_at ?? row.crashedAt ?? null,
    },
    flightDurationMs: flightDuration(row),
    stats: stats
      ? {
        betCount: Number(stats.betCount) || 0,
        staked: credits(stats.stakedCents),
        paid: credits(stats.paidCents),
        uniquePlayers: stats.uniquePlayers ?? null,
      }
      : null,
    algorithm: ROUND_ALGORITHM.id,
  };
}

/** Full public record for a settled round, with revealed seed and verification. */
export function buildRoundDetail(row, bets = []) {
  const summary = buildRoundSummary(row, {
    betCount: bets.length,
    stakedCents: bets.reduce((sum, b) => sum + (Number(b.stake) || 0), 0),
    paidCents: bets.reduce((sum, b) => sum + (Number(b.payout) || 0), 0),
    uniquePlayers: new Set(bets.map((b) => b.userId).filter(Boolean)).size,
  });

  const serverSeed = row.status === 'crashed' ? row.server_seed ?? row.serverSeed ?? null : null;
  const verification = serverSeed
    ? verifyRoundRecord({
      serverSeed,
      roundNo: summary.roundNo,
      seedHash: summary.seedHash,
      crashPoint: summary.crashPoint,
    })
    : null;

  return {
    ...summary,
    serverSeed,
    verification,
    algorithmDetails: ROUND_ALGORITHM,
    disclaimer: FAIRNESS_DISCLAIMER,
    bets: bets.map((b) => ({
      username: b.username,
      slot: b.slot,
      stake: credits(b.stake),
      status: b.status,
      multiplier: b.multiplier,
      payout: credits(b.payout),
      isBot: !!b.isBot,
      placedAt: b.placedAt,
      cashedAt: b.cashedAt ?? null,
    })),
  };
}

export { FAIRNESS_DISCLAIMER, ROUND_ALGORITHM };
