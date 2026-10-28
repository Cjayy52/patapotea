import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getApi } from '../api/index.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const res = await getApi().me();
      setUser(res.user || null);
      setBootError(null);
      return res.user || null;
    } catch (err) {
      setBootError(err.message || 'Could not restore your session.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (email, password) => {
    const res = await getApi().login(email, password);
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (email, username, password) => {
    const res = await getApi().register(email, username, password);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try { await getApi().logout(); } finally { setUser(null); }
  }, []);

  const updateBalance = useCallback((balance) => {
    setUser((u) => (u ? { ...u, balance } : u));
  }, []);

  const patchUser = useCallback((patch) => {
    setUser((u) => (u ? { ...u, ...patch } : u));
  }, []);

  const value = useMemo(
    () => ({ user, loading, bootError, login, register, logout, refresh, updateBalance, patchUser }),
    [user, loading, bootError, login, register, logout, refresh, updateBalance, patchUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
