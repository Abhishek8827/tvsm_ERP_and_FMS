import { useMutation } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Badge, Button, Card, EmptyState, StatCard, useToast } from '../components/ui';

/**
 * Admin: import students from the school's Excel sheet.
 * Step 1 "Check file" saves nothing and lists every problem row.
 * Step 2 "Import" saves the good rows. Rows that already exist are skipped, so it is safe to retry.
 */
export function ImportStudents() {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);

  const send = useMutation({
    mutationFn: ({ commit }) =>
      api(`/api/students/import?commit=${commit}`, { method: 'POST', file }),
    onSuccess: async (res) => {
      setResult(res);
      if (res.committed) {
        await queryClient.invalidateQueries({ queryKey: ['students'] });
        notify(`${res.created} students imported.`, 'success');
      }
    },
    onError: (e) => notify(e.message, 'error'),
  });

  async function downloadTemplate() {
    try {
      const blob = await api('/api/students/import-template', { blob: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'student-import-template.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify(e.message, 'error');
    }
  }

  function onPick(e) {
    setFile(e.target.files?.[0] ?? null);
    setResult(null);
    send.reset();
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink">Import students</h1>
        <Link className="text-sm text-brand hover:underline" to="/data-import">
          ← Data import
        </Link>
      </div>

      <Card title="1. Get the template">
        <p className="text-sm text-ink-muted">
          Use the school's column names. SCH. is the admission number. For bus students put the
          village in ADDRESS and TRANSPORT = YES. REMARK = RTE marks an RTE student. INACTIVE
          students need INACTIVE STATUS as "with TC" or "without TC". AGE is not needed.
        </p>
        <div className="mt-3">
          <Button variant="secondary" onClick={() => void downloadTemplate()}>
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
            onChange={onPick}
            className="text-sm"
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
            <StatCard label="Skipped" value={result.skipped} caption="Problems or already exist" />
          </div>

          {result.feePlan && (
            <div className="mt-4 rounded-lg border border-line bg-app p-3 text-sm">
              <p>
                Fees for {result.feePlan.fy} were posted for {result.feePlan.posted} of{' '}
                {result.feePlan.students} students.
              </p>
              {result.feePlan.skipped.length > 0 && (
                <>
                  <p className="mt-2 font-medium text-warning">
                    {result.feePlan.skipped.length} students have no fees posted yet:
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-ink-muted">
                    {result.feePlan.skipped.slice(0, 10).map((x) => (
                      <li key={x.admissionNo}>
                        SCH. {x.admissionNo} {x.name}: {x.reason}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-ink-muted">
                    Fix the fee chart, then use "Apply fees" in Fees Database.
                  </p>
                </>
              )}
            </div>
          )}

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
          {result.skipped > result.errors.length && (
            <p className="mt-2 text-xs text-ink-muted">
              Showing the first {result.errors.length} problems.
            </p>
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
                Import {result.ready} students
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
