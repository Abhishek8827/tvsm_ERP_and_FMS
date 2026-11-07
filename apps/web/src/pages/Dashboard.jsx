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
import { Icon, IconTile } from "../components/Icons";
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
      icon="users"
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
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-blue-200 text-xs font-semibold uppercase tracking-wide text-blue-800">
                <tr>
                  <th className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-2">
                      <Icon name="cap" size={18} /> Class
                    </span>
                  </th>
                  <th className="px-3 py-2.5 text-right">
                    <span className="inline-flex items-center gap-2">
                      <Icon name="users" size={18} /> Students
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {q.data.rows.map((c) => (
                  <tr key={c.classKey} className="even:bg-slate-200/60">
                    <td className="px-3 py-1.5">
                      <span className="inline-block rounded-full bg-blue-200 px-3 py-0.5 text-xs font-semibold text-blue-800">
                        {classLabel(c.classKey)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-ink">
                      {c.students}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-blue-100">
                  <td className="px-3 py-2.5 font-semibold text-blue-800">
                    <span className="inline-flex items-center gap-2">
                      <Icon name="layers" size={20} /> Total
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="inline-block rounded-full bg-brand px-4 py-1 font-semibold tabular-nums text-white">
                      {q.data.totalStudents}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}
    </Card>
  );
}

/** One "waiting" row: big count, caption and a link to where the decision is made. */
function WaitingRow({ icon, label, count, caption, to }) {
  const { role } = useAuth();
  const Wrap = role === "admin" ? Link : "div"; // the Principal only looks: no Approvals page for them
  return (
    <Wrap
      {...(role === "admin" ? { to } : {})}
      className="glass glass-lift flex items-center gap-4 rounded-card p-4 shadow-card transition hover:shadow-lift"
    >
      <IconTile name={icon} box="h-16 w-16" size={30} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{label}</p>
        <p className="text-3xl font-bold leading-tight text-ink">{count}</p>
        <p className="text-sm text-ink-muted">{caption}</p>
      </div>
      {role === "admin" && <Icon name="chevron" className="text-slate-600" />}
    </Wrap>
  );
}

/** One balance in the Funds strip: icon, label (a <p>), then the amount (the next <p>). */
function FundTile({ icon, label, value, extra }) {
  return (
    <div
      className={`flex min-w-44 flex-1 items-center gap-3 px-4 py-3 ${extra ? "border-l border-line" : ""}`}
    >
      <IconTile name={icon} box="h-12 w-12" />
      <div className="min-w-0">
        <p className="truncate text-sm text-ink-muted">{label}</p>
        <p className="text-2xl font-bold text-ink">{value}</p>
      </div>
    </div>
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
  const cashTotal = d.funds.cashPaise ?? 0; // school cash only: petty cash is a separate fund
  return (
    <>
      <Card title="Funds" subtitle="ACCOUNTS & BALANCES">
        <div
          className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]"
          data-testid="funds-total"
        >
          <div className="glass flex flex-wrap items-center rounded-card p-2 shadow-card">
            <FundTile icon="cash" label="Total cash" value={money(cashTotal)} />
            {d.funds.banks.map((b) => (
              <FundTile
                key={b.id ?? b.name}
                icon="bank"
                label={b.name}
                value={money(b.balancePaise)}
              />
            ))}
            {d.funds.banks.length === 0 && (
              <p className="px-4 text-sm text-ink-muted">
                No bank account added yet.
              </p>
            )}
            <FundTile
              icon="bank"
              label="Total online"
              value={money(bankTotal)}
              extra
            />
          </div>
          <div className="flex items-center gap-4 rounded-card bg-linear-to-br from-blue-600 to-blue-800 p-5 text-white shadow-glow">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/20">
              <Icon name="layers" size={26} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white/90">Total funds</p>
              <p className="text-3xl font-bold leading-tight">
                {money(cashTotal + bankTotal)}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4 rounded-card bg-linear-to-r from-purple-100 to-purple-200/70 px-4 py-3">
          <IconTile name="coins" tone="purple" box="h-10 w-10" size={20} />
          <p className="flex-1 font-medium text-ink">
            Petty cash{" "}
            <span className="text-sm font-normal text-ink-muted">
              (separate fund, not part of Total funds)
            </span>
          </p>
          <p className="text-xl font-bold text-purple-700">
            {money(d.funds.pettyPaise)}
          </p>
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
      <div className="grid items-start gap-4 lg:grid-cols-[24rem_minmax(0,1fr)]">
        <ClassStrength />
        <Card title="Waiting for a decision" icon="doc">
          <div className="flex flex-col gap-3">
            <WaitingRow
              icon="receipt"
              label="Receipt cancellations"
              count={d.pending.cancellations}
              caption="awaiting a decision"
              to="/approvals"
            />
            <WaitingRow
              icon="wallet"
              label="Expense vouchers"
              count={d.pending.vouchers}
              caption="awaiting approval"
              to="/approvals"
            />
            <WaitingRow
              icon="refresh"
              label="Reversal requests"
              count={d.pending.reversals}
              caption="awaiting a decision"
              to="/approvals"
            />
          </div>
        </Card>
      </div>
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
