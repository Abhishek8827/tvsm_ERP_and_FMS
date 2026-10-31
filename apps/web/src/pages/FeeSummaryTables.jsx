import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { classLabel, formatINR } from "@erp/shared";
import { api } from "../api/client";
import { Card, ErrorState, Select, Spinner } from "../components/ui";
import { errorText } from "../lib/rupees";

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const MONTHS = [
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
const monthLabel = (m) =>
  `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const STATUS = [
  { value: "active", label: "Active students" },
  { value: "inactive", label: "Inactive students" },
  { value: "all", label: "All students" },
];

/** 0 % green, 100 % red: the colour of the "Due %" cell, as in the school's own sheet. */
const pctStyle = (pct) =>
  pct == null
    ? undefined
    : {
        backgroundColor: `hsl(${Math.round(120 - Math.min(pct, 100) * 1.2)} 65% 82%)`,
      };

function SummaryTable({ title, data }) {
  const head = [
    "Class",
    "Section",
    "Students",
    "Old remaining",
    "Receivable",
    "Paid",
    "Rebate",
    "Dues",
    "Due %",
  ];
  const cell = "px-3 py-2 text-right tabular-nums";
  const line = (r) => (
    <>
      <td className={cell}>{r.students}</td>
      <td className={cell}>{money(r.oldPaise)}</td>
      <td className={cell}>{money(r.receivablePaise)}</td>
      <td className={cell}>{money(r.paidPaise)}</td>
      <td className={cell}>{money(r.rebatePaise)}</td>
      <td className={cell}>{money(r.duesPaise)}</td>
      <td className={`${cell} font-medium`} style={pctStyle(r.duePct)}>
        {r.duePct == null ? "-" : `${r.duePct.toFixed(2)}%`}
      </td>
    </>
  );
  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-card border border-line bg-surface shadow-sm"
    >
      <h2 className="bg-sidebar px-4 py-2 text-center text-sm font-semibold tracking-wide text-white">
        {title}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-app text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              {head.map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={`px-3 py-2 ${i < 2 ? "text-left" : "text-right"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.rows.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-6 text-center text-ink-muted"
                >
                  No students to show.
                </td>
              </tr>
            )}
            {data.rows.map((r) => (
              <tr key={`${r.classKey}-${r.section}`}>
                <td className="px-3 py-2">{classLabel(r.classKey)}</td>
                <td className="px-3 py-2">{r.section || "-"}</td>
                {line(r)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-app font-semibold">
              <td className="px-3 py-2" colSpan={2}>
                Total
              </td>
              {line(data.total)}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/**
 * Dashboard: School fees and Bus fees, class + section wise, up to the end of the chosen month
 * of the session (June to March). Same numbers as Collect Fee, worked out on the server.
 */
export function FeeSummaryTables() {
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState("active");
  const q = useQuery({
    queryKey: ["dashboard", "fee-summary", month, status],
    queryFn: () =>
      api(
        `/api/dashboard/fee-summary?status=${status}${month ? `&month=${month}` : ""}`,
      ),
  });
  return (
    <Card title="Fee summary">
      <div className="mb-4 grid max-w-md grid-cols-2 gap-3">
        <Select
          label="Select month"
          value={month || q.data?.month || ""}
          onChange={(e) => setMonth(e.target.value)}
          options={(q.data?.months ?? []).map((m) => ({
            value: m,
            label: monthLabel(m),
          }))}
          disabled={!q.data}
        />
        <Select
          label="Students"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={STATUS}
        />
      </div>
      {q.isPending && <Spinner label="Loading fee summary" />}
      {q.isError && (
        <ErrorState
          message={errorText(q.error)}
          onRetry={() => void q.refetch()}
        />
      )}
      {q.data && (
        <div className="flex flex-col gap-4">
          <SummaryTable title="SCHOOL FEES SUMMARY" data={q.data.school} />
          <SummaryTable title="BUS FEES SUMMARY" data={q.data.bus} />
        </div>
      )}
    </Card>
  );
}
