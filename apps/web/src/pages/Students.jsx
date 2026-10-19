import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CLASSES, classLabel } from '@erp/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  Badge,
  Button,
  ConfirmDialog,
  FilterBar,
  Input,
  Pagination,
  Select,
  StatCard,
  Table,
  useToast,
} from '../components/ui';

const CLASS_OPTIONS = [{ value: '', label: 'All classes' }].concat(
  CLASSES.map((c) => ({ value: c.key, label: c.label })),
);
const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

/** Column title that sorts when clicked (first click A to Z / small to big, second click reverses). */
function SortHeader({ label, field, sort, dir, onSort }) {
  const active = sort === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className="inline-flex items-center gap-1 font-medium uppercase hover:text-ink"
      aria-label={`Sort by ${label}`}
    >
      {label}
      <span aria-hidden>{active ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </button>
  );
}

/** Students list: server-side search, filters, sorting and pages (stays fast with 1,500+ students). */
export function Students() {
  const { role } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = role === 'admin';
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [classKey, setClassKey] = useState('');
  const [section, setSection] = useState('');
  const [status, setStatus] = useState('active');
  const [sort, setSort] = useState('admissionNo');
  const [dir, setDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');

  // Wait until typing pauses so we do not call the server on every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const query = useQuery({
    queryKey: ['students', { q, classKey, section, status, sort, dir, page, pageSize }],
    queryFn: () => {
      const params = new URLSearchParams({ page, pageSize, sort, dir });
      if (q) params.set('q', q);
      if (classKey) params.set('classKey', classKey);
      if (section) params.set('section', section);
      if (status) params.set('status', status);
      return api(`/api/students?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const bulkDelete = useMutation({
    mutationFn: () =>
      api('/api/students/bulk-delete', { method: 'POST', body: { ids: selected, reason } }),
    onSuccess: async (res) => {
      setConfirmOpen(false);
      setSelected([]);
      await queryClient.invalidateQueries({ queryKey: ['students'] });
      notify(`${res.deleted} students permanently deleted.`, 'success');
    },
    // The reference number lets us find the exact request in the server log if it ever fails.
    onError: (e) => notify(`${e.message}${e.requestId ? ` (ref ${e.requestId})` : ''}`, 'error'),
  });

  // Any change of what is on screen clears the ticks, so nobody deletes rows they cannot see.
  function change(setter) {
    return (value) => {
      setter(value);
      setPage(1);
      setSelected([]);
    };
  }
  function onSort(field) {
    setDir(sort === field && dir === 'asc' ? 'desc' : 'asc');
    setSort(field);
    setPage(1);
    setSelected([]);
  }

  const data = query.data;
  const rows = data?.rows ?? [];
  const allTicked = rows.length > 0 && rows.every((s) => selected.includes(s.id));
  const toggle = (id) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const columns = [];
  if (isAdmin)
    columns.push({
      key: 'pick',
      header: (
        <input
          type="checkbox"
          aria-label="Select all students on this page"
          checked={allTicked}
          onChange={() => setSelected(allTicked ? [] : rows.map((s) => s.id))}
        />
      ),
      render: (s) => (
        <input
          type="checkbox"
          aria-label={`Select ${s.name}`}
          checked={selected.includes(s.id)}
          onChange={() => toggle(s.id)}
        />
      ),
    });
  columns.push(
    {
      key: 'adm',
      header: (
        <SortHeader label="Adm. no" field="admissionNo" sort={sort} dir={dir} onSort={onSort} />
      ),
      render: (s) => s.admissionNo,
    },
    {
      key: 'name',
      header: <SortHeader label="Student" field="name" sort={sort} dir={dir} onSort={onSort} />,
      render: (s) => (
        <div>
          <Link className="font-medium text-brand hover:underline" to={`/students/${s.id}`}>
            {s.name}
          </Link>
          {s.fatherName && <p className="text-xs text-ink-muted">S/o {s.fatherName}</p>}
        </div>
      ),
    },
    {
      key: 'class',
      header: <SortHeader label="Class" field="class" sort={sort} dir={dir} onSort={onSort} />,
      render: (s) => classLabel(s.classKey),
    },
    {
      key: 'section',
      header: <SortHeader label="Section" field="section" sort={sort} dir={dir} onSort={onSort} />,
      render: (s) => s.section ?? '-',
    },
    { key: 'contact', header: 'Contact', render: (s) => s.contactNo ?? '-' },
    {
      key: 'address',
      header: <SortHeader label="Address" field="address" sort={sort} dir={dir} onSort={onSort} />,
      render: (s) => s.address ?? '-',
    },
    {
      key: 'tags',
      header: 'Tags',
      render: (s) => (
        <div className="flex flex-wrap gap-1">
          {s.isRTE && <Badge tone="info">RTE</Badge>}
          {s.usesTransport && <Badge>Bus</Badge>}
          {s.isNewAdmission && <Badge tone="warning">New</Badge>}
        </div>
      ),
    },
    {
      key: 'status',
      header: <SortHeader label="Status" field="status" sort={sort} dir={dir} onSort={onSort} />,
      render: (s) =>
        s.status === 'active' ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="danger">
            {s.inactiveReason === 'left_with_tc' ? 'Left with TC' : 'Left without TC'}
          </Badge>
        ),
    },
  );
  if (isAdmin)
    columns.push({
      key: 'edit',
      header: '',
      render: (s) => (
        <Link className="text-brand hover:underline" to={`/students/${s.id}/edit`}>
          Edit
        </Link>
      ),
    });

  const sectionOptions = [{ value: '', label: 'All sections' }].concat(
    (data?.sections ?? []).map((s) => ({ value: s, label: s })),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink">Students</h1>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && selected.length > 0 && (
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>
              Delete selected ({selected.length})
            </Button>
          )}
          {isAdmin && (
            <Link
              to="/students/new"
              className="inline-flex min-h-10 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark"
            >
              Add student
            </Link>
          )}
        </div>
      </div>

      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Active students" value={data.counts.active} />
          <StatCard label="Inactive students" value={data.counts.inactive} />
          <StatCard
            label="Grand total"
            value={data.counts.total}
            caption={classKey || section ? 'For the selected class / section' : 'Whole school'}
          />
        </div>
      )}

      <FilterBar>
        <Input
          label="Search"
          placeholder="Name, father, mobile, admission no, address"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          label="Class"
          options={CLASS_OPTIONS}
          value={classKey}
          onChange={(e) => {
            change(setClassKey)(e.target.value);
            setSection('');
          }}
        />
        <Select
          label="Section"
          options={sectionOptions}
          value={section}
          onChange={(e) => change(setSection)(e.target.value)}
        />
        <Select
          label="Status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(e) => change(setStatus)(e.target.value)}
        />
      </FilterBar>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        loading={query.isPending}
        error={query.isError ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        emptyTitle="No students found"
        emptyDescription={
          q || classKey || section || status !== 'active'
            ? 'Try a different search or filter.'
            : 'Students will appear here once they are added.'
        }
      />
      {data && data.total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data.total}
          onPageChange={(p) => {
            setPage(p);
            setSelected([]);
          }}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
            setSelected([]);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmOpen}
        tone="danger"
        title={`Permanently delete ${selected.length} students?`}
        description="This cannot be undone. The students and their unpaid fee plan are removed for good and their scholar numbers become free again. The audit log keeps a record of who deleted them and why."
        confirmLabel="Delete students"
        typeToConfirm="DELETE"
        requireReason
        onReasonChange={setReason}
        loading={bulkDelete.isPending}
        onConfirm={() => bulkDelete.mutate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
