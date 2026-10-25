import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatINR } from "@erp/shared";
import { api } from "../api/client";
import {
  Badge,
  Button,
  FilterBar,
  Input,
  Pagination,
  Select,
  Table,
  useToast,
} from "../components/ui";
import { errorText } from "../lib/rupees";

const label = (s) => String(s ?? "").replace(/_/g, " ");
const stamp = (at) =>
  new Date(at).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const show = (k, v) => {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "number" && /Paise$/.test(k))
    return formatINR(v, { hideZeroPaise: true });
  return typeof v === "object" ? JSON.stringify(v) : String(v);
};
/** "old → new" for the keys that changed; a created record just lists its values. */
export function changeText(oldValue, newValue) {
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  if (isObj(newValue) && isObj(oldValue)) {
    const keys = Object.keys({ ...oldValue, ...newValue }).filter(
      (k) => JSON.stringify(oldValue[k]) !== JSON.stringify(newValue[k]),
    );
    return keys
      .slice(0, 4)
      .map(
        (k) => `${label(k)}: ${show(k, oldValue[k])} → ${show(k, newValue[k])}`,
      )
      .join("; ");
  }
  if (isObj(newValue))
    return Object.keys(newValue)
      .slice(0, 4)
      .map((k) => `${label(k)}: ${show(k, newValue[k])}`)
      .join("; ");
  if (newValue !== null && newValue !== undefined) return show("", newValue);
  return "";
}

const TONE = {
  reject: "danger",
  cancel: "danger",
  override: "warning",
  delete: "danger",
};

/** Append-only audit log: look, filter, export. There is nothing here that can edit an entry. */
export function AuditLog() {
  const { notify } = useToast();
  const [filters, setFilters] = useState({
    userId: "",
    action: "",
    entity: "",
    from: "",
    to: "",
  });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const set = (k) => (e) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
  };
  const options = useQuery({
    queryKey: ["audit-options"],
    staleTime: 60_000,
    queryFn: () => api("/api/audit-log/options"),
  });
  const qs = (extra = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({
      ...filters,
      q: search.trim(),
      ...extra,
    }))
      if (v !== "" && v !== undefined) p.set(k, v);
    return p;
  };
  const badRange = filters.from && filters.to && filters.from > filters.to;
  const query = useQuery({
    queryKey: ["audit-log", filters, search.trim(), page, pageSize],
    enabled: !badRange,
    placeholderData: (prev) => prev,
    queryFn: () => api(`/api/audit-log?${qs({ page, pageSize })}`),
  });
  const data = query.data;

  async function exportCsv() {
    try {
      const blob = await api(`/api/audit-log/export?${qs()}`, { blob: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "audit-log.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify(errorText(e), "error");
    }
  }

  const o = options.data;
  const columns = [
    { key: "at", header: "Time", render: (r) => stamp(r.at) },
    {
      key: "user",
      header: "User",
      render: (r) => r.userName ?? r.userRole ?? "System",
    },
    {
      key: "action",
      header: "Action",
      render: (r) => (
        <Badge tone={TONE[r.action] ?? "neutral"}>{label(r.action)}</Badge>
      ),
    },
    {
      key: "record",
      header: "Record",
      render: (r) => (
        <span>
          {label(r.entity)}
          {r.entityId && (
            <span className="block text-xs text-ink-muted">{r.entityId}</span>
          )}
        </span>
      ),
    },
    {
      key: "change",
      header: "Change",
      render: (r) => changeText(r.oldValue, r.newValue),
    },
    { key: "reason", header: "Reason", render: (r) => r.reason ?? "" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Audit Log</h1>
          <p className="text-sm text-ink-muted">
            Every financial and certificate action. Entries cannot be edited or
            deleted.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={!data || data.total === 0 || badRange}
          onClick={() => void exportCsv()}
        >
          Export CSV
        </Button>
      </div>

      <FilterBar>
        <Select
          label="User"
          value={filters.userId}
          onChange={set("userId")}
          options={[
            { value: "", label: "All users" },
            ...(o?.users ?? []).map((u) => ({
              value: u.id,
              label: `${u.name} (${u.role})`,
            })),
          ]}
        />
        <Select
          label="Action"
          value={filters.action}
          onChange={set("action")}
          options={[
            { value: "", label: "All actions" },
            ...(o?.actions ?? []).map((a) => ({ value: a, label: label(a) })),
          ]}
        />
        <Select
          label="Record type"
          value={filters.entity}
          onChange={set("entity")}
          options={[
            { value: "", label: "All" },
            ...(o?.entities ?? []).map((e) => ({ value: e, label: label(e) })),
          ]}
        />
        <Input
          label="From"
          type="date"
          value={filters.from}
          onChange={set("from")}
        />
        <Input label="To" type="date" value={filters.to} onChange={set("to")} />
        <Input
          label="Search"
          placeholder="Reason or record no."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </FilterBar>
      {badRange && (
        <p className="text-sm text-danger">
          The start date is after the end date.
        </p>
      )}

      <Table
        columns={columns}
        rows={data?.rows}
        rowKey={(r) => r.id}
        loading={query.isPending && !badRange}
        error={query.isError ? errorText(query.error) : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No entries match"
        emptyDescription="Change or clear the filters."
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
          pageSizes={[25, 50, 100, 200]}
        />
      )}
    </div>
  );
}
