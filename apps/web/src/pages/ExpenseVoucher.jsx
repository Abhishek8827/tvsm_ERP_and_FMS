import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatINR } from '@erp/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { errorText, parseRupees } from '../lib/rupees';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  ErrorState,
  Input,
  Spinner,
  StatCard,
  Table,
  useToast,
} from '../components/ui';
import { StatusBadge } from './Expenses';
import { PaymentDialog } from './PayVoucherDialog';

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });

function AdjustmentDialog({ voucher, open, onClose }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [f, setF] = useState({ amount: '', reason: '', remark: '' });
  const [errors, setErrors] = useState({});
  const amount = parseRupees(f.amount);
  const add = useMutation({
    mutationFn: () =>
      api(`/api/vouchers/${voucher.id}/adjustments`, {
        method: 'POST',
        body: { amountPaise: amount.paise, reason: f.reason, remark: f.remark },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['voucher', voucher.id] });
      await queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      notify('Adjustment saved.', 'success');
      setF({ amount: '', reason: '', remark: '' });
      onClose();
    },
    onError: (e) => {
      setErrors(e.fields ?? {});
      notify(errorText(e), 'error');
    },
  });
  const ready =
    amount.paise > 0 && !amount.error && f.reason.trim().length >= 3 && f.remark.trim().length >= 3;
  return (
    <Dialog
      open={open}
      title="Adjustment (discount / reduction)"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button loading={add.isPending} disabled={!ready} onClick={() => add.mutate()}>
            Save adjustment
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-ink-muted">
          Reduces the balance due without any cash or bank payment. Balance due now:{' '}
          <b>{money(voucher.balanceDuePaise)}</b>
        </p>
        <Input
          label="Adjustment amount (₹)"
          inputMode="decimal"
          value={f.amount}
          error={amount.error ?? errors.amountPaise}
          onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))}
        />
        <Input
          label="Reason (required)"
          value={f.reason}
          error={errors.reason}
          onChange={(e) => setF((p) => ({ ...p, reason: e.target.value }))}
        />
        <Input
          label="Supporting remark (required)"
          value={f.remark}
          error={errors.remark}
          onChange={(e) => setF((p) => ({ ...p, remark: e.target.value }))}
        />
      </div>
    </Dialog>
  );
}

export function ExpenseVoucher() {
  const { id } = useParams();
  const { role } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(null); // 'pay' | 'adjust'
  const [acting, setActing] = useState(null); // { kind: 'approve' | 'reject' | 'reverse-payment' | 'cancel-voucher', paymentId? }
  const [reason, setReason] = useState('');
  const query = useQuery({ queryKey: ['voucher', id], queryFn: () => api(`/api/vouchers/${id}`) });
  const done = async (message) => {
    await queryClient.invalidateQueries({ queryKey: ['voucher', id] });
    await queryClient.invalidateQueries({ queryKey: ['vouchers'] });
    await queryClient.invalidateQueries({ queryKey: ['expense-reversals'] });
    await queryClient.invalidateQueries({ queryKey: ['money'] });
    notify(message, 'success');
    setActing(null);
  };
  const act = useMutation({
    mutationFn: () => {
      if (acting.kind === 'approve')
        return api(`/api/vouchers/${id}/approve`, { method: 'POST', body: {} });
      if (acting.kind === 'reject')
        return api(`/api/vouchers/${id}/reject`, { method: 'POST', body: { reason } });
      return api('/api/expense-reversals', {
        method: 'POST',
        body:
          acting.kind === 'cancel-voucher'
            ? { kind: 'voucher', targetId: id, reason }
            : { kind: 'payment', targetId: acting.paymentId, reason },
      });
    },
    onSuccess: () =>
      done(
        acting.kind === 'approve'
          ? 'Voucher approved.'
          : acting.kind === 'reject'
            ? 'Voucher rejected.'
            : 'Request sent to the Principal.',
      ),
    onError: (e) => notify(errorText(e), 'error'),
  });
  if (query.isPending) return <Spinner label="Loading voucher" />;
  if (query.isError)
    return <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />;
  const v = query.data;
  const isAdmin = role === 'admin';
  const openReversal = (target) =>
    v.reversals.some((r) => r.status === 'requested' && r.targetId === target);
  const canPay = isAdmin && v.status === 'approved' && v.balanceDuePaise > 0;
  const canCancel =
    isAdmin &&
    v.status === 'approved' &&
    v.payments.every((p) => p.status === 'reversed') &&
    v.adjustments.length === 0 &&
    !openReversal(v.id);

  const payCols = [
    { key: 'sno', header: 'S.No', render: (p) => p.seq },
    { key: 'date', header: 'Date', render: (p) => p.date },
    {
      key: 'mode',
      header: 'Mode',
      render: (p) => (p.mode === 'bank' ? `Bank: ${p.bankName ?? ''}` : 'Cash'),
    },
    { key: 'details', header: 'Details', render: (p) => p.details || '-' },
    { key: 'amount', header: 'Amount', align: 'right', render: (p) => money(p.amountPaise) },
    { key: 'by', header: 'Approved by', render: (p) => p.approvedBy || '-' },
    {
      key: 'st',
      header: '',
      render: (p) =>
        p.status === 'reversed' ? (
          <Badge tone="danger">Reversed</Badge>
        ) : openReversal(p.id) ? (
          <Badge tone="warning">Reversal requested</Badge>
        ) : isAdmin ? (
          <Button
            variant="secondary"
            onClick={() => {
              setReason('');
              setActing({ kind: 'reverse-payment', paymentId: p.id });
            }}
          >
            Request reversal
          </Button>
        ) : null,
    },
  ];
  const titles = {
    approve: ['Approve this voucher?', 'After approval the Admin can pay it.', 'Approve'],
    reject: [
      'Reject this voucher?',
      'The Admin will see your reason. A rejected voucher cannot be paid.',
      'Reject',
    ],
    'reverse-payment': [
      'Request payment reversal?',
      'The Principal must approve. Until then the payment stays.',
      'Send request',
    ],
    'cancel-voucher': [
      'Request voucher cancellation?',
      'Only an unpaid voucher can be cancelled. The Principal must approve.',
      'Send request',
    ],
  };
  const [t, d, c] = titles[acting?.kind ?? 'approve'];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/expenses" className="text-sm text-brand hover:underline">
            ← All expenses
          </Link>
          <h1 className="text-2xl font-semibold text-ink">{v.number}</h1>
        </div>
        <StatusBadge status={v.status} />
      </div>
      <Card>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-muted">Date</dt>
            <dd>{v.date}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Head</dt>
            <dd>{v.headName}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Payee</dt>
            <dd>{v.payeeName}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Made by</dt>
            <dd>{v.createdByName ?? '-'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-ink-muted">Particulars</dt>
            <dd>{v.particulars}</dd>
          </div>
          {v.decidedByName && (
            <div>
              <dt className="text-ink-muted">
                {v.status === 'rejected' ? 'Rejected by' : 'Approved by'}
              </dt>
              <dd>{v.decidedByName}</dd>
            </div>
          )}
          {v.rejectionReason && (
            <div>
              <dt className="text-ink-muted">Reason</dt>
              <dd>{v.rejectionReason}</dd>
            </div>
          )}
        </dl>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Amount" value={money(v.amountPaise)} />
        <StatCard label="Paid" value={money(v.paidPaise)} />
        <StatCard label="Adjustment" value={money(v.adjustedPaise)} />
        <StatCard label="Balance due" value={money(v.balanceDuePaise)} />
      </div>
      <div className="flex flex-wrap gap-2">
        {role === 'principal' && v.status === 'pending' && (
          <>
            <Button
              onClick={() => {
                setReason('');
                setActing({ kind: 'approve' });
              }}
            >
              Approve
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setReason('');
                setActing({ kind: 'reject' });
              }}
            >
              Reject
            </Button>
          </>
        )}
        {canPay && <Button onClick={() => setDialog('pay')}>Record payment</Button>}
        {canPay && (
          <Button variant="secondary" onClick={() => setDialog('adjust')}>
            Add adjustment
          </Button>
        )}
        {canCancel && (
          <Button
            variant="secondary"
            onClick={() => {
              setReason('');
              setActing({ kind: 'cancel-voucher' });
            }}
          >
            Request cancellation
          </Button>
        )}
      </div>
      <Card title="Payments">
        <Table
          columns={payCols}
          rows={v.payments}
          rowKey={(p) => p.id}
          emptyTitle="No payment yet"
          emptyDescription={
            v.status === 'approved'
              ? 'Record the first payment above.'
              : 'A voucher can be paid only after approval.'
          }
        />
      </Card>
      {v.adjustments.length > 0 && (
        <Card title="Adjustments">
          <ul className="flex flex-col gap-2 text-sm">
            {v.adjustments.map((a) => (
              <li key={`${a.at}-${a.amountPaise}`}>
                <b>{money(a.amountPaise)}</b> - {a.reason} ({a.remark})
                {a.byName ? `, ${a.byName}` : ''}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {dialog === 'pay' && <PaymentDialog voucher={v} open onClose={() => setDialog(null)} />}
      {dialog === 'adjust' && <AdjustmentDialog voucher={v} open onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={!!acting}
        title={t}
        description={d}
        confirmLabel={c}
        tone={acting?.kind === 'reject' ? 'danger' : 'primary'}
        requireReason={acting != null && acting.kind !== 'approve'}
        onReasonChange={setReason}
        loading={act.isPending}
        onConfirm={() => act.mutate()}
        onCancel={() => setActing(null)}
      />
    </div>
  );
}
