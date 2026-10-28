export function Footer({ navigate }) {
  return (
    <footer className="site-foot">
      <div className="container">
        <div className="between wrap" style={{ gap: 16 }}>
          <div style={{ maxWidth: 720 }}>
            <strong style={{ color: 'var(--text-dim)', letterSpacing: '0.1em' }}>PATAPOTEA</strong>
            {' '}— Aviator-style crash game demo. All balances, stakes, payouts and transactions are
            <strong> DEMO / VIRTUAL CREDITS</strong> with no monetary value. No deposits, wagering or
            withdrawals involving real money are supported. 18+.
          </div>
          <div className="mono" style={{ fontSize: 10 }}>v1.0.0 · demo build</div>
        </div>
        <div className="links">
          <a href="#/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Play</a>
          <a href="#/dashboard" onClick={(e) => { e.preventDefault(); navigate('/dashboard'); }}>Dashboard</a>
          <a href="#/rounds" onClick={(e) => { e.preventDefault(); navigate('/rounds'); }}>Round verification (demo)</a>
          <span>Seed commitment only · not independently audited</span>
          <span>Responsible play: this is a simulation</span>
        </div>
      </div>
    </footer>
  );
}
