import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';

const Session = createContext(null);
const storageKey = 'horta.sessao';

export function SessionProvider({ children }) {
  const [token, setToken] = useState(() => sessionStorage.getItem(storageKey));
  const [usuario, setUsuario] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  const logout = useCallback(() => {
    sessionStorage.removeItem(storageKey);
    setToken(null);
    setUsuario(null);
    setError('');
    setLoading(false);
  }, []);

  const request = useCallback(async (path, options) => {
    try { return await api(path, { ...options, token }); }
    catch (error) {
      if (token && error.status === 401) logout();
      throw error;
    }
  }, [token, logout]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    request('/auth/me', { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setUsuario(data.usuario); })
      .catch(error => {
        if (!controller.signal.aborted && error.status !== 401) setError(error.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, request, retry]);

  const login = async credentials => {
    const { data } = await api('/auth/login', { method: 'POST', body: credentials });
    sessionStorage.setItem(storageKey, data.accessToken);
    setUsuario(data.usuario);
    setToken(data.accessToken);
    setError('');
  };
  const retrySession = () => { setLoading(true); setError(''); setRetry(value => value + 1); };
  return <Session.Provider value={{ token, usuario, loading, error, retrySession, login, logout, request }}>{children}</Session.Provider>;
}

export function useSession() { return useContext(Session); }

export function useResource(path, refreshMs = 0) {
  const { request } = useSession();
  const [state, setState] = useState({ path: null, data: null, error: null, loading: false });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState(current => ({ path, data: current.path === path ? current.data : null, error: null, loading: true }));
    request(path, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setState({ path, data, error: null, loading: false }); })
      .catch(error => { if (!controller.signal.aborted) setState({ path, data: null, error, loading: false }); });
    return () => controller.abort();
  }, [path, request, revision]);
  useEffect(() => {
    if (!refreshMs || !path || state.path !== path || state.loading || state.error) return;
    const timer = setTimeout(refresh, refreshMs);
    return () => clearTimeout(timer);
  }, [path, refresh, refreshMs, state]);
  return useMemo(() => ({
    ...(path && state.path === path ? state : { data: null, loading: Boolean(path), error: null }),
    refresh,
  }), [path, state, refresh]);
}
