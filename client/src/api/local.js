/**
 * Offline preview adapter.
 *
 * Runs the SAME CrashEngine and crash math as the server, but inside the
 * browser, against a localStorage repository. Auth here is a convenience stub:
 * it exists so the preview has working login/register screens — it is NOT a
 * security model. The server build is the one with real session auth.
 */
import { CrashEngine } from '../../../server/game/engine.js';
import { LocalRepo, previewHash } from '../../../shared/local-repo.js';
import { CONFIG } from '../../../shared/config.js';
import { formatCredits } from '../../../shared/game-math.js';
import { buildRoundDetail, buildRoundSummary } from '../../../shared/round-record.js';
import {
  FAIRNESS_DISCLAIMER, ROUND_ALGORITHM, VERIFICATION_LIMITATIONS,
} from '../../../shared/verification.js';
import { ApiError } from './http.js';

const SESSION_KEY = 'patapotea_preview_user';
const cents = (credits) => Math.round(Number(credits) * 100);
const credits = (c) => Math.round(Number(c) || 0) / 100;

export class LocalApi {
  mode = 'preview';

  constructor() {
    this.repo = new LocalRepo();
    this.engine = new CrashEngine({ repo: this.repo, bots: CONFIG.botsEnabled });
    this.currentUserId = this.loadSession();
    this.engine.start();
  }

  loadSession() {
    try {
      const id = localStorage.getItem(SESSION_KEY);
      return id && this.repo.findUser((u) => u.id === id) ? id : null;
    } catch {
      return null;
    }
  }

  setSession(id) {
    this.currentUserId = id;
    try {
      if (id) localStorage.setItem(SESSION_KEY, id);
      else localStorage.removeItem(SESSION_KEY);
    } catch { /* ignore */ }
  }

  user() {
    const u = this.currentUserId ? this.repo.findUser((x) => x.id === this.currentUserId) : null;
    return u ? this.dto(u) : null;
  }

  dto(u) {
    let settings = { sound: true, autoCashOut: null };
    try { settings = { ...settings, ...JSON.parse(u.settings || '{}') }; } catch { /* ignore */ }
    return {
      id: u.id, email: u.email, username: u.username, role: u.role,
      balance: credits(u.balance_cents), isDemo: true, settings,
      createdAt: u.created_at, lastLoginAt: u.last_login_at,
    };
  }

  mapState(snap) {
    const me = this.currentUserId;
    return {
      ...snap,
      bets: (snap.bets || []).map((b) => ({
        ...b,
        stake: credits(b.stake),
        payout: credits(b.payout),
        mine: !!me && b.userId === me,
      })),
      demo: true,
    };
  }

  /* ------------------------------- auth ---------------------------------- */

  async me() {
    if (this.currentUserId) {
      const u = this.repo.findUser((x) => x.id === this.currentUserId);
      if (u) return { user: this.dto(u), demo: true };
      this.setSession(null);
    }
    return { user: null, demo: true };
  }

  async register(email, username, password) {
    email = String(email || '').trim().toLowerCase();
    username = String(username || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email)) {
      throw new ApiError('Enter a valid email address.', 'VALIDATION_ERROR', 400, 'email');
    }
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      throw new ApiError('Username may only contain letters, numbers and underscores (3-20).', 'VALIDATION_ERROR', 400, 'username');
    }
    if (String(password).length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      throw new ApiError('Password must be 10+ characters with a letter and a number.', 'VALIDATION_ERROR', 400, 'password');
    }
    if (this.repo.findUser((u) => u.email.toLowerCase() === email)) {
      throw new ApiError('An account with that email already exists.', 'EMAIL_TAKEN', 409, 'email');
    }
    if (this.repo.findUser((u) => u.username.toLowerCase() === username.toLowerCase())) {
      throw new ApiError('That username is taken.', 'USERNAME_TAKEN', 409, 'username');
    }
    const user = this.repo.createUser({ email, username, password });
    this.setSession(user.id);
    return { user: this.dto(user), demo: true };
  }

  async login(email, password) {
    const user = this.repo.findUser((u) => u.email.toLowerCase() === String(email || '').trim().toLowerCase());
    if (!user || user.password_hash !== previewHash(String(password || ''))) {
      throw new ApiError('Invalid email or password.', 'INVALID_CREDENTIALS', 401);
    }
    user.last_login_at = Date.now();
    this.repo.save();
    this.setSession(user.id);
    return { user: this.dto(user), demo: true };
  }

  async logout() {
    this.setSession(null);
    return { ok: true };
  }

  async updateProfile(settings) {
    const u = this.repo.findUser((x) => x.id === this.currentUserId);
    if (!u) throw new ApiError('Please sign in to continue.', 'UNAUTHENTICATED', 401);
    const next = { sound: true, autoCashOut: null, ...(u.settings ? JSON.parse(u.settings) : {}), ...settings };
    if (next.autoCashOut !== null && next.autoCashOut !== undefined && next.autoCashOut !== '') {
      const n = Number(next.autoCashOut);
      if (!Number.isFinite(n) || n < 1.01 || n > 500) {
        throw new ApiError('Auto cash-out must be between 1.01x and 500x.', 'VALIDATION_ERROR', 400, 'autoCashOut');
      }
      next.autoCashOut = Math.round(n * 100) / 100;
    } else {
      next.autoCashOut = null;
    }
    this.repo.updateSettings(u.id, next);
    return { user: this.dto(u) };
  }

  async changePassword(currentPassword, newPassword) {
    const u = this.repo.findUser((x) => x.id === this.currentUserId);
    if (!u) throw new ApiError('Please sign in to continue.', 'UNAUTHENTICATED', 401);
    if (u.password_hash !== previewHash(String(currentPassword || ''))) {
      throw new ApiError('Current password is incorrect.', 'INVALID_CREDENTIALS', 401);
    }
    if (String(newPassword).length < 10) {
      throw new ApiError('New password must be at least 10 characters.', 'VALIDATION_ERROR', 400, 'newPassword');
    }
    this.repo.updatePassword(u.id, newPassword);
    return { ok: true };
  }

  /* -------------------------------- game --------------------------------- */

  async getState() { return this.mapState(this.engine.getSnapshot(this.currentUserId)); }

  stream(onState) {
    const unsubscribe = this.engine.subscribe((ev) => {
      if (ev.type === 'state') onState(this.mapState(ev.state));
    });
    setTimeout(() => onState(this.mapState(this.engine.getSnapshot(this.currentUserId))), 0);
    return unsubscribe;
  }

  requireAuth() {
    if (!this.currentUserId) throw new ApiError('Please sign in to continue.', 'UNAUTHENTICATED', 401);
    return this.currentUserId;
  }

  async placeBet(slot, stake) {
    this.requireAuth();
    const centsValue = cents(stake);
    if (!Number.isInteger(centsValue) || Math.abs(centsValue / 100 - Number(stake)) > 1e-9) {
      throw new ApiError('Enter a valid stake amount.', 'VALIDATION_ERROR', 400, 'stake');
    }
    try {
      const bet = this.engine.placeBet(this.currentUserId, Number(slot), centsValue);
      const u = this.repo.findUser((x) => x.id === this.currentUserId);
      return {
        bet: { id: bet.id, slot: bet.slot, stake: credits(bet.stake), status: bet.status, roundId: bet.roundId },
        balance: credits(u.balance_cents), demo: true,
      };
    } catch (err) {
      throw new ApiError(err.message || 'Could not place bet.', err.code || 'BET_FAILED', err.status || 400);
    }
  }

  async cashOut(slot) {
    this.requireAuth();
    try {
      const settled = this.engine.cashOut(this.currentUserId, Number(slot));
      const u = this.repo.findUser((x) => x.id === this.currentUserId);
      return {
        cashout: {
          slot: settled.slot, multiplier: settled.multiplier,
          payout: credits(settled.payout), stake: credits(settled.stake), roundId: settled.roundId,
        },
        balance: credits(u.balance_cents), demo: true,
      };
    } catch (err) {
      throw new ApiError(err.message || 'Cash out failed.', err.code || 'CASHOUT_FAILED', err.status || 400);
    }
  }

  async myBets() {
    this.requireAuth();
    return {
      bets: this.repo.myBets(this.currentUserId).map((b) => ({
        id: b.id, roundId: b.round_id, roundNo: b.round_no, slot: b.slot,
        stake: credits(b.stake_cents), status: b.status, multiplier: b.multiplier,
        payout: credits(b.payout_cents), crashPoint: b.crash_point,
        placedAt: b.placed_at, cashedAt: b.cashed_at, roundStatus: b.roundStatus,
      })),
    };
  }

  async myTransactions() {
    this.requireAuth();
    return {
      transactions: this.repo.myTransactions(this.currentUserId).map((t) => ({
        id: t.id, type: t.type, amount: credits(t.amount_cents),
        balanceAfter: credits(t.balance_after_cents), note: t.note,
        roundId: t.round_id, createdAt: t.created_at,
      })),
    };
  }

  async demoTopup() {
    this.requireAuth();
    const last = this.repo.lastTopup(this.currentUserId);
    const cooldown = 5 * 60 * 1000;
    if (last && Date.now() - last.created_at < cooldown) {
      const retry = Math.ceil((cooldown - (Date.now() - last.created_at)) / 1000);
      throw new ApiError(`Demo top-up available again in ${retry}s.`, 'TOPUP_COOLDOWN', 429);
    }
    const u = this.repo.topup(this.currentUserId, 250000, Date.now());
    return { balance: credits(u.balance_cents), amount: 2500, demo: true };
  }

  /* ---------------------- round history & verification ------------------- */

  async fairness() {
    return {
      algorithm: ROUND_ALGORITHM,
      limitations: VERIFICATION_LIMITATIONS,
      disclaimer: FAIRNESS_DISCLAIMER,
      demo: true,
    };
  }

  async rounds(limit = 20, before = null) {
    if (!Number.isInteger(Number(limit)) || Number(limit) < 1) {
      throw new ApiError('limit must be a positive integer.', 'VALIDATION_ERROR', 400, 'limit');
    }
    const max = Math.min(Number(limit), 100);
    const beforeNo = before === null || before === undefined ? null : Number(before);
    if (beforeNo !== null && (!Number.isInteger(beforeNo) || beforeNo < 1)) {
      throw new ApiError('before must be a positive integer.', 'VALIDATION_ERROR', 400, 'before');
    }
    const rows = this.repo.listSettledRounds(max + 1, beforeNo);
    const hasMore = rows.length > max;
    const page = rows.slice(0, max).map((r) => buildRoundSummary(r, {
      betCount: r.bet_count,
      stakedCents: r.staked_cents,
      paidCents: r.paid_cents,
    }));
    return {
      rounds: page,
      total: this.repo.countSettledRounds(),
      hasMore,
      nextBefore: hasMore ? page[page.length - 1].roundNo : null,
      algorithm: ROUND_ALGORITHM,
      disclaimer: FAIRNESS_DISCLAIMER,
      demo: true,
    };
  }

  settledRound(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      throw new ApiError('Invalid round ID.', 'INVALID_ROUND_ID', 400, 'id');
    }
    const row = this.repo.getRoundRaw(id);
    if (!row) throw new ApiError('Round not found.', 'ROUND_NOT_FOUND', 404);
    if (row.status !== 'crashed') {
      throw new ApiError(
        'This round has not settled yet. Its seed and crash point stay hidden until it crashes.',
        'ROUND_NOT_SETTLED',
        409,
      );
    }
    return row;
  }

  async roundDetail(id) {
    const row = this.settledRound(id);
    return {
      round: buildRoundDetail(row, this.repo.listRoundBets(row.id)),
      algorithm: ROUND_ALGORITHM,
      disclaimer: FAIRNESS_DISCLAIMER,
      demo: true,
    };
  }

  async verifyRound(id) {
    const row = this.settledRound(id);
    const detail = buildRoundDetail(row, this.repo.listRoundBets(row.id));
    return {
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
    };
  }

  /* -------------------------------- admin -------------------------------- */

  requireAdmin() {
    const u = this.repo.findUser((x) => x.id === this.currentUserId);
    if (!u) throw new ApiError('Please sign in to continue.', 'UNAUTHENTICATED', 401);
    if (u.role !== 'admin') throw new ApiError('Admin access required.', 'FORBIDDEN', 403);
    return u;
  }

  async adminOverview() {
    this.requireAdmin();
    const s = this.repo.stats();
    return {
      stats: {
        users: s.users, bots: s.bots, rounds: s.rounds, bets: s.bets,
        wagered: credits(s.wagered), paid: credits(s.paid),
        houseNet: credits(s.wagered - s.paid), balances: credits(s.balances),
      },
      currentRound: this.mapState(this.engine.getSnapshot()),
      demo: true,
    };
  }

  async adminUsers() {
    this.requireAdmin();
    return {
      users: this.repo.data.users.map((u) => ({
        id: u.id, email: u.email, username: u.username, role: u.role,
        balance: credits(u.balance_cents), isBot: !!u.is_bot,
        betCount: this.repo.data.bets.filter((b) => b.user_id === u.id).length,
        createdAt: u.created_at, lastLoginAt: u.last_login_at,
      })),
    };
  }

  async adminRounds() {
    this.requireAdmin();
    return {
      rounds: this.repo.listRounds(40).map((r) => ({
        id: r.id, roundNo: r.roundNo,
        crashPoint: r.status === 'crashed' ? r.crashPoint : null,
        status: r.status,
        startedAt: r.startedAt, crashedAt: r.crashedAt, betCount: r.betCount,
        staked: credits(r.staked), paid: credits(r.paid),
        seedHash: r.seedHash, serverSeed: r.serverSeed,
      })),
    };
  }
}

export { formatCredits };
