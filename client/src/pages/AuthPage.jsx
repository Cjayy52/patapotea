import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { ApiError } from '../api/index.js';
import { ArrowRight, Bolt, Check, Lock, Mail, Plane, Shield, User } from '../components/Icons.jsx';

export function AuthPage({ mode, navigate }) {
  const isRegister = mode === 'register';
  const { user, login, register } = useAuth();
  const toast = useToast();

  const [form, setForm] = useState({ email: '', username: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  useEffect(() => {
    if (user) navigate('/', { replace: true });
  }, [user, navigate]);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((x) => ({ ...x, [key]: undefined }));
    setFormError(null);
  };

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    setErrors({});
    try {
      if (isRegister) {
        await register(form.email.trim(), form.username.trim(), form.password);
        toast.success('Demo account created — 10,000 virtual credits added.');
      } else {
        await login(form.email.trim(), form.password);
        toast.success('Signed in. Good luck — demo credits only.');
      }
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError && err.field) {
        setErrors({ [err.field]: err.message });
      } else {
        setFormError(err.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  function fillDemo(kind) {
    const creds = kind === 'admin'
      ? { email: 'admin@patapotea.demo', password: 'AdminDemo!2025' }
      : { email: 'player@patapotea.demo', password: 'PlayerDemo!2025' };
    setForm({ email: creds.email, username: '', password: creds.password });
    setErrors({});
    setFormError(null);
    setShowDemo(false);
    toast.info('Demo credentials filled — press sign in.');
  }

  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); navigate('/'); }} aria-label="PATAPOTEA home">
          <span className="brand-mark"><Plane width={20} height={20} /></span>
          <span className="brand-name">PATA<span>POTEA</span></span>
        </a>

        <div className="auth-hero">
          <span className="badge red" style={{ marginBottom: 16 }}>DEMO BUILD · VIRTUAL CREDITS</span>
          <h1>Watch it climb.<br /><em>Cash out</em> before it burns.</h1>
          <p>
            An Aviator-style crash game built with an authoritative server, a commit-and-reveal
            crash record and two simultaneous virtual bets — all played with credits that are
            worth absolutely nothing.
          </p>
          <div className="auth-points">
            <div className="auth-point"><Check /> Start with 10,000 virtual credits, no card, no deposit.</div>
            <div className="auth-point"><Shield /> Server-validated timing and single-settlement cash-outs.</div>
            <div className="auth-point"><Bolt /> Live multipliers, flight history, full demo ledger.</div>
          </div>
        </div>

        <div className="auth-legal">
          PATAPOTEA is a technology demonstration. It does not accept real-money deposits or stakes,
          and virtual credits cannot be exchanged for cash. Gambling involves risk — if it stops
          being fun, seek support. 18+.
        </div>

        <svg className="auth-orbit" viewBox="0 0 400 400" fill="none" aria-hidden="true">
          <circle cx="200" cy="200" r="150" stroke="rgba(255,45,63,0.12)" strokeDasharray="3 9" />
          <circle cx="200" cy="200" r="110" stroke="rgba(255,45,63,0.08)" />
          <path d="M40 330C120 300 180 220 350 70" stroke="rgba(255,45,63,0.35)" strokeWidth="1.2" strokeDasharray="4 8" />
          <path d="M330 92l26-26-36 6" stroke="rgba(255,45,63,0.5)" strokeWidth="1.2" />
        </svg>
      </aside>

      <main className="auth-panel">
        <div className="auth-card">
          <div className="auth-mobile-brand brand">
            <span className="brand-mark"><Plane width={20} height={20} /></span>
            <span className="brand-name">PATA<span>POTEA</span></span>
          </div>

          <h1 className="page-title" style={{ fontSize: 28 }}>{isRegister ? 'Create your demo account' : 'Welcome back'}</h1>
          <p className="sub">
            {isRegister
              ? 'Free, instant, and funded with 10,000 virtual credits. No payment details.'
              : 'Sign in to place virtual bets and track your demo history.'}
          </p>

          {formError && (
            <div className="alert" style={{ marginBottom: 16 }} role="alert">
              <Shield />
              <span>{formError}</span>
            </div>
          )}

          <form className="auth-form" onSubmit={submit} noValidate>
            <label className="field">
              <span className="field-label">Email</span>
              <div className="input-wrap">
                <Mail className="input-icon" />
                <input
                  className={`input with-icon ${errors.email ? 'invalid' : ''}`}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={set('email')}
                  required
                  aria-invalid={!!errors.email}
                />
              </div>
              {errors.email && <span className="error-text">{errors.email}</span>}
            </label>

            {isRegister && (
              <label className="field">
                <span className="field-label">Username</span>
                <div className="input-wrap">
                  <User className="input-icon" />
                  <input
                    className={`input with-icon ${errors.username ? 'invalid' : ''}`}
                    type="text"
                    autoComplete="username"
                    placeholder="sky_rider"
                    value={form.username}
                    onChange={set('username')}
                    maxLength={20}
                    required
                    aria-invalid={!!errors.username}
                  />
                </div>
                {errors.username
                  ? <span className="error-text">{errors.username}</span>
                  : <span className="hint">3–20 characters: letters, numbers or underscores.</span>}
              </label>
            )}

            <label className="field">
              <span className="field-label">Password</span>
              <div className="input-wrap">
                <Lock className="input-icon" />
                <input
                  className={`input with-icon ${errors.password ? 'invalid' : ''}`}
                  type="password"
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  placeholder={isRegister ? 'At least 10 characters' : 'Your password'}
                  value={form.password}
                  onChange={set('password')}
                  required
                  aria-invalid={!!errors.password}
                />
              </div>
              {errors.password
                ? <span className="error-text">{errors.password}</span>
                : isRegister && <span className="hint">10+ characters, including a letter and a number.</span>}
            </label>

            <button type="submit" className="btn primary block lg" disabled={busy}>
              {busy ? <><span className="spinner" /> Please wait…</> : (
                <>{isRegister ? 'Create demo account' : 'Sign in'} <ArrowRight width={16} height={16} /></>
              )}
            </button>
          </form>

          <div className="auth-foot">
            {isRegister ? (
              <>Already have a demo account? <a href="#/login" onClick={(e) => { e.preventDefault(); navigate('/login'); }}>Sign in</a></>
            ) : (
              <>New here? <a href="#/register" onClick={(e) => { e.preventDefault(); navigate('/register'); }}>Create a demo account</a></>
            )}
          </div>

          <div className="auth-demo-hint">
            <div className="between">
              <span><strong style={{ color: 'var(--text-dim)' }}>Test accounts</strong> — seeded for review.</span>
              <button type="button" className="btn ghost sm" onClick={() => setShowDemo((s) => !s)}>
                {showDemo ? 'Hide' : 'Use demo login'}
              </button>
            </div>
            {showDemo && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button type="button" className="btn ghost sm block" onClick={() => fillDemo('player')}>
                  Player · player@patapotea.demo
                </button>
                <button type="button" className="btn ghost sm block" onClick={() => fillDemo('admin')}>
                  Admin · admin@patapotea.demo
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
