import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { classLabel, getFinancialYear, paiseToRupeesString, rupeesToPaise } from '@erp/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, EmptyState, ErrorState, Input, Spinner, useToast } from '../components/ui';

/**
 * Admin: edit the fee chart of the current financial year.
 * Amounts are typed in rupees and sent as integer paise (rule 1). Changing the chart does NOT
 * change fees already posted to students: charges copy the amount when they are posted.
 */
export function FeeStructure() {
  const fy = getFinancialYear(new Date());
  const chart = useQuery({
    queryKey: ['fee-structure', fy],
    // 404 only means "not set up yet": that is a normal state, not an error.
    queryFn: async () => {
      try {
        return await api(`/api/fee-structure/${fy}`);
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },
    retry: false,
  });

  if (chart.isPending) return <Spinner label="Loading fee structure" />;
  if (chart.isError) {
    return <ErrorState message={chart.error.message} onRetry={() => chart.refetch()} />;
  }
  if (chart.data === null) {
    return (
      <EmptyState
        title={`No fee structure for ${fy} yet`}
        description="Run the fee seed once (pnpm --filter @erp/api fees:seed) to load the school's fee chart, then reload this page."
      />
    );
  }

  return <FeeForm fy={fy} initial={chart.data} />;
}

function toForm(d) {
  return {
    classFees: d.classFees.map((c) => ({
      classKey: c.classKey,
      tuition: paiseToRupeesString(c.monthlyTuitionPaise),
      admission: paiseToRupeesString(c.admissionPaise),
    })),
    formFee: paiseToRupeesString(d.formFeePaise),
    lateFee: paiseToRupeesString(d.lateFeePaise),
    dueDay: String(d.dueDay),
    graceDays: String(d.graceDays),
    villages: d.villages.map((v) => ({
      name: v.name,
      amount: paiseToRupeesString(v.monthlyPaise),
    })),
  };
}

function FeeForm({ fy, initial }) {
  // Cashier sees the chart but cannot change it (the server also refuses: Admin only).
  const readOnly = useAuth().role !== 'admin';
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState(() => toForm(initial));
  const save = useMutation({
    mutationFn: (body) => api(`/api/fee-structure/${fy}`, { method: 'PUT', body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fee-structure'] });
      notify('Fee structure saved.', 'success');
    },
    onError: (e) => notify(`${e.message}${e.requestId ? ` (ref ${e.requestId})` : ''}`, 'error'),
  });

  function setRow(list, i, patch) {
    setForm((f) => ({ ...f, [list]: f[list].map((r, n) => (n === i ? { ...r, ...patch } : r)) }));
  }

  function onSubmit(e) {
    e.preventDefault();
    const bad = {};
    const money = (key, value) => {
      try {
        return rupeesToPaise(value);
      } catch {
        bad[key] = 'Enter a valid amount';
        return 0;
      }
    };
    const body = {
      classFees: form.classFees.map((c, i) => ({
        classKey: c.classKey,
        monthlyTuitionPaise: money(`t${i}`, c.tuition),
        admissionPaise: money(`a${i}`, c.admission),
      })),
      formFeePaise: money('form', form.formFee),
      lateFeePaise: money('late', form.lateFee),
      dueDay: Number(form.dueDay),
      graceDays: Number(form.graceDays),
      villages: form.villages
        .filter((v) => v.name.trim())
        .map((v, i) => ({ name: v.name.trim(), monthlyPaise: money(`v${i}`, v.amount) })),
    };
    if (!(body.dueDay >= 1 && body.dueDay <= 28)) bad.dueDay = 'Use 1 to 28';
    if (!(body.graceDays >= 0 && body.graceDays <= 60)) bad.graceDays = 'Use 0 to 60';
    setErrors(bad);
    if (Object.keys(bad).length === 0) save.mutate(body);
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink">Fee structure {fy}</h1>
        {!readOnly && (
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        )}
      </div>
      <p className="text-sm text-ink-muted">
        {readOnly && 'View only. Only the Admin can change the fee structure. '}Amounts are in
        rupees. Fees already posted to students do not change when you edit this chart; only new fee
        plans use the new amounts. Every change is recorded in the audit log.
      </p>

      <fieldset disabled={readOnly} className="flex flex-col gap-4">
        <Card title="Class fees">
          <div className="grid grid-cols-[1fr_1fr_1fr] items-end gap-3">
            <span className="text-xs font-medium uppercase text-ink-muted">Class</span>
            <span className="text-xs font-medium uppercase text-ink-muted">
              Monthly tuition (₹)
            </span>
            <span className="text-xs font-medium uppercase text-ink-muted">Admission fee (₹)</span>
            {form.classFees.map((c, i) => (
              <FragmentRow key={c.classKey}>
                <span className="self-center text-sm text-ink">{classLabel(c.classKey)}</span>
                <Input
                  aria-label={`${classLabel(c.classKey)} monthly tuition`}
                  inputMode="decimal"
                  value={c.tuition}
                  error={errors[`t${i}`]}
                  onChange={(e) => setRow('classFees', i, { tuition: e.target.value })}
                />
                <Input
                  aria-label={`${classLabel(c.classKey)} admission fee`}
                  inputMode="decimal"
                  value={c.admission}
                  error={errors[`a${i}`]}
                  onChange={(e) => setRow('classFees', i, { admission: e.target.value })}
                />
              </FragmentRow>
            ))}
          </div>
        </Card>

        <Card title="Other fees and rules">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Form fee (₹, once)"
              inputMode="decimal"
              value={form.formFee}
              error={errors.form}
              onChange={(e) => setForm({ ...form, formFee: e.target.value })}
            />
            <Input
              label="Late fee (₹, once per overdue month)"
              inputMode="decimal"
              value={form.lateFee}
              error={errors.late}
              onChange={(e) => setForm({ ...form, lateFee: e.target.value })}
            />
            <Input
              label="Due day of month"
              inputMode="numeric"
              value={form.dueDay}
              error={errors.dueDay}
              onChange={(e) => setForm({ ...form, dueDay: e.target.value })}
            />
            <Input
              label="Grace days"
              inputMode="numeric"
              value={form.graceDays}
              error={errors.graceDays}
              onChange={(e) => setForm({ ...form, graceDays: e.target.value })}
            />
          </div>
        </Card>

        <Card title="Bus fee by village (monthly)">
          <div className="flex flex-col gap-2">
            {form.villages.length === 0 && (
              <p className="text-sm text-ink-muted">No villages yet. Add one below.</p>
            )}
            {form.villages.map((v, i) => (
              <div key={i} className="grid grid-cols-[1fr_9rem_auto] items-start gap-2">
                <Input
                  aria-label={`Village ${i + 1} name`}
                  value={v.name}
                  onChange={(e) => setRow('villages', i, { name: e.target.value })}
                />
                <Input
                  aria-label={`${v.name || 'Village'} monthly bus fee`}
                  inputMode="decimal"
                  value={v.amount}
                  error={errors[`v${i}`]}
                  onChange={(e) => setRow('villages', i, { amount: e.target.value })}
                />
                {!readOnly && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setForm({ ...form, villages: form.villages.filter((_, n) => n !== i) })
                    }
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
            {!readOnly && (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setForm({ ...form, villages: [...form.villages, { name: '', amount: '0' }] })
                  }
                >
                  Add village
                </Button>
              </div>
            )}
          </div>
        </Card>
      </fieldset>
    </form>
  );
}

// Lets a row of grid cells be returned from map() without an extra wrapper box.
function FragmentRow({ children }) {
  return <>{children}</>;
}
