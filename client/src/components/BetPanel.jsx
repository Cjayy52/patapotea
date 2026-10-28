import { useEffect, useMemo, useRef, useState } from 'react';
import { getApi } from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fmtCredits, fmtMult } from '../lib/format.js';
import { sound } from '../lib/sound.js';
import { Check, Coin, Plane } from './Icons.jsx';

const MIN_STAKE = 1;
const MAX_STAKE = 5000;

export function BetPanel({ slot, state, user, navigate, offsetRef }) {
  const { updateBalance, patchUser } = useAuth();
  const toast = useToast();
  const [stake, setStake] = useState(() => {
    try { return localStorage.getItem(`patapotea_stake_${slot}`) || '50'; } catch { return '50'; }
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [optimisticBet, setOptimisticBet] = useState(null);
  const autoDone = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(`patapotea_stake_${slot}`, stake); } catch { /* ignore */ }
  }, [stake, slot]);

  const phase = state?.phase || 'betting';
  const myBet = useMemo(
    () => (state?.bets || []).find(
      (b) => (b.mine || (user && b.userId === user.id)) && b.slot === slot,
    ) || null,
    [state?.bets, slot, user],
  );
  const bet = myBet || (optimisticBet && phase === 'betting' ? optimisticBet : null);
  const active = bet?.status === 'active';
  const cashed = bet?.status === 'cashed';
  const lost = bet?.status === 'lost';

  // Drop the optimistic bet once the authoritative state catches up.
  useEffect(() => {
    if (optimisticBet && myBet) setOptimisticBet(null);
  }, [myBet, optimisticBet]);
  useEffect(() => {
    if (phase === 'betting' && !myBet) setOptimisticBet(null);
  }, [phase, myBet]);

  const stakeNum = Number(stake);
  const stakeValid = Number.isFinite(stakeNum)
    && stakeNum >= MIN_STAKE
    && stakeNum <= MAX_STAKE
    && Math.abs(Math.round(stakeNum * 100) / 100 - stakeNum) < 1e-9;
  const balanceEnough = !user || stakeNum <= user.balance;

  const liveMultiplier = phase === 'flying' && active ? state?.multiplier || 1 : cashed ? bet.multiplier : 1;
  const potential = stakeValid ? stakeNum * liveMultiplier : 0;

  const canPlace = !!user && phase === 'betting' && !active && stakeValid && balanceEnough && !pending;
  const canCash = !!user && phase === 'flying' && active && !pending;

  /* ---------------------------- auto cash-out --------------------------- */
  useEffect(() => {
    const target = Number(user?.settings?.autoCashOut);
    if (!target || !active || phase !== 'flying') return;
    if (autoDone.current === bet.id) return;
    if ((state?.multiplier || 1) < target) return;
    autoDone.current = bet.id;
    getApi().cashOut(slot)
      .then((res) => {
        updateBalance(res.balance);
        sound.cashout(res.cashout.multiplier);
        toast.success(`Auto cashed out at ${fmtMult(res.cashout.multiplier)} · +${fmtCredits(res.cashout.payout)} VC`);
      })
      .catch(() => { /* crash beat the auto target — the bet is lost */ });
  }, [user?.settings?.autoCashOut, active, phase, state?.multiplier, bet?.id, slot, updateBalance, toast]);

  async function place() {
    setError(null);
    if (!stakeValid) {
      setError(`Enter a stake between ${MIN_STAKE.toFixed(2)} and ${MAX_STAKE.toFixed(2)} VC.`);
      return;
    }
    if (!balanceEnough) {
      setError('Not enough virtual credits for that stake.');
      return;
    }
    setPending(true);
    try {
      const res = await getApi().placeBet(slot, stakeNum);
      updateBalance(res.balance);
      setOptimisticBet({
        id: res.bet.id, slot, stake: res.bet.stake, status: 'active', mine: true, username: user.username,
      });
      sound.click();
      toast.success(`Bet placed · ${fmtCredits(res.bet.stake)} VC on round #${state?.roundNo ?? ''}`);
    } catch (err) {
      setError(err.message || 'Could not place bet.');
      toast.error(err.message || 'Could not place bet.');
      sound.error();
    } finally {
      setPending(false);
    }
  }

  async function cashOut() {
    setPending(true);
    setError(null);
    try {
      const res = await getApi().cashOut(slot);
      updateBalance(res.balance);
      sound.cashout(res.cashout.multiplier);
      toast.success(`Cashed out at ${fmtMult(res.cashout.multiplier)} · +${fmtCredits(res.cashout.payout)} VC`);
      if (user && user.settings?.sound === false) {
        patchUser({ settings: { ...user.settings, sound: true } });
      }
    } catch (err) {
      setError(err.message || 'Cash out failed.');
      toast.error(err.message || 'Cash out failed.');
      sound.error();
    } finally {
      setPending(false);
    }
  }

  let action;
  if (!user) {
    action = (
      <button type="button" className="btn primary block lg bet-action" onClick={() => navigate('/login')}>
        Sign in to play
      </button>
    );
  } else if (pending) {
    action = (
      <button type="button" className="btn primary block lg bet-action" disabled>
        <span className="spinner" />
        <span className="sub">Processing…</span>
      </button>
    );
  } else if (canCash) {
    action = (
      <button type="button" className="btn green block lg bet-action" onClick={cashOut}>
        <span>
          Cash out
          <span className="mult">{fmtMult(state?.multiplier || 1)}</span>
          <span className="sub">+{fmtCredits((bet?.stake || 0) * (state?.multiplier || 1))} VC</span>
        </span>
      </button>
    );
  } else if (active && phase === 'betting') {
    action = (
      <button type="button" className="btn primary block lg bet-action" disabled>
        <Plane width={18} height={18} />
        Bet locked in
        <span className="sub">Cash out unlocks at takeoff</span>
      </button>
    );
  } else if (cashed) {
    action = (
      <button type="button" className="btn green block lg bet-action" disabled>
        <Check />
        Cashed out at {fmtMult(bet.multiplier)}
        <span className="sub">+{fmtCredits(bet.payout)} VC credited</span>
      </button>
    );
  } else if (lost) {
    action = (
      <button type="button" className="btn block lg bet-action" disabled>
        Lost this round
        <span className="sub">Stake {fmtCredits(bet.stake)} VC · demo credits</span>
      </button>
    );
  } else if (phase === 'flying') {
    action = (
      <button type="button" className="btn block lg bet-action" disabled>
        Next round
        <span className="sub">Plane is already in flight</span>
      </button>
    );
  } else {
    action = (
      <button type="button" className={`btn primary block lg bet-action ${canPlace ? '' : 'is-disabled'}`} disabled={!canPlace} onClick={place}>
        <Plane width={18} height={18} />
        {phase === 'betting' ? 'Place bet' : 'Waiting for next round'}
        <span className="sub">{phase === 'betting' ? `${fmtCredits(stakeValid ? stakeNum : 0)} VC` : 'Get ready'}</span>
      </button>
    );
  }

  return (
    <section className={`panel bet-panel ${cashed ? 'settled' : ''}`} aria-label={`Bet ${slot + 1}`}>
      <div className="panel-head" style={{ paddingBottom: 10 }}>
        <div className="row">
          <span className={`feed-dot ${active ? 'mine' : ''}`} style={cashed ? { background: 'var(--green)' } : undefined} />
          <span className="panel-title">BET {slot + 1}</span>
        </div>
        <span className={`badge ${active ? 'red' : cashed ? 'green' : lost ? '' : 'violet'}`}>
          {active ? 'Active' : cashed ? 'Won' : lost ? 'Lost' : 'Ready'}
        </span>
      </div>

      <div className="bet-body">
        <div className="stake-box">
          <span className="prefix">VC</span>
          <input
            className="stake-input"
            type="number"
            inputMode="decimal"
            min={MIN_STAKE}
            max={MAX_STAKE}
            step="1"
            value={stake}
            disabled={!!bet || phase !== 'betting'}
            onChange={(e) => { setStake(e.target.value); setError(null); }}
            onBlur={() => {
              if (stakeNum > MAX_STAKE) setStake(String(MAX_STAKE));
            }}
            aria-label={`Stake for bet ${slot + 1} in virtual credits`}
          />
          {bet && <span className="prefix" style={{ borderLeft: '1px solid var(--line)', borderRight: 0 }}>LOCKED</span>}
        </div>

        {!bet && (
          <div className="quick-chips">
            {[10, 50, 100, 500].map((v) => (
              <button key={v} type="button" className="quick-chip" onClick={() => setStake(String(v))} disabled={phase !== 'betting'}>
                {v}
              </button>
            ))}
          </div>
        )}

        <div className="payout-row">
          <span>{cashed ? 'Paid out' : active && phase === 'flying' ? 'Cash-out value' : 'Potential payout'}</span>
          <strong className={cashed ? 'win' : ''}>
            {cashed
              ? `+${fmtCredits(bet.payout)}`
              : lost
                ? '0.00 VC'
                : `${fmtCredits(active && phase === 'flying' ? (bet.stake || 0) * (state?.multiplier || 1) : potential)} VC`}
          </strong>
        </div>

        {action}
        {error && <div className="error-text" role="alert">{error}</div>}

        {active && phase === 'betting' && (
          <div className="bet-status-note">Round #{state?.roundNo} · waiting for takeoff</div>
        )}
        {active && phase === 'flying' && (
          <div className="bet-status-note">Auto cash-out {user?.settings?.autoCashOut ? `@ ${fmtMult(user.settings.autoCashOut)}` : 'off'} · demo credits</div>
        )}
        {cashed && (
          <div className="bet-status-note won">Settled at {fmtMult(bet.multiplier)} · round #{state?.roundNo}</div>
        )}
        {lost && <div className="bet-status-note">Crashed at {fmtMult(state?.crashPoint)} · demo credits</div>}
      </div>

      <div className="panel-note row" style={{ gap: 6 }}>
        <Coin width={12} height={12} />
        <span>
          {user
            ? `${fmtCredits(user.balance)} VC available · DEMO only, no cash value`
            : 'Virtual credits only · no real money, no cash value'}
        </span>
      </div>
    </section>
  );
}
