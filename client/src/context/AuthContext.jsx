import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createApiClient } from '../api/client.js';
import { useToast } from './ToastContext.jsx';

const AuthContext = createContext(null);

const TOKEN_KEY = 'shrt.token';

/** localStorage can be unavailable (private mode, blocked site data): then a session lasts for this page view. */
export const tokenStorage = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* ignore */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

/** Holds the current token outside React state, so the API client can read the latest value on every request. */
function createSessionStore(initialToken) {
  let token = initialToken;
  return {
    getToken: () => token,
    setToken: (next) => {
      token = next;
    },
  };
}

/**
 * Owns the signed-in user and the API client (which reads the current token on every request).
 * On start it restores a saved session by asking the server who the token belongs to.
 *
 * @param {object} props
 * @param {typeof fetch} [props.fetchFn] Injected in tests.
 */
export function AuthProvider({ children, fetchFn }) {
  const toast = useToast();
  const [session] = useState(() => createSessionStore(tokenStorage.get()));
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(() => (session.getToken() ? 'loading' : 'ready'));

  const applySession = useCallback(
    (token, nextUser) => {
      session.setToken(token);
      if (token) tokenStorage.set(token);
      else tokenStorage.clear();
      setUser(nextUser);
    },
    [session],
  );

  const logout = useCallback(
    (message) => {
      applySession(null, null);
      if (message) toast(message, 'error');
    },
    [applySession, toast],
  );

  const api = useMemo(
    () =>
      createApiClient({
        getToken: session.getToken,
        onSessionExpired: () => logout('Your session has expired. Please sign in again.'),
        fetchFn,
      }),
    [session, logout, fetchFn],
  );

  // Restore a saved session.
  useEffect(() => {
    if (!session.getToken()) return undefined;
    const controller = new AbortController();
    api
      .me({ signal: controller.signal })
      .then(({ user: me }) => {
        if (!controller.signal.aborted) setUser(me);
      })
      .catch(() => {
        /* an invalid token has already signed the user out */
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatus('ready');
      });
    return () => controller.abort();
  }, [api, session]);

  const login = useCallback(
    async (email, password) => {
      const next = await api.login(email, password);
      applySession(next.token, next.user);
    },
    [api, applySession],
  );

  const register = useCallback(
    async (email, password) => {
      const next = await api.register(email, password);
      applySession(next.token, next.user);
    },
    [api, applySession],
  );

  const value = useMemo(
    () => ({ api, user, status, login, register, logout }),
    [api, user, status, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
