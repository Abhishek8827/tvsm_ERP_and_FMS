import { useQuery } from '@tanstack/react-query';
import { formatINR, todayIst } from '@erp/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, ErrorState, Spinner, StatCard } from '../components/ui';
/**
 * Step 1 dashboard intentionally shows NO business numbers: there is no data yet, and rule 1
 * forbids placeholders. The only live information is the API/database health from /api/health.
 * Real dashboards (collection, dues, approvals) arrive with their steps.
 */
const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });

/** Cashier: today's collection, straight from the receipts (cancelled ones are left out). */
function TodayCollection() {
  const today = todayIst();
  const q = useQuery({
    queryKey: ['receipts', 'today', today],
    queryFn: () => api(`/api/receipts?from=${today}&to=${today}&pageSize=1`),
    refetchInterval: 60_000,
    retry: false,
  });
  return (
    <Card title="Today's collection" subtitle="All receipts made today, by every cashier">
      {q.isPending && <Spinner label="Loading today's collection" />}
      {q.isError && <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />}
      {q.data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Total collected"
            value={money(q.data.totals.paise)}
            caption={`${q.data.totals.count} receipts`}
          />
          <StatCard label="School fees" value={money(q.data.totals.byKind.school)} />
          <StatCard label="Transport fees" value={money(q.data.totals.byKind.transport)} />
          <StatCard label="Cash" value={money(q.data.totals.byMode.cash)} />
          <StatCard label="UPI" value={money(q.data.totals.byMode.upi)} />
          <StatCard label="QR" value={money(q.data.totals.byMode.qr)} />
        </div>
      )}
    </Card>
  );
}

export function Dashboard() {
  const { user, role } = useAuth();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api('/api/health'),
    refetchInterval: 30_000,
    retry: false,
  });
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-ink-muted">
          Signed in as {user.name} ({user.role}).
        </p>
      </div>
      {role === 'cashier' && <TodayCollection />}
      <Card title="System status" subtitle="Live from the API">
        {health.isPending && <Spinner label="Checking the server" />}
        {health.isError && (
          <ErrorState message={health.error.message} onRetry={() => void health.refetch()} />
        )}
        {health.data && (
          <div className="flex items-center gap-3">
            <Badge tone={health.data.status === 'ok' ? 'success' : 'warning'}>
              {health.data.status === 'ok' ? 'All systems normal' : 'Database not connected'}
            </Badge>
            <span className="text-sm text-ink-muted">Database: {health.data.db}</span>
          </div>
        )}
      </Card>
      <p className="text-sm text-ink-muted">
        Fee, expense and approval dashboards appear here as each step is built and signed off.
      </p>
    </div>
  );
}
