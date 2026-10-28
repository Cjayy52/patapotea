import { useCallback, useEffect, useState } from 'react';
import { getApi } from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { fmtCredits, fmtDate, fmtMult, shortHash, timeAgo } from '../lib/format.js';
import { Alert, Coin, Refresh, Shield, Ticket, Trend, User } from '../components/Icons.jsx';

export function AdminPage({ navigate }) {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState({ overview: null, users: [], rounds: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showBots, setShowBots] = useState(true);

  const load = useCallback(async () => {
    if (!user || user.role !== 'admin') return;
    try {
      const [overview, users, rounds] = await Promise.all([
        getApi().adminOverview(),
        getApi().adminUsers(),
        getApi().adminRounds(),
      ]);
      setData({ overview, users: users.users || [], rounds: rounds.rounds || [] });
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load admin data.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!user || user.role !== 'admin') return undefined;
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [user, load]);

  if (authLoading) {
    return <main className="page container"><div className="loading-panel"><span className="spinner lg" /><span className="txt">Checking access…</span></div></main>;
  }

  if (!user || user.role !== 'admin') {
    return (
      <main className="page container">
        <div className="panel empty" style={{ marginTop: 40 }}>
          <div className="icon"><Shield /></div>
          <h4>Admin access required</h4>
          <p>Sign in with an administrator account to view simulated rounds and demo test accounts.</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <button type="button" className="btn primary sm" onClick={() => navigate('/login')}>
              Sign in
            </button>
            <button type="button" className="btn ghost sm" onClick={() => navigate('/')}>Back to game</button>
          </div>
        </div>
      </main>
    );
  }

  const stats = data.overview?.stats;
  const round = data.overview?.currentRound;
  const visibleUsers = data.users.filter((u) => (showBots ? true : !u.isBot));

  return (
    <main className="page container">
      <div className="page-head">
        <div>
          <span className="eyebrow">Operations · read-only</span>
          <h1 className="page-title">Admin dashboard</h1>
          <p className="page-sub">Simulated rounds, demo accounts and virtual-credit flow. No real money is processed.</p>
        </div>
        <div className="row wrap">
          <button type="button" className="btn ghost sm" onClick={() => setShowBots((s) => !s)}>
            <User width={14} height={14} /> {showBots ? 'Hide' : 'Show'} SIM bots
          </button>
          <button type="button" className="btn ghost sm" onClick={load} disabled={loading}>
            <Refresh width={14} height={14} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="alert" style={{ marginBottom: 16 }} role="alert">
          <Alert /><span>{error}</span>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat">
          <div className="k">Demo players</div>
          <div className="v">{(stats?.users ?? 0) + (stats?.bots ?? 0)}</div>
          <div className="s">{stats?.bots ?? 0} simulated bots · {stats?.users ?? 0} humans</div>
        </div>
        <div className="stat">
          <div className="k">Rounds completed</div>
          <div className="v">{stats?.rounds ?? 0}</div>
          <div className="s">{(stats?.bets ?? 0).toLocaleString()} bets recorded</div>
        </div>
        <div className="stat">
          <div className="k">Virtual wagered</div>
          <div className="v">{fmtCredits(stats?.wagered ?? 0)}<span className="u">VC</span></div>
          <div className="s">Lifetime demo stakes</div>
        </div>
        <div className="stat accent">
          <div className="k">Demo house net</div>
          <div className="v" style={{ color: (stats?.houseNet ?? 0) >= 0 ? 'var(--green)' : '#ff7d89' }}>
            {fmtCredits(stats?.houseNet ?? 0)}<span className="u">VC</span>
          </div>
          <div className="s">Stakes − payouts (virtual only)</div>
        </div>
      </div>

      <div className="admin-grid" style={{ marginBottom: 18 }}>
        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">Live round</span>
            <span className={`badge ${round?.phase === 'flying' ? 'red' : round?.phase === 'crashed' ? '' : 'amber'}`}>
              {round?.phase || 'idle'}
            </span>
          </div>
          <div className="round-card">
            <div className="between wrap" style={{ alignItems: 'flex-end' }}>
              <div>
                <div className="eyebrow">Round #{round?.roundNo ?? '—'}</div>
                <div className="big" style={{ marginTop: 4 }}>
                  {fmtMult(round?.phase === 'crashed' ? round?.crashPoint : round?.multiplier)}
                </div>
              </div>
              <div className="mute" style={{ fontSize: 11, textAlign: 'right' }}>
                {(round?.bets || []).length} bets<br />
                {fmtCredits((round?.bets || []).reduce((s, b) => s + b.stake, 0))} VC staked
              </div>
            </div>
            <dl className="kv">
              <dt>Status</dt><dd>{round?.phase || '—'}</dd>
              <dt>Started</dt><dd>{round?.startedAt ? fmtDate(round.startedAt) : '—'}</dd>
              <dt>Crash point</dt><dd>{round?.crashPoint ? fmtMult(round.crashPoint) : 'committed, hidden'}</dd>
              <dt>Seed hash</dt><dd title={round?.seedHash}>{shortHash(round?.seedHash, 20)}</dd>
              <dt>Server seed</dt><dd title={round?.serverSeed}>{round?.serverSeed ? shortHash(round.serverSeed, 20) : 'revealed after crash'}</dd>
            </dl>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="panel-title">Integrity notes</span>
            <span className="badge violet">DEMO</span>
          </div>
          <div className="panel-body stack" style={{ gap: 12 }}>
            <div className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
              <Shield width={15} height={15} style={{ color: 'var(--red)', marginTop: 2 }} />
              <span className="dim" style={{ fontSize: 12 }}>
                Crash points are derived from a hashed server seed and committed before betting opens.
                This is a demo commit-and-reveal record — not independently audited.
              </span>
            </div>
            <div className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
              <Coin width={15} height={15} style={{ color: 'var(--red)', marginTop: 2 }} />
              <span className="dim" style={{ fontSize: 12 }}>
                Every stake and payout is double-entry logged in virtual credits. Total player balances:{' '}
                <strong>{fmtCredits(stats?.balances ?? 0)} VC</strong>.
              </span>
            </div>
            <div className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
              <Alert width={15} height={15} style={{ color: 'var(--amber)', marginTop: 2 }} />
              <span className="dim" style={{ fontSize: 12 }}>
                This admin view is read-only. No real-money deposits, payouts or adjustments exist in this build.
              </span>
            </div>
            <div className="mono mute" style={{ fontSize: 10, marginTop: 4 }}>
              auto-refresh · 8s · {new Date().toLocaleTimeString()}
            </div>
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <span className="panel-title">Simulated rounds</span>
          <span className="badge">{data.rounds.length} shown</span>
        </div>
        {loading && !data.rounds.length ? (
          <div className="loading-panel"><span className="spinner lg" /><span className="txt">Loading rounds…</span></div>
        ) : data.rounds.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Round</th><th>Crash</th><th>Status</th><th>Bets</th>
                  <th>Staked (VC)</th><th>Paid (VC)</th><th>Net (VC)</th><th>Seed</th><th>Crashed</th>
                </tr>
              </thead>
              <tbody>
                {data.rounds.map((r) => (
                  <tr key={r.id}>
                    <td className="round-no">#{r.roundNo}</td>
                    <td className="num">{r.crashPoint ? fmtMult(r.crashPoint) : '—'}</td>
                    <td>
                      <span className={`badge ${r.status === 'crashed' ? 'red' : r.status === 'flying' ? 'green' : 'amber'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="num">{r.betCount}</td>
                    <td className="num">{fmtCredits(r.staked)}</td>
                    <td className="num">{fmtCredits(r.paid)}</td>
                    <td className={`num ${r.staked - r.paid >= 0 ? 'pos' : 'neg'}`}>{fmtCredits(r.staked - r.paid)}</td>
                    <td className="mono mute" style={{ fontSize: 10 }}>{shortHash(r.seedHash, 12)}</td>
                    <td className="mute" style={{ fontSize: 11 }}>{r.crashedAt ? timeAgo(r.crashedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="icon"><Trend /></div>
            <h4>No completed rounds yet</h4>
            <p>Rounds appear here as soon as the first flight crashes.</p>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">Demo &amp; test accounts</span>
          <span className="badge">{visibleUsers.length} accounts</span>
        </div>
        {loading && !data.users.length ? (
          <div className="loading-panel"><span className="spinner lg" /><span className="txt">Loading accounts…</span></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Username</th><th>Email</th><th>Role</th><th>Balance (VC)</th><th>Bets</th><th>Created</th><th>Last login</th></tr>
              </thead>
              <tbody>
                {visibleUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className="row" style={{ gap: 7 }}>
                        <span className="avatar" style={{ width: 24, height: 24, fontSize: 9, cursor: 'default' }}>
                          {u.username.slice(0, 2).toUpperCase()}
                        </span>
                        {u.username}
                        {u.isBot && <span className="badge" style={{ fontSize: 8 }}>SIM</span>}
                      </span>
                    </td>
                    <td className="mute" style={{ fontSize: 11.5 }}>{u.email}</td>
                    <td><span className={`badge ${u.role === 'admin' ? 'violet' : ''}`}>{u.role}</span></td>
                    <td className="num">{fmtCredits(u.balance)}</td>
                    <td className="num">{u.betCount}</td>
                    <td className="mute" style={{ fontSize: 11 }}>{fmtDate(u.createdAt)}</td>
                    <td className="mute" style={{ fontSize: 11 }}>{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="panel-note">
          Test accounts are seeded for review. Credentials are printed by the server on first boot and can be
          overridden with <code>SEED_ADMIN_PASSWORD</code> / <code>SEED_PLAYER_PASSWORD</code>.
          Accounts marked <strong>SIM</strong> are bots that keep demo tables populated.
        </div>
      </section>

      <div className="fairness-bar" style={{ marginTop: 16 }}>
        <span className="badge red">READ-ONLY</span>
        <span className="mute">
          Admin actions that move real value are intentionally absent. See docs/REAL_MONEY_READINESS.md for the
          security, licensing and compliance work a real-money deployment would require.
        </span>
      </div>
    </main>
  );
}
