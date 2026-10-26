import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { classLabel, formatINR, todayIst } from "@erp/shared";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  FilterBar,
  Input,
  Pagination,
  Select,
  StatCard,
  Table,
  useToast,
} from "../components/ui";

const KINDS = [
  { value: "", label: "School + Transport" },
  { value: "school", label: "School fees" },
  { value: "transport", label: "Transport fees" },
];
const MODES = [
  { value: "", label: "All modes" },
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "qr", label: "QR" },
];
const STATUSES = [
  { value: "", label: "All receipts" },
  { value: "valid", label: "Not cancelled" },
  { value: "cancelled", label: "Cancelled" },
];
const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const dateTime = (iso) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * All receipts (Cashier "Receipts" and Admin "Fees & Receipts"): filters, totals of the receipts
 * that still count, pages from the server. The Admin can also export the filtered list to Excel.
 */
export function Receipts() {
  const { role } = useAuth();
  const { notify } = useToast();
  const today = todayIst();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [kind, setKind] = useState("");
  const [mode, setMode] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const filters = () => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (kind) p.set("kind", kind);
    if (mode) p.set("mode", mode);
    if (status) p.set("status", status);
    if (q) p.set("q", q);
    return p;
  };
  const query = useQuery({
    queryKey: ["receipts", { from, to, kind, mode, status, q, page, pageSize }],
    queryFn: () => {
      const p = filters();
      p.set("page", page);
      p.set("pageSize", pageSize);
      return api(`/api/receipts?${p}`);
    },
    placeholderData: keepPreviousData,
  });

  const reset = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };

  async function exportExcel() {
    setExporting(true);
    try {
      const blob = await api(`/api/receipts/export?${filters()}`, {
        blob: true,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `receipts-${from || "all"}-to-${to || "all"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify(
        `${e.message}${e.requestId ? ` (ref ${e.requestId})` : ""}`,
        "error",
      );
    } finally {
      setExporting(false);
    }
  }

  const data = query.data;
  const t = data?.totals;
  const columns = [
    {
      key: "no",
      header: "Receipt no.",
      render: (r) => (
        <Link
          className="font-medium text-brand hover:underline"
          to={`/receipts/${r.id}`}
        >
          {r.number}
        </Link>
      ),
    },
    { key: "date", header: "Date", render: (r) => dateTime(r.issuedAt) },
    {
      key: "student",
      header: "Student",
      render: (r) => (
        <div>
          <p className="font-medium text-ink">{r.student.name}</p>
          <p className="text-xs text-ink-muted">
            Sch. {r.student.admissionNo} · {classLabel(r.student.classKey)}
          </p>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Type",
      render: (r) => (r.kind === "school" ? "School" : "Transport"),
    },
    { key: "month", header: "Month", render: (r) => r.monthLabel || "-" },
    { key: "mode", header: "Mode", render: (r) => r.mode.toUpperCase() },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (r) => money(r.totalPaise),
    },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        r.status === "cancelled" ? (
          <Badge tone="danger">Cancelled</Badge>
        ) : r.status === "cancel_requested" ? (
          <Badge tone="warning">Cancel requested</Badge>
        ) : r.rejection ? (
          <span>
            <Badge tone="success">Valid</Badge>
            <span className="mt-1 block text-xs text-danger">
              Cancel rejected: {r.rejection.reason || "no reason written"}
            </span>
          </span>
        ) : (
          <Badge tone="success">Valid</Badge>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink">
          {role === "admin" ? "Fees & Receipts" : "Receipts"}
        </h1>
        {role === "admin" && (
          <Button
            variant="secondary"
            loading={exporting}
            onClick={() => void exportExcel()}
          >
            Export to Excel
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Collected"
          value={money(t?.paise)}
          caption={`${t?.count ?? 0} receipts`}
        />
        <StatCard label="School fees" value={money(t?.byKind?.school)} />
        <StatCard label="Transport fees" value={money(t?.byKind?.transport)} />
        <StatCard
          label="Cash / UPI / QR"
          value={`${money(t?.byMode?.cash)} / ${money(t?.byMode?.upi)} / ${money(t?.byMode?.qr)}`}
        />
      </div>

      <FilterBar>
        <Input
          label="From"
          type="date"
          value={from}
          onChange={reset(setFrom)}
        />
        <Input label="To" type="date" value={to} onChange={reset(setTo)} />
        <Select
          label="Type"
          options={KINDS}
          value={kind}
          onChange={reset(setKind)}
        />
        <Select
          label="Mode"
          options={MODES}
          value={mode}
          onChange={reset(setMode)}
        />
        <Select
          label="Status"
          options={STATUSES}
          value={status}
          onChange={reset(setStatus)}
        />
        <Input
          label="Search"
          placeholder="Receipt no., name or scholar no."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </FilterBar>

      <Table
        columns={columns}
        rows={data?.rows}
        rowKey={(r) => r.id}
        loading={query.isPending}
        error={query.isError ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        emptyTitle="No receipts for these filters"
        emptyDescription="Change the dates or filters."
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
