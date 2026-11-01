import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api } from "../api/client";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  Spinner,
  useToast,
} from "../components/ui";
import { errorText } from "../lib/rupees";
import { istStamp, saveBlob } from "../lib/saveFile";

export const RESTORE_PHRASE = "RESTORE BACKUP";
const when = (d) =>
  new Date(d).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

/** Admin: system-wide settings. Today that is Backup & Restore. */
export function SystemSettings() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">System Settings</h1>
      </div>
      <BackupCard />
      <RestoreCard />
    </div>
  );
}

function BackupCard() {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["backup", "status"],
    queryFn: () => api("/api/backup/status"),
  });
  const download = useMutation({
    mutationFn: () => api("/api/backup/download", { blob: true }),
    onSuccess: async (blob) => {
      saveBlob(blob, `tvsm-erp-backup-${istStamp()}.json`);
      await queryClient.invalidateQueries({ queryKey: ["backup"] });
      notify("Backup downloaded. Keep the file somewhere safe.", "success");
    },
    onError: (e) => notify(errorText(e), "error"),
  });
  const s = status.data;
  return (
    <Card
      title="Backup"
      subtitle="One file with all the school's data. It is not password-protected, so keep it safe."
      actions={
        s &&
        (s.reminder ? (
          <Badge tone="warning">Backup due</Badge>
        ) : (
          <Badge tone="success">Up to date</Badge>
        ))
      }
    >
      {status.isPending && <Spinner label="Checking the last backup" />}
      {status.isError && (
        <ErrorState
          message={errorText(status.error)}
          onRetry={() => void status.refetch()}
        />
      )}
      {s && (
        <p className="mb-3 text-sm text-ink-muted">
          {s.lastBackupAt
            ? `Last backup: ${when(s.lastBackupAt)} (${s.daysSince} day${s.daysSince === 1 ? "" : "s"} ago).`
            : "No backup has been taken yet."}{" "}
          A reminder shows after {s.reminderDays} days.
        </p>
      )}
      <Button loading={download.isPending} onClick={() => download.mutate()}>
        Download backup
      </Button>
    </Card>
  );
}

function RestoreCard() {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [phrase, setPhrase] = useState("");
  const [result, setResult] = useState(null);
  const restore = useMutation({
    mutationFn: async () => {
      // 1. Safety copy of the CURRENT data goes to Downloads first, automatically.
      const safety = await api("/api/backup/download", { blob: true });
      saveBlob(safety, `safety-backup-before-restore-${istStamp()}.json`);
      // 2. Then the chosen file is restored: only missing records are added.
      return api(`/api/backup/restore?confirm=${encodeURIComponent(phrase)}`, {
        method: "POST",
        file,
      });
    },
    onSuccess: async (data) => {
      setResult(data);
      setFile(null);
      setPhrase("");
      if (input.current) input.current.value = "";
      await queryClient.invalidateQueries();
      notify("Restore finished.", "success");
    },
    onError: (e) => notify(errorText(e), "error"),
  });
  const ready = !!file && phrase === RESTORE_PHRASE;
  return (
    <Card
      title="Restore"
      subtitle="Adds only what is missing. Records already in the system are never changed or replaced."
    >
      <div className="flex max-w-md flex-col gap-3">
        <div>
          <label
            htmlFor="backup-file"
            className="mb-1 block text-sm font-medium text-ink"
          >
            Backup file
          </label>
          <input
            id="backup-file"
            ref={input}
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
            }}
            className="block w-full text-sm"
          />
        </div>
        <Input
          label={`Type ${RESTORE_PHRASE} to confirm`}
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          autoComplete="off"
        />
        <p className="text-sm text-ink-muted">
          Before restoring, a safety copy of today's data is downloaded
          automatically.
        </p>
        <div>
          <Button
            disabled={!ready}
            loading={restore.isPending}
            onClick={() => restore.mutate()}
          >
            Restore from file
          </Button>
        </div>
      </div>
      {result && <RestoreResult result={result} />}
    </Card>
  );
}

function RestoreResult({ result }) {
  const rows = Object.entries(result.collections).filter(
    ([, r]) => r.inFile > 0,
  );
  return (
    <div className="mt-4 text-sm" role="status">
      <p className="font-medium text-ink">
        {result.totals.added} record{result.totals.added === 1 ? "" : "s"}{" "}
        added, {result.totals.skipped} already there or clashing (left as they
        are).
      </p>
      {rows.length > 0 && (
        <table className="mt-2 w-full max-w-md text-left">
          <thead className="text-ink-muted">
            <tr>
              <th className="py-1 pr-4 font-medium">Data</th>
              <th className="py-1 pr-4 text-right font-medium">In file</th>
              <th className="py-1 pr-4 text-right font-medium">Added</th>
              <th className="py-1 text-right font-medium">Skipped</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, r]) => (
              <tr key={name} className="border-t border-line">
                <td className="py-1 pr-4">{name}</td>
                <td className="py-1 pr-4 text-right">{r.inFile}</td>
                <td className="py-1 pr-4 text-right">{r.added}</td>
                <td className="py-1 text-right">{r.skipped}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result.unknown.length > 0 && (
        <p className="mt-2 text-warning">
          Ignored (unknown data): {result.unknown.join(", ")}
        </p>
      )}
    </div>
  );
}
