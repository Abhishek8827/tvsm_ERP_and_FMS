import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { classLabel, formatINR } from '@erp/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card, Dialog, Input, StatCard, useToast } from '../components/ui';
import { ErrorState, Spinner } from '../components/ui';
import { CASHBOOK_CSS, cashbookHtml } from '../lib/cashbookHtml';
import { printHtml } from '../lib/printHtml';
import { errorText, parseRupees, todayInput } from '../lib/rupees';

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });

function Grid({ head, rows, foot, empty }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-app text-xs uppercase text-ink-muted">
          <tr>
            {head.map((h) => (
              <th key={h.label} className={`px-3 py-2 font-medium ${h.right ? 'text-right' : ''}`}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.length === 0 ? (
            <tr>
              <td className="px-3 py-3 text-ink-muted" colSpan={head.length}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={r.key ?? i}>
                {r.cells.map((c, j) => (
                  <td key={j} className={`px-3 py-2 ${head[j].right ? 'text-right' : ''}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {foot && (
          <tfoot className="bg-app font-semibold">
            <tr>
              {foot.map((c, j) => (
                <td key={j} className={`px-3 py-2 ${head[j].right ? 'text-right' : ''}`}>
                  {c}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function Balance({ title, b }) {
  const lines = [
    ['Opening balance', b.openingPaise],
    ["Add: today's receipts", b.receiptsPaise],
    ...(b.otherPaise ? [['Add / less: transfers and other', b.otherPaise]] : []),
    ["Less: today's expense", b.expensePaise],
  ];
  return (
    <div className="rounded-card border border-line">
      <p className="border-b border-line bg-app px-3 py-2 text-sm font-medium">{title}</p>
      <dl className="divide-y divide-line text-sm">
        {lines.map(([k, v]) => (
          <div key={k} className="flex justify-between px-3 py-2">
            <dt>{k}</dt>
            <dd>{money(v)}</dd>
          </div>
        ))}
        <div className="flex justify-between bg-app px-3 py-2 font-semibold">
          <dt>Closing balance</dt>
          <dd>{money(b.closingPaise)}</dd>
        </div>
      </dl>
    </div>
  );
}

const receiptHead = [
  { label: 'Receipt' },
  { label: 'Scholar' },
  { label: 'Class' },
  { label: 'Student name' },
  { label: 'Cash', right: true },
  { label: 'Online', right: true },
  { label: 'Due', right: true },
];
const receiptRows = (s) =>
  s.rows.map((r) => ({
    key: r.id,
    cells: [
      r.number,
      r.admissionNo,
      r.classKey ? `${classLabel(r.classKey)}${r.section ? ` - ${r.section}` : ''}` : '',
      r.name,
      r.cashPaise ? money(r.cashPaise) : '',
      r.onlinePaise ? (
        <span>
          {money(r.onlinePaise)}
          {r.bankName && <span className="block text-xs text-ink-muted">{r.bankName}</span>}
        </span>
      ) : (
        ''
      ),
      money(r.duePaise),
    ],
  }));

/**
 * Cashbook: the school's daily notebook, built from the real receipts, expense payments and
 * money ledger of the chosen date. Everyone can look; the Admin sets up the transport account.
 */
export function Cashbook() {
  const { role } = useAuth();
  const { notify } = useToast();
  const [date, setDate] = useState(todayInput());
  const [settings, setSettings] = useState(false);
  const query = useQuery({
    queryKey: ['cashbook', date],
    enabled: !!date,
    queryFn: () => api(`/api/cashbook?date=${date}`),
  });
  const c = query.data;

  async function exportXlsx() {
    try {
      const blob = await api(`/api/cashbook/export?date=${date}`, { blob: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cashbook-${date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify(errorText(e), 'error');
    }
  }
  async function print() {
    try {
      await printHtml({ html: cashbookHtml(c), css: CASHBOOK_CSS, title: `Cashbook ${date}` });
    } catch (e) {
      notify(errorText(e), 'error');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold text-ink">
            Cashbook
            {c && (
              <Badge tone={c.closed ? 'success' : 'warning'}>
                {c.closed ? 'Day closed' : 'Day open'}
              </Badge>
            )}
          </h1>
          <p className="text-sm text-ink-muted">
            The day&apos;s receipts, expenses and balances, taken from the school&apos;s records.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            label="Date"
            type="date"
            max={todayInput()}
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <Button variant="secondary" disabled={!c} onClick={() => void print()}>
            Print (A4)
          </Button>
          <Button variant="secondary" disabled={!c} onClick={() => void exportXlsx()}>
            Export to Excel
          </Button>
          {role === 'admin' && (
            <Button variant="secondary" onClick={() => setSettings(true)}>
              Transport account settings
            </Button>
          )}
        </div>
      </div>

      {query.isPending && <Spinner label="Loading cashbook" />}
      {query.isError && (
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      )}
      {c && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Receipts today" value={money(c.totals.receiptsPaise)} />
            <StatCard label="Expense today" value={money(c.totals.expensePaise)} />
            <StatCard label="Cash closing" value={money(c.cash.closingPaise)} />
            <StatCard label="Online closing" value={money(c.online.closingPaise)} />
          </div>
          {c.cancelledToday > 0 && (
            <p className="text-sm text-ink-muted">
              {c.cancelledToday} receipt(s) were cancelled today; they are not counted anywhere
              here.
            </p>
          )}

          {[
            ['1. School fees receipts', c.school],
            ['2. Bus fees receipts', c.bus],
          ].map(([title, s]) => (
            <Card key={title} title={title}>
              <Grid
                head={receiptHead}
                rows={receiptRows(s)}
                empty="No receipts on this date."
                foot={['Total', '', '', '', money(s.cashPaise), money(s.onlinePaise), '']}
              />
            </Card>
          ))}

          <Card title="3. Expense summary">
            <Grid
              head={[
                { label: 'Voucher no' },
                { label: 'Head' },
                { label: 'Payee' },
                { label: 'Paid from' },
                { label: 'Amount', right: true },
                { label: 'By' },
              ]}
              rows={c.expenses.rows.map((e) => ({
                key: e.id,
                cells: [
                  <span key="v">
                    {e.voucherNo}
                    {e.reversal && <Badge tone="warning">reversal</Badge>}
                  </span>,
                  e.head,
                  e.payee,
                  e.mode,
                  money(e.amountPaise),
                  e.by,
                ],
              }))}
              empty="No expense on this date."
              foot={['Total', '', '', '', money(c.expenses.totalPaise), '']}
            />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="4. Cash balance">
              <Balance title="Cash" b={c.cash} />
            </Card>
            <Card title="5. Online balance">
              <div className="flex flex-col gap-3">
                {c.online.banks.length === 0 && (
                  <p className="text-sm text-ink-muted">No bank account added yet.</p>
                )}
                {c.online.banks.map((b) => (
                  <Balance key={b.id} title={b.name} b={b} />
                ))}
                {c.online.unassignedPaise > 0 && (
                  <p className="text-xs text-warning">
                    {money(c.online.unassignedPaise)} of UPI / QR receipts have no bank chosen, so
                    they are in no bank&apos;s balance.
                  </p>
                )}
              </div>
            </Card>
          </div>

          <Card title="6. Transport account">
            <TransportBlock t={c.transport} isAdmin={role === 'admin'} />
          </Card>
        </>
      )}
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
    </div>
  );
}

function TransportBlock({ t, isAdmin }) {
  if (!t.configured)
    return (
      <p className="text-sm text-ink-muted">
        {isAdmin
          ? 'Not set up yet. Use "Transport account settings" to enter the opening amount and the expense heads.'
          : 'The Admin has not set up the transport account yet.'}
      </p>
    );
  if (!t.started)
    return <p className="text-sm text-ink-muted">This account starts on {t.startDate}.</p>;
  return (
    <div className="flex flex-col gap-3">
      <Balance
        title="Transport vendor account"
        b={{
          openingPaise: t.openingPaise,
          receiptsPaise: t.incomePaise,
          otherPaise: 0,
          expensePaise: t.expensePaise,
          closingPaise: t.closingPaise,
        }}
      />
      <p className="text-xs text-ink-muted">
        Income: cash {money(t.incomeCashPaise)} + online {money(t.incomeOnlinePaise)}. Expense
        heads: {t.heads.length ? t.heads.join(', ') : 'none chosen'}.
      </p>
      {t.expenseRows.length > 0 && (
        <Grid
          head={[{ label: 'Voucher no' }, { label: 'Head' }, { label: 'Amount', right: true }]}
          rows={t.expenseRows.map((e) => ({
            key: e.id,
            cells: [e.voucherNo, e.head, money(e.amountPaise)],
          }))}
        />
      )}
    </div>
  );
}

function SettingsDialog({ onClose }) {
  const q = useQuery({
    queryKey: ['cashbook-settings'],
    queryFn: () => api('/api/cashbook/settings'),
  });
  return (
    <Dialog open title="Transport account settings" onClose={onClose}>
      {q.isPending && <Spinner label="Loading" />}
      {q.isError && <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && <SettingsForm data={q.data} onClose={onClose} />}
    </Dialog>
  );
}

function SettingsForm({ data, onClose }) {
  const { notify } = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({
    opening: String(data.transportOpeningPaise / 100),
    startDate: data.transportStartDate ?? todayInput(),
    heads: data.transportHeads,
    reason: '',
  });
  const amount = parseRupees(f.opening);
  const save = useMutation({
    mutationFn: () =>
      api('/api/cashbook/settings', {
        method: 'PUT',
        body: {
          openingRupees: f.opening,
          startDate: f.startDate,
          heads: f.heads,
          reason: f.reason.trim(),
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['cashbook'] });
      await qc.invalidateQueries({ queryKey: ['cashbook-settings'] });
      notify('Transport account saved.', 'success');
      onClose();
    },
    onError: (e) => notify(errorText(e), 'error'),
  });
  const toggle = (h) =>
    setF((x) => ({
      ...x,
      heads: x.heads.includes(h) ? x.heads.filter((y) => y !== h) : [...x.heads, h],
    }));
  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Account starts on"
        type="date"
        value={f.startDate}
        onChange={(e) => setF({ ...f, startDate: e.target.value })}
      />
      <Input
        label="Opening amount on that date (₹)"
        inputMode="decimal"
        value={f.opening}
        error={amount.error}
        onChange={(e) => setF({ ...f, opening: e.target.value })}
      />
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">
          Expense heads that are transport expense
        </legend>
        {data.expenseHeads.length === 0 && (
          <p className="text-sm text-ink-muted">No expense heads exist yet.</p>
        )}
        {data.expenseHeads.map((h) => (
          <label key={h} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.heads.includes(h)} onChange={() => toggle(h)} />
            {h}
          </label>
        ))}
      </fieldset>
      <Input
        label="Reason for this change (required)"
        value={f.reason}
        onChange={(e) => setF({ ...f, reason: e.target.value })}
      />
      <p className="text-xs text-ink-muted">
        Every change is kept in the history and the audit log. Income of this account is the bus-fee
        receipts (cash and online).
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          loading={save.isPending}
          disabled={!!amount.error || f.reason.trim().length < 3 || !f.startDate}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
