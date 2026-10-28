import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { sound } from '../lib/sound.js';

const ToastContext = createContext(null);
const SoundContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const push = useCallback((type, message, ttl = 4200) => {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2, 7)}`;
    setToasts((list) => [...list.slice(-3), { id, type, message }]);
    const timer = setTimeout(() => dismiss(id), ttl);
    timers.current.set(id, timer);
    return id;
  }, [dismiss]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const value = useMemo(() => ({
    toasts,
    push,
    dismiss,
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  }), [toasts, push, dismiss]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

/** Mute state persists locally; the AudioContext unlocks on first gesture. */
export function SoundProvider({ children }) {
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem('patapotea_muted') === '1'; } catch { return false; }
  });

  useEffect(() => {
    sound.setMuted(muted);
    try { localStorage.setItem('patapotea_muted', muted ? '1' : '0'); } catch { /* ignore */ }
  }, [muted]);

  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const value = useMemo(() => ({
    muted,
    toggle: () => setMuted((m) => !m),
    setMuted,
  }), [muted]);

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

export function useSoundSettings() {
  const ctx = useContext(SoundContext);
  if (!ctx) throw new Error('useSoundSettings must be used inside SoundProvider');
  return ctx;
}
