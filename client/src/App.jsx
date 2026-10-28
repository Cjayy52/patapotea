import { useEffect } from 'react';
import { useAuth } from './context/AuthContext.jsx';
import { useHashRoute } from './hooks/useHashRoute.js';
import { MobileNav, Nav } from './components/Nav.jsx';
import { Footer } from './components/Footer.jsx';
import { Toasts } from './components/Toasts.jsx';
import { PlayPage } from './pages/PlayPage.jsx';
import { AuthPage } from './pages/AuthPage.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { AdminPage } from './pages/AdminPage.jsx';
import { RoundsPage } from './pages/RoundsPage.jsx';
import { Plane } from './components/Icons.jsx';

function Boot({ label = 'Loading your session…' }) {
  return (
    <main className="page container">
      <div className="loading-panel" style={{ minHeight: '50vh' }}>
        <span className="spinner lg" />
        <span className="txt">{label}</span>
      </div>
    </main>
  );
}

function NotFound({ navigate }) {
  return (
    <main className="page container">
      <div className="panel empty" style={{ marginTop: 40 }}>
        <div className="icon"><Plane /></div>
        <h4>Page not found</h4>
        <p>That route doesn&apos;t exist in this demo. Head back to the runway.</p>
        <button type="button" className="btn primary sm" style={{ marginTop: 14 }} onClick={() => navigate('/')}>
          Back to the game
        </button>
      </div>
    </main>
  );
}

export default function App() {
  const { path, query, navigate } = useHashRoute();
  const { user, loading } = useAuth();
  const isAuthRoute = path === '/login' || path === '/register';
  const guarded = path === '/dashboard' || path === '/admin';

  useEffect(() => {
    if (!loading && !user && guarded) navigate('/login', { replace: true });
  }, [loading, user, guarded, navigate]);

  let content;
  if (path === '/login' || path === '/register') {
    content = <AuthPage mode={path === '/register' ? 'register' : 'login'} navigate={navigate} />;
  } else {
    content = (
      <div className="app-frame">
        <Nav path={path} navigate={navigate} />
        {path === '/' && <PlayPage navigate={navigate} />}
        {path === '/dashboard' && (user ? <DashboardPage navigate={navigate} initialTab={query.tab} /> : <Boot />)}
        {path === '/admin' && (user ? <AdminPage navigate={navigate} /> : <Boot label="Checking access…" />)}
        {path === '/rounds' && <RoundsPage navigate={navigate} />}
        {!['/', '/dashboard', '/admin', '/rounds'].includes(path) && <NotFound navigate={navigate} />}
        <Footer navigate={navigate} />
        <MobileNav path={path} navigate={navigate} />
      </div>
    );
  }

  return (
    <>
      {content}
      <Toasts />
    </>
  );
}
