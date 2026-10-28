/** Formatting helpers shared by the UI. */

export const fmtCredits = (n, decimals = 2) => {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0.00';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

export const fmtMult = (n) => {
  const num = Number(n);
  if (!Number.isFinite(num)) return '1.00x';
  if (num >= 100) return `${num.toFixed(1)}x`;
  return `${num.toFixed(2)}x`;
};

export const multClass = (n) => (n >= 10 ? 'high' : n >= 2 ? 'mid' : 'low');

export const fmtDate = (ts) => {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
};

export const fmtTime = (ts) => {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '—';
  }
};

export const timeAgo = (ts) => {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export const initials = (name = '') =>
  name.trim().slice(0, 2).toUpperCase() || 'PP';

export const shortHash = (hash, n = 10) =>
  hash ? `${hash.slice(0, n)}…${hash.slice(-4)}` : '—';

/** Full local timestamp including seconds — used by the round audit record. */
export const fmtTimestamp = (ts) => {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return '—';
  }
};

/** Short, stable display form of a UUID round id. */
export const shortId = (id = '') => (id ? id.slice(0, 8) : '—');
