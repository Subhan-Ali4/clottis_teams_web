import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setUnauthorizedHandler } from './api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // true until the first /me check finishes
  const [notice, setNotice] = useState('');

  // Session survives a refresh: the cookie is checked with the server on every app load.
  useEffect(() => {
    let alive = true;
    api.me()
      .then((r) => alive && setUser(r.user))
      .catch(() => alive && setUser(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  // Any protected call that comes back 401 means the session ended
  // (logged out elsewhere, deactivated, password reset, expired).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setNotice('Your session has ended. Please sign in again.');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await api.login(email, password);
    setNotice('');
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* cookie is cleared or already invalid */ }
    setNotice('');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, notice, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
