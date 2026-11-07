import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { formatINR } from '@erp/shared';
import { api, newIdempotencyKey } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { accountLabel, errorText, parseRupees } from '../lib/rupees';
import { Icon, IconTile } from '../components/Icons';
import {
  Badge,
  Button,
  Card,
  Dialog,
  ErrorState,
  Input,
  Pagination,
  Select,
  Spinner,
  Table,
  useToast,
} from '../components/ui';

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const MODE_LABEL = { upi: 'UPI / QR' };

/** School money: cash in hand and every bank account, with the school total. Petty cash is a separate fund and is not here. */
function Balances({ data }) {
  const bankTotal = data.banks.reduce((n, b) => n + b.balancePaise, 0);
  return (
    <div className="flex flex-col gap-4">
      {data.unassignedReceiptsPaise > 0 && (
        <div
          role="alert"
          className="rounded-card border border-warning/40 bg-warning/10 p-4 text-sm text-ink"
        >
          {money(data.unassignedReceiptsPaise)} of UPI / QR receipts have no bank account chosen, so
          they are not counted in any bank balance.
        </div>
      )}
      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="glass grid gap-1 rounded-card p-2 shadow-card sm:grid-cols-2 lg:grid-cols-3">
          <BalanceTile icon="cash" label="Cash in hand" value={money(data.cashPaise)} />
          {data.banks.map((b) => (
            <BalanceTile
              key={b.id}
              icon="bank"
              label={`${b.name}${b.last4 ? ` ••••${b.last4}` : ''}${b.active ? '' : ' (not in use)'}`}
              value={money(b.balancePaise)}
              caption={
                b.defaultForModes.length
                  ? `Default for ${b.defaultForModes.map((m) => MODE_LABEL[m]).join(' + ')}`
                  : undefined
              }
            />
          ))}
          {data.banks.length === 0 && (
            <p className="px-4 py-3 text-sm text-ink-muted">No bank account added yet.</p>
          )}
        </div>
        <div className="flex items-center gap-4 rounded-card bg-linear-to-br from-blue-600 to-blue-800 p-5 text-white shadow-glow">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/20">
            <Icon name="layers" size={26} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white/90">School funds</p>
            <p className="text-3xl font-bold leading-tight">{money(data.cashPaise + bankTotal)}</p>
            <p className="text-xs text-white/80">
              Cash {money(data.cashPaise)} + banks {money(bankTotal)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function BalanceTile({ icon, label, value, caption }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-4 py-3">
      <IconTile name={icon} box="h-12 w-12" />
      <div className="min-w-0">
        <p className="truncate text-sm text-ink-muted">{label}</p>
        <p className="text-2xl font-bold text-ink">{value}</p>
        {caption && <p className="text-xs text-ink-muted">{caption}</p>}
      </div>
    </div>
  );
}

const TITLE = {
  deposit: 'Deposit cash to a bank',
  withdraw: 'Withdraw from a bank to cash',
  bank: 'Move money between banks',
};

function TransferDialog({ open, onClose, overview, preset }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const key = useRef(newIdempotencyKey());
  const banks = (overview?.banks ?? []).filter((b) => b.active);
  // School accounts only: petty cash is topped up from the Petty Cash page.
  const accounts = [
    { value: 'cash', label: 'Cash in hand' },
    ...banks.map((b) => ({ value: `bank:${b.id}`, label: b.name })),
  ];
  const balanceOf = (acc) =>
    acc === 'cash'
      ? overview.cashPaise
      : (overview.banks.find((b) => `bank:${b.id}` === acc)?.balancePaise ?? 0);
  const only = (kind) => {
    const list = banks.map((b) => `bank:${b.id}`);
    return list.length === 1 && kind === 'bank' ? list[0] : '';
  };
  const start = {
    deposit: { from: 'cash', to: only('bank') },
    withdraw: { from: only('bank'), to: 'cash' },
    bank: { from: '', to: '' },
  }[preset] ?? { from: 'cash', to: '' };
  const [f, setF] = useState({ ...start, amount: '', note: '' });
  const [errors, setErrors] = useState({});
  const amount = parseRupees(f.amount);
  const save = useMutation({
    mutationFn: () =>
      api('/api/transfers', {
        method: 'POST',
        idempotencyKey: key.current,
        body: { from: f.from, to: f.to, amountPaise: amount.paise, note: f.note || undefined },
      }),
    onSuccess: async () => {
      key.current = newIdempotencyKey();
      await queryClient.invalidateQueries({ queryKey: ['money'] });
      await queryClient.invalidateQueries({ queryKey: ['petty'] });
      notify('Transfer saved. It is not counted as income or expense.', 'success');
      setErrors({});
      onClose();
    },
    onError: (e) => {
      setErrors(e.fields ?? {});
      if (e.status >= 400 && e.status < 500) key.current = newIdempotencyKey();
      notify(errorText(e), 'error');
    },
  });
  return (
    <Dialog
      open={open}
      title={TITLE[preset] ?? 'Transfer between accounts'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={!f.from || !f.to || !(amount.paise > 0) || !!amount.error}
            onClick={() => save.mutate()}
          >
            Transfer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select
          label="From"
          value={f.from}
          error={errors.from}
          onChange={(e) => setF((p) => ({ ...p, from: e.target.value }))}
          options={[{ value: '', label: 'Choose' }, ...accounts.filter((a) => a.value !== f.to)]}
        />
        {f.from && (
          <p className="-mt-2 text-xs text-ink-muted">Available: {money(balanceOf(f.from))}</p>
        )}
        <Select
          label="To"
          value={f.to}
          error={errors.to}
          onChange={(e) => setF((p) => ({ ...p, to: e.target.value }))}
          options={[{ value: '', label: 'Choose' }, ...accounts.filter((a) => a.value !== f.from)]}
        />
        <Input
          label="Amount (₹)"
          inputMode="decimal"
          value={f.amount}
          error={amount.error ?? errors.amountPaise}
          onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))}
        />
        <Input
          label="Note (optional)"
          value={f.note}
          onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))}
        />
      </div>
    </Dialog>
  );
}

const KIND = (from, to) =>
  from === 'cash' && to.startsWith('bank:')
    ? ['Cash to bank', 'success']
    : from.startsWith('bank:') && to === 'cash'
      ? ['Bank to cash', 'warning']
      : from.startsWith('bank:') && to.startsWith('bank:')
        ? ['Bank to bank', 'info']
        : ['Transfer', 'neutral'];

function TransfersTable({ banks }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [account, setAccount] = useState('');
  const filtered = from || to || account;
  const q = useQuery({
    queryKey: ['money', 'transfers', page, pageSize, from, to, account],
    queryFn: () =>
      api(
        `/api/transfers?scope=school&page=${page}&pageSize=${pageSize}` +
          (from ? `&from=${from}` : '') +
          (to ? `&to=${to}` : '') +
          (account ? `&account=${encodeURIComponent(account)}` : ''),
      ),
    placeholderData: keepPreviousData,
  });
  const columns = [
    { key: 'date', header: 'Date', render: (t) => t.date },
    {
      key: 'kind',
      header: 'Type',
      render: (t) => {
        const [label, tone] = KIND(t.from, t.to);
        return <Badge tone={tone}>{label}</Badge>;
      },
    },
    { key: 'from', header: 'From', render: (t) => accountLabel(t.from, banks) },
    { key: 'to', header: 'To', render: (t) => accountLabel(t.to, banks) },
    { key: 'amt', header: 'Amount', align: 'right', render: (t) => money(t.amountPaise) },
    { key: 'note', header: 'Note', render: (t) => t.note || '-' },
    { key: 'by', header: 'By', render: (t) => t.byName ?? '-' },
  ];
  const reset = (fn) => (e) => {
    fn(e.target.value);
    setPage(1);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Input label="From" type="date" value={from} onChange={reset(setFrom)} />
        <Input label="To" type="date" value={to} onChange={reset(setTo)} />
        <Select
          label="Account"
          value={account}
          onChange={reset(setAccount)}
          options={[
            { value: '', label: 'All accounts' },
            { value: 'cash', label: 'Cash in hand' },
            ...banks.map((b) => ({ value: `bank:${b.id}`, label: b.name })),
          ]}
        />
        {filtered && (
          <Button
            variant="secondary"
            onClick={() => {
              setFrom('');
              setTo('');
              setAccount('');
              setPage(1);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
      <Table
        columns={columns}
        rows={q.data?.rows}
        rowKey={(t) => t.transferId}
        loading={q.isPending}
        error={q.isError ? q.error.message : undefined}
        onRetry={() => void q.refetch()}
        emptyTitle={filtered ? 'No transfers match these filters' : 'No transfers yet'}
        emptyDescription={
          filtered
            ? 'Try a wider date range or another account.'
            : 'Cash deposited to a bank or a bank withdrawal appears here.'
        }
      />
      {q.data && q.data.total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={q.data.total}
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

function StaffView({ isAdmin }) {
  const [dialog, setDialog] = useState(null);
  const q = useQuery({
    queryKey: ['money', 'overview'],
    queryFn: () => api('/api/money/overview'),
    refetchInterval: 60_000,
  });
  if (q.isPending) return <Spinner label="Loading balances" />;
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />;
  return (
    <div className="flex flex-col gap-4">
      <Balances data={q.data} />
      {isAdmin && (
        <Card
          title="Move money"
          icon="refresh"
          subtitle="Between cash and banks. A transfer is not income or expense."
        >
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setDialog('deposit')}>Deposit cash to bank</Button>
            <Button variant="secondary" onClick={() => setDialog('withdraw')}>
              Withdraw from bank to cash
            </Button>
            <Button variant="secondary" onClick={() => setDialog('bank')}>
              Bank to bank
            </Button>
          </div>
        </Card>
      )}
      <Card title="Transfers" icon="doc">
        <TransfersTable banks={q.data.banks} />
      </Card>
      {isAdmin && dialog && (
        <TransferDialog open preset={dialog} overview={q.data} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

export function BankCash() {
  const { role } = useAuth();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Bank & Cash</h1>
        <p className="text-sm text-ink-muted">
          School cash and every bank account. Petty cash is a separate fund (see Petty Cash).
        </p>
      </div>
      <StaffView isAdmin={role === 'admin'} />
    </div>
  );
}