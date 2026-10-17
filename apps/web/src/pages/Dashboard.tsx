import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, ErrorState, Spinner } from '../components/ui';

interface Health {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
}

/**
 * Step 1 dashboard intentionally shows NO business numbers: there is no data yet, and rule 1
 * forbids placeholders. The only live information is the API/database health from /api/health.
 * Real dashboards (collection, dues, approvals) arrive with their steps.
 */
export function Dashboard() {
  const { role } = useAuth();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/api/health'),
    refetchInterval: 30_000,
    retry: false,
  });

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-ink-muted">Signed in as {role}.</p>
      </div>
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
