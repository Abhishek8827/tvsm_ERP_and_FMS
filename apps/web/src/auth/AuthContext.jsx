import { createContext, useCallback, useContext, useMemo, useState } from 'react';
const AuthContext = createContext(null);
const KEY = 'erp.devRole';
function readStored() {
  try {
    const v = sessionStorage.getItem(KEY);
    return v === 'admin' || v === 'principal' || v === 'cashier' ? v : null;
  } catch {
    return null;
  }
}
export function AuthProvider({ children, initialRole }) {
  const [role, setRole] = useState(initialRole ?? (import.meta.env.DEV ? readStored() : null));
  const setDevRole = useCallback((next) => {
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
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
