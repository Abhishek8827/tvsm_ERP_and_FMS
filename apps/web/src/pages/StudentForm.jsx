import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CLASSES, STREAMS, STREAM_CLASSES } from '@erp/shared';
import { api } from '../api/client';
import { Button, Card, ErrorState, Input, Select, Spinner, useToast } from '../components/ui';

const EMPTY = {
  admissionNo: '',
  name: '',
  fatherName: '',
  motherName: '',
  classKey: 'NURSERY',
  stream: '',
  section: '',
  gender: '',
  dateOfBirth: '',
  contactNo: '',
  address: '',
  category: '',
  caste: '',
  samagraId: '',
  aadhaar: '',
  bankAccount: '',
  ifsc: '',
  formNo: '',
  nationality: '',
  firstAdmissionDate: '',
  firstAdmissionClass: '',
  pen: '',
  aparId: '',
  isNewAdmission: false,
  isRTE: false,
  status: 'active',
  inactiveReason: '',
};
const CLASS_OPTIONS = CLASSES.map((c) => ({ value: c.key, label: c.label }));
const blank = (label) => [{ value: '', label }];

/** Turns the form into what the API accepts: empty boxes are left out. */
function toPayload(form, editing) {
  const out = {};
  for (const [k, v] of Object.entries(form)) {
    if (v === '' || v === null) continue;
    out[k] = v;
  }
  // Editing: fields cleared by the Admin must be sent as empty so they are really cleared.
  if (editing && !form.stream) out.stream = null;
  return out;
}

/** Add / edit one student. Admin only (the API enforces it too). */
export function StudentForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const student = useQuery({
    queryKey: ['student', id],
    enabled: editing,
    queryFn: () => api(`/api/students/${id}`),
  });
  // Start with the loaded student (edit) or a blank form (new).
  if (form === null) {
    if (!editing) setForm(EMPTY);
    else if (student.data) {
      const s = student.data;
      setForm({
        ...EMPTY,
        ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null)),
        dateOfBirth: s.dateOfBirth ? s.dateOfBirth.slice(0, 10) : '',
        firstAdmissionDate: s.firstAdmissionDate ? s.firstAdmissionDate.slice(0, 10) : '',
      });
    }
  }

  if (editing && student.isPending) return <Spinner label="Loading student" />;
  if (editing && student.isError)
    return <ErrorState message={student.error.message} onRetry={() => void student.refetch()} />;
  if (form === null) return <Spinner />;

  const set = (key) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: v }));
  };
  const err = (k) => errors[k];

  async function onSubmit(e) {
    e.preventDefault();
    const missing = {};
    if (!form.admissionNo.trim()) missing.admissionNo = 'Admission number is required';
    if (!form.name.trim()) missing.name = 'Student name is required';
    if (!form.classKey) missing.classKey = 'Choose a class';
    if (Object.keys(missing).length) {
      setErrors(missing);
      setFormError('Please fill the fields marked with *.');
      return;
    }
    setBusy(true);
    setErrors({});
    setFormError('');
    try {
      await api(editing ? `/api/students/${id}` : '/api/students', {
        method: editing ? 'PATCH' : 'POST',
        body: toPayload(form, editing),
      });
      await queryClient.invalidateQueries({ queryKey: ['students'] });
      notify(editing ? 'Student updated.' : 'Student added.', 'success');
      navigate('/students');
    } catch (e2) {
      setErrors(e2.fields ?? {});
      setFormError(e2.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-4xl flex-col gap-4" noValidate>
      <h1 className="text-2xl font-semibold text-ink">
        {editing ? 'Edit student' : 'Add student'}
      </h1>

      <Card title="Basic details">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            required
            label="Admission no (SCH.)"
            value={form.admissionNo}
            onChange={set('admissionNo')}
            error={err('admissionNo')}
          />
          <Input
            required
            label="Student name"
            value={form.name}
            onChange={set('name')}
            error={err('name')}
          />
          <Input
            label="Father's name"
            value={form.fatherName}
            onChange={set('fatherName')}
            error={err('fatherName')}
          />
          <Input
            label="Mother's name"
            value={form.motherName}
            onChange={set('motherName')}
            error={err('motherName')}
          />
          <Select
            required
            label="Class"
            options={CLASS_OPTIONS}
            value={form.classKey}
            onChange={set('classKey')}
            error={err('classKey')}
          />
          <Input
            label="Section"
            value={form.section}
            onChange={set('section')}
            error={err('section')}
          />
          {STREAM_CLASSES.includes(form.classKey) && (
            <Select
              label="Stream"
              options={blank('Choose stream').concat(STREAMS.map((s) => ({ value: s, label: s })))}
              value={form.stream}
              onChange={set('stream')}
              error={err('stream')}
            />
          )}
          <Select
            label="Gender"
            options={blank('Choose').concat(
              ['MALE', 'FEMALE', 'OTHER'].map((g) => ({ value: g, label: g })),
            )}
            value={form.gender}
            onChange={set('gender')}
            error={err('gender')}
          />
          <Input
            label="Date of birth"
            type="date"
            value={form.dateOfBirth}
            onChange={set('dateOfBirth')}
            error={err('dateOfBirth')}
          />
          <Input
            label="Contact no"
            inputMode="numeric"
            maxLength={10}
            value={form.contactNo}
            onChange={set('contactNo')}
            error={err('contactNo')}
          />
          <Input
            label="Address"
            value={form.address}
            onChange={set('address')}
            error={err('address')}
          />
        </div>
      </Card>

      <Card title="Category and IDs">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Category (GEN / OBC / SC / ST)"
            value={form.category}
            onChange={set('category')}
            error={err('category')}
          />
          <Input label="Caste" value={form.caste} onChange={set('caste')} error={err('caste')} />
          <Input
            label="Samagra ID"
            value={form.samagraId}
            onChange={set('samagraId')}
            error={err('samagraId')}
          />
          <Input
            label="Nationality (printed on the TC)"
            placeholder="Indian"
            value={form.nationality}
            onChange={set('nationality')}
            error={err('nationality')}
          />
          <Input
            label="Date of first admission"
            type="date"
            value={form.firstAdmissionDate}
            onChange={set('firstAdmissionDate')}
            error={err('firstAdmissionDate')}
          />
          <Select
            label="Class at first admission"
            options={blank('Choose').concat(CLASS_OPTIONS)}
            value={form.firstAdmissionClass}
            onChange={set('firstAdmissionClass')}
            error={err('firstAdmissionClass')}
          />
          <Input label="PEN" value={form.pen} onChange={set('pen')} error={err('pen')} />
          <Input
            label="APAAR ID"
            value={form.aparId}
            onChange={set('aparId')}
            error={err('aparId')}
          />
          <Input
            label="Form no"
            value={form.formNo}
            onChange={set('formNo')}
            error={err('formNo')}
          />
          <Input
            label="Aadhaar (12 digits)"
            inputMode="numeric"
            maxLength={12}
            value={form.aadhaar}
            onChange={set('aadhaar')}
            error={err('aadhaar')}
          />
          <Input
            label="Bank account"
            value={form.bankAccount}
            onChange={set('bankAccount')}
            error={err('bankAccount')}
          />
          <Input label="IFSC" value={form.ifsc} onChange={set('ifsc')} error={err('ifsc')} />
        </div>
      </Card>

      <Card title="Fees">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isNewAdmission} onChange={set('isNewAdmission')} />
            New admission (admission fee will be charged)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isRTE} onChange={set('isRTE')} />
            RTE student
          </label>
          <p className="text-xs text-ink-muted sm:col-span-2">
            School bus: enter the student in the Transport module (village comes from the address).
          </p>
        </div>
      </Card>

      <Card title="Status">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Status"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            value={form.status}
            onChange={set('status')}
          />
          {form.status === 'inactive' && (
            <Select
              label="Why inactive?"
              options={blank('Choose').concat([
                { value: 'left_with_tc', label: 'Left with TC' },
                { value: 'left_without_tc', label: 'Left without TC' },
              ])}
              value={form.inactiveReason}
              onChange={set('inactiveReason')}
              error={err('inactiveReason')}
            />
          )}
        </div>
      </Card>

      {formError && (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          {editing ? 'Save changes' : 'Add student'}
        </Button>
        <Link
          to="/students"
          className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}