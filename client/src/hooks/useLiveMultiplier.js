import { useEffect, useState } from 'react';
import { multiplierAt } from '../../../shared/game-math.js';

/**
 * Smooth client-side rendering of the server's multiplier.
 * The function is only an interpolation of authoritative timestamps — the
 * server remains the source of truth for every accepted cash-out.
 */
export function useLiveMultiplier(state, offsetRef, fps = 30) {
  const [value, setValue] = useState(state?.multiplier ?? 1);

  useEffect(() => {
    if (!state) return undefined;
    if (!state.flyStartedAt || state.phase === 'betting') {
      setValue(1);
      return undefined;
    }
    let raf;
    let last = 0;
    const frame = (ts) => {
      if (ts - last > 1000 / fps) {
        last = ts;
        const now = Date.now() + (offsetRef?.current || 0);
        let m;
        if (state.phase === 'crashed') {
          m = state.crashPoint || 1;
        } else {
          const until = state.crashAt ? Math.min(now, state.crashAt) : now;
          m = multiplierAt(until - state.flyStartedAt);
        }
        setValue(m);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [state?.roundId, state?.phase, state?.flyStartedAt, state?.crashAt, state?.crashPoint, fps, offsetRef]);

  return value;
}

/** Countdown to the next phase, updated ~10x/second. */
export function useCountdown(targetTs, offsetRef) {
  const [remaining, setRemaining] = useState(() =>
    targetTs ? Math.max(0, targetTs - (Date.now() + (offsetRef?.current || 0))) : 0);

  useEffect(() => {
    if (!targetTs) return undefined;
    let raf;
    let last = 0;
    const frame = (ts) => {
      if (ts - last > 90) {
        last = ts;
        const remain = Math.max(0, targetTs - (Date.now() + (offsetRef?.current || 0)));
        setRemaining(remain);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [targetTs, offsetRef]);

  return remaining;
}
