import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CLASSES, classLabel } from '@erp/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Badge, FilterBar, Input, Pagination, Select, Table } from '../components/ui';

const CLASS_OPTIONS = [{ value: '', label: 'All classes' }].concat(
  CLASSES.map((c) => ({ value: c.key, label: c.label })),
);
const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

/** Students list: server-side search, filters and pages (stays fast with 1,500+ students). */
export function Students() {
  const { role } = useAuth();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [classKey, setClassKey] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Wait until typing pauses so we do not call the server on every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const query = useQuery({
    queryKey: ['students', { q, classKey, status, page, pageSize }],
    queryFn: () => {
      const params = new URLSearchParams({ page, pageSize });
      if (q) params.set('q', q);
      if (classKey) params.set('classKey', classKey);
      if (status) params.set('status', status);
      return api(`/api/students?${params}`);
    },
    placeholderData: keepPreviousData,
  });

  const columns = [
    { key: 'adm', header: 'Adm. no', render: (s) => s.admissionNo },
    {
      key: 'name',
      header: 'Student',
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
      header: 'Class',
      render: (s) => `${classLabel(s.classKey)}${s.section ? ` - ${s.section}` : ''}`,
    },
    { key: 'contact', header: 'Contact', render: (s) => s.contactNo ?? '-' },
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
      header: 'Status',
      render: (s) =>
        s.status === 'active' ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="danger">
            {s.inactiveReason === 'left_with_tc' ? 'Left with TC' : 'Left without TC'}
          </Badge>
        ),
    },
  ];
  if (role === 'admin')
    columns.push({
      key: 'edit',
      header: '',
      render: (s) => (
        <Link className="text-brand hover:underline" to={`/students/${s.id}/edit`}>
          Edit
        </Link>
      ),
    });

  const data = query.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink">Students</h1>
        {role === 'admin' && (
          <Link
            to="/students/new"
            className="inline-flex min-h-10 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark"
          >
            Add student
          </Link>
        )}
      </div>
      <FilterBar>
        <Input
          label="Search"
          placeholder="Name, admission no or mobile"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          label="Class"
          options={CLASS_OPTIONS}
          value={classKey}
          onChange={(e) => {
            setClassKey(e.target.value);
            setPage(1);
          }}
        />
        <Select
          label="Status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        />
      </FilterBar>
      <Table
        columns={columns}
        rows={data?.rows}
        rowKey={(s) => s.id}
        loading={query.isPending}
        error={query.isError ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        emptyTitle="No students found"
        emptyDescription={
          q || classKey || status !== 'active'
            ? 'Try a different search or filter.'
            : 'Students will appear here once they are added.'
        }
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
    </div>
  );
}
