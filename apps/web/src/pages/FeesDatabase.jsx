import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CLASSES, classLabel, formatINR } from '@erp/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  Badge,
  Button,
  Dialog,
  FilterBar,
  Input,
  Pagination,
  Select,
  StatCard,
  Table,
  useToast,
} from '../components/ui';
import { errorText, parseRupees } from '../lib/rupees';

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const ANY = { value: '', label: 'Any' };
const CLASS_OPTIONS = [{ value: '', label: 'All classes' }].concat(
  CLASSES.map((c) => ({ value: c.key, label: c.label })),
);
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active students' },
  { value: 'inactive', label: 'Inactive students' },
];
const FEE_STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Fees due till today' },
  { value: 'overdue', label: 'Overdue (past grace days)' },
  { value: 'clear', label: 'Nothing due' },
  { value: 'noplan', label: 'Fees not posted yet' },
];
const YES_NO = [ANY, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }];
const GENDERS = [
  ANY,
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
];
const INITIAL = {
  q: '',
  classKey: '',
  section: '',
  status: 'active',
  feeStatus: '',
  transport: '',
  newAdmission: '',
  rte: '',
  village: '',
  category: '',
  gender: '',
  minDue: '',
  maxDue: '',
};

function params(f, extra = {}) {
  const p = new URLSearchParams(extra);
  for (const [k, v] of Object.entries(f)) if (v !== '') p.set(k, v);
  return p;
}

/**
 * Fees Database: every student with what was billed, paid, rebated and is due (worked out by
 * the same fee engine as Collect Fee). Everyone can look; the Cashier cannot export; only the
 * Admin can apply fees or give a rebate.
 */
export function FeesDatabase() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const canExport = role === 'admin' || role === 'principal';
  const { notify } = useToast();
  const [filters, setFilters] = useState(INITIAL);
  const [search, setSearch] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [sort, setSort] = useState('class');
  const [dir, setDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [rebateFor, setRebateFor] = useState(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const t = window.setTimeout(() => {
      setFilters((f) => ({ ...f, q: search.trim() }));
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const set = (k) => (e) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
  };
  // Rupees typed -> the URL carries rupees; the server turns them into paise.
  const bad = (v) => v !== '' && !(Number(v) >= 0);

  const query = useQuery({
    queryKey: ['fees-database', filters, sort, dir, page, pageSize],
    enabled: !bad(filters.minDue) && !bad(filters.maxDue),
    queryFn: () => api(`/api/fees-database?${params(filters, { sort, dir, page, pageSize })}`),
    placeholderData: keepPreviousData,
  });

  const planOne = useMutation({
    mutationFn: (row) =>
      api(`/api/students/${row.id}/fee-plan`, { method: 'POST', body: { fy: query.data.fy } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fees-database'] });
      notify('Fees posted for this student.', 'success');
    },
    onError: (e) => notify(errorText(e), 'error'),
  });

  async function exportExcel() {
    try {
      const blob = await api(`/api/fees-database/export?${params(filters)}`, { blob: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'fees-database.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify(errorText(e), 'error');
    }
  }

  function onSort(field) {
    setDir(sort === field && dir === 'asc' ? 'desc' : 'asc');
    setSort(field);
    setPage(1);
  }
  const head = (label, field) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-medium uppercase hover:text-ink"
      aria-label={`Sort by ${label}`}
      onClick={() => onSort(field)}
    >
      {label}
      <span aria-hidden>{sort === field ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </button>
  );

  const data = query.data;
  const t = data?.totals;
  const columns = [
    { key: 'adm', header: head('Adm. no', 'admissionNo'), render: (r) => r.admissionNo },
    {
      key: 'name',
      header: head('Student', 'name'),
      render: (r) => (
        <div>
          <Link className="font-medium text-brand hover:underline" to={`/students/${r.id}`}>
            {r.name}
          </Link>
          {r.fatherName && <p className="text-xs text-ink-muted">S/o {r.fatherName}</p>}
        </div>
      ),
    },
    {
      key: 'class',
      header: head('Class', 'class'),
      render: (r) => `${classLabel(r.classKey)}${r.section ? ` ${r.section}` : ''}`,
    },
    {
      key: 'bus',
      header: 'Bus',
      render: (r) => (r.usesTransport ? <Badge>{r.village || 'Bus'}</Badge> : '-'),
    },
    { key: 'billed', header: 'Billed', align: 'right', render: (r) => money(r.billedPaise) },
    {
      key: 'paid',
      header: head('Paid', 'paid'),
      align: 'right',
      render: (r) => money(r.paidPaise),
    },
    { key: 'rebate', header: 'Rebate', align: 'right', render: (r) => money(r.rebatePaise) },
    {
      key: 'due',
      header: head('Due till today', 'dueNow'),
      align: 'right',
      render: (r) => (r.planPosted ? money(r.dueNowPaise) : '-'),
    },
    {
      key: 'out',
      header: head('Outstanding (year)', 'outstanding'),
      align: 'right',
      render: (r) => (r.planPosted ? money(r.outstandingPaise) : '-'),
    },
    {
      key: 'state',
      header: 'Status',
      render: (r) =>
        !r.planPosted ? (
          <Badge tone="warning">Fees not posted</Badge>
        ) : r.overduePaise > 0 ? (
          <Badge tone="danger">Overdue</Badge>
        ) : r.dueNowPaise > 0 ? (
          <Badge tone="warning">Due</Badge>
        ) : (
          <Badge tone="success">Clear</Badge>
        ),
    },
  ];
  if (isAdmin)
    columns.push({
      key: 'act',
      header: '',
      render: (r) =>
        r.planPosted ? (
          <Button variant="secondary" onClick={() => setRebateFor(r)}>
            Add rebate
          </Button>
        ) : (
          <Button
            variant="secondary"
            loading={planOne.isPending && planOne.variables?.id === r.id}
            onClick={() => planOne.mutate(r)}
          >
            Apply fees
          </Button>
        ),
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Fees Database</h1>
          {data && <p className="text-sm text-ink-muted">Financial year {data.fy}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && <Button onClick={() => setApplyOpen(true)}>Apply fees to students</Button>}
          {canExport && (
            <Button variant="secondary" onClick={() => void exportExcel()}>
              Export to Excel
            </Button>
          )}
        </div>
      </div>

      {t && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Students" value={t.students} caption="Matching the filters" />
          <StatCard label="Billed (year)" value={money(t.billedPaise)} />
          <StatCard
            label="Paid"
            value={money(t.paidPaise)}
            caption={`Rebate ${money(t.rebatePaise)}`}
          />
          <StatCard
            label="Due till today"
            value={money(t.dueNowPaise)}
            caption={`Overdue ${money(t.overduePaise)} · Late fee ${money(t.lateFeePaise)}`}
          />
        </div>
      )}

      <FilterBar>
        <Input
          label="Search"
          placeholder="Name, father, mobile, adm. no, village"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          label="Class"
          options={CLASS_OPTIONS}
          value={filters.classKey}
          onChange={set('classKey')}
        />
        <Select
          label="Fee status"
          options={FEE_STATUS_OPTIONS}
          value={filters.feeStatus}
          onChange={set('feeStatus')}
        />
        <Select
          label="Student status"
          options={STATUS_OPTIONS}
          value={filters.status}
          onChange={set('status')}
        />
      </FilterBar>

      <div>
        <button
          type="button"
          aria-expanded={advanced}
          className="text-sm font-medium text-brand hover:underline"
          onClick={() => setAdvanced((a) => !a)}
        >
          {advanced ? 'Hide advanced filters' : 'Advanced filters'}
        </button>
        {advanced && (
          <div className="mt-2">
            <FilterBar>
              <Input label="Section" value={filters.section} onChange={set('section')} />
              <Select
                label="Uses bus"
                options={YES_NO}
                value={filters.transport}
                onChange={set('transport')}
              />
              <Input label="Village" value={filters.village} onChange={set('village')} />
              <Select
                label="New admission"
                options={YES_NO}
                value={filters.newAdmission}
                onChange={set('newAdmission')}
              />
              <Select label="RTE" options={YES_NO} value={filters.rte} onChange={set('rte')} />
              <Input
                label="Category"
                placeholder="GEN / OBC / SC / ST"
                value={filters.category}
                onChange={set('category')}
              />
              <Select
                label="Gender"
                options={GENDERS}
                value={filters.gender}
                onChange={set('gender')}
              />
              <Input
                label="Due till today: at least (₹)"
                inputMode="decimal"
                value={filters.minDue}
                error={bad(filters.minDue) ? 'Enter a valid amount' : undefined}
                onChange={set('minDue')}
              />
              <Input
                label="Due till today: at most (₹)"
                inputMode="decimal"
                value={filters.maxDue}
                error={bad(filters.maxDue) ? 'Enter a valid amount' : undefined}
                onChange={set('maxDue')}
              />
            </FilterBar>
            <button
              type="button"
              className="mt-2 text-sm text-ink-muted hover:underline"
              onClick={() => {
                setFilters(INITIAL);
                setSearch('');
                setPage(1);
              }}
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>

      <Table
        columns={columns}
        rows={data?.rows}
        rowKey={(r) => r.id}
        loading={query.isPending}
        error={query.isError ? errorText(query.error) : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No students match"
        emptyDescription="Change or clear the filters."
      />
      {data && data.total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data.total}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}

      {rebateFor && (
        <RebateDialog row={rebateFor} fy={data?.fy} onClose={() => setRebateFor(null)} />
      )}
      {applyOpen && <ApplyDialog fy={data?.fy} onClose={() => setApplyOpen(false)} />}
    </div>
  );
}

function RebateDialog({ row, fy, onClose }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState('school');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const parsed = parseRupees(amount);
  const save = useMutation({
    mutationFn: () =>
      api(`/api/students/${row.id}/rebates`, {
        method: 'POST',
        body: { fy, kind, amountPaise: parsed.paise, reason: reason.trim() },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fees-database'] });
      notify('Rebate added.', 'success');
      onClose();
    },
    onError: (e) => notify(errorText(e), 'error'),
  });
  const ready = !parsed.error && parsed.paise > 0 && reason.trim().length >= 3;
  return (
    <Dialog
      open
      title={`Add rebate: ${row.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>
            Add rebate
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-ink-muted">
          The rebate reduces the oldest unpaid fees first. It is recorded with your reason and can
          be reversed later.
        </p>
        <Select
          label="Rebate on"
          options={[
            { value: 'school', label: 'School fees' },
            { value: 'transport', label: 'Transport fees' },
          ]}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        />
        <Input
          label="Amount (₹)"
          inputMode="decimal"
          value={amount}
          error={parsed.error}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input
          label="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Dialog>
  );
}

function ApplyDialog({ fy, onClose }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [classKey, setClassKey] = useState('');
  const [kinds, setKinds] = useState({ school: true, transport: true });
  const [result, setResult] = useState(null);
  const chosen = Object.keys(kinds).filter((k) => kinds[k]);
  const apply = useMutation({
    mutationFn: () =>
      api('/api/fee-plan/apply', {
        method: 'POST',
        body: { fy, kinds: chosen, ...(classKey ? { classKey } : {}) },
      }),
    onSuccess: async (res) => {
      setResult(res);
      await queryClient.invalidateQueries({ queryKey: ['fees-database'] });
      notify(`Fees posted for ${res.posted} students.`, 'success');
    },
    onError: (e) => notify(errorText(e), 'error'),
  });
  return (
    <Dialog
      open
      title="Apply fees to students"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={apply.isPending}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button
              disabled={chosen.length === 0 || !fy}
              loading={apply.isPending}
              onClick={() => apply.mutate()}
            >
              Apply fees
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-ink-muted">
          Posts the {fy} fees from the fee chart for active students. Fees already posted are never
          added twice, so it is safe to run again.
        </p>
        <Select
          label="Class"
          options={CLASS_OPTIONS}
          value={classKey}
          onChange={(e) => setClassKey(e.target.value)}
        />
        <fieldset className="flex gap-4">
          <legend className="mb-1 text-sm font-medium">Fees</legend>
          {[
            ['school', 'School fees'],
            ['transport', 'Transport fees'],
          ].map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={kinds[k]}
                onChange={(e) => setKinds((x) => ({ ...x, [k]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {result && (
          <div className="rounded-lg border border-line bg-app p-3">
            <p>
              Posted for {result.posted} of {result.students} students ({result.newCharges} new
              charges).
            </p>
            {result.skipped.length > 0 && (
              <>
                <p className="mt-2 font-medium text-warning">{result.skipped.length} skipped:</p>
                <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-ink-muted">
                  {result.skipped.slice(0, 20).map((x) => (
                    <li key={x.admissionNo}>
                      SCH. {x.admissionNo} {x.name}: {x.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
