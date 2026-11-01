import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";

/** Admin only: a yellow line when no backup was taken for 7 days (or ever). Nothing when fine. */
export function BackupReminder() {
  const q = useQuery({
    queryKey: ["backup", "status"],
    queryFn: () => api("/api/backup/status"),
    retry: false,
  });
  if (!q.data?.reminder) return null;
  const { daysSince } = q.data;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink"
    >
      <span>
        {daysSince === null
          ? "No backup has been taken yet."
          : `The last backup was ${daysSince} days ago.`}{" "}
        Take one now so the school's records are safe.
      </span>
      <Link
        to="/system-settings"
        className="font-semibold text-brand underline"
      >
        Open Backup &amp; Restore
      </Link>
    </div>
  );
}
