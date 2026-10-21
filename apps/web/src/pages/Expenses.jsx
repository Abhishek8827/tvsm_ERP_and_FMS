import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatINR } from '@erp/shared';
import { api, newIdempotencyKey } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { errorText, parseRupees, todayInput } from '../lib/rupees';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  FilterBar,
  Input,
  Pagination,
  Select,
  StatCard,
  Table,
  useToast,
} from '../components/ui';

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const STATUS_TONE = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};
const STATUS_LABEL = {
  pending: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
export const StatusBadge = ({ status }) => (
  <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? status}</Badge>
);

/** Admin makes a school expense voucher (Rs 500 or more). Under Rs 500 belongs to Petty Cash. */
function NewVoucherDialog({ open, onClose }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const heads = useQuery({
    queryKey: ['expense-heads'],
    queryFn: () => api('/api/expense-heads'),
    enabled: open,
  });
  const key = useRef(newIdempotencyKey());
  const [f, setF] = useState({
    date: todayInput(),
    headId: '',
    payeeName: '',
    particulars: '',
    amount: '',
  });
  const [errors, setErrors] = useState({});
  const amount = parseRupees(f.amount);
  const set = (patch) => setF((p) => ({ ...p, ...patch }));
  const active = (heads.data?.heads ?? []).filter((h) => h.active);
  const create = useMutation({
    mutationFn: () =>
      api('/api/vouchers', {
        method: 'POST',
        idempotencyKey: key.current,
        body: {
          date: f.date,
          headId: f.headId,
          payeeName: f.payeeName,
          particulars: f.particulars,
          amountPaise: amount.paise,
        },
      }),
    onSuccess: async (v) => {
      key.current = newIdempotencyKey();
      await queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      notify(`Voucher ${v.number} saved. It now waits for the Principal.`, 'success');
      setF({ date: todayInput(), headId: '', payeeName: '', particulars: '', amount: '' });
      setErrors({});
      onClose();
    },
    onError: (e) => {
      setErrors(e.fields ?? {});
      if (e.status >= 400 && e.status < 500) key.current = newIdempotencyKey();
      notify(errorText(e), 'error');
    },
  });
  const ready =
    f.headId && f.payeeName.trim() && f.particulars.trim() && !amount.error && amount.paise > 0;
  return (
    <Dialog
      open={open}
      title="New expense voucher"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={!ready} onClick={() => create.mutate()}>
            Save voucher
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Date"
          type="date"
          value={f.date}
          max={todayInput()}
          error={errors.date}
          onChange={(e) => set({ date: e.target.value })}
        />
        <Select
          label="Head"
          value={f.headId}
          error={errors.headId}
          options={[
            {
              value: '',
              label: active.length ? 'Choose a head' : 'No heads yet. Add one in the Heads tab.',
            },
            ...active.map((h) => ({ value: h.id, label: h.name })),
          ]}
          onChange={(e) => set({ headId: e.target.value })}
        />
        <Input
          label="Payee name"
          value={f.payeeName}
          error={errors.payeeName}
          onChange={(e) => set({ payeeName: e.target.value })}
        />
        <Input
          label="Particulars"
          value={f.particulars}
          error={errors.particulars}
          onChange={(e) => set({ particulars: e.target.value })}
        />
        <Input
          label="Amount (₹)"
          inputMode="decimal"
          value={f.amount}
          error={amount.error ?? errors.amountPaise}
          hint="₹500 or more. Under ₹500 goes to Petty Cash."
          onChange={(e) => set({ amount: e.target.value })}
        />
      </div>
    </Dialog>
  );
}

function VouchersTab({ isAdmin }) {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);
  const query = useQuery({
    queryKey: ['vouchers', { status, q, from, to, page, pageSize }],
    queryFn: () => {
      const p = new URLSearchParams({ page, pageSize });
      if (status) p.set('status', status);
      if (q) p.set('q', q);
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      return api(`/api/vouchers?${p}`);
    },
    placeholderData: keepPreviousData,
  });
  const reset = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };
  const d = query.data;
  const cols = [
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
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => money(r.amountPaise) },
    { key: 'head', header: 'Head', render: (r) => r.headName },
    { key: 'payee', header: 'Payee name', render: (r) => r.payeeName },
    { key: 'part', header: 'Particular', render: (r) => r.particulars },
    {
      key: 'due',
      header: 'Balance due',
      align: 'right',
      render: (r) => (r.status === 'approved' ? money(r.balanceDuePaise) : '-'),
    },
    { key: 'paid', header: 'Paid', align: 'right', render: (r) => money(r.paidPaise) },
    {
      key: 'adj',
      header: 'Adjustment paid',
      align: 'right',
      render: (r) => money(r.adjustedPaise),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  ];
  const rows = d?.rows?.map((r, i) => ({ ...r, _n: (page - 1) * pageSize + i + 1 }));
  const withNo = [{ key: 'sno', header: 'S.No', render: (r) => r._n }, ...cols];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Awaiting approval"
          value={money(d?.totals?.pending?.paise)}
          caption={`${d?.totals?.pending?.count ?? 0} vouchers`}
        />
        <StatCard
          label="Approved"
          value={money(d?.totals?.approved?.paise)}
          caption={`${d?.totals?.approved?.count ?? 0} vouchers`}
        />
      </div>
      <FilterBar>
        <Select
          label="Status"
          value={status}
          onChange={reset(setStatus)}
          options={[
            { value: '', label: 'All' },
            ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
          ]}
        />
        <Input label="From" type="date" value={from} onChange={reset(setFrom)} />
        <Input label="To" type="date" value={to} onChange={reset(setTo)} />
        <Input
          label="Search"
          placeholder="Voucher no., payee, head"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {isAdmin && <Button onClick={() => setCreating(true)}>New voucher</Button>}
      </FilterBar>
      <Table
        columns={withNo}
        rows={rows}
        rowKey={(r) => r.id}
        loading={query.isPending}
        error={query.isError ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        emptyTitle="No vouchers yet"
        emptyDescription={
          isAdmin
            ? 'Use "New voucher" for an expense of ₹500 or more.'
            : 'The Admin has not made any voucher for these filters.'
        }
      />
      {d && d.total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={d.total}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
      {isAdmin && <NewVoucherDialog open={creating} onClose={() => setCreating(false)} />}
    </div>
  );
}

function PaymentsTab() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);
  const query = useQuery({
    queryKey: ['expense-payments', { q, page, pageSize }],
    queryFn: () =>
      api(`/api/expense-payments?${new URLSearchParams({ page, pageSize, ...(q && { q }) })}`),
    placeholderData: keepPreviousData,
  });
  const d = query.data;
  const columns = [
    { key: 'sno', header: 'S.No', render: (r) => r.seq },
    {
      key: 'v',
      header: 'Voucher no.',
      render: (r) => (
        <Link className="text-brand hover:underline" to={`/expenses/${r.voucherId}`}>
          {r.voucherNumber}
        </Link>
      ),
    },
    { key: 'date', header: 'Date', render: (r) => r.date },
    { key: 'head', header: 'Head', render: (r) => r.headName },
    { key: 'payee', header: 'Payee name', render: (r) => r.payeeName },
    { key: 'details', header: 'Particulars / payment details', render: (r) => r.details || '-' },
    {
      key: 'mode',
      header: 'Payment mode',
      render: (r) => (r.mode === 'bank' ? `Bank: ${r.bankName ?? ''}` : 'Cash'),
    },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => money(r.amountPaise) },
    { key: 'by', header: 'Approved by', render: (r) => r.approvedBy || '-' },
    {
      key: 'remark',
      header: 'Remark',
      render: (r) =>
        r.status === 'reversed' ? <Badge tone="danger">Reversed</Badge> : r.remark || '-',
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <FilterBar>
        <Input
          label="Search"
          placeholder="Voucher no., payee, head"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </FilterBar>
      <Table
        columns={columns}
        rows={d?.rows}
        rowKey={(r) => r.id}
        loading={query.isPending}
        error={query.isError ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        emptyTitle="No payments yet"
        emptyDescription="A payment appears here after the Principal approves a voucher and the Admin pays it."
      />
      {d && d.total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={d.total}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}

/** Reversal requests: the Admin asked, the Principal decides (reason compulsory to reject). */
function RequestsTab({ isPrincipal }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [acting, setActing] = useState(null); // { id, decision }
  const [reason, setReason] = useState('');
  const query = useQuery({
    queryKey: ['expense-reversals'],
    queryFn: () => api('/api/expense-reversals'),
  });
  const decide = useMutation({
    mutationFn: () =>
      api(`/api/expense-reversals/${acting.id}/${acting.decision}`, {
        method: 'POST',
        body: acting.decision === 'reject' ? { reason } : {},
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['expense-reversals'] });
      await queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      await queryClient.invalidateQueries({ queryKey: ['expense-payments'] });
      await queryClient.invalidateQueries({ queryKey: ['money'] });
      notify(
        acting.decision === 'approve' ? 'Reversal approved.' : 'Reversal rejected.',
        'success',
      );
      setActing(null);
    },
    onError: (e) => notify(errorText(e), 'error'),
  });
  const tone = { requested: 'warning', approved: 'success', rejected: 'danger' };
  const columns = [
    {
      key: 'v',
      header: 'Voucher no.',
      render: (r) => (
        <Link className="text-brand hover:underline" to={`/expenses/${r.voucherId}`}>
          {r.voucherNumber}
        </Link>
      ),
    },
    {
      key: 'kind',
      header: 'What',
      render: (r) => (r.kind === 'payment' ? 'Payment reversal' : 'Voucher cancellation'),
    },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => money(r.amountPaise) },
    { key: 'reason', header: 'Reason', render: (r) => r.reason },
    { key: 'by', header: 'Asked by', render: (r) => r.requestedByName ?? '-' },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge tone={tone[r.status]}>
          {r.status === 'requested' ? 'Waiting' : r.status === 'approved' ? 'Approved' : 'Rejected'}
        </Badge>
      ),
    },
    {
      key: 'act',
      header: '',
      render: (r) =>
        isPrincipal && r.status === 'requested' ? (
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setReason('');
                setActing({ id: r.id, decision: 'approve' });
              }}
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setReason('');
                setActing({ id: r.id, decision: 'reject' });
              }}
            >
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];
  return (
    <>
      <Table
        columns={columns}
        rows={query.data?.rows}
        rowKey={(r) => r.id}
        loading={query.isPending}
        error={query.isError ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        emptyTitle="No reversal requests"
        emptyDescription="A wrong payment or voucher is corrected by a request with a reason. The Principal decides."
      />
      <ConfirmDialog
        open={!!acting}
        title={acting?.decision === 'approve' ? 'Approve this reversal?' : 'Reject this reversal?'}
        description={
          acting?.decision === 'approve'
            ? 'The payment amount goes back to the account it was paid from. This cannot be undone.'
            : 'The payment stays as it is.'
        }
        confirmLabel={acting?.decision === 'approve' ? 'Approve' : 'Reject'}
        tone={acting?.decision === 'approve' ? 'primary' : 'danger'}
        requireReason={acting?.decision === 'reject'}
        onReasonChange={setReason}
        loading={decide.isPending}
        onConfirm={() => decide.mutate()}
        onCancel={() => setActing(null)}
      />
    </>
  );
}

/** Admin: expense heads. A deactivated head stays on old vouchers. */
function HeadsTab() {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const query = useQuery({ queryKey: ['expense-heads'], queryFn: () => api('/api/expense-heads') });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['expense-heads'] });
  const add = useMutation({
    mutationFn: () => api('/api/expense-heads', { method: 'POST', body: { name } }),
    onSuccess: async () => {
      setName('');
      setError('');
      await refresh();
      notify('Head added.', 'success');
    },
    onError: (e) => setError(e.fields?.name ?? e.message),
  });
  const toggle = useMutation({
    mutationFn: (h) =>
      api(`/api/expense-heads/${h.id}`, { method: 'PATCH', body: { active: !h.active } }),
    onSuccess: refresh,
    onError: (e) => notify(errorText(e), 'error'),
  });
  const columns = [
    { key: 'name', header: 'Head', render: (h) => h.name },
    {
      key: 'status',
      header: 'Status',
      render: (h) =>
        h.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Not in use</Badge>,
    },
    {
      key: 'act',
      header: '',
      render: (h) => (
        <Button
          variant="secondary"
          loading={toggle.isPending && toggle.variables?.id === h.id}
          onClick={() => toggle.mutate(h)}
        >
          {h.active ? 'Stop using' : 'Use again'}
        </Button>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card title="Add a head" subtitle="Heads are made here. Nothing is pre-filled.">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2) add.mutate();
          }}
        >
          <Input
            label="Head name"
            value={name}
            error={error}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" loading={add.isPending} disabled={name.trim().length < 2}>
            Add head
          </Button>
        </form>
      </Card>
      <Table
        columns={columns}
        rows={query.data?.heads}
        rowKey={(h) => h.id}
        loading={query.isPending}
        error={query.isError ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        emptyTitle="No heads yet"
        emptyDescription="Add the first head above, for example the kind of expense you make most often."
      />
    </div>
  );
}

export function Expenses() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const [tab, setTab] = useState('vouchers');
  const pending = useQuery({
    queryKey: ['money', 'pending'],
    queryFn: () => api('/api/money/pending'),
    refetchInterval: 60_000,
  });
  const tabs = [
    ['vouchers', 'Expense vouchers'],
    ['payments', 'Payments'],
    [
      'requests',
      `Reversal requests${pending.data?.reversals ? ` (${pending.data.reversals})` : ''}`,
    ],
    ...(isAdmin ? [['heads', 'Heads']] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Expenses</h1>
        <p className="text-sm text-ink-muted">
          School expenses of ₹500 or more. Payment only after the Principal approves.
        </p>
      </div>
      <div role="tablist" className="flex flex-wrap gap-2 border-b border-line">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === key ? 'border-brand text-brand' : 'border-transparent text-ink-muted hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'vouchers' && <VouchersTab isAdmin={isAdmin} />}
      {tab === 'payments' && <PaymentsTab />}
      {tab === 'requests' && <RequestsTab isPrincipal={role === 'principal'} />}
      {tab === 'heads' && isAdmin && <HeadsTab />}
    </div>
  );
}
