/**
 * HTTP client for the PATAPOTEA server.
 * Cookie sessions are httpOnly; every mutation carries the CSRF header.
 */

export class ApiError extends Error {
  constructor(message, code = 'REQUEST_FAILED', status = 0, field) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'patapotea',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the game server. Check your connection.', 'NETWORK', 0);
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    throw new ApiError(
      data?.error || `Request failed (${res.status}).`,
      data?.code || 'REQUEST_FAILED',
      res.status,
      data?.field,
    );
  }
  return data;
}

export class HttpApi {
  mode = 'server';

  getState() { return request('/game/state'); }

  /** Subscribe to authoritative state over Server-Sent Events. */
  stream(onState, onStatus) {
    let closed = false;
    let source;
    let retry = 0;

    const connect = () => {
      if (closed) return;
      source = new EventSource('/api/game/stream');
      source.addEventListener('open', () => { retry = 0; onStatus?.('live'); });
      source.addEventListener('state', (ev) => {
        try { onState(JSON.parse(ev.data).state); } catch { /* ignore malformed frame */ }
      });
      source.addEventListener('error', () => {
        onStatus?.('reconnecting');
        source.close();
        if (closed) return;
        retry = Math.min(retry + 1, 6);
        setTimeout(connect, 800 * retry);
      });
    };
    connect();

    return () => {
      closed = true;
      try { source?.close(); } catch { /* ignore */ }
    };
  }

  me() { return request('/auth/me'); }
  login(email, password) { return request('/auth/login', { method: 'POST', body: { email, password } }); }
  register(email, username, password) {
    return request('/auth/register', { method: 'POST', body: { email, username, password } });
  }
  logout() { return request('/auth/logout', { method: 'POST' }); }
  updateProfile(settings) { return request('/auth/profile', { method: 'PATCH', body: { settings } }); }
  changePassword(currentPassword, newPassword) {
    return request('/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
  }

  placeBet(slot, stake) { return request('/game/bet', { method: 'POST', body: { slot, stake } }); }
  cashOut(slot) { return request('/game/cashout', { method: 'POST', body: { slot } }); }

  fairness() { return request('/fairness'); }

  rounds(limit = 20, before = null) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (before) params.set('before', String(before));
    const qs = params.toString();
    return request(`/rounds${qs ? `?${qs}` : ''}`);
  }

  roundDetail(id) { return request(`/rounds/${encodeURIComponent(id)}`); }
  verifyRound(id) { return request(`/rounds/${encodeURIComponent(id)}/verify`); }

  myBets() { return request('/me/bets'); }
  myTransactions() { return request('/me/transactions'); }
  demoTopup() { return request('/wallet/demo-topup', { method: 'POST' }); }

  adminOverview() { return request('/admin/overview'); }
  adminUsers() { return request('/admin/users?bots=1'); }
  adminRounds() { return request('/admin/rounds?limit=40'); }
}
