import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatINR } from '@erp/shared';
import { api } from '../api/client';
import { Badge, Button, Card, ConfirmDialog, ErrorState, Table, useToast } from '../components/ui';
import { errorText } from '../lib/rupees';

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const when = (d) =>
  d
    ? new Date(d).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      })
    : '-';

/** Receipt cancellation requests: the Cashier asked, the Principal decides. */
function Cancellations() {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [acting, setActing] = useState(null); // { row, decision }
  const [reason, setReason] = useState('');
  const query = useQuery({
    queryKey: ['receipt-cancellations', 'requested'],
    queryFn: () => api('/api/receipt-cancellations?status=requested&pageSize=50'),
    refetchInterval: (query) => (query.state.status === 'error' ? false : 60_000),
  });
  const decide = useMutation({
    mutationFn: () =>
      api(`/api/receipt-cancellations/${acting.row.id}/${acting.decision}`, {
        method: 'POST',
        body: acting.decision === 'reject' ? { reason } : {},
      }),
    onSuccess: async () => {
      notify(
        acting.decision === 'approve'
          ? 'Receipt cancelled. Its fees are payable again.'
          : 'Request rejected.',
        'success',
      );
      setActing(null);
      setReason('');
      for (const key of ['receipt-cancellations', 'receipts', 'fees-database', 'dashboard', 'dues'])
        await queryClient.invalidateQueries({ queryKey: [key] });
    },
    onError: (e) => {
      notify(errorText(e), 'error');
      setActing(null);
      void queryClient.invalidateQueries({ queryKey: ['receipt-cancellations'] });
    },
  });
  const columns = [
    {
      key: 'no',
      header: 'Receipt',
      render: (r) =>
        r.receipt ? (
          <Link className="font-medium text-brand hover:underline" to={`/receipts/${r.receipt.id}`}>
            {r.receiptNumber}
          </Link>
        ) : (
          r.receiptNumber
        ),
    },
    {
      key: 'stu',
      header: 'Student',
      render: (r) => (r.receipt ? `${r.receipt.studentName} (${r.receipt.admissionNo})` : '-'),
    },
    {
      key: 'amt',
      header: 'Amount',
      align: 'right',
      render: (r) => (r.receipt ? money(r.receipt.totalPaise) : '-'),
    },
    {
      key: 'mode',
      header: 'Mode',
      render: (r) => (r.receipt ? <Badge>{r.receipt.mode.toUpperCase()}</Badge> : '-'),
    },
    { key: 'reason', header: 'Reason', render: (r) => r.reason },
    {
      key: 'by',
      header: 'Asked by',
      render: (r) => (
        <span>
          {r.requestedByName ?? '-'}
          <span className="block text-xs text-ink-muted">{when(r.requestedAt)}</span>
        </span>
      ),
    },
    {
      key: 'act',
      header: '',
      render: (r) => (
        <div className="flex gap-2">
          <Button onClick={() => setActing({ row: r, decision: 'approve' })}>Approve</Button>
          <Button variant="secondary" onClick={() => setActing({ row: r, decision: 'reject' })}>
            Reject
          </Button>
        </div>
      ),
    },
  ];
  return (
    <Card
      title="Receipt cancellations"
      subtitle="Approving cancels the receipt: its payments stop counting and the fees become payable again."
    >
      <Table
        columns={columns}
        rows={query.data?.rows}
        rowKey={(r) => r.id}
        loading={query.isPending}
        error={query.isError ? errorText(query.error) : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No cancellation requests waiting"
      />
      <ConfirmDialog
        open={!!acting}
        title={
          acting?.decision === 'approve'
            ? `Cancel receipt ${acting?.row.receiptNumber}?`
            : `Reject the request for ${acting?.row.receiptNumber}?`
        }
        description={
          acting?.decision === 'approve'
            ? `${acting?.row.receipt ? money(acting.row.receipt.totalPaise) : ''} will no longer count as paid. This is recorded and cannot be undone.`
            : 'The receipt stays valid. The Cashier is told your reason.'
        }
        confirmLabel={acting?.decision === 'approve' ? 'Cancel the receipt' : 'Reject request'}
        tone={acting?.decision === 'approve' ? 'danger' : 'primary'}
        requireReason={acting?.decision === 'reject'}
        onReasonChange={setReason}
        loading={decide.isPending}
        onConfirm={() => decide.mutate()}
        onCancel={() => setActing(null)}
      />
    </Card>
  );
}

/** Expense vouchers waiting for the Principal. The decision itself is made on the voucher page. */
function PendingVouchers() {
  const query = useQuery({
    queryKey: ['vouchers', 'pending-approvals'],
    queryFn: () => api('/api/vouchers?status=pending&pageSize=50'),
    refetchInterval: (query) => (query.state.status === 'error' ? false : 60_000),
  });
  const columns = [
    {
      key: 'no',
      header: 'Voucher no.',
      render: (r) => (
        <Link className="font-medium text-brand hover:underline" to={`/expenses/${r.id}`}>
          {r.number}
        </Link>
      ),
    },
    { key: 'date', header: 'Date', render: (r) => r.date },
    { key: 'amt', header: 'Amount', align: 'right', render: (r) => money(r.amountPaise) },
    { key: 'head', header: 'Head', render: (r) => r.headName },
    { key: 'payee', header: 'Payee', render: (r) => r.payeeName },
    {
      key: 'open',
      header: '',
      render: (r) => (
        <Link className="text-brand hover:underline" to={`/expenses/${r.id}`}>
          Review and decide
        </Link>
      ),
    },
  ];
  return (
    <Card title="Expense vouchers" subtitle="Open a voucher to approve or reject it.">
      <Table
        columns={columns}
        rows={query.data?.rows}
        rowKey={(r) => r.id}
        loading={query.isPending}
        error={query.isError ? errorText(query.error) : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No vouchers waiting"
      />
    </Card>
  );
}

function PendingReversals() {
  const query = useQuery({
    queryKey: ['money', 'pending'],
    queryFn: () => api('/api/money/pending'),
    refetchInterval: (query) => (query.state.status === 'error' ? false : 60_000),
  });
  return (
    <Card title="Expense reversal requests">
      {query.isPending && <p className="text-sm text-ink-muted">Loading…</p>}
      {query.isError && (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      )}
      {query.data && (
        <p className="text-sm">
          {query.data.reversals === 0 ? (
            'No reversal requests waiting.'
          ) : (
            <>
              <b>{query.data.reversals}</b> waiting.{' '}
              <Link className="text-brand hover:underline" to="/expenses">
                Open Expenses, "Reversal requests" tab
              </Link>
            </>
          )}
        </p>
      )}
    </Card>
  );
}

/** Principal: everything that needs a decision, in one place. */
export function Approvals() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Approvals</h1>
        <p className="text-sm text-ink-muted">Only you can approve or reject these.</p>
      </div>
      <Cancellations />
      <PendingVouchers />
      <PendingReversals />
    </div>
  );
}
