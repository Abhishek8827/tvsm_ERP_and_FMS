import { useMutation } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '../api/client';
import { Badge, Button, Card, EmptyState, StatCard, useToast } from '../components/ui';

/**
 * Admin: import OLD fees (unpaid before this system started) from an Excel sheet.
 * Step 1 "Check file" saves nothing and lists every problem row.
 * Step 2 "Import" saves the good rows. Rows that already exist are skipped, so it is safe to retry.
 */
export function ImportOldFees() {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);

  const send = useMutation({
    mutationFn: ({ commit }) =>
      api(`/api/old-dues/import?commit=${commit}`, { method: 'POST', file }),
    onSuccess: async (res) => {
      setResult(res);
      if (res.committed) {
        await queryClient.invalidateQueries({ queryKey: ['ledger'] });
        notify(`${res.created} old fee entries imported.`, 'success');
      }
    },
    onError: (e) => notify(e.message, 'error'),
  });

  async function downloadTemplate() {
    try {
      const blob = await api('/api/old-dues/template', { blob: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'old-fees-import-template.xlsx';
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
      <h1 className="text-2xl font-semibold text-ink">Import old fees</h1>

      <Card title="1. Get the template">
        <p className="text-sm text-ink-muted">
          Old fees are amounts a student still owed BEFORE this system started. One row per student:
          SCH. (scholar number), OLD SCHOOL FEES and OLD TRANSPORT FEES in rupees. They are saved
          for the current financial year and must be paid before any new fee. A student who already
          has old fees imported is skipped, so the same file can be imported again safely.
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
            <StatCard
              label="Skipped"
              value={result.skipped}
              caption="Problems or already imported"
            />
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
                Import {result.ready} old fee entries
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
