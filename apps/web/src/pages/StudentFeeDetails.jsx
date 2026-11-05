import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { classLabel, formatINR, getFinancialYear } from "@erp/shared";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  FilterBar,
  Input,
  Select,
  Spinner,
  Table,
} from "../components/ui";
import { EditOldFeesDialog } from "./EditOldFeesDialog";

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const MODE_LABEL = { cash: "Cash", upi: "UPI / QR" };
const date = (iso) =>
  new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

/** The last few financial years, newest first ("2026-27"). */
function sessionOptions() {
  const now = getFinancialYear(new Date());
  const start = Number(now.slice(0, 4));
  return Array.from({ length: 4 }, (_, i) => {
    const y = start - i;
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  });
}

const SUMMARY_ROWS = [
  ["oldSchool", "Old school fee dues (brought forward)"],
  ["oldTransport", "Old bus fee dues (brought forward)"],
  ["currentSchool", "Current session school fees"],
  ["currentTransport", "Current session transport fees"],
];

/**
 * One student's complete fee picture: details, summary (school and bus kept apart, old dues apart
 * from this session's) and every receipt. Read-only: it shows the same numbers as Collect Fee and
 * the Fees Database, and the payment list comes straight from the issued receipts.
 */
export function StudentFeeDetails() {
  const { id } = useParams();
  const { role } = useAuth();
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState("payments");
  const [fy, setFy] = useState(getFinancialYear(new Date()));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState("");
  const [mode, setMode] = useState("");

  const query = useQuery({
    queryKey: ["fee-details", id, { fy, from, to, category, mode }],
    queryFn: () => {
      const p = new URLSearchParams({ fy });
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      if (category) p.set("category", category);
      if (mode) p.set("mode", mode);
      return api(`/api/students/${id}/fee-details?${p}`);
    },
  });

  if (query.isPending) return <Spinner label="Loading fee details" />;
  if (query.isError)
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => query.refetch()}
      />
    );
  const d = query.data;
  const s = d.student;
  const sum = d.summary;

  const columns = [
    { key: "sno", header: "S.No.", render: (r) => r._n },
    {
      key: "no",
      header: "Receipt No.",
      render: (r) => (
        <Link
          className="font-medium text-brand hover:underline"
          to={`/receipts/${r.id}`}
        >
          {r.number}
        </Link>
      ),
    },
    { key: "date", header: "Payment date", render: (r) => date(r.issuedAt) },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (r) => (
        <span
          className={
            r.status === "cancelled" ? "text-ink-muted line-through" : ""
          }
        >
          {money(r.totalPaise)}
        </span>
      ),
    },
    {
      key: "school",
      header: "School fee",
      align: "right",
      render: (r) => money(r.schoolPaise),
    },
    {
      key: "transport",
      header: "Transport fee",
      align: "right",
      render: (r) => money(r.transportPaise),
    },
    {
      key: "other",
      header: "Other categories",
      align: "right",
      render: (r) => money(r.otherPaise),
    },
    {
      key: "mode",
      header: "Payment mode",
      render: (r) => (
        <span>
          {r.mode === "split"
            ? (r.payments ?? [])
                .map(
                  (p) =>
                    `${MODE_LABEL[p.mode]} ${formatINR(p.amountPaise, { hideZeroPaise: true })}`,
                )
                .join(" + ")
            : (MODE_LABEL[r.mode] ?? r.mode)}
          {r.reference ? (
            <span className="text-ink-muted"> · {r.reference}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        r.status === "cancelled" ? (
          <div>
            <Badge tone="danger">Cancelled</Badge>
            <p className="mt-1 text-xs text-ink-muted">
              {r.cancellation?.reason}
              {r.cancellation?.decidedByName
                ? ` (by ${r.cancellation.decidedByName})`
                : ""}
            </p>
          </div>
        ) : r.status === "cancel_requested" ? (
          <Badge tone="warning">Cancellation requested</Badge>
        ) : (
          <Badge tone="success">Valid</Badge>
        ),
    },
    {
      key: "view",
      header: "Receipt",
      render: (r) => (
        <Link
          className="inline-flex min-h-9 items-center rounded-lg border border-line bg-surface/80 px-3 text-sm font-medium text-ink shadow-sm hover:bg-surface hover:shadow-card"
          to={`/receipts/${r.id}`}
        >
          View
        </Link>
      ),
    },
  ];
  const rows = d.payments.map((p, i) => ({ ...p, _n: i + 1 }));

  const oldTotal =
    sum.oldSchool.outstandingPaise + sum.oldTransport.outstandingPaise;
  const curTotal =
    sum.currentSchool.billedPaise + sum.currentTransport.billedPaise;
  const amountToPay = sum.totals.outstandingPaise + sum.totals.lateFeePaise;
  const canCollect =
    (role === "admin" || role === "cashier") && s.status === "active";
  const linkBtn =
    "inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface/80 px-4 text-sm font-medium text-ink shadow-sm transition hover:bg-surface hover:shadow-card";
  const TABS = [
    ["payments", "Payment History"],
    ["ledger", "Fee Ledger"],
    ["adjustments", "Adjustments & Edits"],
  ];
  const line = (label, value, strong) => (
    <div
      className={`flex items-center justify-between gap-4 px-3 py-2 ${strong ? "bg-brand/[0.06] font-semibold" : ""}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink">Student Fee Details</h1>
        <div className="flex flex-wrap items-end gap-2">
          <Link className={linkBtn} to="/fees-database">
            <span aria-hidden="true">←</span> Back to Fees Database
          </Link>
          {role === "admin" && (
            <div className="relative">
              <span className="absolute -top-2.5 right-2 rounded-full bg-danger px-2 text-[10px] font-semibold uppercase text-white shadow-sm">
                Admin only
              </span>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit Old Fees
              </Button>
            </div>
          )}
          {canCollect && (
            <Link
              to={`/collect-fee?student=${s.id}`}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-linear-to-b from-brand to-brand-dark px-4 text-sm font-medium text-white shadow-glow transition hover:brightness-110"
            >
              + Collect Fee
            </Link>
          )}
        </div>
      </div>
      {editing && (
        <EditOldFeesDialog student={s} onClose={() => setEditing(false)} />
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div className="flex items-center gap-4">
            <span
              aria-hidden="true"
              className="flex h-16 w-16 items-center justify-center rounded-full bg-brand/10 text-2xl font-semibold text-brand ring-4 ring-white/70"
            >
              {(s.name ?? "?").trim().charAt(0).toUpperCase()}
            </span>
            <div>
              <p className="text-xl font-semibold uppercase text-ink">
                {s.name}
              </p>
              <p className="text-sm text-ink-muted">
                Scholar ID: {s.admissionNo}
              </p>
            </div>
          </div>
          <dl className="grid flex-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                "Class",
                `${classLabel(s.classKey)}${s.section ? ` - ${s.section}` : ""}`,
              ],
              ["Father's Name", s.fatherName || "-"],
              ["Contact", s.contactNo || "-"],
              ["Address / Village", s.address || "-"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-ink-muted">{k}</dt>
                <dd className="font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            <Badge tone={s.usesTransport ? "success" : "neutral"}>
              Transport: {s.usesTransport ? "Yes" : "No"}
              {s.usesTransport && s.transportFrom
                ? ` (from ${s.transportFrom}${s.transportUntil ? ` to ${s.transportUntil}` : ""})`
                : ""}
            </Badge>
            <Badge tone="info">Session: {d.fy}</Badge>
            <Badge tone={s.status === "active" ? "success" : "neutral"}>
              {s.status === "active" ? "Active" : "Inactive"}
            </Badge>
          </div>
        </div>
      </Card>

      <Card title="Fee Summary">
        {!d.planPosted ? (
          <p className="text-sm text-ink-muted">
            No fees are posted for this student in {d.fy}.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="overflow-hidden rounded-card border border-line bg-surface/70 text-sm">
              <p className="bg-brand/[0.08] px-3 py-2 font-semibold text-ink">
                Old Dues (Imported / Previous)
              </p>
              {line("Old School Fee", money(sum.oldSchool.outstandingPaise))}
              {line("Old Bus Fee", money(sum.oldTransport.outstandingPaise))}
              {line("Total Old Due", money(oldTotal), true)}
            </div>
            <div className="overflow-hidden rounded-card border border-line bg-surface/70 text-sm">
              <p className="bg-brand/[0.08] px-3 py-2 font-semibold text-ink">
                Current Session ({d.fy})
              </p>
              {line(
                "School Fee (Receivable)",
                money(sum.currentSchool.billedPaise),
              )}
              {line(
                "Bus Fee (Receivable)",
                money(sum.currentTransport.billedPaise),
              )}
              {line("Total Current", money(curTotal), true)}
            </div>
            <div className="overflow-hidden rounded-card border border-line bg-surface/70 text-sm">
              {line("Total Billed", money(sum.totals.billedPaise))}
              {line("Total Paid", money(sum.totals.paidPaise))}
              <div className="flex items-center justify-between gap-4 bg-danger/10 px-3 py-2 font-semibold text-danger">
                <span>Outstanding</span>
                <span className="tabular-nums">
                  {money(sum.totals.outstandingPaise)}
                </span>
              </div>
              {line("Late Fee (Penalty)", money(sum.totals.lateFeePaise))}
              <div className="flex items-center justify-between gap-4 bg-danger/15 px-3 py-2 font-semibold text-danger">
                <span>Amount to be Paid</span>
                <span className="tabular-nums">{money(amountToPay)}</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      <div
        role="tablist"
        aria-label="Student fee views"
        className="flex flex-wrap gap-2"
      >
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-10 rounded-full border px-4 text-sm font-medium shadow-sm transition ${
              tab === key
                ? "border-brand bg-brand text-white shadow-glow"
                : "border-line bg-surface/80 text-ink hover:bg-surface"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "ledger" && (
        <Card title={`Fee ledger ${d.fy}`}>
          {!d.planPosted ? (
            <p className="text-sm text-ink-muted">
              No fees are posted for this student.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-brand/[0.06] text-xs uppercase text-ink-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Fee</th>
                    <th className="px-4 py-2 text-right font-medium">Billed</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Concession
                    </th>
                    <th className="px-4 py-2 text-right font-medium">Paid</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Outstanding
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {SUMMARY_ROWS.map(([key, label]) => (
                    <tr key={key}>
                      <td className="px-4 py-2">
                        {label}
                        {sum[key].importedPaise !== undefined &&
                          sum[key].importedPaise !== sum[key].billedPaise && (
                            <span className="block text-xs text-ink-muted">
                              Imported {money(sum[key].importedPaise)},
                              corrected by the Admin
                            </span>
                          )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {money(sum[key].billedPaise)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {money(sum[key].concessionPaise)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {money(sum[key].paidPaise)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {money(sum[key].outstandingPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-brand/[0.06] font-medium">
                  <tr>
                    <td className="px-4 py-2">Total</td>
                    <td className="px-4 py-2 text-right">
                      {money(sum.totals.billedPaise)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {money(sum.totals.concessionPaise)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {money(sum.totals.paidPaise)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {money(sum.totals.outstandingPaise)}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2">Late fee / penalty (separate)</td>
                    <td colSpan={3} />
                    <td className="px-4 py-2 text-right text-danger">
                      {money(sum.totals.lateFeePaise)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "adjustments" && (
        <Card
          title="Adjustments & edits"
          subtitle="Old fee corrections made by the Admin. The imported figure is never changed; each correction is added on top."
        >
          <Table
            columns={[
              {
                key: "date",
                header: "Effective date",
                render: (r) => r.effectiveDate,
              },
              { key: "cat", header: "Fee", render: (r) => r.label },
              {
                key: "prev",
                header: "Previous",
                align: "right",
                render: (r) => money(r.previousPaise),
              },
              {
                key: "new",
                header: "New total",
                align: "right",
                render: (r) => money(r.newPaise),
              },
              { key: "why", header: "Reason", render: (r) => r.reason },
              {
                key: "by",
                header: "By",
                render: (r) => r.createdByName ?? "-",
              },
            ]}
            rows={d.oldFeeCorrections ?? []}
            rowKey={(r) => r.id}
            emptyTitle="No corrections"
            emptyDescription="The old fees are as imported."
          />
        </Card>
      )}

      {tab === "payments" && (
        <Card title="Payment history">
          <FilterBar>
            <Select
              label="Academic session"
              value={fy}
              onChange={(e) => setFy(e.target.value)}
              options={sessionOptions().map((y) => ({ value: y, label: y }))}
            />
            <Input
              label="From"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              label="To"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <Select
              label="Fee category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={[
                { value: "", label: "All" },
                { value: "school", label: "School fee" },
                { value: "transport", label: "Transport fee" },
                { value: "other", label: "Other" },
              ]}
            />
            <Select
              label="Payment mode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              options={[
                { value: "", label: "All" },
                { value: "cash", label: "Cash" },
                { value: "upi", label: "UPI / QR" },
              ]}
            />
          </FilterBar>
          <div className="mt-3">
            <Table
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              emptyTitle="No payments"
              emptyDescription="No receipts match these filters."
            />
          </div>
          {d.payments.length > 0 && (
            <p className="mt-3 text-sm text-ink">
              Received: <b>{money(d.paymentTotals.totalPaise)}</b> in{" "}
              {d.paymentTotals.count} receipts. Cancelled receipts are not
              counted.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
