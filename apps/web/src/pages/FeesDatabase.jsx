import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CLASSES, classLabel, formatINR, getFinancialYear } from "@erp/shared";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  Dialog,
  FilterBar,
  Input,
  Pagination,
  Select,
  StatCard,
  Table,
  useToast,
} from "../components/ui";
import { errorText } from "../lib/rupees";

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const ANY = { value: "", label: "Any" };
const CLASS_OPTIONS = [{ value: "", label: "All classes" }].concat(
  CLASSES.map((c) => ({ value: c.key, label: c.label })),
);
const STATUS_OPTIONS = [
  { value: "active", label: "Active students" },
  { value: "inactive", label: "Inactive students" },
];
const FEE_STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "pending", label: "Defaulters (fees due till today)" },
  {
    value: "school_paid_bus_pending",
    label: "School fees paid, bus fees pending",
  },
  { value: "overdue", label: "Overdue (past grace days)" },
  { value: "clear", label: "Nothing due" },
  { value: "noplan", label: "Fees not posted yet" },
];
const YES_NO = [
  ANY,
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];
const GENDERS = [
  ANY,
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
  { value: "OTHER", label: "Other" },
];
const INITIAL = {
  q: "",
  classKey: "",
  section: "",
  status: "active",
  feeStatus: "",
  transport: "",
  newAdmission: "",
  rte: "",
  village: "",
  category: "",
  gender: "",
  minDue: "",
  maxDue: "",
  upto: "",
};
// One click presets for the lists the school uses most.
const PRESETS = [
  { key: "defaulters", label: "Defaulters", patch: { feeStatus: "pending" } },
  {
    key: "school-paid",
    label: "School paid, bus pending",
    patch: { feeStatus: "school_paid_bus_pending" },
  },
  {
    key: "transport",
    label: "Only transport students",
    patch: { transport: "true" },
  },
];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// April .. March of the financial year ("2026-27" -> 2026-04 .. 2027-03).
function monthOptions(fy) {
  const start = Number(String(fy).slice(0, 4));
  const out = [{ value: "", label: "Till today" }];
  for (let i = 0; i < 12; i += 1) {
    const m = ((3 + i) % 12) + 1;
    const y = start + (3 + i >= 12 ? 1 : 0);
    out.push({
      value: `${y}-${String(m).padStart(2, "0")}`,
      label: `Up to ${MONTH_NAMES[m - 1]} ${y}`,
    });
  }
  return out;
}

function params(f, extra = {}) {
  const p = new URLSearchParams(extra);
  for (const [k, v] of Object.entries(f)) if (v !== "") p.set(k, v);
  return p;
}

const COLS_KEY = "erp.feesDb.columns";
const readCols = () => {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? "null");
    return Array.isArray(v) ? v : null;
  } catch {
    return null; // private window / blocked storage: just use the defaults
  }
};

const amt = (v) => (v > 0 ? money(v) : "-");

/**
 * Every column of the school's sheet. `show` = visible at first; the user can tick any column on
 * or off (remembered in this browser). Excel export always has ALL columns.
 */
function buildColumnDefs({ head, uptoLabel }) {
  const c = (r) => r.cols;
  return [
    {
      key: "sno",
      group: "Basic",
      label: "S.No",
      show: true,
      render: (r) => r._n,
    },
    {
      key: "adm",
      group: "Basic",
      label: "Sch. ID",
      show: true,
      header: head("Sch. ID", "admissionNo"),
      render: (r) => r.admissionNo,
    },
    {
      key: "name",
      group: "Basic",
      label: "Student name",
      show: true,
      header: head("Student name", "name"),
      render: (r) => (
        <div>
          <Link
            className="font-medium text-brand hover:underline"
            to={`/students/${r.id}`}
          >
            {r.name}
          </Link>
          {r.fatherName && (
            <p className="text-xs text-ink-muted">S/o {r.fatherName}</p>
          )}
          {r.planPosted && (r.dueNowPaise > 0 || r.lateFeePaise > 0) && (
            <p className="text-xs text-ink-muted" data-testid="due-summary">
              Due till {uptoLabel}: {money(r.dueNowPaise)} + penalty{" "}
              {money(r.lateFeePaise)} ={" "}
              <b className="text-ink">
                {money((r.dueNowPaise ?? 0) + (r.lateFeePaise ?? 0))}
              </b>
            </p>
          )}
        </div>
      ),
    },
    {
      key: "class",
      group: "Basic",
      label: "Class",
      show: true,
      header: head("Class", "class"),
      render: (r) => classLabel(r.classKey),
    },
    {
      key: "section",
      group: "Basic",
      label: "Section",
      show: true,
      render: (r) => r.section || "-",
    },
    {
      key: "address",
      group: "Basic",
      label: "Address",
      show: false,
      render: (r) => r.address || "-",
    },
    {
      key: "contact",
      group: "Basic",
      label: "Contact no.",
      show: true,
      render: (r) => r.contactNo || "-",
    },
    {
      key: "bus",
      group: "Bus fees",
      label: "Bus (village)",
      show: true,
      render: (r) =>
        r.usesTransport ? <Badge>{r.village || "Bus"}</Badge> : "-",
    },
    {
      key: "oldSchool",
      group: "School fees",
      label: "Old school due",
      show: true,
      align: "right",
      render: (r) => amt(c(r).oldSchoolDue),
    },
    {
      key: "oldBus",
      group: "Bus fees",
      label: "Old bus due",
      show: true,
      align: "right",
      render: (r) => amt(c(r).oldBusDue),
    },
    {
      key: "schoolRec",
      group: "School fees",
      label: "New school receivable",
      show: false,
      align: "right",
      render: (r) => amt(c(r).newSchoolReceivable),
    },
    {
      key: "busRec",
      group: "Bus fees",
      label: "New bus receivable",
      show: false,
      align: "right",
      render: (r) => amt(c(r).newBusReceivable),
    },
    {
      key: "admRec",
      group: "Admission fees",
      label: "Adm fees rec.",
      show: false,
      align: "right",
      render: (r) => amt(c(r).admReceivable),
    },
    {
      key: "formRec",
      group: "Form fees",
      label: "Form fees rec.",
      show: false,
      align: "right",
      render: (r) => amt(c(r).formReceivable),
    },
    {
      key: "schoolPaid",
      group: "School fees",
      label: "New school fee paid",
      show: false,
      align: "right",
      render: (r) => amt(c(r).newSchoolPaid),
    },
    {
      key: "busPaid",
      group: "Bus fees",
      label: "New bus fee paid",
      show: false,
      align: "right",
      render: (r) => amt(c(r).newBusPaid),
    },
    {
      key: "admPaid",
      group: "Admission fees",
      label: "Admission fee paid",
      show: false,
      align: "right",
      render: (r) => amt(c(r).admPaid),
    },
    {
      key: "formPaid",
      group: "Form fees",
      label: "Form fee paid",
      show: false,
      align: "right",
      render: (r) => amt(c(r).formPaid),
    },
    {
      key: "schoolRebate",
      group: "Rebates",
      label: "School rebate",
      show: false,
      align: "right",
      render: (r) => amt(c(r).schoolRebate),
    },
    {
      key: "busRebate",
      group: "Rebates",
      label: "Transport rebate",
      show: false,
      align: "right",
      render: (r) => amt(c(r).transportRebate),
    },
    {
      key: "admRebate",
      group: "Rebates",
      label: "Admission rebate",
      show: false,
      align: "right",
      render: (r) => amt(c(r).admissionRebate),
    },
    {
      key: "schoolDue",
      group: "School fees",
      label: "New school fees due",
      show: true,
      align: "right",
      render: (r) => (r.planPosted ? amt(c(r).newSchoolDue) : "-"),
    },
    {
      key: "busDue",
      group: "Bus fees",
      label: "New bus fees due",
      show: true,
      align: "right",
      render: (r) => (r.planPosted ? amt(c(r).newBusDue) : "-"),
    },
    {
      key: "admDue",
      group: "Admission fees",
      label: "Adm fees due",
      show: false,
      align: "right",
      render: (r) => amt(c(r).admDue),
    },
    {
      key: "formDue",
      group: "Form fees",
      label: "Form fees due",
      show: false,
      align: "right",
      render: (r) => amt(c(r).formDue),
    },
    {
      key: "total",
      group: "Totals",
      label: "Total dues",
      show: true,
      align: "right",
      header: head("Total dues", "dueNow"),
      render: (r) => (r.planPosted ? <b>{money(r.dueNowPaise)}</b> : "-"),
    },
    {
      key: "late",
      group: "Totals",
      label: "Late fee (penalty)",
      show: true,
      align: "right",
      render: (r) =>
        r.lateFeePaise > 0 ? (
          <span className="text-danger">{money(r.lateFeePaise)}</span>
        ) : (
          "-"
        ),
    },
    {
      key: "out",
      group: "Totals",
      label: "Outstanding (all posted)",
      show: false,
      align: "right",
      header: head("Outstanding (all posted)", "outstanding"),
      render: (r) => (r.planPosted ? money(r.outstandingPaise) : "-"),
    },
    {
      key: "status",
      group: "Totals",
      label: "Status",
      show: true,
      render: (r) =>
        r.status === "active" ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge>Inactive</Badge>
        ),
    },
    {
      key: "feeState",
      group: "Totals",
      label: "Fee status",
      show: true,
      render: (r) =>
        !r.planPosted ? (
          <Badge tone="warning">Fees not posted</Badge>
        ) : r.overduePaise > 0 ? (
          <Badge tone="danger">Overdue</Badge>
        ) : r.dueNowPaise > 0 ? (
          <Badge tone="warning">Due</Badge>
        ) : (
          <Badge tone="success">Clear</Badge>
        ),
    },
  ];
}

/**
 * Fees Database: every student with what was billed, paid, rebated and is due (worked out by
 * the same fee engine as Collect Fee). Everyone can look; the Cashier cannot export; only the
 * Admin can waive a late fee. Fees are posted automatically every month, and rebates have their
 * own module.
 */
export function FeesDatabase() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const canExport = role === "admin" || role === "principal";
  const { notify } = useToast();
  const [filters, setFilters] = useState(INITIAL);
  const [search, setSearch] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [sort, setSort] = useState("class");
  const [dir, setDir] = useState("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [waiveFor, setWaiveFor] = useState(null);
  const [pickCols, setPickCols] = useState(false);
  const [visible, setVisible] = useState(readCols); // null = the defaults

  useEffect(() => {
    const t = window.setTimeout(() => {
      setFilters((f) => ({ ...f, q: search.trim() }));
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const set = (k) => (e) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
  };
  // Rupees typed -> the URL carries rupees; the server turns them into paise.
  const bad = (v) => v !== "" && !(Number(v) >= 0);

  const query = useQuery({
    queryKey: ["fees-database", filters, sort, dir, page, pageSize],
    enabled: !bad(filters.minDue) && !bad(filters.maxDue),
    queryFn: () =>
      api(
        `/api/fees-database?${params(filters, { sort, dir, page, pageSize })}`,
      ),
    placeholderData: keepPreviousData,
  });

  async function exportExcel() {
    try {
      const blob = await api(`/api/fees-database/export?${params(filters)}`, {
        blob: true,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "fees-database.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify(errorText(e), "error");
    }
  }

  function onSort(field) {
    setDir(sort === field && dir === "asc" ? "desc" : "asc");
    setSort(field);
    setPage(1);
  }
  const head = (label, field) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-medium uppercase hover:text-ink"
      aria-label={`Sort by ${label}`}
      onClick={() => onSort(field)}
    >
      {label}
      <span aria-hidden>
        {sort === field ? (dir === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </button>
  );

  const uptoLabel = filters.upto
    ? (monthOptions(getFinancialYear(new Date()))
        .find((m) => m.value === filters.upto)
        ?.label.replace("Up to ", "") ?? "today")
    : "today";
  const defs = useMemo(
    () => buildColumnDefs({ head, uptoLabel }),
    [sort, dir, uptoLabel],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = new Set(
    visible ?? defs.filter((d) => d.show).map((d) => d.key),
  );
  function toggleCol(key) {
    const next = new Set(shown);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    const list = defs.map((d) => d.key).filter((k) => next.has(k));
    setVisible(list);
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(list));
    } catch {
      /* the choice just is not remembered */
    }
  }
  function resetCols() {
    setVisible(null);
    try {
      localStorage.removeItem(COLS_KEY);
    } catch {
      /* nothing to forget */
    }
  }
  const groups = [...new Set(defs.map((d) => d.group))];

  const data = query.data;
  const t = data?.totals;
  const columns = defs
    .filter((d) => shown.has(d.key))
    .map((d) => ({
      key: d.key,
      header: d.header ?? d.label,
      align: d.align,
      render: d.render,
    }));
  if (isAdmin)
    columns.push({
      key: "act",
      header: "",
      render: (r) =>
        r.lateFeePaise > 0 ? (
          <Button variant="secondary" onClick={() => setWaiveFor(r)}>
            Waive late fee
          </Button>
        ) : null,
    });
  const pageSizeNo = data?.pageSize ?? pageSize;
  const rows = data?.rows?.map((r, i) => ({
    ...r,
    _n: (page - 1) * pageSizeNo + i + 1,
  }));
  const fy = data?.fy ?? getFinancialYear(new Date());
  const activePreset = PRESETS.find((p) =>
    Object.entries(p.patch).every(([k, v]) => filters[k] === v),
  )?.key;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Fees Database</h1>
          {data && (
            <p className="text-sm text-ink-muted">
              Financial year {data.fy}
              {filters.upto &&
                ` · dues up to ${monthOptions(fy)
                  .find((m) => m.value === filters.upto)
                  ?.label.replace("Up to ", "")}`}
              {" · fees are added to every student automatically each month"}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            aria-expanded={pickCols}
            onClick={() => setPickCols((p) => !p)}
          >
            Columns
          </Button>
          {canExport && (
            <Button variant="secondary" onClick={() => void exportExcel()}>
              Export to Excel
            </Button>
          )}
        </div>
      </div>

      {pickCols && (
        <div
          className="rounded-card border border-line bg-surface p-4"
          aria-label="Choose columns"
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">
              Show or hide columns (Excel always has all columns)
            </p>
            <button
              type="button"
              className="text-sm text-brand hover:underline"
              onClick={resetCols}
            >
              Reset to default
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {groups.map((g) => (
              <fieldset key={g} className="flex flex-col gap-1">
                <legend className="mb-1 text-xs font-medium uppercase text-ink-muted">
                  {g}
                </legend>
                {defs
                  .filter((d) => d.group === g)
                  .map((d) => (
                    <label
                      key={d.key}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={shown.has(d.key)}
                        onChange={() => toggleCol(d.key)}
                      />
                      {d.label}
                    </label>
                  ))}
              </fieldset>
            ))}
          </div>
        </div>
      )}

      {t && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            label="Students"
            value={t.students}
            caption="Matching the filters"
          />
          <StatCard
            label="Billed (till this month)"
            value={money(t.billedPaise)}
          />
          <StatCard
            label="Paid"
            value={money(t.paidPaise)}
            caption={`Rebate ${money(t.rebatePaise)}`}
          />
          <StatCard
            label="Total dues"
            value={money(t.dueNowPaise)}
            caption={`Overdue ${money(t.overduePaise)}`}
          />
          <StatCard
            label="Late fee (penalty)"
            value={money(t.lateFeePaise)}
            caption="Shown separately, not in dues"
          />
        </div>
      )}

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Quick lists"
      >
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={activePreset === p.key}
            className={`min-h-9 rounded-full border px-3 text-sm ${
              activePreset === p.key
                ? "border-brand bg-brand text-white"
                : "border-line bg-surface text-ink hover:bg-app"
            }`}
            onClick={() => {
              setFilters((f) =>
                activePreset === p.key
                  ? {
                      ...f,
                      ...Object.fromEntries(
                        Object.keys(p.patch).map((k) => [k, ""]),
                      ),
                    }
                  : { ...f, ...p.patch },
              );
              setPage(1);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <FilterBar>
        <Input
          label="Search"
          placeholder="Name, father, mobile, adm. no, village"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          label="Class"
          options={CLASS_OPTIONS}
          value={filters.classKey}
          onChange={set("classKey")}
        />
        <Select
          label="Fee list"
          options={FEE_STATUS_OPTIONS}
          value={filters.feeStatus}
          onChange={set("feeStatus")}
        />
        <Select
          label="Dues up to"
          options={monthOptions(fy)}
          value={filters.upto}
          onChange={set("upto")}
        />
        <Select
          label="Student status"
          options={STATUS_OPTIONS}
          value={filters.status}
          onChange={set("status")}
        />
      </FilterBar>

      <div>
        <button
          type="button"
          aria-expanded={advanced}
          className="text-sm font-medium text-brand hover:underline"
          onClick={() => setAdvanced((a) => !a)}
        >
          {advanced ? "Hide advanced filters" : "Advanced filters"}
        </button>
        {advanced && (
          <div className="mt-2">
            <FilterBar>
              <Input
                label="Section"
                value={filters.section}
                onChange={set("section")}
              />
              <Select
                label="Uses bus"
                options={YES_NO}
                value={filters.transport}
                onChange={set("transport")}
              />
              <Input
                label="Village"
                value={filters.village}
                onChange={set("village")}
              />
              <Select
                label="New admission"
                options={YES_NO}
                value={filters.newAdmission}
                onChange={set("newAdmission")}
              />
              <Select
                label="RTE"
                options={YES_NO}
                value={filters.rte}
                onChange={set("rte")}
              />
              <Input
                label="Category"
                placeholder="GEN / OBC / SC / ST"
                value={filters.category}
                onChange={set("category")}
              />
              <Select
                label="Gender"
                options={GENDERS}
                value={filters.gender}
                onChange={set("gender")}
              />
              <Input
                label="Total dues: at least (₹)"
                inputMode="decimal"
                value={filters.minDue}
                error={bad(filters.minDue) ? "Enter a valid amount" : undefined}
                onChange={set("minDue")}
              />
              <Input
                label="Total dues: at most (₹)"
                inputMode="decimal"
                value={filters.maxDue}
                error={bad(filters.maxDue) ? "Enter a valid amount" : undefined}
                onChange={set("maxDue")}
              />
            </FilterBar>
          </div>
        )}
        <button
          type="button"
          className="mt-2 block text-sm text-ink-muted hover:underline"
          onClick={() => {
            setFilters(INITIAL);
            setSearch("");
            setPage(1);
          }}
        >
          Clear all filters
        </button>
      </div>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={query.isPending}
        error={query.isError ? errorText(query.error) : null}
        onRetry={() => void query.refetch()}
        emptyTitle="No students match"
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
        />
      )}

      {waiveFor && (
        <WaiveDialog
          row={waiveFor}
          fy={data?.fy}
          onClose={() => setWaiveFor(null)}
        />
      )}
    </div>
  );
}

/** Late-fee relaxation: the Admin picks the overdue months to waive and writes the reason. */
function WaiveDialog({ row, fy, onClose }) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState(null); // null = all months ticked
  const [reason, setReason] = useState("");
  const ledger = useQuery({
    queryKey: ["ledger", row.id, fy],
    queryFn: () => api(`/api/students/${row.id}/ledger?fy=${fy}`),
  });
  const late = (ledger.data?.instalments ?? []).filter((i) => i.lateFee > 0);
  const chosen = picked ?? late.map((i) => i.period);
  const total = late
    .filter((i) => chosen.includes(i.period))
    .reduce((n, i) => n + i.lateFee, 0);
  const save = useMutation({
    mutationFn: () =>
      api(`/api/students/${row.id}/late-fee-waivers`, {
        method: "POST",
        body: { fy, periods: chosen, reason: reason.trim() },
      }),
    onSuccess: async () => {
      for (const key of ["fees-database", "dues", "ledger", "dashboard"])
        await queryClient.invalidateQueries({ queryKey: [key] });
      notify("Late fee waived.", "success");
      onClose();
    },
    onError: (e) => notify(errorText(e), "error"),
  });
  const toggle = (p) =>
    setPicked(
      chosen.includes(p) ? chosen.filter((x) => x !== p) : [...chosen, p],
    );
  return (
    <Dialog
      open
      title={`Waive late fee: ${row.name}`}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={save.isPending}
          >
            Cancel
          </Button>
          <Button
            disabled={chosen.length === 0 || reason.trim().length < 3}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Waive {money(total)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {ledger.isPending && (
          <p className="text-ink-muted">Loading the months…</p>
        )}
        {ledger.isError && (
          <p className="text-danger">{errorText(ledger.error)}</p>
        )}
        {ledger.data && late.length === 0 && (
          <p className="text-ink-muted">
            No late fee is pending for this student.
          </p>
        )}
        {late.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">
              Months with a late fee
            </legend>
            {late.map((i) => (
              <label key={i.period} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={chosen.includes(i.period)}
                  onChange={() => toggle(i.period)}
                />
                {i.period} · {money(i.lateFee)}
              </label>
            ))}
          </fieldset>
        )}
        <Input
          label="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-xs text-ink-muted">
          The waiver is recorded with your reason and can be reversed later.
        </p>
      </div>
    </Dialog>
  );
}
