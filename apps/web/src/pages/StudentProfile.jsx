import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { classLabel, formatINR, getFinancialYear } from '@erp/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Spinner,
  StatCard,
  useToast,
} from '../components/ui';

const HEAD_LABEL = { tuition: 'Tuition', transport: 'Bus', admission: 'Admission', form: 'Form' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function periodLabel(period) {
  if (period === 'once') return 'One time';
  const [y, m] = period.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}
const Row = ({ label, value }) => (
  <div>
    <dt className="text-xs text-ink-muted">{label}</dt>
    <dd className="text-sm text-ink">{value || '-'}</dd>
  </div>
);

/** One student: details + this year's fee ledger. Admin can post the year's fee plan. */
export function StudentProfile() {
  const { id } = useParams();
  const { role } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const fy = getFinancialYear(new Date());

  const student = useQuery({
    queryKey: ['student', id],
    queryFn: () => api(`/api/students/${id}`),
  });
  const ledger = useQuery({
    queryKey: ['ledger', id, fy],
    queryFn: () => api(`/api/students/${id}/ledger?fy=${fy}`),
  });
  const postPlan = useMutation({
    mutationFn: () => api(`/api/students/${id}/fee-plan`, { method: 'POST', body: { fy } }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['ledger', id] });
      notify(
        res.newlyAdded > 0
          ? `Fee plan posted: ${res.newlyAdded} charges added.`
          : 'Fee plan was already posted. Nothing changed.',
        'success',
      );
    },
    onError: (e) => notify(e.message, 'error'),
  });

  if (student.isPending) return <Spinner label="Loading student" />;
  if (student.isError)
    return <ErrorState message={student.error.message} onRetry={() => void student.refetch()} />;
  const s = student.data;
  const t = ledger.data?.totals;

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/students" className="text-sm text-brand hover:underline">
            Back to students
          </Link>
          <h1 className="text-2xl font-semibold text-ink">{s.name}</h1>
          <p className="text-sm text-ink-muted">
            Adm. no {s.admissionNo} | {classLabel(s.classKey)}
            {s.section ? ` - ${s.section}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {s.status === 'active' ? (
            <Badge tone="success">Active</Badge>
          ) : (
            <Badge tone="danger">
              {s.inactiveReason === 'left_with_tc' ? 'Left with TC' : 'Left without TC'}
            </Badge>
          )}
          {s.isRTE && <Badge tone="info">RTE</Badge>}
          {s.usesTransport && <Badge>Bus: {s.village}</Badge>}
          {role === 'admin' && (
            <Link
              to={`/students/${id}/edit`}
              className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm"
            >
              Edit
            </Link>
          )}
        </div>
      </div>

      <Card title="Details">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Row label="Father" value={s.fatherName} />
          <Row label="Mother" value={s.motherName} />
          <Row label="Contact" value={s.contactNo} />
          <Row label="Gender" value={s.gender} />
          <Row label="Date of birth" value={s.dateOfBirth?.slice(0, 10)} />
          <Row label="Address" value={s.address} />
          <Row label="Category" value={s.category} />
          <Row label="Samagra ID" value={s.samagraId} />
          <Row label="Form no" value={s.formNo} />
        </dl>
      </Card>

      <Card
        title={`Fee ledger ${fy}`}
        actions={
          role === 'admin' &&
          s.status === 'active' && (
            <Button loading={postPlan.isPending} onClick={() => postPlan.mutate()}>
              Post fee plan
            </Button>
          )
        }
      >
        {ledger.isPending && <Spinner label="Loading ledger" />}
        {ledger.isError && (
          <ErrorState message={ledger.error.message} onRetry={() => void ledger.refetch()} />
        )}
        {ledger.data && ledger.data.instalments.length === 0 && (
          <EmptyState
            title="No fee plan yet"
            description={
              role === 'admin'
                ? `Press "Post fee plan" to add the ${fy} charges for this student.`
                : `The ${fy} fee plan has not been posted for this student yet.`
            }
          />
        )}
        {ledger.data && ledger.data.instalments.length > 0 && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <StatCard label="Total billed" value={formatINR(t.billed)} />
              <StatCard label="Paid" value={formatINR(t.paid)} />
              <StatCard label="Due now" value={formatINR(t.dueNow)} />
              <StatCard
                label="Overdue + late fee"
                value={formatINR(t.overdue + t.lateFee)}
                caption={`Overdue ${formatINR(t.overdue)} + late fee ${formatINR(t.lateFee)}`}
              />
            </div>
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-app text-xs uppercase text-ink-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Month</th>
                    <th className="px-4 py-3 font-medium">Due date</th>
                    <th className="px-4 py-3 font-medium">Charges</th>
                    <th className="px-4 py-3 text-right font-medium">Due</th>
                    <th className="px-4 py-3 text-right font-medium">Late fee</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ledger.data.instalments.map((i) => (
                    <tr key={`${i.dueDate}${i.period}`}>
                      <td className="px-4 py-3">{periodLabel(i.period)}</td>
                      <td className="px-4 py-3">{i.dueDate}</td>
                      <td className="px-4 py-3">
                        {i.items
                          .map((x) => `${HEAD_LABEL[x.head]} ${formatINR(x.amount)}`)
                          .join(', ')}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatINR(i.due)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {i.lateFee > 0 ? formatINR(i.lateFee) : '-'}
                      </td>
                      <td className="px-4 py-3">
                        {i.due === 0 ? (
                          <Badge tone="success">Paid</Badge>
                        ) : i.isOverdue ? (
                          <Badge tone="danger">Overdue</Badge>
                        ) : i.isDue ? (
                          <Badge tone="warning">Due</Badge>
                        ) : (
                          <Badge>Upcoming</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
