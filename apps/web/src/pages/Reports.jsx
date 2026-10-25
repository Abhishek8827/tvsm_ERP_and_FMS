import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatINR, paiseToRupeesString } from "@erp/shared";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Button,
  Card,
  Dialog,
  ErrorState,
  Input,
  Pagination,
  Select,
  Spinner,
  StatCard,
  Table,
  useToast,
} from "../components/ui";
import { printHtml } from "../lib/printHtml";
import { REPORT_CSS, reportHtml } from "../lib/reportsHtml";
import { errorText, parseRupees, todayInput } from "../lib/rupees";

const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const TABS = [
  { key: "income-expenditure", label: "Income & Expenditure" },
  { key: "balance-sheet", label: "Balance Sheet" },
  { key: "trial-balance", label: "Trial Balance" },
  { key: "day-book", label: "Day Book" },
];
const COMPARE = [
  { value: "none", label: "None" },
  { value: "previous", label: "Previous period (same length)" },
];
const fyStartInput = () => {
  const [y, m] = todayInput().split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
};
const niceDate = (d) =>
  new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
const stamp = (at) =>
  new Date(at).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Two-column statement block: label + amount (+ earlier period when comparing). */
function Lines({ title, lines, total, totalLabel, compare }) {
  return (
    <div className="rounded-card border border-line bg-surface">
      <p className="border-b border-line bg-app px-4 py-2 text-sm font-medium">
        {title}
      </p>
      <dl className="divide-y divide-line text-sm">
        {lines.length === 0 && (
          <p className="px-4 py-3 text-ink-muted">Nothing in this period.</p>
        )}
        {lines.map((l) => (
          <div key={l.key} className="flex justify-between gap-4 px-4 py-2">
            <dt>{l.label}</dt>
            <dd className="tabular-nums">
              {money(l.paise)}
              {compare && (
                <span className="ml-4 text-ink-muted">
                  {money(l.comparePaise)}
                </span>
              )}
            </dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 bg-app px-4 py-2 font-semibold">
          <dt>{totalLabel}</dt>
          <dd className="tabular-nums">
            {money(total.now)}
            {compare && (
              <span className="ml-4 text-ink-muted">{money(total.before)}</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function IncomeExpenditure({ r }) {
  const c = r.compare;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total income" value={money(r.totalIncomePaise)} />
        <StatCard
          label="Total expenditure"
          value={money(r.totalExpenditurePaise)}
        />
        <StatCard
          label={
            r.surplusPaise < 0
              ? "Deficit for the period"
              : "Surplus for the period"
          }
          value={money(Math.abs(r.surplusPaise))}
        />
      </div>
      {c && (
        <p className="text-sm text-ink-muted">
          The grey amount is the earlier period, {niceDate(c.from)} to{" "}
          {niceDate(c.to)}.
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <Lines
          title="Income"
          lines={r.income}
          totalLabel="Total income"
          total={{ now: r.totalIncomePaise, before: c?.totalIncomePaise }}
          compare={!!c}
        />
        <Lines
          title="Expenditure"
          lines={r.expenditure}
          totalLabel="Total expenditure"
          total={{
            now: r.totalExpenditurePaise,
            before: c?.totalExpenditurePaise,
          }}
          compare={!!c}
        />
      </div>
    </div>
  );
}

function BalanceSheet({ r }) {
  return (
    <div className="flex flex-col gap-3">
      {r.differencePaise !== 0 && (
        <div
          role="alert"
          className="rounded-card border border-warning bg-app p-3 text-sm"
        >
          Assets and funds differ by{" "}
          <strong>{money(Math.abs(r.differencePaise))}</strong>
          {r.differencePaise > 0
            ? " (assets are higher)"
            : " (funds are higher)"}
          . Check the opening balances (fixed assets and capital) with your
          accountant. The difference is shown, never hidden.
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <Lines
          title="Assets"
          lines={r.assets}
          totalLabel="Total assets"
          total={{ now: r.totalAssetsPaise }}
        />
        <Lines
          title="Funds"
          lines={r.funds}
          totalLabel="Total funds"
          total={{ now: r.totalFundsPaise }}
        />
      </div>
      <Card
        title="Memo items (not in the totals)"
        subtitle="Cash basis: these are shown for information only."
      >
        <dl className="divide-y divide-line text-sm">
          <div className="flex justify-between py-2">
            <dt>Fee dues still to be received (late fee not included)</dt>
            <dd className="tabular-nums">{money(r.memo.feeReceivablePaise)}</dd>
          </div>
          <div className="flex justify-between py-2">
            <dt>Approved expenses not yet paid</dt>
            <dd className="tabular-nums">{money(r.memo.payablesPaise)}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

function TrialBalance({ r }) {
  const columns = [
    { key: "label", header: "Account", render: (x) => x.label },
    {
      key: "d",
      header: "Debit",
      align: "right",
      render: (x) => (x.debitPaise ? money(x.debitPaise) : ""),
    },
    {
      key: "c",
      header: "Credit",
      align: "right",
      render: (x) => (x.creditPaise ? money(x.creditPaise) : ""),
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      {r.differencePaise !== 0 && (
        <div
          role="alert"
          className="rounded-card border border-warning bg-app p-3 text-sm"
        >
          The opening balances do not agree with the money held (difference{" "}
          <strong>{money(Math.abs(r.differencePaise))}</strong>). It is shown on
          its own line so the two totals match. Check the fixed assets and
          capital with your accountant.
        </div>
      )}
      <Table
        columns={columns}
        rows={r.rows}
        rowKey={(x) => x.label}
        emptyTitle="No accounts"
      />
      <div className="flex justify-between rounded-card border border-line bg-app px-4 py-2 text-sm font-semibold">
        <span>Total</span>
        <span className="tabular-nums">
          {money(r.totalDebitPaise)} / {money(r.totalCreditPaise)}
        </span>
      </div>
    </div>
  );
}

function DayBook({ r, page, pageSize, onPage, onPageSize }) {
  const columns = [
    { key: "at", header: "Date and time", render: (x) => stamp(x.at) },
    { key: "type", header: "Type", render: (x) => x.type },
    { key: "ref", header: "Reference", render: (x) => x.ref },
    { key: "who", header: "Particulars", render: (x) => x.particulars },
    { key: "acc", header: "Account", render: (x) => x.account },
    {
      key: "in",
      header: "Money in",
      align: "right",
      render: (x) => (x.inPaise ? money(x.inPaise) : ""),
    },
    {
      key: "out",
      header: "Money out",
      align: "right",
      render: (x) => (x.outPaise ? money(x.outPaise) : ""),
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Entries" value={r.total} />
        <StatCard
          label="Money in (whole period)"
          value={money(r.totalInPaise)}
        />
        <StatCard
          label="Money out (whole period)"
          value={money(r.totalOutPaise)}
        />
      </div>
      <Table
        columns={columns}
        rows={r.rows}
        rowKey={(x) => `${x.type}-${x.id}`}
        emptyTitle="No entries in this period"
        emptyDescription="Choose other dates."
      />
      {r.total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={r.total}
          onPageChange={onPage}
          onPageSizeChange={onPageSize}
          pageSizes={[25, 50, 100, 200]}
        />
      )}
    </div>
  );
}

function OpeningBalances({ onClose }) {
  const { notify } = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["report-settings"],
    queryFn: () => api("/api/reports/settings"),
  });
  const [fixed, setFixed] = useState(null);
  const [capital, setCapital] = useState(null);
  const [reason, setReason] = useState("");
  const fixedText = fixed ?? paiseToRupeesString(q.data?.fixedAssetsPaise ?? 0);
  const capitalText = capital ?? paiseToRupeesString(q.data?.capitalPaise ?? 0);
  const f = parseRupees(fixedText);
  const c = parseRupees(capitalText);
  const save = useMutation({
    mutationFn: () =>
      api("/api/reports/settings", {
        method: "PUT",
        body: {
          fixedAssetsRupees: fixedText,
          capitalRupees: capitalText,
          reason,
        },
      }),
    onSuccess: () => {
      notify("Opening balances saved", "success");
      void qc.invalidateQueries({ queryKey: ["report-settings"] });
      void qc.invalidateQueries({ queryKey: ["report"] });
      onClose();
    },
    onError: (e) => notify(errorText(e), "error"),
  });
  const bad = f.error || c.error || reason.trim().length < 3;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Opening balances"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="opening-form"
            disabled={!!bad || save.isPending || !q.data}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-muted">
        Fixed assets and the capital / reserve fund are entered once. Every
        change is kept with its reason.
      </p>
      {q.isPending && <Spinner label="Loading" />}
      {q.isError && (
        <ErrorState
          message={errorText(q.error)}
          onRetry={() => void q.refetch()}
        />
      )}
      {q.data && (
        <form
          id="opening-form"
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!bad) save.mutate();
          }}
        >
          <Input
            label="Fixed assets (₹)"
            inputMode="decimal"
            value={fixedText}
            error={f.error}
            onChange={(e) => setFixed(e.target.value)}
          />
          <Input
            label="Capital / reserve fund (₹)"
            inputMode="decimal"
            value={capitalText}
            error={c.error}
            onChange={(e) => setCapital(e.target.value)}
          />
          <Input
            label="Reason for this entry"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {q.data.history.length > 0 && (
            <ul className="max-h-32 overflow-auto text-xs text-ink-muted">
              {q.data.history.map((h) => (
                <li key={`${h.at}`}>
                  {stamp(h.at)}, {h.byName ?? "Admin"}: assets{" "}
                  {money(h.fixedAssetsPaise)}, capital {money(h.capitalPaise)},{" "}
                  {h.reason}
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
    </Dialog>
  );
}

/**
 * Reports (cash basis): Income & Expenditure, Balance Sheet, Trial Balance, Day Book. Every
 * figure is computed on the server from receipts, payments, petty cash and the money ledger.
 */
export function Reports() {
  const { role } = useAuth();
  const { notify } = useToast();
  const [tab, setTab] = useState("income-expenditure");
  const [draft, setDraft] = useState({
    from: fyStartInput(),
    to: todayInput(),
    compare: "none",
  });
  const [applied, setApplied] = useState(draft);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [opening, setOpening] = useState(false);
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const invalid = !draft.from || !draft.to || draft.from > draft.to;

  const params = () => {
    const p = new URLSearchParams();
    if (tab === "balance-sheet") p.set("asOn", applied.to);
    else {
      p.set("from", applied.from);
      p.set("to", applied.to);
    }
    if (tab === "income-expenditure") p.set("compare", applied.compare);
    return p;
  };
  const query = useQuery({
    queryKey: [
      "report",
      tab,
      applied,
      tab === "day-book" ? [page, pageSize] : null,
    ],
    queryFn: () => {
      const p = params();
      if (tab === "day-book") {
        p.set("page", page);
        p.set("pageSize", pageSize);
      }
      return api(`/api/reports/${tab}?${p}`);
    },
  });
  const r = query.data;

  async function exportXlsx() {
    try {
      const p = params();
      p.set("type", tab);
      const blob = await api(`/api/reports/export?${p}`, { blob: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${tab}-${applied.to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify(errorText(e), "error");
    }
  }

  async function print() {
    try {
      const head2 = (a, b) => [{ label: a }, { label: b, right: true }];
      const lines = (xs) => xs.map((l) => [l.label, money(l.paise)]);
      let sections;
      let title = TABS.find((t) => t.key === tab).label;
      let subtitle = `${niceDate(applied.from)} to ${niceDate(applied.to)} · Cash basis`;
      let notes = [];
      if (tab === "income-expenditure") {
        sections = [
          {
            head: head2("Income", "Amount"),
            rows: lines(r.income),
            foot: ["Total income", money(r.totalIncomePaise)],
          },
          {
            head: head2("Expenditure", "Amount"),
            rows: lines(r.expenditure),
            foot: ["Total expenditure", money(r.totalExpenditurePaise)],
          },
          {
            head: head2("Result", "Amount"),
            rows: [
              [
                r.surplusPaise < 0
                  ? "Deficit for the period"
                  : "Surplus for the period",
                money(Math.abs(r.surplusPaise)),
              ],
            ],
          },
        ];
      } else if (tab === "balance-sheet") {
        subtitle = `As on ${niceDate(r.asOn)} · Cash basis`;
        sections = [
          {
            head: head2("Assets", "Amount"),
            rows: lines(r.assets),
            foot: ["Total assets", money(r.totalAssetsPaise)],
          },
          {
            head: head2("Funds", "Amount"),
            rows: lines(r.funds),
            foot: ["Total funds", money(r.totalFundsPaise)],
          },
          {
            title: "Memo items (not in the totals)",
            head: head2("Item", "Amount"),
            rows: [
              [
                "Fee dues still to be received (late fee not included)",
                money(r.memo.feeReceivablePaise),
              ],
              ["Approved expenses not yet paid", money(r.memo.payablesPaise)],
            ],
          },
        ];
        if (r.differencePaise !== 0)
          notes = [
            `Assets and funds differ by ${money(Math.abs(r.differencePaise))}. Check the opening balances.`,
          ];
      } else if (tab === "trial-balance") {
        sections = [
          {
            head: [
              { label: "Account" },
              { label: "Debit", right: true },
              { label: "Credit", right: true },
            ],
            rows: r.rows.map((x) => [
              x.label,
              x.debitPaise ? money(x.debitPaise) : "",
              x.creditPaise ? money(x.creditPaise) : "",
            ]),
            foot: [
              "Total",
              money(r.totalDebitPaise),
              money(r.totalCreditPaise),
            ],
          },
        ];
      } else {
        // The printout carries the whole period, not just the page on screen.
        const p = params();
        p.set("page", 1);
        p.set("pageSize", 200);
        const all = [];
        let first = await api(`/api/reports/day-book?${p}`);
        all.push(...first.rows);
        for (let n = 2; all.length < first.total && n <= 100; n += 1) {
          p.set("page", n);
          first = await api(`/api/reports/day-book?${p}`);
          all.push(...first.rows);
        }
        sections = [
          {
            head: [
              { label: "Date and time" },
              { label: "Type" },
              { label: "Reference" },
              { label: "Particulars" },
              { label: "Account" },
              { label: "In", right: true },
              { label: "Out", right: true },
            ],
            rows: all.map((x) => [
              stamp(x.at),
              x.type,
              x.ref,
              x.particulars,
              x.account,
              x.inPaise ? money(x.inPaise) : "",
              x.outPaise ? money(x.outPaise) : "",
            ]),
            foot: [
              "Total",
              "",
              "",
              "",
              "",
              money(r.totalInPaise),
              money(r.totalOutPaise),
            ],
          },
        ];
      }
      await printHtml({
        html: reportHtml({ title, subtitle, sections, notes }),
        css: REPORT_CSS,
        title,
      });
    } catch (e) {
      notify(errorText(e), "error");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Reports</h1>
          <p className="text-sm text-ink-muted">
            Statutory and financial statements, worked out from the
            school&apos;s own records (cash basis).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {role === "admin" && (
            <Button variant="secondary" onClick={() => setOpening(true)}>
              Opening balances
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={!r}
            onClick={() => void print()}
          >
            Print (A4)
          </Button>
          <Button
            variant="secondary"
            disabled={!r}
            onClick={() => void exportXlsx()}
          >
            Export to Excel
          </Button>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Report"
        className="flex flex-wrap gap-1 border-b border-line"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => {
              setTab(t.key);
              setPage(1);
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.key
                ? "border-ink text-ink"
                : "border-transparent text-ink-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) {
            setApplied(draft);
            setPage(1);
          }
        }}
      >
        {tab !== "balance-sheet" && (
          <Input
            label="From"
            type="date"
            max={todayInput()}
            value={draft.from}
            onChange={set("from")}
          />
        )}
        <Input
          label={tab === "balance-sheet" ? "As on" : "To"}
          type="date"
          max={todayInput()}
          value={draft.to}
          onChange={set("to")}
        />
        {tab === "income-expenditure" && (
          <Select
            label="Compare with"
            options={COMPARE}
            value={draft.compare}
            onChange={set("compare")}
          />
        )}
        <Button type="submit" disabled={invalid}>
          Update report
        </Button>
      </form>
      {invalid && (
        <p className="text-sm text-danger">
          Choose a start date that is not after the end date.
        </p>
      )}

      {query.isPending && <Spinner label="Loading report" />}
      {query.isError && (
        <ErrorState
          message={errorText(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}
      {r && tab === "income-expenditure" && <IncomeExpenditure r={r} />}
      {r && tab === "balance-sheet" && <BalanceSheet r={r} />}
      {r && tab === "trial-balance" && <TrialBalance r={r} />}
      {r && tab === "day-book" && (
        <DayBook
          r={r}
          page={page}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
      <p className="text-xs text-ink-muted">
        Fixed assets and capital come from the opening balances entered at
        setup. Have your accountant review these layouts before go-live.
      </p>
      {opening && <OpeningBalances onClose={() => setOpening(false)} />}
    </div>
  );
}
