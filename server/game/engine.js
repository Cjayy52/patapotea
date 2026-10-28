/**
 * PATAPOTEA — authoritative crash-round engine.
 *
 * This module owns round timing, bet acceptance, cash-out validation and
 * settlement. It is intentionally UI-free and repository-driven so that:
 *   - the Node server runs it against SQLite (single source of truth), and
 *   - the offline preview build runs the very same file against localStorage.
 *
 * All balances are integer credit-cents. DEMO / VIRTUAL CREDITS ONLY.
 */
import { CONFIG, PHASE, BET_STATUS } from '../../shared/config.js';
import { durationForMultiplier, multiplierAt, payoutFor } from '../../shared/game-math.js';
import { computeCommitmentHash, recomputeCrashPoint } from '../../shared/verification.js';

export class GameError extends Error {
  /**
   * @param {string} code machine readable error code
   * @param {string} message human readable message
   * @param {number} [status] HTTP status hint
   */
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'GameError';
    this.code = code;
    this.status = status;
  }
}

const BOT_NAMES = [
  ['AceOfSpades', 'player'], ['Mira_V', 'player'], ['KofiRuns', 'player'], ['Nina99', 'player'],
  ['CrashKing', 'player'], ['LuckyTunde', 'player'], ['SkyRider', 'player'], ['ZaraBet', 'player'],
];

export class CrashEngine {
  /**
   * @param {object} deps
   * @param {object} deps.repo repository adapter (see server/db/repo.js)
   * @param {() => number} [deps.now] clock injection for tests
   * @param {(n:number)=>Uint8Array} [deps.randomBytes] entropy source
   * @param {object} [deps.config] config overrides (tests)
   * @param {boolean} [deps.bots] enable simulated bot players
   * @param {(event:object)=>void} [deps.onEvent] event sink (bet/cashout/crash/phase)
   */
  constructor({ repo, now = () => Date.now(), randomBytes, config = {}, bots = CONFIG.botsEnabled, onEvent }) {
    if (!repo) throw new Error('CrashEngine requires a repository');
    this.repo = repo;
    this.now = now;
    this.config = { ...CONFIG, ...config };
    this.botsEnabled = bots;
    this.listeners = new Set();
    if (onEvent) this.listeners.add(onEvent);
    this.randomBytes = randomBytes || ((n) => {
      const bytes = new Uint8Array(n);
      if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
      else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
      return bytes;
    });

    /** @type {null | ReturnType<CrashEngine['makeRound']>} */
    this.round = null;
    this.timer = null;
    this.running = false;
    this.history = []; // newest first: {roundId, roundNo, crashPoint, crashedAt}
    this.botPlan = [];
    this.pendingBotCashouts = new Map();
    this.tickInFlight = false;
    this.seedRevealed = false;
  }

  /** Subscribe to engine events. Returns an unsubscribe function. */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event) {
    for (const fn of this.listeners) {
      try { fn(event); } catch { /* a subscriber must never break the loop */ }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  start() {
    if (this.running) return;
    this.running = true;
    this.history = this.repo.recentCrashedRounds(this.config.historySize).map(roundToHistory);
    this.beginBetting();
    this.timer = setInterval(() => this.tick(), this.config.tickMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /* ------------------------------------------------------------------ */
  /* State machine                                                       */
  /* ------------------------------------------------------------------ */

  makeRound(roundNo) {
    const seed = [...this.randomBytes(32)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const seedHash = computeCommitmentHash(seed);
    // Same function the verifier uses — no duplicated derivation logic.
    const crashPoint = recomputeCrashPoint(seed, roundNo);
    const now = this.now();
    return {
      id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `r_${roundNo}_${now}`,
      roundNo,
      serverSeed: seed,
      seedHash,
      crashPoint,
      phase: PHASE.BETTING,
      startedAt: now,
      bettingEndsAt: now + this.config.bettingMs,
      flyStartedAt: null,
      crashAt: null,
      crashedAt: null,
    };
  }

  beginBetting() {
    const roundNo = this.repo.nextRoundNumber();
    const round = this.makeRound(roundNo);
    this.repo.createRound(round);
    this.round = round;
    this.seedRevealed = false;
    this.pendingBotCashouts.clear();
    this.planBots();
    this.emit({ type: 'phase', phase: round.phase, roundId: round.id, roundNo });
    this.emitState();
  }

  /** Move the current round from betting to flying. */
  beginFlight() {
    const round = this.round;
    if (!round || round.phase !== PHASE.BETTING) return;
    const now = this.now();
    round.phase = PHASE.FLYING;
    round.flyStartedAt = now;
    round.crashAt = now + durationForMultiplier(round.crashPoint);
    this.repo.setRoundFlying(round.id, now, round.crashAt);
    this.emit({ type: 'phase', phase: round.phase, roundId: round.id, roundNo: round.roundNo });
    this.emitState();
  }

  /** Resolve the flying round at its crash point. Idempotent. */
  crash() {
    const round = this.round;
    if (!round || round.phase !== PHASE.FLYING) return;
    const now = this.now();
    round.phase = PHASE.CRASHED;
    round.crashedAt = now;
    const lost = this.repo.loseRemainingBets(round.id);
    this.repo.setRoundCrashed(round.id, now, round.serverSeed, round.crashPoint);
    this.seedRevealed = true;
    this.history = [
      { roundId: round.id, roundNo: round.roundNo, crashPoint: round.crashPoint, crashedAt: now },
      ...this.history,
    ].slice(0, this.config.historySize);
    this.emit({
      type: 'crash',
      roundId: round.id,
      roundNo: round.roundNo,
      crashPoint: round.crashPoint,
      lostBets: lost,
    });
    this.emitState();
  }

  /** Main loop. Safe to call manually in tests. */
  tick() {
    if (!this.round || this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      const now = this.now();
      const round = this.round;
      if (round.phase === PHASE.BETTING) {
        this.runBots(now);
        if (now >= round.bettingEndsAt) this.beginFlight();
      } else if (round.phase === PHASE.FLYING) {
        this.runBotCashouts(now);
        if (now >= round.crashAt) this.crash();
      } else if (round.phase === PHASE.CRASHED) {
        if (now >= round.crashedAt + this.config.crashedMs) this.beginBetting();
      }
      this.emitState();
    } finally {
      this.tickInFlight = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Betting                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Place a virtual bet in one of the player's two slots.
   * @param {string} userId
   * @param {number} slot 0..(betSlots-1)
   * @param {number} stakeCents integer credit-cents
   */
  placeBet(userId, slot, stakeCents, { isBot = false } = {}) {
    const round = this.requireRound();
    if (round.phase !== PHASE.BETTING) {
      throw new GameError('BETTING_CLOSED', 'Betting is closed for this round.', 409);
    }
    if (this.now() >= round.bettingEndsAt) {
      throw new GameError('BETTING_CLOSED', 'Betting is closed for this round.', 409);
    }
    this.validateSlot(slot);
    this.validateStake(stakeCents);

    const existing = this.repo.getBet(round.id, userId, slot);
    if (existing) {
      throw new GameError('SLOT_TAKEN', 'That bet slot is already in use this round.', 409);
    }

    let bet;
    try {
      bet = this.repo.placeBet({
        id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `b_${Date.now()}_${Math.random()}`,
        roundId: round.id,
        userId,
        slot,
        stakeCents,
        isBot,
        now: this.now(),
      });
    } catch (err) {
      if (err instanceof GameError) throw err;
      throw new GameError('BET_FAILED', 'Could not place bet.', 400);
    }

    if (!isBot) {
      this.emit({
        type: 'bet',
        roundId: round.id,
        username: bet.username,
        slot,
        stake: stakeCents,
        isBot,
      });
    }
    this.emitState();
    return bet;
  }

  /**
   * Cash out a bet at the server-computed multiplier.
   * Accepted only while FLYING and strictly before the crash timestamp.
   */
  cashOut(userId, slot, { isBot = false } = {}) {
    const round = this.requireRound();
    if (round.phase !== PHASE.FLYING) {
      throw new GameError('ROUND_NOT_ACTIVE', 'Cash out is only available while the plane is flying.', 409);
    }
    this.validateSlot(slot);
    const now = this.now();
    if (now >= round.crashAt) {
      throw new GameError('TOO_LATE', 'The plane already crashed — cash out refused.', 409);
    }

    const bet = this.repo.getBet(round.id, userId, slot);
    if (!bet) throw new GameError('NO_BET', 'No active bet in that slot.', 404);
    if (bet.status !== BET_STATUS.ACTIVE) {
      throw new GameError('ALREADY_SETTLED', 'This bet has already been settled.', 409);
    }

    const multiplier = Math.min(multiplierAt(now - round.flyStartedAt), round.crashPoint);
    if (multiplier < 1) throw new GameError('INVALID_STATE', 'Invalid multiplier.', 409);
    const payoutCents = payoutFor(bet.stake, multiplier);

    const settled = this.repo.settleCashout({
      betId: bet.id,
      roundId: round.id,
      userId,
      multiplier,
      payoutCents,
      now,
    });
    if (!settled) {
      // Guarded UPDATE lost the race — another request already cashed out.
      throw new GameError('ALREADY_SETTLED', 'This bet has already been settled.', 409);
    }

    this.emit({
      type: 'cashout',
      roundId: round.id,
      username: settled.username,
      slot,
      multiplier,
      payout: payoutCents,
      isBot,
    });
    this.emitState();
    return { ...settled, multiplier, payout: payoutCents };
  }

  /* ------------------------------------------------------------------ */
  /* Validation                                                          */
  /* ------------------------------------------------------------------ */

  requireRound() {
    if (!this.round) throw new GameError('NO_ROUND', 'No round is active.', 503);
    return this.round;
  }

  validateSlot(slot) {
    const n = Number(slot);
    if (!Number.isInteger(n) || n < 0 || n >= this.config.betSlots) {
      throw new GameError('INVALID_SLOT', `Bet slot must be 0 or 1.`, 400);
    }
  }

  validateStake(stakeCents) {
    const s = Number(stakeCents);
    if (!Number.isFinite(s) || !Number.isInteger(s)) {
      throw new GameError('INVALID_STAKE', 'Stake must be a whole number of cents.', 400);
    }
    if (s < this.config.minStake * 100) {
      throw new GameError('STAKE_TOO_LOW', `Minimum stake is ${this.config.minStake.toFixed(2)} VC.`, 400);
    }
    if (s > this.config.maxStake * 100) {
      throw new GameError('STAKE_TOO_HIGH', `Maximum stake is ${this.config.maxStake.toFixed(2)} VC.`, 400);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Snapshot                                                            */
  /* ------------------------------------------------------------------ */

  getMultiplier() {
    const round = this.round;
    if (!round) return 1;
    if (round.phase === PHASE.BETTING) return 1;
    if (round.phase === PHASE.CRASHED) return round.crashPoint;
    return Math.min(multiplierAt(this.now() - round.flyStartedAt), round.crashPoint);
  }

  getSnapshot(userId = null) {
    const round = this.round;
    if (!round) return { phase: 'idle', history: this.history, config: this.publicConfig() };
    const bets = this.repo.listRoundBets(round.id).map((b) => ({
      id: b.id,
      userId: b.userId,
      username: b.username,
      slot: b.slot,
      stake: b.stake,
      status: b.status,
      multiplier: b.multiplier,
      payout: b.payout,
      isBot: !!b.isBot,
      mine: userId ? b.userId === userId : false,
    }));
    return {
      roundId: round.id,
      roundNo: round.roundNo,
      phase: round.phase,
      now: this.now(),
      startedAt: round.startedAt,
      bettingEndsAt: round.bettingEndsAt,
      flyStartedAt: round.flyStartedAt,
      crashAt: round.crashAt,
      crashedAt: round.crashedAt,
      nextRoundAt: round.phase === PHASE.CRASHED ? round.crashedAt + this.config.crashedMs : null,
      multiplier: this.getMultiplier(),
      seedHash: round.seedHash,
      // The seed is only revealed after the round has crashed.
      serverSeed: round.phase === PHASE.CRASHED && this.seedRevealed ? round.serverSeed : null,
      crashPoint: round.phase === PHASE.CRASHED ? round.crashPoint : null,
      history: this.history,
      bets,
      config: this.publicConfig(),
      serverTime: this.now(),
    };
  }

  publicConfig() {
    return {
      bettingMs: this.config.bettingMs,
      crashedMs: this.config.crashedMs,
      minStake: this.config.minStake,
      maxStake: this.config.maxStake,
      betSlots: this.config.betSlots,
      maxMultiplier: this.config.maxMultiplier,
      growthRate: this.config.growthRate,
      houseEdge: this.config.houseEdge,
    };
  }

  emitState() {
    if (!this.round) return;
    try {
      this.emit({ type: 'state', state: this.getSnapshot() });
    } catch {
      /* subscribers must never break the loop */
    }
  }

  /* ------------------------------------------------------------------ */
  /* Simulated players (clearly labelled SIM in the UI)                  */
  /* ------------------------------------------------------------------ */

  planBots() {
    this.botPlan = [];
    if (!this.botsEnabled) return;
    const bots = this.repo.listBots();
    if (!bots.length) return;
    const now = this.now();
    const count = Math.min(bots.length, 2 + Math.floor(Math.random() * 5));
    const shuffled = [...bots].sort(() => Math.random() - 0.5).slice(0, count);
    shuffled.forEach((bot, i) => {
      const stakedSlots = Math.random() < 0.25 ? 2 : 1;
      for (let slot = 0; slot < stakedSlots && slot < this.config.betSlots; slot++) {
        const stakes = [1000, 2500, 5000, 10000, 25000, 50000];
        this.botPlan.push({
          at: now + 400 + Math.random() * Math.max(1000, this.config.bettingMs - 1500) + i * 120,
          botId: bot.id,
          slot,
          stakeCents: stakes[Math.floor(Math.random() * stakes.length)],
        });
      }
      if (Math.random() < 0.85) {
        this.pendingBotCashouts.set(`${bot.id}:0`, 1.15 + Math.random() * 3.2);
      }
    });
  }

  runBots(now) {
    if (!this.botPlan.length) return;
    const due = this.botPlan.filter((p) => p.at <= now);
    if (!due.length) return;
    this.botPlan = this.botPlan.filter((p) => p.at > now);
    for (const p of due) {
      try {
        this.placeBet(p.botId, p.slot, p.stakeCents, { isBot: true });
      } catch {
        /* bots are cosmetic — never let them break the round */
      }
    }
  }

  runBotCashouts(now) {
    if (!this.pendingBotCashouts.size) return;
    const current = multiplierAt(now - this.round.flyStartedAt);
    for (const [key, target] of this.pendingBotCashouts) {
      if (current < target) continue;
      const [botId, slot] = key.split(':');
      this.pendingBotCashouts.delete(key);
      try {
        this.cashOut(botId, Number(slot), { isBot: true });
      } catch {
        /* bet may not exist this round */
      }
    }
  }
}

function roundToHistory(r) {
  // Accepts either the SQL row (snake_case) or the normalised repository shape.
  return {
    roundId: r.id,
    roundNo: r.roundNo ?? r.round_no,
    crashPoint: r.crashPoint ?? r.crash_point,
    crashedAt: r.crashedAt ?? r.crashed_at,
  };
}

export { BOT_NAMES };
