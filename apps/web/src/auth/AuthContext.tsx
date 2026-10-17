import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Role } from '@erp/shared';

/**
 * STEP 1 STAND-IN. Real Firebase login, custom claims and server verification arrive in Step 2.
 * Until then the role is chosen with the clearly labelled picker, available ONLY in development
 * builds (import.meta.env.DEV). It only drives which navigation is drawn; the API never trusts it.
 */
interface AuthState {
  role: Role | null;
  setDevRole: (role: Role | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);
const KEY = 'erp.devRole';

function readStored(): Role | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v === 'admin' || v === 'principal' || v === 'cashier' ? v : null;
  } catch {
    return null;
  }
}

export function AuthProvider({
  children,
  initialRole,
}: {
  children: ReactNode;
  initialRole?: Role | null;
}) {
  const [role, setRole] = useState<Role | null>(
    initialRole ?? (import.meta.env.DEV ? readStored() : null),
  );
  const setDevRole = useCallback((next: Role | null) => {
    setRole(next);
    try {
      if (next) sessionStorage.setItem(KEY, next);
      else sessionStorage.removeItem(KEY);
    } catch {
      /* storage unavailable: the choice just won't survive a reload */
    }
  }, []);
  const value = useMemo(() => ({ role, setDevRole }), [role, setDevRole]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
