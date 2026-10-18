import { Navigate, Route, Routes } from 'react-router-dom';
import { navForRole } from '@erp/shared';
import { useAuth } from './auth/AuthContext';
import { ErrorState, Spinner } from './components/ui';
import { AppShell } from './layout/AppShell';
import { ComingSoon } from './pages/ComingSoon';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';

function FullPage({ children }) {
  return <div className="mx-auto flex min-h-full max-w-md items-center p-6">{children}</div>;
}

/**
 * Frontend guards are UX only; the API enforces roles on every request (Step 2 tests prove it).
 * Routes come from the signed-in role's own navigation, so typing another role's URL falls
 * through to "/".
 */
export function App() {
  const { status, role, loadError, retry } = useAuth();

  if (status === 'unconfigured') {
    return (
      <FullPage>
        <ErrorState message="Sign-in is not configured. Add the VITE_FIREBASE_* values to apps/web/.env.local and restart (see README)." />
      </FullPage>
    );
  }
  if (status === 'loading') {
    return (
      <FullPage>
        <Spinner label="Checking sign-in" />
      </FullPage>
    );
  }
  if (status === 'error') {
    return (
      <FullPage>
        <ErrorState message={loadError} onRetry={retry} />
      </FullPage>
    );
  }
  if (status === 'signedOut') return <Login />;

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
