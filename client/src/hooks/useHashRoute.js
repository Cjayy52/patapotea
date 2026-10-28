import { useCallback, useEffect, useState } from 'react';

const normalize = (raw) => {
  const path = (raw || '').replace(/^#/, '');
  if (!path || path === '/') return '/';
  return path.startsWith('/') ? path : `/${path}`;
};

/** Tiny dependency-free hash router — robust for a single-page demo. */
export function useHashRoute() {
  const read = () => {
    const parsed = normalize(window.location.hash);
    const [pathname, qs = ''] = parsed.split('?');
    return { pathname, query: Object.fromEntries(new URLSearchParams(qs)) };
  };
  const [route, setRoute] = useState(read);

  useEffect(() => {
    const onChange = () => {
      setRoute(read());
      window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((to, { replace = false } = {}) => {
    const target = `#${normalize(to)}`;
    if (window.location.hash === target) return;
    if (replace) window.history.replaceState(null, '', target);
    else window.location.hash = target;
    setRoute(read());
  }, []);

  return { path: route.pathname, query: route.query, navigate };
}
