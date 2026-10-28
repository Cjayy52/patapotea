import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useSoundSettings } from '../context/ToastContext.jsx';
import { fmtCredits, initials } from '../lib/format.js';
import { Dashboard, History, Login, Logout, Plane, Shield, User, Volume, VolumeOff } from './Icons.jsx';

const LINKS = [
  { path: '/', label: 'Play' },
  { path: '/rounds', label: 'Rounds' },
  { path: '/dashboard', label: 'Dashboard', auth: true },
  { path: '/admin', label: 'Admin', admin: true },
];

export function Nav({ path, navigate }) {
  const { user, logout } = useAuth();
  const { muted, toggle } = useSoundSettings();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const links = LINKS.filter((l) => {
    if (l.admin) return user?.role === 'admin';
    if (l.auth) return !!user;
    return true;
  });

  return (
    <div className="site-header">
      <div className="demo-ribbon">
        <span className="dot" />
        Demo · Virtual credits only · No real money
        {typeof __PREVIEW_MODE__ !== 'undefined' && __PREVIEW_MODE__ && (
          <span className="preview-tag">PREVIEW · LOCAL SIMULATION</span>
        )}
      </div>
      <header className="nav">
        <div className="nav-inner">
          <a
            className="brand"
            href="#/"
            onClick={(e) => { e.preventDefault(); navigate('/'); }}
            aria-label="PATAPOTEA home"
          >
            <span className="brand-mark"><Plane width={20} height={20} /></span>
            <span className="brand-name">PATA<span>POTEA</span></span>
          </a>

          <nav className="nav-links" aria-label="Primary">
            {links.map((l) => (
              <a
                key={l.path}
                href={`#${l.path}`}
                className={`nav-link ${path === l.path ? 'active' : ''}`}
                onClick={(e) => { e.preventDefault(); navigate(l.path); }}
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="nav-right">
            {user ? (
              <div className="balance-chip" title="DEMO / virtual credit balance — no cash value">
                <div>
                  <div className="label">BALANCE</div>
                  <div className="value">{fmtCredits(user.balance)}</div>
                </div>
                <span className="unit">VC</span>
                <button
                  type="button"
                  className="icon-btn"
                  style={{ width: 28, height: 28, borderRadius: 8, border: 0, background: 'rgba(255,45,63,.12)' }}
                  onClick={() => navigate('/dashboard')}
                  aria-label="Open dashboard"
                >
                  <User width={14} height={14} />
                </button>
              </div>
            ) : (
              <button type="button" className="btn ghost sm" onClick={() => navigate('/login')}>Sign in</button>
            )}

            <button
              type="button"
              className={`icon-btn ${muted ? 'on' : ''}`}
              onClick={toggle}
              aria-label={muted ? 'Unmute sound' : 'Mute sound'}
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <VolumeOff /> : <Volume />}
            </button>

            {user ? (
              <div style={{ position: 'relative' }} ref={menuRef}>
                <button
                  type="button"
                  className="avatar"
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Account menu"
                >
                  {initials(user.username)}
                </button>
                {menuOpen && (
                  <div className="menu" role="menu">
                    <div className="menu-head">
                      <div className="truncate" style={{ fontWeight: 700 }}>{user.username}</div>
                      <div className="truncate mute" style={{ fontSize: 11 }}>{user.email}</div>
                      <div className="row" style={{ marginTop: 8, gap: 6 }}>
                        <span className="badge red">DEMO</span>
                        {user.role === 'admin' && <span className="badge violet">ADMIN</span>}
                      </div>
                    </div>
                    <button className="menu-item" role="menuitem" onClick={() => { setMenuOpen(false); navigate('/dashboard'); }}>
                      <Dashboard width={16} height={16} /> Dashboard
                    </button>
                    {user.role === 'admin' && (
                      <button className="menu-item" role="menuitem" onClick={() => { setMenuOpen(false); navigate('/admin'); }}>
                        <Shield width={16} height={16} /> Admin panel
                      </button>
                    )}
                    <button className="menu-item" role="menuitem" onClick={() => { setMenuOpen(false); navigate('/dashboard?tab=profile'); }}>
                      <User width={16} height={16} /> Profile settings
                    </button>
                    <button
                      className="menu-item danger"
                      role="menuitem"
                      onClick={async () => { setMenuOpen(false); await logout(); navigate('/'); }}
                    >
                      <Logout width={16} height={16} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button type="button" className="btn primary sm nav-cta" onClick={() => navigate('/register')}>Create account</button>
            )}
          </div>
        </div>
      </header>
    </div>
  );
}

export function MobileNav({ path, navigate }) {
  const { user } = useAuth();
  const items = [
    { path: '/', label: 'Play', icon: Plane },
    { path: '/rounds', label: 'Rounds', icon: History },
    ...(user ? [{ path: '/dashboard', label: 'Account', icon: User }] : []),
    ...(user?.role === 'admin' ? [{ path: '/admin', label: 'Admin', icon: Shield }] : []),
    ...(!user ? [{ path: '/login', label: 'Sign in', icon: Login }] : []),
  ];
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {items.map((item) => (
        <a
          key={item.path}
          href={`#${item.path}`}
          className={path === item.path ? 'active' : ''}
          onClick={(e) => { e.preventDefault(); navigate(item.path); }}
        >
          <item.icon />
          {item.label}
        </a>
      ))}
    </nav>
  );
}
