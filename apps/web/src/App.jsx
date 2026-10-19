import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { navForRole } from '@erp/shared';
import { useAuth } from './auth/AuthContext';
import { ErrorState, Spinner } from './components/ui';
import { AppShell } from './layout/AppShell';
import { ComingSoon } from './pages/ComingSoon';
import { Dashboard } from './pages/Dashboard';
import { FeeStructure } from './pages/FeeStructure';
import { ImportStudents } from './pages/ImportStudents';
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
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // After sign-out: forget everything the last person saw (so the next login never shows their
  // cached data) and go back to the dashboard, so a new login always starts at "/".
  useEffect(() => {
    if (status === 'signedOut') {
      queryClient.clear();
      navigate('/', { replace: true });
    }
  }, [status, queryClient, navigate]);

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
          .filter(
            (i) => i.key !== 'students' && i.key !== 'data-import' && i.key !== 'fee-structure',
          )
          .map((i) => (
            <Route key={i.key} path={i.path} element={<ComingSoon />} />
          ))}
        <Route path="/students" element={<Students />} />
        <Route path="/students/:id" element={<StudentProfile />} />
        {role === 'admin' && <Route path="/fee-structure" element={<FeeStructure />} />}
        {role === 'admin' && <Route path="/data-import" element={<ImportStudents />} />}
        {role === 'admin' && <Route path="/students/new" element={<StudentForm />} />}
        {role === 'admin' && <Route path="/students/:id/edit" element={<StudentForm />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
