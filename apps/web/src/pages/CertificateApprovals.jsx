import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatINR } from "@erp/shared";
import { api } from "../api/client";
import { Badge, Card, Table } from "../components/ui";
import { errorText } from "../lib/rupees";

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const day = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        timeZone: "Asia/Kolkata",
      })
    : "-";

/**
 * Principal's inbox: Transfer Certificate and Bonafide requests the Admin has sent. The
 * certificate is read and decided on the TC & Bonafide page (the "Review" button there).
 */
export function PendingCertificates() {
  const query = useQuery({
    queryKey: ["cert-requests", "pending-approvals"],
    queryFn: () => api("/api/certificate-requests?status=pending&pageSize=50"),
    // Stop asking again and again while the server is failing; "Try again" resumes it.
    refetchInterval: (q) => (q.state.status === "error" ? false : 60_000),
  });
  const columns = [
    {
      key: "kind",
      header: "Type",
      render: (r) => (
        <Badge tone="info">
          {r.kind === "tc" ? "Transfer Certificate" : "Bonafide"}
        </Badge>
      ),
    },
    {
      key: "stu",
      header: "Student",
      render: (r) => `${r.studentName} (${r.admissionNo})`,
    },
    {
      key: "why",
      header: "Reason / purpose",
      render: (r) =>
        (r.kind === "tc" ? r.preview?.entered?.reason : r.preview?.purpose) ??
        "-",
    },
    {
      key: "dues",
      header: "",
      render: (r) =>
        r.duesOverride ? (
          <Badge tone="warning">
            Dues pending {money(r.duesOverride.duePaise)}
          </Badge>
        ) : null,
    },
    {
      key: "by",
      header: "Asked by",
      render: (r) => (
        <span>
          {r.requestedByName ?? "-"}
          <span className="block text-xs text-ink-muted">
            {day(r.createdAt)}
          </span>
        </span>
      ),
    },
    {
      key: "open",
      header: "",
      render: (r) => (
        <Link
          className="text-brand hover:underline"
          to={`/tc-bonafide?tab=${r.kind}`}
        >
          Review and decide
        </Link>
      ),
    },
  ];
  return (
    <Card
      title="Transfer Certificate and Bonafide requests"
      subtitle="Open a request to read the certificate, then approve or reject it. The number is given only when you approve."
    >
      <Table
        columns={columns}
        rows={query.data?.rows ?? (query.isPending ? undefined : [])}
        rowKey={(r) => r.id}
        loading={query.isPending}
        error={query.isError ? errorText(query.error) : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No certificate requests waiting"
      />
    </Card>
  );
}
