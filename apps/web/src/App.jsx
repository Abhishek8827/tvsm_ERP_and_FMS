import { Navigate, Route, Routes } from 'react-router-dom';
import { navForRole } from '@erp/shared';
import { useAuth } from './auth/AuthContext';
import { ErrorState, Spinner } from './components/ui';
import { AppShell } from './layout/AppShell';
import { ComingSoon } from './pages/ComingSoon';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { StudentProfile } from './pages/StudentProfile';
import { StudentForm } from './pages/StudentForm';
import { Students } from './pages/Students';

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
        {items
          .filter((i) => i.key !== 'students')
          .map((i) => (
            <Route key={i.key} path={i.path} element={<ComingSoon />} />
          ))}
        <Route path="/students" element={<Students />} />
        <Route path="/students/:id" element={<StudentProfile />} />
        {role === 'admin' && <Route path="/students/new" element={<StudentForm />} />}
        {role === 'admin' && <Route path="/students/:id/edit" element={<StudentForm />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
