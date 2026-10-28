import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useGameState } from '../hooks/useGameState.js';
import { fmtCredits, fmtMult } from '../lib/format.js';
import { sound } from '../lib/sound.js';
import { BetPanel } from '../components/BetPanel.jsx';
import { GameStage } from '../components/GameStage.jsx';
import { BetFeed, HistoryStrip } from '../components/GamePanels.jsx';
import { Bolt, Shield, Ticket } from '../components/Icons.jsx';

export function PlayPage({ navigate }) {
  const { user } = useAuth();
  const toast = useToast();
  const { state, status, error, offsetRef, reload } = useGameState();
  const prevPhase = useRef(null);
  const prevRound = useRef(null);
  const tickSecond = useRef(null);
  const crashedNotice = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  /* -------------------------- audio cues ------------------------------- */
  useEffect(() => {
    if (!state) return;
    const newRound = state.roundId !== prevRound.current;
    if (newRound) {
      prevRound.current = state.roundId;
      tickSecond.current = null;
      prevPhase.current = null;
    }
    if (prevPhase.current === state.phase) return;
    prevPhase.current = state.phase;

    if (state.phase === 'flying') sound.takeoff();
    if (state.phase === 'crashed') {
      sound.crash();
      if (crashedNotice.current !== state.roundId) {
        crashedNotice.current = state.roundId;
        const lostBets = (state.bets || []).filter(
          (b) => (b.mine || (user && b.userId === user.id)) && b.status === 'lost',
        );
        if (lostBets.length) {
          toast.info(`Round crashed at ${fmtMult(state.crashPoint)} — your ${lostBets.length === 1 ? 'bet' : 'bets'} lost.`);
        }
      }
    }
  }, [state, toast, user]);

  /* ----------------------- countdown tick sounds ----------------------- */
  useEffect(() => {
    const timer = setInterval(() => {
      const st = stateRef.current;
      if (!st || st.phase !== 'betting' || !st.bettingEndsAt) return;
      const remaining = (st.bettingEndsAt - (Date.now() + offsetRef.current)) / 1000;
      const sec = Math.ceil(remaining);
      if (sec > 0 && sec <= 3 && sec !== tickSecond.current) {
        tickSecond.current = sec;
        sound.tick(sec === 1);
      }
      if (sec > 3) tickSecond.current = null;
    }, 120);
    return () => clearInterval(timer);
  }, [offsetRef]);

  const totalStaked = (state?.bets || []).reduce((sum, b) => sum + (Number(b.stake) || 0), 0);

  return (
    <main className="page container">
      {error && !state && (
        <div className="alert" style={{ marginBottom: 14 }} role="alert">
          <Shield />
          <span>{error}</span>
          <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={reload}>
            Retry
          </button>
        </div>
      )}

      <div className="game-layout">
        <div className="game-main">
          <HistoryStrip history={state?.history || []} loading={!state} />

          <GameStage state={state} status={status} offsetRef={offsetRef} />

          {state && (
            <div className="fairness-bar">
              <span className="badge violet">SEED COMMITMENT</span>
              <span className="mono truncate">
                {state.seedHash ? `${state.seedHash.slice(0, 24)}…` : '—'}
              </span>
              <span className="mute">
                {state.serverSeed
                  ? 'Seed revealed after the crash. Check the commitment and outcome in Round verification.'
                  : 'Committed before betting and revealed after the crash. Demo scheme — not independently audited.'}
              </span>
              <button type="button" className="btn ghost sm" onClick={() => navigate('/rounds')}>
                Verify rounds
              </button>
            </div>
          )}
        </div>

        <aside className="game-side">
          <BetPanel slot={0} state={state} user={user} navigate={navigate} offsetRef={offsetRef} />
          <BetPanel slot={1} state={state} user={user} navigate={navigate} offsetRef={offsetRef} />
          <BetFeed bets={state?.bets || []} user={user} />
        </aside>
      </div>

      <div className="info-grid">
            <div className="info-card">
              <span className="info-icon"><Bolt /></span>
              <div>
                <h4>Two bets, one flight</h4>
                <p>Run two independent virtual stakes per round and cash each out at a different moment.</p>
              </div>
            </div>
            <div className="info-card">
              <span className="info-icon"><Shield /></span>
              <div>
                <h4>Server-authoritative</h4>
                <p>Round timing, crash points and every cash-out are validated on the server against its own clock.</p>
              </div>
            </div>
            <div className="info-card">
              <span className="info-icon"><Ticket /></span>
              <div>
                <h4>Demo credits only</h4>
                <p>
                  {user
                    ? `You hold ${fmtCredits(user.balance)} VC. Top up free demo credits anytime from your dashboard.`
                    : 'Create a free demo account and start with 10,000 virtual credits. No real money, ever.'}
                </p>
              </div>
            </div>
          </div>

      {state && (
        <div className="round-summary mono">
          <span>Round #{state.roundNo}</span>
          <span className="sep">·</span>
          <span>{state.bets.length} bets</span>
          <span className="sep">·</span>
          <span>{fmtCredits(totalStaked)} VC staked</span>
          <span className="sep">·</span>
          <span>{state.phase === 'flying' ? `flying ${fmtMult(state.multiplier)}` : state.phase === 'crashed' ? `crashed at ${fmtMult(state.crashPoint)}` : 'betting open'}</span>
        </div>
      )}
    </main>
  );
}
