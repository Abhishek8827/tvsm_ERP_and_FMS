import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { classLabel, formatINR, todayIst } from "@erp/shared";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { errorText } from "../lib/rupees";
import { useState } from "react";
import {
  Badge,
  Card,
  ErrorState,
  Select,
  Spinner,
  StatCard,
} from "../components/ui";
import { BackupReminder } from "../components/BackupReminder";
/**
 * Step 1 dashboard intentionally shows NO business numbers: there is no data yet, and rule 1
 * forbids placeholders. The only live information is the API/database health from /api/health.
 * Real dashboards (collection, dues, approvals) arrive with their steps.
 */
const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });

/** Cashier: today's collection, straight from the receipts (cancelled ones are left out). */
function TodayCollection() {
  const today = todayIst();
  const q = useQuery({
    queryKey: ["receipts", "today", today],
    queryFn: () => api(`/api/receipts?from=${today}&to=${today}&pageSize=1`),
    refetchInterval: 60_000,
    retry: false,
  });
  return (
    <Card title="Today's collection">
      {q.isPending && <Spinner label="Loading today's collection" />}
      {q.isError && (
        <ErrorState
          message={q.error.message}
          onRetry={() => void q.refetch()}
        />
      )}
      {q.data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Total collected"
            value={money(q.data.totals.paise)}
            caption={`${q.data.totals.count} receipts`}
          />
          <StatCard
            label="School fees"
            value={money(q.data.totals.byKind.school)}
          />
          <StatCard
            label="Transport fees"
            value={money(q.data.totals.byKind.transport)}
          />
          <StatCard label="Cash" value={money(q.data.totals.byMode.cash)} />
          <StatCard label="UPI / QR" value={money(q.data.totals.byMode.upi)} />
        </div>
      )}
    </Card>
  );
}

const STRENGTH_STATUS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "all", label: "All" },
];

/** Mini table: how many students are in each class, for active / inactive / all students. */
function ClassStrength() {
  const [status, setStatus] = useState("active");
  const q = useQuery({
    queryKey: ["dashboard", "class-strength", status],
    queryFn: () => api(`/api/dashboard/class-strength?status=${status}`),
    retry: false,
  });
  return (
    <Card
      title="Class strength"
      subtitle={q.data ? `${q.data.totalStudents} students` : undefined}
      actions={
        <Select
          label="Show"
          options={STRENGTH_STATUS}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        />
      }
    >
      {q.isPending && <Spinner label="Loading class strength" />}
      {q.isError && (
        <ErrorState
          message={errorText(q.error)}
          onRetry={() => void q.refetch()}
        />
      )}
      {q.data &&
        (q.data.rows.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No {status === "all" ? "" : status} students.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-ink-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">Class</th>
                  <th className="py-2 text-right font-medium">Students</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {q.data.rows.map((c) => (
                  <tr key={c.classKey}>
                    <td className="py-1.5 pr-4">{classLabel(c.classKey)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {c.students}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line font-semibold">
                  <td className="py-2 pr-4">Total</td>
                  <td className="py-2 text-right tabular-nums">
                    {q.data.totalStudents}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}
    </Card>
  );
}

/** Admin and Principal: funds, fees, class-wise students and what is waiting, all from real records. */
function Overview() {
  const q = useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: () => api("/api/dashboard/overview"),
    refetchInterval: 60_000,
    retry: false,
  });
  if (q.isPending) return <Spinner label="Loading the overview" />;
  if (q.isError)
    return (
      <ErrorState
        message={errorText(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  const d = q.data;
  const bankTotal = d.funds.banks.reduce((n, b) => n + b.balancePaise, 0);
  const cashTotal = (d.funds.cashPaise ?? 0) + (d.funds.pettyPaise ?? 0);
  return (
    <>
      <Card title="Funds">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Bank accounts
        </p>
        {d.funds.banks.length === 0 ? (
          <p className="text-sm text-ink-muted">No bank account added yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {d.funds.banks.map((b) => (
              <StatCard
                key={b.id ?? b.name}
                label={b.name}
                value={money(b.balancePaise)}
              />
            ))}
          </div>
        )}
        <div
          className="mt-4 grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr]"
          data-testid="funds-total"
        >
          <StatCard
            label="Total cash"
            value={money(cashTotal)}
            caption={`Cash in hand ${money(d.funds.cashPaise)} + petty cash ${money(d.funds.pettyPaise)}`}
          />
          <span
            aria-hidden="true"
            className="hidden self-center text-2xl text-ink-muted sm:block"
          >
            +
          </span>
          <StatCard
            label="Total online"
            value={money(bankTotal)}
            caption="All bank accounts"
          />
          <span
            aria-hidden="true"
            className="hidden self-center text-2xl text-ink-muted sm:block"
          >
            =
          </span>
          <StatCard label="Total funds" value={money(cashTotal + bankTotal)} />
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          Collected today: <b className="text-ink">{money(d.today?.paise)}</b> (
          {d.today?.count ?? 0} receipts)
        </p>
      </Card>
      <Card title={`Fees ${d.fy}`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Billed (till this month)"
            value={money(d.fees.billedPaise)}
          />
          <StatCard
            label="Collected"
            value={money(d.fees.paidPaise)}
            caption={`Rebate ${money(d.fees.rebatePaise)}`}
          />
          <StatCard
            label="Due till today"
            value={money(d.fees.dueNowPaise)}
            caption={`Overdue ${money(d.fees.overduePaise)}`}
          />
          <StatCard
            label="Outstanding"
            value={money(d.fees.outstandingPaise)}
          />
        </div>
        {d.noPlanStudents > 0 && (
          <p className="mt-3 text-sm text-warning">
            {d.noPlanStudents} students have no fees posted yet.{" "}
            <Link className="underline" to="/fees-database">
              Open Fees Database
            </Link>
          </p>
        )}
        {/* Fees are posted automatically; this lists what the last run could not price. */}
        {d.feePlan?.problems?.length > 0 && (
          <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <p className="font-medium text-warning">
              Fees were NOT posted for some students (fix the fee chart or the
              student record):
            </p>
            <ul className="mt-1 list-disc pl-5 text-ink-muted">
              {d.feePlan.problems.map((p) => (
                <li key={p.reason}>
                  {p.count} student{p.count > 1 ? "s" : ""}: {p.reason} (e.g.{" "}
                  {p.examples.join(", ")})
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      <Card title="Waiting for a decision">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Receipt cancellations"
            value={String(d.pending.cancellations)}
            caption="awaiting a decision"
          />
          <StatCard
            label="Expense vouchers"
            value={String(d.pending.vouchers)}
            caption="awaiting approval"
          />
          <StatCard
            label="Reversal requests"
            value={String(d.pending.reversals)}
            caption="awaiting a decision"
          />
        </div>
      </Card>
      <ClassStrength />
    </>
  );
}

export function Dashboard() {
  const { role } = useAuth();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api("/api/health"),
    refetchInterval: 30_000,
    retry: false,
  });
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
      </div>
      {role === "admin" && <BackupReminder />}
      <div className="grid gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          {role === "cashier" && <TodayCollection />}
          {(role === "admin" || role === "principal") && <Overview />}
          <Card title="System status">
            {health.isPending && <Spinner label="Checking the server" />}
            {health.isError && (
              <ErrorState
                message={health.error.message}
                onRetry={() => void health.refetch()}
              />
            )}
            {health.data && (
              <div className="flex items-center gap-3">
                <Badge
                  tone={health.data.status === "ok" ? "success" : "warning"}
                >
                  {health.data.status === "ok"
                    ? "All systems normal"
                    : "Database not connected"}
                </Badge>
                <span className="text-sm text-ink-muted">
                  Database: {health.data.db}
                </span>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
