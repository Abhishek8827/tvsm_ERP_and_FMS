import { Navigate, Route, Routes } from 'react-router-dom';
import { navForRole } from '@erp/shared';
import { useAuth } from './auth/AuthContext';
import { AppShell } from './layout/AppShell';
import { ComingSoon } from './pages/ComingSoon';
import { Dashboard } from './pages/Dashboard';
import { SignedOut } from './pages/SignedOut';
/**
 * Frontend guards are UX only; backend RBAC (Step 2) is the real enforcement (TDD 12.2).
 * Routes are generated from the role's own navigation, so a role cannot even reach another
 * role's screen by typing the URL - it falls through to "/".
 */
export function App() {
  const { role } = useAuth();
  if (!role) return <SignedOut />;
  const items = navForRole(role).filter((i) => i.path !== '/');
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        {items.map((i) => (
          <Route key={i.key} path={i.path} element={<ComingSoon />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
