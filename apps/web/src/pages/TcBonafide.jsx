import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  CLASSES,
  TC_CONDUCT,
  TC_REASONS,
  classLabel,
  dMonY,
  dmy,
  formatINR,
  getFinancialYear,
} from '@erp/shared';
import { api, newIdempotencyKey } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  FilterBar,
  Input,
  Pagination,
  Select,
  Table,
  useToast,
} from '../components/ui';
import { CERT_CSS, bonafideHtml, tcHtml } from '../lib/certificateHtml';
import { printHtml } from '../lib/printHtml';
import { errorText, todayInput } from '../lib/rupees';

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const slText = (n) => String(n).padStart(4, '0');

/** Find one student by name or Sch. no. `onlyActive` for the Bonafide. */
function StudentPicker({ onPick, onlyActive }) {
  const [search, setSearch] = useState('');
  const q = search.trim();
  const found = useQuery({
    queryKey: ['cert-student-search', q, onlyActive],
    queryFn: () =>
      api(
        `/api/students?${onlyActive ? 'status=active&' : ''}pageSize=8&q=${encodeURIComponent(q)}`,
      ),
    enabled: q.length >= 2,
  });
  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Find student (name or Sch. no.)"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Type at least 2 letters"
      />
      {found.isLoading && <p className="text-sm text-ink-muted">Searching...</p>}
      {found.isError && <p className="text-sm text-danger">{errorText(found.error)}</p>}
      {found.data && found.data.rows.length === 0 && (
        <p className="text-sm text-ink-muted">No student found.</p>
      )}
      <ul className="flex flex-col divide-y divide-line">
        {found.data?.rows.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="flex w-full items-center justify-between gap-3 px-2 py-2 text-left hover:bg-app"
            >
              <span>
                <b>{s.name}</b> <span className="text-ink-muted">· Sch. {s.admissionNo}</span>
              </span>
              <span className="text-sm text-ink-muted">
                {classLabel(s.classKey)}
                {s.section ? ` - ${s.section}` : ''}
                {s.status === 'inactive' ? ' · inactive' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** On-screen preview in its own page (iframe) so the print CSS cannot leak into the app. */
function PreviewDialog({ open, title, html, onClose, onPrint, printing, canPrint, extra }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-[90vh] w-full max-w-4xl flex-col gap-3 rounded-card bg-surface p-4 shadow-xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <div className="flex flex-wrap gap-2">
            {extra}
            {canPrint && (
              <Button onClick={onPrint} loading={printing}>
                Print / Save as PDF
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        <iframe
          title="Certificate preview"
          className="min-h-0 flex-1 rounded border border-line bg-white"
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>${CERT_CSS} body{padding:8px}</style></head><body>${html}</body></html>`}
        />
        {!canPrint && (
          <p className="text-xs text-ink-muted">
            You can look at this certificate here. Only the Admin can print it.
          </p>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Transfer Certificate

const TC_STATUS = { issued: ['success', 'Issued'], cancelled: ['danger', 'Cancelled'] };

function TcForm({ draft, student, onIssued, onBack }) {
  const { notify } = useToast();
  const keyRef = useRef(newIdempotencyKey());
  const d = draft.defaults;
  const missingKeys = draft.missing.map((m) => m.key);
  const [f, setF] = useState({
    nationality: draft.snapshot.nationality || 'Indian',
    firstAdmissionDate: draft.snapshot.firstAdmissionDate ?? '',
    firstAdmissionClass: '',
    pen: draft.pen,
    aparId: draft.aparId,
    fatherName: '',
    motherName: '',
    category: '',
    dateOfBirth: '',
    bookNo: draft.bookNo,
    lastExam: '',
    failedInSameClass: 'No',
    subjects: '',
    qualifiedForPromotion: d.qualifiedForPromotion,
    workingDays: '',
    daysPresent: '',
    ncc: d.ncc,
    games: d.games,
    conduct: 'Good',
    dateOfApplication: d.dateOfApplication,
    dateOfIssue: d.dateOfIssue,
    reason: 'Parent Request',
    reasonNote: '',
    remarks: d.remarks,
    duesOverrideReason: '',
  });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const due = draft.pendingPaise;

  const issue = useMutation({
    mutationFn: () => {
      const body = {
        studentId: student.id,
        bookNo: f.bookNo.trim(),
        lastExam: f.lastExam.trim(),
        failedInSameClass: f.failedInSameClass.trim(),
        subjects: f.subjects.trim(),
        qualifiedForPromotion: f.qualifiedForPromotion.trim(),
        workingDays: Number(f.workingDays),
        daysPresent: Number(f.daysPresent),
        ncc: f.ncc.trim() || 'Not applicable',
        games: f.games.trim() || 'Not applicable',
        conduct: f.conduct,
        dateOfApplication: f.dateOfApplication,
        dateOfIssue: f.dateOfIssue,
        reason: f.reason,
        remarks: f.remarks.trim() || 'None',
      };
      if (f.reasonNote.trim()) body.reasonNote = f.reasonNote.trim();
      if (due > 0) body.duesOverrideReason = f.duesOverrideReason.trim();
      for (const k of [
        'fatherName',
        'motherName',
        'category',
        'dateOfBirth',
        'nationality',
        'firstAdmissionDate',
        'firstAdmissionClass',
        'pen',
        'aparId',
      ])
        if (String(f[k] ?? '').trim()) body[k] = String(f[k]).trim();
      return api('/api/tc', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': keyRef.current },
      });
    },
    onSuccess: (tc) => {
      notify(`Transfer Certificate ${slText(tc.slNo)} issued.`, 'success');
      onIssued(tc);
    },
    onError: (e) => {
      setErrors(e.fields ?? {});
      notify(errorText(e), 'error');
      // A refusal (4xx) needs a fresh key after the Admin fixes it; a network failure keeps it.
      if (e.status >= 400 && e.status < 500) keyRef.current = newIdempotencyKey();
    },
  });

  const submit = (e) => {
    e.preventDefault();
    const local = {};
    const need = (k, label) => !String(f[k] ?? '').trim() && (local[k] = `${label} is required`);
    need('lastExam', 'Last exam and result');
    need('failedInSameClass', 'This answer');
    need('subjects', 'Subjects studied');
    need('qualifiedForPromotion', 'Promotion');
    need('workingDays', 'Working days');
    need('daysPresent', 'Days present');
    need('bookNo', 'Book No.');
    for (const m of draft.missing) need(m.key, m.label);
    if (due > 0 && f.duesOverrideReason.trim().length < 3)
      local.duesOverrideReason = 'Write the reason (at least 3 letters)';
    if (Number(f.daysPresent) > Number(f.workingDays))
      local.daysPresent = 'Days present cannot be more than working days';
    setErrors(local);
    if (Object.keys(local).length === 0) issue.mutate();
  };
  const err = (k) => errors[k];
  const s = draft.snapshot;
  const cls = `${classLabel(student.classKey)}${student.section ? ` - ${student.section}` : ''}`;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Card title="From the school records (fields 1-8, 13, 14)">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {[
            ['Name', s.name],
            ["Mother's name", s.motherName || '—'],
            ["Father's name", s.fatherName || '—'],
            ['Date of birth', s.dob ? `${dmy(s.dob)} · ${s.dobInWords}` : '—'],
            ['Category', s.category || '—'],
            ['Last class', `${s.lastClassInWords}${s.section ? ` - ${s.section}` : ''} (${cls})`],
            ['Dues paid up to', s.duesPaidUpto],
            ['Fee concession', s.feeConcession],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-36 shrink-0 text-ink-muted">{k}</dt>
              <dd className="text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {due > 0 ? (
        <div role="alert" className="rounded-card border border-danger/40 bg-danger/5 p-4 text-sm">
          <p className="font-medium text-danger">
            Fees are still due: {money(due)} (late fee included).
          </p>
          <p className="mb-3 text-ink-muted">
            A TC is normally given only after all dues are paid. To issue it anyway, write the
            reason. It is saved on the TC and in the audit log.
          </p>
          <Input
            label="Reason to issue with dues pending"
            value={f.duesOverrideReason}
            onChange={set('duesOverrideReason')}
            error={err('duesOverrideReason')}
          />
        </div>
      ) : (
        <div className="rounded-card border border-success/40 bg-success/5 p-3 text-sm text-success">
          No fee dues pending. This TC can be issued.
        </div>
      )}

      <Card
        title="Student details"
        subtitle="Anything missing is filled here and saved back to the student record."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {missingKeys.includes('fatherName') && (
            <Input
              label="Father's name"
              required
              value={f.fatherName}
              onChange={set('fatherName')}
              error={err('fatherName')}
            />
          )}
          {missingKeys.includes('motherName') && (
            <Input
              label="Mother's name"
              required
              value={f.motherName}
              onChange={set('motherName')}
              error={err('motherName')}
            />
          )}
          {missingKeys.includes('dateOfBirth') && (
            <Input
              label="Date of birth"
              type="date"
              required
              value={f.dateOfBirth}
              onChange={set('dateOfBirth')}
              error={err('dateOfBirth')}
            />
          )}
          {missingKeys.includes('category') && (
            <Input
              label="Category (SC / ST / OBC / General)"
              required
              value={f.category}
              onChange={set('category')}
              error={err('category')}
            />
          )}
          <Input
            label="Nationality"
            value={f.nationality}
            onChange={set('nationality')}
            error={err('nationality')}
          />
          <Input
            label="Date of first admission"
            type="date"
            required={missingKeys.includes('firstAdmissionDate')}
            value={f.firstAdmissionDate}
            onChange={set('firstAdmissionDate')}
            error={err('firstAdmissionDate')}
          />
          <Select
            label="Class at first admission"
            required={missingKeys.includes('firstAdmissionClass')}
            value={f.firstAdmissionClass}
            onChange={set('firstAdmissionClass')}
            error={err('firstAdmissionClass')}
            options={[
              {
                value: '',
                label: s.firstAdmissionClass ? `${s.firstAdmissionClass} (saved)` : 'Select',
              },
              ...CLASSES.map((c) => ({ value: c.key, label: c.label })),
            ]}
          />
          <Input label="PEN (optional)" value={f.pen} onChange={set('pen')} />
          <Input label="APAAR ID (optional)" value={f.aparId} onChange={set('aparId')} />
        </div>
      </Card>

      <Card title="To be entered (fields 9-12, 15-23)">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Book No."
            required
            value={f.bookNo}
            onChange={set('bookNo')}
            error={err('bookNo')}
          />
          <Input
            label="9. Annual exam last taken, with result"
            required
            value={f.lastExam}
            onChange={set('lastExam')}
            error={err('lastExam')}
            placeholder="Annual Examination 2025-26, Passed"
          />
          <Input
            label="10. Failed? once or twice in same class"
            required
            value={f.failedInSameClass}
            onChange={set('failedInSameClass')}
            error={err('failedInSameClass')}
          />
          <Input
            label="11. Subjects studied"
            required
            value={f.subjects}
            onChange={set('subjects')}
            error={err('subjects')}
          />
          <Input
            label="12. Qualified for promotion to higher class"
            required
            value={f.qualifiedForPromotion}
            onChange={set('qualifiedForPromotion')}
            error={err('qualifiedForPromotion')}
          />
          <Input
            label="15. Working days in the session"
            type="number"
            min="0"
            required
            value={f.workingDays}
            onChange={set('workingDays')}
            error={err('workingDays')}
          />
          <Input
            label="16. Days present"
            type="number"
            min="0"
            required
            value={f.daysPresent}
            onChange={set('daysPresent')}
            error={err('daysPresent')}
          />
          <Input label="17. NCC / Scout / Guide" value={f.ncc} onChange={set('ncc')} />
          <Input label="18. Games / activities" value={f.games} onChange={set('games')} />
          <Select
            label="19. General conduct"
            value={f.conduct}
            onChange={set('conduct')}
            options={TC_CONDUCT.map((c) => ({ value: c, label: c }))}
          />
          <Input
            label="20. Date of application"
            type="date"
            value={f.dateOfApplication}
            onChange={set('dateOfApplication')}
            error={err('dateOfApplication')}
          />
          <Input
            label="21. Date of issue"
            type="date"
            value={f.dateOfIssue}
            onChange={set('dateOfIssue')}
            error={err('dateOfIssue')}
          />
          <Select
            label="22. Reason for leaving"
            value={f.reason}
            onChange={set('reason')}
            options={TC_REASONS.map((c) => ({ value: c, label: c }))}
          />
          <Input
            label="22. More detail (optional)"
            value={f.reasonNote}
            onChange={set('reasonNote')}
          />
          <Input label="23. Any other remarks" value={f.remarks} onChange={set('remarks')} />
        </div>
      </Card>

      <p className="text-sm text-ink-muted">
        After issue the student becomes inactive and no more fees are posted. The Sl. No. is
        <b> {slText(draft.nextSl)}</b> or the next free number of this year.
      </p>
      <div className="flex gap-2">
        <Button type="submit" loading={issue.isPending}>
          Issue Transfer Certificate
        </Button>
        <Button variant="secondary" onClick={onBack} disabled={issue.isPending}>
          Back
        </Button>
      </div>
    </form>
  );
}

function TcGenerate({ onIssued, onBack }) {
  const [student, setStudent] = useState(null);
  const draft = useQuery({
    queryKey: ['tc-draft', student?.id],
    queryFn: () => api(`/api/tc/draft/${student.id}`),
    enabled: Boolean(student),
    gcTime: 0,
  });
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Generate Transfer Certificate</h2>
        <Button variant="secondary" onClick={onBack}>
          Back to list
        </Button>
      </div>
      <Card title="Student">
        {student ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              <b>{student.name}</b>{' '}
              <span className="text-ink-muted">· Sch. {student.admissionNo}</span>
            </p>
            <Button variant="secondary" onClick={() => setStudent(null)}>
              Change student
            </Button>
          </div>
        ) : (
          <StudentPicker onPick={setStudent} />
        )}
      </Card>
      {student && draft.isLoading && <p className="text-sm text-ink-muted">Loading details...</p>}
      {student && draft.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorText(draft.error)}
        </p>
      )}
      {draft.data?.existingTc && (
        <div role="alert" className="rounded-card border border-danger/40 bg-danger/5 p-4 text-sm">
          A Transfer Certificate (Sl. No. {slText(draft.data.existingTc.slNo)}) is already issued
          for this student. Cancel it from the list first if it was a mistake.
        </div>
      )}
      {draft.data && !draft.data.existingTc && (
        <TcForm
          key={student.id}
          draft={draft.data}
          student={student}
          onIssued={onIssued}
          onBack={onBack}
        />
      )}
    </div>
  );
}

function TcTab({ isAdmin }) {
  const qc = useQueryClient();
  const { notify } = useToast();
  const [mode, setMode] = useState('list');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null); // { tc, copyNo, original }
  const [cancelFor, setCancelFor] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [printing, setPrinting] = useState(false);

  const list = useQuery({
    queryKey: ['tc-list', page, pageSize, q, status],
    queryFn: () =>
      api(
        `/api/tc?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}${status ? `&status=${status}` : ''}`,
      ),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['tc-list'] });
  const doPrint = async (tc, copyNo) => {
    setPrinting(true);
    try {
      await printHtml({
        html: tcHtml(tc, { copyNo }),
        css: CERT_CSS,
        title: `TC ${slText(tc.slNo)}`,
      });
    } catch (e) {
      notify(errorText(e), 'error');
    } finally {
      setPrinting(false);
    }
  };
  const reprint = useMutation({
    mutationFn: (id) => api(`/api/tc/${id}/reprint`, { method: 'POST' }),
    onSuccess: async (tc) => {
      await refresh();
      await doPrint(tc, tc.copyNo);
    },
    onError: (e) => notify(errorText(e), 'error'),
  });
  const cancel = useMutation({
    mutationFn: () =>
      api(`/api/tc/${cancelFor.id}/cancel`, {
        method: 'POST',
        body: { reason: cancelReason.trim() },
      }),
    onSuccess: async () => {
      notify('Transfer Certificate cancelled. The student is active again.', 'success');
      setCancelFor(null);
      setView(null);
      await refresh();
      await qc.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (e) => notify(errorText(e), 'error'),
  });

  if (mode === 'new')
    return (
      <TcGenerate
        onBack={() => setMode('list')}
        onIssued={async (tc) => {
          await refresh();
          setMode('list');
          setView({ tc, copyNo: null, original: true });
        }}
      />
    );

  const columns = [
    { key: 'sl', header: 'Sl. No.', render: (r) => <b>{slText(r.slNo)}</b> },
    {
      key: 'student',
      header: 'Student',
      render: (r) => (
        <span>
          {r.snapshot.name} <span className="text-ink-muted">· Sch. {r.snapshot.admissionNo}</span>
        </span>
      ),
    },
    { key: 'class', header: 'Last class', render: (r) => classLabel(r.snapshot.lastClass) },
    { key: 'date', header: 'Issued', render: (r) => dmy(r.entered.dateOfIssue) },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          <Badge tone={TC_STATUS[r.status][0]}>{TC_STATUS[r.status][1]}</Badge>
          {r.duesOverride && <Badge tone="warning">Dues pending</Badge>}
          {r.duplicateCount > 0 && <Badge>{r.duplicateCount} duplicate(s)</Badge>}
        </span>
      ),
    },
    {
      key: 'act',
      header: '',
      render: (r) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => setView({ tc: r, copyNo: null, original: false })}
          >
            View
          </Button>
          {isAdmin && r.status === 'issued' && (
            <>
              <Button
                variant="secondary"
                loading={reprint.isPending && reprint.variables === r.id}
                onClick={() => reprint.mutate(r.id)}
              >
                Print duplicate
              </Button>
              <Button variant="danger" onClick={() => setCancelFor(r)}>
                Cancel
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <FilterBar>
        <Input
          label="Search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Name or Sch. no."
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
            { value: 'issued', label: 'Issued' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
        />
        {isAdmin && <Button onClick={() => setMode('new')}>Generate Transfer Certificate</Button>}
      </FilterBar>
      <Table
        columns={columns}
        rows={list.data?.rows}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        error={list.isError ? errorText(list.error) : null}
        onRetry={() => list.refetch()}
        emptyTitle="No Transfer Certificates yet"
        emptyDescription={
          isAdmin ? 'Use "Generate Transfer Certificate" to make the first one.' : undefined
        }
      />
      {list.data && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={list.data.total}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
      <PreviewDialog
        open={Boolean(view)}
        title={view ? `Transfer Certificate ${slText(view.tc.slNo)}` : ''}
        html={view ? tcHtml(view.tc, { copyNo: view.copyNo }) : ''}
        canPrint={isAdmin && view?.tc.status === 'issued' && view?.original}
        printing={printing}
        onPrint={() => doPrint(view.tc, null)}
        onClose={() => setView(null)}
        extra={
          view?.tc.status === 'cancelled' ? (
            <Badge tone="danger">Cancelled: {view.tc.cancelReason}</Badge>
          ) : null
        }
      />
      <ConfirmDialog
        open={Boolean(cancelFor)}
        title={cancelFor ? `Cancel Transfer Certificate ${slText(cancelFor.slNo)}?` : ''}
        description="The number stays used (it is never given again). The student becomes active again."
        confirmLabel="Cancel this TC"
        tone="danger"
        requireReason
        onReasonChange={setCancelReason}
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onCancel={() => setCancelFor(null)}
      />
    </div>
  );
}

// ------------------------------------------------------------------ Bonafide

function BonafideForm({ onIssued, onBack }) {
  const { notify } = useToast();
  const keyRef = useRef(newIdempotencyKey());
  const [student, setStudent] = useState(null);
  const [purpose, setPurpose] = useState('');
  const [academicYear, setAcademicYear] = useState(getFinancialYear(new Date()));
  const [dateOfIssue, setDateOfIssue] = useState(todayInput());
  const [errors, setErrors] = useState({});
  const issue = useMutation({
    mutationFn: () =>
      api('/api/bonafide', {
        method: 'POST',
        body: { studentId: student.id, purpose: purpose.trim(), academicYear, dateOfIssue },
        headers: { 'Idempotency-Key': keyRef.current },
      }),
    onSuccess: (b) => {
      notify(`Bonafide ${b.number} issued.`, 'success');
      onIssued(b);
    },
    onError: (e) => {
      setErrors(e.fields ?? {});
      notify(errorText(e), 'error');
      if (e.status >= 400 && e.status < 500) keyRef.current = newIdempotencyKey();
    },
  });
  const submit = (e) => {
    e.preventDefault();
    const local = {};
    if (purpose.trim().length < 2) local.purpose = 'Write the purpose';
    if (!/^\d{4}-\d{2}$/.test(academicYear)) local.academicYear = 'Use a year like 2026-27';
    setErrors(local);
    if (!student) return notify('Choose a student first.', 'error');
    if (Object.keys(local).length === 0) issue.mutate();
  };
  return (
    <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Generate Bonafide Certificate</h2>
        <Button variant="secondary" onClick={onBack}>
          Back to list
        </Button>
      </div>
      <Card title="Student" subtitle="Only students who are studying now (active) can get one.">
        {student ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              <b>{student.name}</b>{' '}
              <span className="text-ink-muted">· Sch. {student.admissionNo}</span>
              <span className="text-ink-muted">
                {' '}
                · Class {classLabel(student.classKey)}
                {student.section ? ` - ${student.section}` : ''}
              </span>
            </p>
            <Button variant="secondary" onClick={() => setStudent(null)}>
              Change student
            </Button>
          </div>
        ) : (
          <StudentPicker onPick={setStudent} onlyActive />
        )}
      </Card>
      <Card title="Details">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Purpose"
            required
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            error={errors.purpose}
            placeholder="Passport application"
          />
          <Input
            label="Academic year"
            value={academicYear}
            onChange={(e) => setAcademicYear(e.target.value)}
            error={errors.academicYear}
          />
          <Input
            label="Date of issue"
            type="date"
            value={dateOfIssue}
            onChange={(e) => setDateOfIssue(e.target.value)}
            error={errors.dateOfIssue}
          />
        </div>
        <p className="mt-3 text-sm text-ink-muted">Dues are not checked for a Bonafide.</p>
      </Card>
      <div>
        <Button type="submit" loading={issue.isPending}>
          Generate certificate
        </Button>
      </div>
    </form>
  );
}

function BonafideTab({ isAdmin }) {
  const qc = useQueryClient();
  const { notify } = useToast();
  const [mode, setMode] = useState('list');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [view, setView] = useState(null);
  const [printing, setPrinting] = useState(false);
  const list = useQuery({
    queryKey: ['bonafide-list', page, pageSize, q],
    queryFn: () =>
      api(`/api/bonafide?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['bonafide-list'] });
  const doPrint = async (b, copyNo) => {
    setPrinting(true);
    try {
      await printHtml({
        html: bonafideHtml(b, { copyNo }),
        css: CERT_CSS,
        title: `Bonafide ${b.number}`,
      });
    } catch (e) {
      notify(errorText(e), 'error');
    } finally {
      setPrinting(false);
    }
  };
  const reprint = useMutation({
    mutationFn: (id) => api(`/api/bonafide/${id}/reprint`, { method: 'POST' }),
    onSuccess: async (b) => {
      await refresh();
      await doPrint(b, b.copyNo);
    },
    onError: (e) => notify(errorText(e), 'error'),
  });

  if (mode === 'new')
    return (
      <BonafideForm
        onBack={() => setMode('list')}
        onIssued={async (b) => {
          await refresh();
          setMode('list');
          setView({ b, original: true });
        }}
      />
    );

  const columns = [
    { key: 'no', header: 'Number', render: (r) => <b>{r.number}</b> },
    {
      key: 'student',
      header: 'Student',
      render: (r) => (
        <span>
          {r.snapshot.name} <span className="text-ink-muted">· Sch. {r.snapshot.admissionNo}</span>
        </span>
      ),
    },
    { key: 'purpose', header: 'Purpose', render: (r) => r.purpose },
    { key: 'date', header: 'Issued', render: (r) => dMonY(r.dateOfIssue) },
    {
      key: 'act',
      header: '',
      render: (r) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setView({ b: r, original: false })}>
            View
          </Button>
          {isAdmin && (
            <Button
              variant="secondary"
              loading={reprint.isPending && reprint.variables === r.id}
              onClick={() => reprint.mutate(r.id)}
            >
              Print duplicate
            </Button>
          )}
        </div>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <FilterBar>
        <Input
          label="Search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Name or Sch. no."
        />
        {isAdmin && <Button onClick={() => setMode('new')}>Generate Bonafide</Button>}
      </FilterBar>
      <Table
        columns={columns}
        rows={list.data?.rows}
        rowKey={(r) => r.id}
        loading={list.isLoading}
        error={list.isError ? errorText(list.error) : null}
        onRetry={() => list.refetch()}
        emptyTitle="No Bonafide certificates yet"
        emptyDescription={isAdmin ? 'Use "Generate Bonafide" to make the first one.' : undefined}
      />
      {list.data && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={list.data.total}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
      <PreviewDialog
        open={Boolean(view)}
        title={view ? `Bonafide ${view.b.number}` : ''}
        html={view ? bonafideHtml(view.b) : ''}
        canPrint={isAdmin && view?.original}
        printing={printing}
        onPrint={() => doPrint(view.b, null)}
        onClose={() => setView(null)}
      />
    </div>
  );
}

// ------------------------------------------------------------------ Settings (Admin)

function SettingsForm({ data, onSaved }) {
  const { notify } = useToast();
  const [bookNo, setBookNo] = useState(data.tcBookNo);
  const [startSl, setStartSl] = useState(String(data.tcStartSl));
  const save = useMutation({
    mutationFn: () =>
      api('/api/certificates/settings', {
        method: 'PUT',
        body: { tcBookNo: bookNo.trim(), tcStartSl: Number(startSl) },
      }),
    onSuccess: async () => {
      notify('Saved.', 'success');
      await onSaved();
    },
    onError: (e) => notify(errorText(e), 'error'),
  });
  const valid = bookNo.trim() && Number.isInteger(Number(startSl)) && Number(startSl) >= 1;
  return (
    <Card title="Transfer Certificate numbering">
      <div className="grid max-w-xl gap-3 sm:grid-cols-2">
        <Input label="Book No." value={bookNo} onChange={(e) => setBookNo(e.target.value)} />
        <Input
          label={`First Sl. No. of ${data.fy}`}
          type="number"
          min="1"
          value={startSl}
          disabled={data.startLocked}
          hint={
            data.startLocked
              ? 'Locked: a TC is already issued this year.'
              : 'The first TC of the year gets this number; after that it goes up by one.'
          }
          onChange={(e) => setStartSl(e.target.value)}
        />
      </div>
      <div className="mt-4">
        <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </Card>
  );
}

function SettingsTab() {
  const qc = useQueryClient();
  const s = useQuery({
    queryKey: ['cert-settings'],
    queryFn: () => api('/api/certificates/settings'),
  });
  if (s.isLoading) return <p className="text-sm text-ink-muted">Loading...</p>;
  if (s.isError)
    return (
      <p role="alert" className="text-sm text-danger">
        {errorText(s.error)}
      </p>
    );
  return (
    <SettingsForm
      key={`${s.data.tcBookNo}|${s.data.tcStartSl}|${s.data.startLocked}`}
      data={s.data}
      onSaved={() => qc.invalidateQueries({ queryKey: ['cert-settings'] })}
    />
  );
}

/** TC & Bonafide. Admin makes, reprints and cancels; Principal and Cashier can only look. */
export function TcBonafide() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const [tab, setTab] = useState('tc');
  const tabs = [
    ['tc', 'Transfer Certificates'],
    ['bonafide', 'Bonafide'],
    ...(isAdmin ? [['settings', 'Settings']] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">TC & Bonafide</h1>
        <p className="text-sm text-ink-muted">
          {isAdmin
            ? 'Make, print and cancel Transfer Certificates and Bonafide certificates.'
            : 'You can look at issued certificates. Only the Admin can make or print them.'}
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
      {tab === 'tc' && <TcTab isAdmin={isAdmin} />}
      {tab === 'bonafide' && <BonafideTab isAdmin={isAdmin} />}
      {tab === 'settings' && isAdmin && <SettingsTab />}
    </div>
  );
}
