import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, configureAuth } from '../api/client';
import { useIdleTimeout } from './useIdleTimeout';

export const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // decision: 10 minutes on shared counter PCs

// When `pnpm dev` starts, the web side is ready before the API (it connects to the database
// first), so the very first sign-in check can hit a closed door. One patient, sequential wait
// (about 15 seconds in total) instead of a 502 screen. Not a retry storm: one call at a time.
const STARTUP_RETRY = [500, 1000, 2000, 3000, 4000, 5000];

const AuthContext = createContext(null);

/** Never reveal whether an email exists: wrong email and wrong password look the same. */
export function friendlyAuthError(err) {
  const code = err?.code ?? '';
  if (
    [
      'auth/invalid-credential',
      'auth/wrong-password',
      'auth/user-not-found',
      'auth/invalid-email',
    ].includes(code)
  ) {
    return 'Email or password is incorrect.';
  }
  if (code === 'auth/user-disabled')
    return 'This account has been deactivated. Please contact the Admin.';
  if (code === 'auth/too-many-requests') {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Could not reach the sign-in service. Check the internet connection.';
  }
  return 'Could not sign in. Please try again.';
}

/**
 * Session state for the whole app. `status` is one of:
 *   unconfigured  Firebase keys are missing (we say so, no fake login)
 *   loading       checking whether someone is already signed in
 *   signedOut     show the login screen
 *   signedIn      `user` comes from the SERVER (/api/auth/me), never from the browser
 *   error         the server could not be reached; show retry
 */
export function AuthProvider({ service, idleMs = IDLE_TIMEOUT_MS, children }) {
  const [status, setStatus] = useState(service ? 'loading' : 'unconfigured');
  const [user, setUser] = useState(null);
  const [notice, setNotice] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const announceLogin = useRef(false);
  const [attempt, setAttempt] = useState(0);

  // Session events are best-effort audit calls; they must never block signing in or out.
  const sessionEvent = useCallback((event) => {
    return api('/api/auth/session-event', { method: 'POST', body: { event } }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!service) return undefined;
    configureAuth(service.getToken, () => {
      setNotice('Your session has expired. Please sign in again.');
      void service.signOut();
    });
    const unsubscribe = service.onChange(async (signedIn) => {
      if (!signedIn) {
        setUser(null);
        setStatus('signedOut');
        return;
      }
      try {
        const { user: me } = await api('/api/auth/me', { retryDelays: STARTUP_RETRY });
        setUser(me);
        setLoadError(null);
        setStatus('signedIn');
        if (announceLogin.current) {
          announceLogin.current = false;
          void sessionEvent('login');
        }
      } catch (err) {
        if (err.status === 401 || err.status === 403) {
          // Signed in with Firebase but not allowed into this school's system.
          setNotice(err.message);
          await service.signOut();
        } else {
          // 502/503/504 or no answer = the API is not up (still starting, or restarting).
          const down = [502, 503, 504, 0].includes(err.status);
          setLoadError(
            down
              ? 'The server is not ready yet. It may still be starting. Wait a few seconds and press Try again.'
              : err.message,
          );
          setStatus('error');
        }
      }
    });
    return () => {
      unsubscribe?.();
      configureAuth(null);
    };
  }, [service, sessionEvent, attempt]);

  const signIn = useCallback(
    async (email, password) => {
      setNotice(null);
      announceLogin.current = true;
      try {
        await service.signIn(email, password);
      } catch (err) {
        announceLogin.current = false;
        throw new Error(friendlyAuthError(err), { cause: err });
      }
    },
    [service],
  );

  const signOut = useCallback(
    async (event = 'logout') => {
      await sessionEvent(event); // while the token is still valid
      await service.signOut();
    },
    [service, sessionEvent],
  );

  useIdleTimeout(status === 'signedIn', idleMs, () => {
    setNotice('You were signed out after 10 minutes of inactivity.');
    void signOut('idle_logout');
  });

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({ status, user, role: user?.role ?? null, notice, loadError, signIn, signOut, retry }),
    [status, user, notice, loadError, signIn, signOut, retry],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
