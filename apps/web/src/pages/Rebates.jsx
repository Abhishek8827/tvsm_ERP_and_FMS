import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { classLabel, formatINR } from '@erp/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
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
const TYPES = [
  { value: 'school', label: 'School fees' },
  { value: 'transport', label: 'Transport fees' },
  { value: 'admission', label: 'Admission fees' },
];
const TYPE_LABEL = {
  ...Object.fromEntries(TYPES.map((t) => [t.value, t.label])),
  late_fee: 'Late fee waiver',
};
const ADJUST_OPTIONS = [
  { value: 'oldest', label: 'Oldest unpaid fee first (normal)' },
  { value: 'last', label: "Last month's fee (BC, OTP and similar)" },
];

async function download(path, name, notify) {
  try {
    const blob = await api(path, { blob: true });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    notify(errorText(e), 'error');
  }
}

/**
 * Rebates: every concession in one list. The Admin gives a rebate (tick the types, an amount box
 * opens for each), imports many from Excel, or reverses one (reason compulsory). The Principal
 * can look and export. A rebate is never edited or deleted, only reversed.
 */
export function Rebates() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const { notify } = useToast();
  const [mode, setMode] = useState('list'); // 'list' | 'import'
  const [giving, setGiving] = useState(false);
  const [reversing, setReversing] = useState(null);
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const queryClient = useQueryClient();

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const qs = (extra = {}) => {
    const p = new URLSearchParams(extra);
    if (q) p.set('q', q);
    if (type) p.set('type', type);
    if (status) p.set('status', status);
    return p;
  };
  const query = useQuery({
    queryKey: ['rebates', { q, type, status, page, pageSize }],
    queryFn: () => api(`/api/rebates?${qs({ page, pageSize })}`),
    placeholderData: keepPreviousData,
  });
  const reverse = useMutation({
    mutationFn: () =>
      api(`/api/rebates/${reversing.id}/reverse`, { method: 'POST', body: { reason } }),
    onSuccess: async () => {
      for (const key of ['rebates', 'fees-database', 'dues', 'ledger', 'dashboard'])
        await queryClient.invalidateQueries({ queryKey: [key] });
      notify('Rebate reversed.', 'success');
      setReversing(null);
    },
    onError: (e) => notify(errorText(e), 'error'),
  });

  const d = query.data;
  const rows = d?.rows?.map((r, i) => ({ ...r, _n: (page - 1) * pageSize + i + 1 }));
  const columns = [
    { key: 'sno', header: 'S.No', render: (r) => r._n },
    { key: 'adm', header: 'Sch. ID', render: (r) => r.student?.admissionNo ?? '-' },
    {
      key: 'name',
      header: 'Student',
      render: (r) =>
        r.studentId ? (
          <Link className="font-medium text-brand hover:underline" to={`/students/${r.studentId}`}>
            {r.student?.name ?? 'Student'}
          </Link>
        ) : (
          '-'
        ),
    },
    {
      key: 'class',
      header: 'Class',
      render: (r) => (r.student?.classKey ? classLabel(r.student.classKey) : '-'),
    },
    { key: 'type', header: 'Rebate type', render: (r) => TYPE_LABEL[r.type] ?? r.type },
    { key: 'amt', header: 'Amount', align: 'right', render: (r) => money(r.totalPaise) },
    {
      key: 'on',
      header: 'Adjusted on',
      render: (r) =>
        r.type === 'late_fee'
          ? r.periods.join(', ')
          : r.adjustOn === 'last'
            ? 'Last month'
            : 'Oldest unpaid',
    },
    { key: 'reason', header: 'Reason', render: (r) => r.reason },
    {
      key: 'date',
      header: 'Date',
      render: (r) =>
        new Date(r.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) =>
        r.status === 'reversed' ? (
          <div>
            <Badge tone="danger">Reversed</Badge>
            {r.reversedReason && <p className="mt-1 text-xs text-ink-muted">{r.reversedReason}</p>}
          </div>
        ) : (
          <Badge tone="success">Active</Badge>
        ),
    },
  ];
  if (isAdmin)
    columns.push({
      key: 'act',
      header: '',
      render: (r) =>
        r.status === 'active' ? (
          <Button
            variant="secondary"
            onClick={() => {
              setReason('');
              setReversing(r);
            }}
          >
            Reverse
          </Button>
        ) : null,
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Rebates</h1>
          <p className="text-sm text-ink-muted">
            Every concession given to students. Reversed rebates stay in the list.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && <Button onClick={() => setGiving(true)}>Give rebate</Button>}
          {isAdmin && (
            <Button
              variant="secondary"
              onClick={() => setMode(mode === 'import' ? 'list' : 'import')}
            >
              {mode === 'import' ? 'Back to list' : 'Import from Excel'}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => void download(`/api/rebates/export?${qs()}`, 'rebates.xlsx', notify)}
          >
            Export to Excel
          </Button>
        </div>
      </div>

      {mode === 'import' && isAdmin && (
        <ImportPanel
          onDone={async () => {
            for (const key of ['rebates', 'fees-database', 'dues', 'ledger', 'dashboard'])
              await queryClient.invalidateQueries({ queryKey: [key] });
          }}
        />
      )}

      {mode === 'list' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Active rebates"
              value={d?.totals?.count ?? 0}
              caption="Matching the filters"
            />
            <StatCard label="Total rebate amount" value={money(d?.totals?.paise)} />
          </div>
          <FilterBar>
            <Input
              label="Search"
              placeholder="Student name or Sch. ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              label="Rebate type"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All' },
                ...TYPES,
                { value: 'late_fee', label: 'Late fee waiver' },
              ]}
            />
            <Select
              label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'reversed', label: 'Reversed' },
              ]}
            />
          </FilterBar>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={query.isPending}
            error={query.isError ? errorText(query.error) : null}
            onRetry={() => void query.refetch()}
            emptyTitle="No rebates yet"
            emptyDescription={
              isAdmin
                ? 'Use "Give rebate" or "Import from Excel" to add one.'
                : 'The Admin has not given any rebate for these filters.'
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
        </>
      )}

      {giving && <GiveDialog onClose={() => setGiving(false)} />}
      <ConfirmDialog
        open={!!reversing}
        title="Reverse this rebate?"
        description="The student's fees go back up by this amount. The rebate stays in the list as reversed."
        confirmLabel="Reverse rebate"
        tone="danger"
        loading={reverse.isPending}
        requireReason
        onReasonChange={setReason}
        onConfirm={() => reverse.mutate()}
        onCancel={() => setReversing(null)}
      />
    </div>
  );
}

/** Pick a student by typing, tick the rebate types (an amount box opens for each), give a reason. */
function GiveDialog({ onClose }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [student, setStudent] = useState(null);
  const [ticked, setTicked] = useState({}); // type -> amount text
  const [reason, setReason] = useState('');
  const [adjustOn, setAdjustOn] = useState('oldest');
  useEffect(() => {
    const t = window.setTimeout(() => setQ(text.trim()), 300);
    return () => window.clearTimeout(t);
  }, [text]);
  const found = useQuery({
    queryKey: ['rebate-student-search', q],
    enabled: q.length >= 2 && !student,
    queryFn: () => api(`/api/students?status=active&pageSize=8&q=${encodeURIComponent(q)}`),
  });
  const items = Object.entries(ticked).map(([type, text]) => ({ type, parsed: parseRupees(text) }));
  const ready =
    !!student &&
    items.length > 0 &&
    items.every((i) => !i.parsed.error && i.parsed.paise > 0) &&
    reason.trim().length >= 2;
  const save = useMutation({
    mutationFn: () =>
      api('/api/rebates', {
        method: 'POST',
        body: {
          studentId: student.id,
          items: items.map((i) => ({ type: i.type, amountPaise: i.parsed.paise })),
          reason: reason.trim(),
          adjustOn,
        },
      }),
    onSuccess: async (res) => {
      for (const key of ['rebates', 'fees-database', 'dues', 'ledger', 'dashboard'])
        await queryClient.invalidateQueries({ queryKey: [key] });
      notify(`${res.created.length} rebate${res.created.length > 1 ? 's' : ''} given.`, 'success');
      // Some types may have failed (e.g. more than what is unpaid): say which and why.
      for (const f of res.failed ?? []) notify(`${TYPE_LABEL[f.type]}: ${f.message}`, 'error');
      onClose();
    },
    onError: (e) => notify(errorText(e), 'error'),
  });
  const toggle = (type) =>
    setTicked((t) => {
      const next = { ...t };
      if (type in next) delete next[type];
      else next[type] = '';
      return next;
    });
  return (
    <Dialog
      open
      title="Give rebate"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>
            Give rebate
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {student ? (
          <div className="flex items-center justify-between rounded-lg border border-line bg-app p-3">
            <div>
              <p className="font-medium">{student.name}</p>
              <p className="text-xs text-ink-muted">
                Sch. {student.admissionNo} · {classLabel(student.classKey)}
              </p>
            </div>
            <button
              type="button"
              className="text-sm text-brand hover:underline"
              onClick={() => setStudent(null)}
            >
              Change
            </button>
          </div>
        ) : (
          <div>
            <Input
              label="Student"
              placeholder="Type name or Sch. ID (2+ letters)"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {found.isPending && q.length >= 2 && (
              <p className="mt-2 text-sm text-ink-muted">Searching…</p>
            )}
            {found.isError && <p className="mt-2 text-sm text-danger">{errorText(found.error)}</p>}
            {found.data && found.data.rows.length === 0 && (
              <p className="mt-2 text-sm text-ink-muted">No active student found.</p>
            )}
            {found.data && found.data.rows.length > 0 && (
              <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                {found.data.rows.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-app"
                      onClick={() => setStudent(s)}
                    >
                      <span>{s.name}</span>
                      <span className="text-xs text-ink-muted">
                        Sch. {s.admissionNo} · {classLabel(s.classKey)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Rebate on (tick one or more)</legend>
          {TYPES.map((t) => (
            <div key={t.value} className="flex flex-wrap items-center gap-3">
              <label className="flex min-w-40 items-center gap-2">
                <input
                  type="checkbox"
                  checked={t.value in ticked}
                  onChange={() => toggle(t.value)}
                />
                {t.label}
              </label>
              {t.value in ticked && (
                <div className="w-40">
                  <Input
                    label={`${t.label} rebate (₹)`}
                    inputMode="decimal"
                    value={ticked[t.value]}
                    error={parseRupees(ticked[t.value]).error}
                    onChange={(e) => setTicked((x) => ({ ...x, [t.value]: e.target.value }))}
                  />
                </div>
              )}
            </div>
          ))}
        </fieldset>

        <Select
          label="Reduce which fee"
          options={ADJUST_OPTIONS}
          value={adjustOn}
          onChange={(e) => setAdjustOn(e.target.value)}
        />
        <Input
          label="Reason (required, e.g. BC, OTP, staff child)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-xs text-ink-muted">
          A rebate can never be more than what is still unpaid. Admission rebate always lowers the
          admission fee. It is recorded with your reason and can be reversed later.
        </p>
      </div>
    </Dialog>
  );
}

/** Excel import: "Check file" saves nothing and lists problems; "Import" saves the good rows. */
function ImportPanel({ onDone }) {
  const { notify } = useToast();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const send = useMutation({
    mutationFn: ({ commit }) =>
      api(`/api/rebates/import?commit=${commit}`, { method: 'POST', file }),
    onSuccess: async (res) => {
      setResult(res);
      if (res.committed) {
        await onDone();
        notify(`${res.created} rebates imported.`, 'success');
      }
    },
    onError: (e) => notify(errorText(e), 'error'),
  });
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <Card title="1. Get the template">
        <p className="text-sm text-ink-muted">
          One row per rebate: SCH. ID, REBATE TYPE (school / transport / admission), AMOUNT (₹) and
          REASON. The optional ADJUST ON column can say "last" for BC / OTP style rebates that
          reduce the last month's fee (empty = oldest unpaid fee first). The same rebate (student,
          type, amount, reason) is never given twice, so importing a file again is safe.
        </p>
        <div className="mt-3">
          <Button
            variant="secondary"
            onClick={() =>
              void download('/api/rebates/template', 'rebate-import-template.xlsx', notify)
            }
          >
            Download template (.xlsx)
          </Button>
        </div>
      </Card>
      <Card title="2. Choose your file">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            aria-label="Excel file"
            className="text-sm"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              send.reset();
            }}
          />
          <Button
            loading={send.isPending && send.variables?.commit === 'false'}
            disabled={!file || send.isPending}
            onClick={() => send.mutate({ commit: 'false' })}
          >
            Check file
          </Button>
        </div>
      </Card>
      {result && (
        <Card title={result.committed ? 'Import finished' : 'Check result (nothing saved yet)'}>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Rows in file" value={result.rowsInFile} />
            <StatCard
              label={result.committed ? 'Imported' : 'Ready to import'}
              value={result.committed ? result.created : result.ready}
            />
            <StatCard label="Skipped" value={result.skipped} caption="Problems or already given" />
          </div>
          {result.errors.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-card border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-app text-xs uppercase text-ink-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Excel row</th>
                    <th className="px-4 py-3 font-medium">Problem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.errors.map((e) => (
                    <tr key={`${e.row}-${e.message}`}>
                      <td className="px-4 py-3">{e.row}</td>
                      <td className="px-4 py-3">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!result.committed && result.ready === 0 && (
            <div className="mt-4">
              <EmptyState
                title="Nothing to import"
                description="Fix the rows above in Excel and choose the file again."
              />
            </div>
          )}
          {!result.committed && result.ready > 0 && (
            <div className="mt-4 flex items-center gap-3">
              <Button
                loading={send.isPending && send.variables?.commit === 'true'}
                disabled={send.isPending}
                onClick={() => send.mutate({ commit: 'true' })}
              >
                Import {result.ready} rebates
              </Button>
              {result.skipped > 0 && (
                <Badge tone="warning">{result.skipped} rows will be skipped</Badge>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
