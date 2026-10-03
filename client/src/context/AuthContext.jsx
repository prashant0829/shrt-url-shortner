import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createApiClient } from '../api/client.js';
import { AsyncStatus, TOKEN_STORAGE_KEY, ToastKind } from '../constants.js';
import { useToast } from './ToastContext.jsx';

const AuthContext = createContext(null);

// localStorage can be unavailable (private mode, blocked site data); then a session lasts for this
// page view only.
function tryStorage(action, fallback) {
  try {
    return action();
  } catch {
    return fallback;
  }
}

export const tokenStorage = {
  get: () => tryStorage(() => localStorage.getItem(TOKEN_STORAGE_KEY), null),
  set: (token) => tryStorage(() => localStorage.setItem(TOKEN_STORAGE_KEY, token)),
  clear: () => tryStorage(() => localStorage.removeItem(TOKEN_STORAGE_KEY)),
};

// Holds the current token outside React state, so the API client reads the latest value on every request.
function createSessionStore(initialToken) {
  let token = initialToken;
  return {
    getToken: () => token,
    setToken: (nextToken) => {
      token = nextToken;
    },
  };
}

// Owns the signed-in user and the API client. On start it restores a saved session by asking the
// server who the saved token belongs to. `fetchFn` is injected in tests.
export function AuthProvider({ children, fetchFn }) {
  const showToast = useToast();
  const [session] = useState(() => createSessionStore(tokenStorage.get()));
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(() =>
    session.getToken() ? AsyncStatus.LOADING : AsyncStatus.READY,
  );

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
      if (message) showToast(message, ToastKind.ERROR);
    },
    [applySession, showToast],
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

  useEffect(() => {
    if (!session.getToken()) return undefined;

    const controller = new AbortController();
    api
      .me({ signal: controller.signal })
      .then(({ user: savedUser }) => {
        if (!controller.signal.aborted) setUser(savedUser);
      })
      .catch(() => {
        // An invalid token has already signed the user out.
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatus(AsyncStatus.READY);
      });
    return () => controller.abort();
  }, [api, session]);

  const login = useCallback(
    async (email, password) => {
      const { token, user: signedInUser } = await api.login(email, password);
      applySession(token, signedInUser);
    },
    [api, applySession],
  );

  const register = useCallback(
    async (email, password) => {
      const { token, user: newUser } = await api.register(email, password);
      applySession(token, newUser);
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
