import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { errorText } from "../lib/rupees";
import { Badge, Button, useToast } from "./ui";

const LOOK = {
  queued: ["info", "Sending on WhatsApp..."],
  sent: ["success", "Sent on WhatsApp"],
  failed: ["danger", "WhatsApp not sent"],
  skipped: ["warning", "WhatsApp not sent"],
};

/**
 * Shows whether the WhatsApp notice for a receipt / Transfer Certificate went out, and lets the
 * allowed roles press Retry. "Sent" means WhatsApp accepted the message (delivery is not tracked).
 * Shows nothing at all when WhatsApp is not set up for the school.
 * `waitingText` is shown when no message exists yet (a TC before its first original print).
 */
export function WhatsappStatus({ kind, refId, canRetry, waitingText }) {
  const qc = useQueryClient();
  const { notify } = useToast();
  const key = ["whatsapp", kind, refId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api(`/api/whatsapp/${kind}/${refId}`),
    // A new receipt is sent in the background: look a few times, then stop.
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d?.configured) return false;
      if (d.message?.status === "queued") return 3000;
      return !d.message && !waitingText && query.state.dataUpdateCount < 5
        ? 3000
        : false;
    },
  });
  const retry = useMutation({
    mutationFn: () =>
      api(`/api/whatsapp/${kind}/${refId}/retry`, { method: "POST" }),
    onSuccess: (d) => {
      qc.setQueryData(key, d);
      notify(
        d.message?.status === "sent"
          ? "WhatsApp message sent."
          : "WhatsApp could not send it.",
        d.message?.status === "sent" ? "success" : "error",
      );
    },
    onError: (e) => notify(errorText(e), "error"),
  });

  if (q.isLoading || !q.data?.configured) return null;
  if (q.isError) return null;
  const m = q.data.message;
  if (!m) {
    return waitingText ? (
      <p className="no-print text-sm text-ink-muted">{waitingText}</p>
    ) : null;
  }
  const [tone, label] = LOOK[m.status] ?? LOOK.failed;
  return (
    <div
      role="status"
      className="no-print flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-3 text-sm"
    >
      <Badge tone={tone}>{label}</Badge>
      {m.to && <span className="text-ink-muted">{m.to}</span>}
      {m.status === "skipped" && (
        <span className="text-ink-muted">
          {m.error ?? "No valid mobile number."} Correct the number on the
          student record, then Retry.
        </span>
      )}
      {m.status === "failed" && m.error && (
        <span className="text-ink-muted">{m.error}</span>
      )}
      {canRetry && (m.status === "failed" || m.status === "skipped") && (
        <Button
          variant="secondary"
          loading={retry.isPending}
          onClick={() => retry.mutate()}
        >
          Retry WhatsApp
        </Button>
      )}
    </div>
  );
}
