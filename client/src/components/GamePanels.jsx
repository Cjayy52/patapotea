import { fmtMult, multClass } from '../lib/format.js';

export function HistoryStrip({ history = [], loading }) {
  return (
    <div className="history-strip" aria-label="Recent crash multipliers">
      <span className="history-label">Last crashes</span>
      {loading && !history.length && (
        <>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="skeleton" style={{ width: 48, height: 22, flexShrink: 0 }} />
          ))}
        </>
      )}
      {!loading && !history.length && <span className="history-empty">Waiting for the first round…</span>}
      {history.map((h) => (
        <span
          key={`${h.roundId}-${h.crashedAt}`}
          className={`history-chip ${multClass(h.crashPoint)}`}
          title={`Round #${h.roundNo} crashed at ${fmtMult(h.crashPoint)}`}
        >
          {fmtMult(h.crashPoint)}
        </span>
      ))}
    </div>
  );
}

export function BetFeed({ bets = [], user }) {
  const mineOf = (b) => b.mine || (user && b.userId === user.id);
  const sorted = [...bets].sort((a, b) => {
    const rank = (x) => (x.status === 'cashed' ? 0 : x.status === 'active' ? 1 : 2);
    return rank(a) - rank(b) || (b.payout || 0) - (a.payout || 0);
  });

  return (
    <section className="panel feed-panel" aria-label="Live bets">
      <div className="panel-head">
        <span className="panel-title">Live bets</span>
        <span className="badge"><span className="dot live" style={{ background: 'var(--green)' }} />{bets.length} players</span>
      </div>
      <div className="feed">
        {!sorted.length && (
          <div className="feed-empty">
            No bets yet this round.<br />
            Place one before the countdown ends.
          </div>
        )}
        {sorted.map((b, i) => (
          <div className="feed-row" key={b.id || i}>
            <div className="feed-user">
              <span className={`feed-dot ${mineOf(b) ? 'mine' : ''}`} style={b.status === 'cashed' ? { background: 'var(--green)' } : undefined} />
              <span className={`feed-name ${mineOf(b) ? 'mine' : ''}`}>
                {mineOf(b) ? 'You' : b.username}
                {b.isBot && <span className="sim">SIM</span>}
              </span>
              <span className="mute mono" style={{ fontSize: 10 }}>#{b.slot + 1}</span>
            </div>
            {b.status === 'cashed' ? (
              <span className="feed-amt win">
                {fmtMult(b.multiplier)} · +{Number(b.payout).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            ) : b.status === 'lost' ? (
              <span className="feed-amt" style={{ color: '#ff7d89' }}>
                lost <small>{Number(b.stake).toFixed(2)}</small>
              </span>
            ) : (
              <span className="feed-amt">
                {Number(b.stake).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <small>VC</small>
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="panel-note">
        Simulated players marked <strong>SIM</strong> are demo bots. All amounts are virtual credits.
      </div>
    </section>
  );
}
