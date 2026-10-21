import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { navForRole } from '@erp/shared';
import { useAuth } from './auth/AuthContext';
import { ErrorState, Spinner } from './components/ui';
import { AppShell } from './layout/AppShell';
import { ComingSoon } from './pages/ComingSoon';
import { Dashboard } from './pages/Dashboard';
import { BankCash } from './pages/BankCash';
import { CollectFee } from './pages/CollectFee';
import { ExpenseVoucher } from './pages/ExpenseVoucher';
import { Expenses } from './pages/Expenses';
import { PettyCash } from './pages/PettyCash';
import { FeeStructure } from './pages/FeeStructure';
import { ImportOldFees } from './pages/ImportOldFees';
import { ReceiptView } from './pages/ReceiptView';
import { Receipts } from './pages/Receipts';
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
            (i) =>
              i.key !== 'students' &&
              i.key !== 'data-import' &&
              i.key !== 'fee-structure' &&
              i.key !== 'collect-fee' &&
              i.key !== 'receipts' &&
              i.key !== 'expenses' &&
              i.key !== 'petty-cash' &&
              i.key !== 'bank-cash' &&
              i.key !== 'fees-receipts',
          )
          .map((i) => (
            <Route key={i.key} path={i.path} element={<ComingSoon />} />
          ))}
        <Route path="/petty-cash" element={<PettyCash />} />
        <Route path="/bank-cash" element={<BankCash />} />
        {(role === 'admin' || role === 'principal') && (
          <Route path="/expenses" element={<Expenses />} />
        )}
        {(role === 'admin' || role === 'principal') && (
          <Route path="/expenses/:id" element={<ExpenseVoucher />} />
        )}
        <Route path="/students" element={<Students />} />
        <Route path="/students/:id" element={<StudentProfile />} />
        <Route path="/fee-structure" element={<FeeStructure />} />
        <Route path="/receipts/:id" element={<ReceiptView />} />
        {role === 'cashier' && <Route path="/receipts" element={<Receipts />} />}
        {role === 'admin' && <Route path="/fees-receipts" element={<Receipts />} />}
        {role === 'cashier' && <Route path="/collect-fee" element={<CollectFee />} />}
        {role === 'admin' && <Route path="/data-import" element={<ImportStudents />} />}
        {role === 'admin' && <Route path="/data-import/old-fees" element={<ImportOldFees />} />}
        {role === 'admin' && <Route path="/students/new" element={<StudentForm />} />}
        {role === 'admin' && <Route path="/students/:id/edit" element={<StudentForm />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
