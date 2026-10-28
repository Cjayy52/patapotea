import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApi } from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSoundSettings, useToast } from '../context/ToastContext.jsx';
import { fmtCredits, fmtDate, fmtMult, multClass } from '../lib/format.js';
import { Alert, Check, Coin, History, Lock, Logout, Refresh, Ticket, Trend, User } from '../components/Icons.jsx';

const TABS = [
  { id: 'bets', label: 'My bets' },
  { id: 'ledger', label: 'Credit ledger' },
  { id: 'profile', label: 'Profile settings' },
];

export function DashboardPage({ navigate, initialTab }) {
  const { user, logout, updateBalance, patchUser } = useAuth();
  const toast = useToast();
  const { muted, toggle } = useSoundSettings();
  const [tab, setTab] = useState(TABS.some((t) => t.id === initialTab) ? initialTab : 'bets');
  const [bets, setBets] = useState([]);
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [topping, setTopping] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, t] = await Promise.all([getApi().myBets(), getApi().myTransactions()]);
      setBets(b.bets || []);
      setTxs(t.transactions || []);
    } catch (err) {
      setError(err.message || 'Could not load your dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const staked = bets.reduce((s, b) => s + b.stake, 0);
    const returned = bets.reduce((s, b) => s + (b.payout || 0), 0);
    const settled = bets.filter((b) => b.status !== 'active');
    const wins = settled.filter((b) => b.status === 'cashed');
    const best = settled.reduce((m, b) => Math.max(m, b.multiplier || 0), 0);
    return {
      staked,
      returned,
      net: returned - staked,
      winRate: settled.length ? Math.round((wins.length / settled.length) * 100) : 0,
      best,
      settled: settled.length,
    };
  }, [bets]);

  async function topup() {
    setTopping(true);
    try {
      const res = await getApi().demoTopup();
      updateBalance(res.balance);
      toast.success(`Added ${fmtCredits(res.amount)} demo credits.`);
      load();
    } catch (err) {
      toast.error(err.message || 'Top-up failed.');
    } finally {
      setTopping(false);
    }
  }

  return (
    <main className="page container">
      <div className="page-head">
        <div>
          <span className="eyebrow">Player dashboard</span>
          <h1 className="page-title">Hello, {user.username}</h1>
          <p className="page-sub">Demo account · joined {fmtDate(user.createdAt)} · all figures in virtual credits</p>
        </div>
        <div className="row wrap">
          <button type="button" className="btn ghost sm" onClick={load} disabled={loading}>
            <Refresh width={14} height={14} /> Refresh
          </button>
          <button type="button" className="btn primary sm" onClick={() => navigate('/')}>
            <Ticket width={15} height={15} /> Back to the game
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat">
          <div className="k">Virtual balance</div>
          <div className="v">{fmtCredits(user.balance)}<span className="u">VC</span></div>
          <div className="s">DEMO credits · no cash value</div>
        </div>
        <div className="stat">
          <div className="k">Total staked</div>
          <div className="v">{fmtCredits(stats.staked)}<span className="u">VC</span></div>
          <div className="s">{bets.length} bets placed</div>
        </div>
        <div className="stat accent">
          <div className="k">Net result</div>
          <div className="v" style={{ color: stats.net >= 0 ? 'var(--green)' : '#ff7d89' }}>
            {stats.net >= 0 ? '+' : ''}{fmtCredits(stats.net)}<span className="u">VC</span>
          </div>
          <div className="s">{stats.settled} settled rounds</div>
        </div>
        <div className="stat">
          <div className="k">Win rate · best</div>
          <div className="v">{stats.winRate}%<span className="u">· {stats.best ? fmtMult(stats.best) : '—'}</span></div>
          <div className="s">Cash-outs / settled bets</div>
        </div>
      </div>

      <section className="panel">
        <div className="between wrap" style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <div className="row" style={{ gap: 10 }}>
            <Coin width={16} height={16} style={{ color: 'var(--red)' }} />
            <span className="panel-title">Account activity</span>
            <span className="badge red">DEMO / VIRTUAL CREDITS</span>
          </div>
          <button type="button" className="btn ghost sm" onClick={topup} disabled={topping}>
            {topping ? <span className="spinner" /> : <Refresh width={14} height={14} />} Claim 2,500 demo credits
          </button>
        </div>

        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div style={{ padding: 18 }}>
            <div className="alert" role="alert">
              <Alert /><span>{error}</span>
              <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={load}>Retry</button>
            </div>
          </div>
        )}

        {loading && !error && <TableSkeleton />}

        {!loading && !error && tab === 'bets' && (
          bets.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Round</th><th>Slot</th><th>Stake</th><th>Crash</th>
                    <th>Cash-out</th><th>Payout</th><th>Result</th><th>Placed</th>
                  </tr>
                </thead>
                <tbody>
                  {bets.map((b) => (
                    <tr key={b.id}>
                      <td className="round-no">#{b.roundNo ?? '—'}</td>
                      <td>Bet {b.slot + 1}</td>
                      <td className="num">{fmtCredits(b.stake)}</td>
                      <td className="num">
                        {b.crashPoint ? <span className={multClass(b.crashPoint)} style={{ color: 'inherit' }}>{fmtMult(b.crashPoint)}</span> : '—'}
                      </td>
                      <td className="num">{b.multiplier ? fmtMult(b.multiplier) : '—'}</td>
                      <td className={`num ${b.payout > 0 ? 'pos' : ''}`}>{b.payout > 0 ? `+${fmtCredits(b.payout)}` : '0.00'}</td>
                      <td>
                        {b.status === 'cashed' && <span className="badge green">Won</span>}
                        {b.status === 'lost' && <span className="badge red">Lost</span>}
                        {b.status === 'active' && <span className="badge amber">Active</span>}
                      </td>
                      <td className="mute" style={{ fontSize: 11 }}>{fmtDate(b.placedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <div className="icon"><History /></div>
              <h4>No bets yet</h4>
              <p>Your virtual bets will appear here with the round, crash multiplier and settlement.</p>
              <button type="button" className="btn primary sm" style={{ marginTop: 14 }} onClick={() => navigate('/')}>
                Play your first round
              </button>
            </div>
          )
        )}

        {!loading && !error && tab === 'ledger' && (
          txs.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Type</th><th>Amount (VC)</th><th>Balance after</th><th>Note</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {txs.map((t) => (
                    <tr key={t.id}>
                      <td>{labelForTx(t.type)}</td>
                      <td className={`num ${t.amount >= 0 ? 'pos' : 'neg'}`}>{t.amount >= 0 ? '+' : ''}{fmtCredits(t.amount)}</td>
                      <td className="num">{fmtCredits(t.balanceAfter)}</td>
                      <td className="mute" style={{ whiteSpace: 'normal', maxWidth: 340 }}>{t.note}</td>
                      <td className="mute" style={{ fontSize: 11 }}>{fmtDate(t.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <div className="icon"><Coin /></div>
              <h4>No credit movements</h4>
              <p>Every stake, payout and demo top-up is recorded here for transparency.</p>
            </div>
          )
        )}

        {!loading && !error && tab === 'profile' && (
          <ProfileTab user={user} patchUser={patchUser} muted={muted} toggleSound={toggle} navigate={navigate} onLogout={logout} toast={toast} />
        )}
      </section>

      <div className="fairness-bar" style={{ marginTop: 16 }}>
        <span className="badge">REMINDER</span>
        <span className="mute">
          These are simulated balances tracked in a demo ledger. There is no deposit, withdrawal or
          real-money wagering path in this application, and credits cannot be exchanged for value.
        </span>
      </div>
    </main>
  );
}

function ProfileTab({ user, patchUser, muted, toggleSound, navigate, onLogout, toast }) {
  const [autoCashOut, setAutoCashOut] = useState(user.settings?.autoCashOut ?? '');
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState(null);
  const [pwOk, setPwOk] = useState(false);

  async function savePreferences(nextMuted = muted) {
    setSaving(true);
    try {
      const res = await getApi().updateProfile({
        sound: !nextMuted,
        autoCashOut: autoCashOut === '' ? null : Number(autoCashOut),
      });
      patchUser(res.user);
      toast.success('Preferences saved.');
    } catch (err) {
      toast.error(err.message || 'Could not save preferences.');
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwError(null);
    setPwOk(false);
    if (pw.next !== pw.confirm) {
      setPwError('New passwords do not match.');
      return;
    }
    setPwBusy(true);
    try {
      await getApi().changePassword(pw.current, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      setPwOk(true);
      toast.success('Password updated. Other sessions were signed out.');
    } catch (err) {
      setPwError(err.message || 'Could not change password.');
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className="profile-grid">
      <div className="profile-block">
        <h4>Account</h4>
        <div className="kv" style={{ marginTop: 0 }}>
          <dt>Username</dt><dd>{user.username}</dd>
          <dt>Email</dt><dd>{user.email}</dd>
          <dt>Role</dt><dd>{user.role}</dd>
          <dt>Member since</dt><dd>{fmtDate(user.createdAt)}</dd>
          <dt>Balance</dt><dd>{fmtCredits(user.balance)} VC</dd>
        </div>

        <h4 style={{ marginTop: 8 }}>Gameplay</h4>
        <div className="switch-row">
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Sound effects</div>
            <div className="hint">Takeoff, cash-out and crash cues.</div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={!muted}
              onChange={() => { const nextMuted = !muted; toggleSound(); savePreferences(nextMuted); }}
              aria-label="Toggle sound effects"
            />
            <span className="track" />
          </label>
        </div>

        <div className="field">
          <span className="field-label">Auto cash-out (multiplier)</span>
          <div className="row">
            <input
              className="input"
              type="number"
              min="1.01"
              max="500"
              step="0.01"
              placeholder="e.g. 2.00 (blank = off)"
              value={autoCashOut}
              onChange={(e) => setAutoCashOut(e.target.value)}
            />
            <button type="button" className="btn primary sm" onClick={() => savePreferences()} disabled={saving}>
              {saving ? <span className="spinner" /> : <Check width={14} height={14} />} Save
            </button>
          </div>
          <span className="hint">Automatically cash out both slots once the live multiplier reaches this value.</span>
        </div>
      </div>

      <div className="profile-block">
        <h4>Change password</h4>
        <form className="stack" style={{ gap: 10 }} onSubmit={changePassword}>
          <label className="field">
            <span className="field-label">Current password</span>
            <input
              className="input" type="password" autoComplete="current-password"
              value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} required
            />
          </label>
          <label className="field">
            <span className="field-label">New password</span>
            <input
              className="input" type="password" autoComplete="new-password" minLength={10}
              value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} required
            />
          </label>
          <label className="field">
            <span className="field-label">Confirm new password</span>
            <input
              className="input" type="password" autoComplete="new-password"
              value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} required
            />
          </label>
          {pwError && <div className="error-text" role="alert">{pwError}</div>}
          {pwOk && <div className="alert success"><Check /><span>Password changed successfully.</span></div>}
          <button type="submit" className="btn primary" disabled={pwBusy}>
            {pwBusy ? <span className="spinner" /> : <Lock width={15} height={15} />} Update password
          </button>
        </form>

        <button type="button" className="btn danger" style={{ marginTop: 12 }} onClick={async () => { await onLogout(); navigate('/'); }}>
          <Logout width={15} height={15} /> Sign out of this device
        </button>
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div style={{ padding: 18 }} aria-busy="true" aria-label="Loading">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="row" style={{ padding: '10px 0', gap: 18 }}>
          <div className="skeleton skeleton-line" style={{ width: 60 }} />
          <div className="skeleton skeleton-line" style={{ flex: 1 }} />
          <div className="skeleton skeleton-line" style={{ width: 90 }} />
          <div className="skeleton skeleton-line" style={{ width: 70 }} />
        </div>
      ))}
    </div>
  );
}

function labelForTx(type) {
  switch (type) {
    case 'signup_bonus': return 'Demo signup grant';
    case 'bet_stake': return 'Bet stake';
    case 'cashout_credit': return 'Cash-out payout';
    case 'demo_topup': return 'Demo top-up';
    default: return type;
  }
}
