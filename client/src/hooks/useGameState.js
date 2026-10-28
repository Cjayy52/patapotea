import { useEffect, useRef, useState } from 'react';
import { getApi } from '../api/index.js';

/**
 * Live authoritative game state.
 * Server-Sent Events on the full stack; engine subscription in preview mode.
 */
export function useGameState() {
  const [state, setState] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState(null);
  const offsetRef = useRef(0);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    const api = getApi();
    let alive = true;

    api.getState()
      .then((s) => {
        if (!alive) return;
        setState(s);
        setStatus('live');
        if (s?.serverTime) offsetRef.current = s.serverTime - Date.now();
      })
      .catch((err) => {
        if (!alive) return;
        setError(err.message || 'Could not load the game.');
        setStatus('offline');
      });

    const unsubscribe = api.stream(
      (s) => {
        if (!alive || !s) return;
        if (s.serverTime) offsetRef.current = s.serverTime - Date.now();
        setState(s);
        setStatus('live');
        setError(null);
      },
      (st) => { if (alive && st === 'reconnecting') setStatus('reconnecting'); },
    );

    return () => {
      alive = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [reloadKey]);

  return { state, status, error, offsetRef, reload, serverNow: () => Date.now() + offsetRef.current };
}
