import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  classLabel,
  formatINR,
  paiseToRupeesString,
  rupeesToPaise,
} from "@erp/shared";
import { api, newIdempotencyKey } from "../api/client";
import { Icon, IconTile } from "../components/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Spinner,
  useToast,
} from "../components/ui";

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
function periodLabel(period) {
  if (period === "once") return "One time";
  if (period === "opening") return "Old fees";
  const [y, m] = period.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}
/** Doodle shown before a student is chosen, so the screen is not blank. Drawn inline (no download). */
function FindStudentArt() {
  return (
    <div
      className="flex flex-col items-center gap-2 py-6 text-center"
      data-testid="find-student-art"
    >
      <svg
        width="260"
        height="150"
        viewBox="0 0 260 150"
        fill="none"
        aria-hidden="true"
      >
        <g
          stroke="currentColor"
          className="text-brand"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M126 10v8M108 16l5 6M144 16l-5 6" opacity=".6" />
          <rect
            x="22"
            y="48"
            width="78"
            height="52"
            rx="8"
            transform="rotate(-6 22 48)"
            fill="#eef2ff"
            opacity=".8"
          />
          <rect
            x="160"
            y="48"
            width="78"
            height="52"
            rx="8"
            transform="rotate(6 238 48)"
            fill="#eef2ff"
            opacity=".8"
          />
          <rect x="70" y="36" width="120" height="86" rx="12" fill="#fff" />
          <rect x="82" y="50" width="34" height="34" rx="6" fill="#dbeafe" />
          <circle cx="99" cy="62" r="6" />
          <path d="M89 80c2-7 18-7 20 0" />
          <path d="M126 56h50M126 68h40M126 80h46" opacity=".6" />
          <path d="M82 100h96" opacity=".4" />
          <circle cx="170" cy="36" r="14" fill="#2563eb" stroke="none" />
          <path
            d="M162 35l8-4 8 4-8 4zM165 38v4c3 2 7 2 10 0v-4"
            stroke="#fff"
            strokeWidth="1.6"
          />
        </g>
      </svg>
      <p className="text-lg font-semibold text-ink">
        Find a student to get started
      </p>
      <p className="text-sm text-ink-muted">
        Fee details and payment options will appear here.
      </p>
      <div className="mt-1 flex flex-wrap justify-center gap-2 text-sm text-ink">
        {["Name", "Scholar No.", "Mobile"].map((t) => (
          <span
            key={t}
            className="rounded-full border border-line bg-app px-3 py-1"
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Cashier: find a student, pick School fees or Transport fees, enter amounts, take payment. */
export function CollectFee() {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [kind, setKind] = useState("school");

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fees Database / Student Fee Details open this screen with ?student=<id> already chosen.
  const [params] = useSearchParams();
  const preId = params.get("student");
  const pre = useQuery({
    queryKey: ["collect-student", preId],
    queryFn: () => api(`/api/students/${preId}`),
    enabled: !!preId,
    retry: false,
  });
  const student =
    picked ?? (!dismissed && pre.data?.status === "active" ? pre.data : null);

  const found = useQuery({
    queryKey: ["collect-search", q],
    queryFn: () =>
      api(`/api/students?status=active&pageSize=8&q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2 && !student,
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <h1 className="flex items-center gap-3 text-2xl font-bold text-ink">
        <span className="text-brand">
          <Icon name="stack" size={28} />
        </span>
        Collect Fee
      </h1>
      {preId && pre.isError && (
        <p role="alert" className="text-center text-sm text-danger">
          That student could not be opened. Search for the student below.
        </p>
      )}
      {preId && pre.data && pre.data.status !== "active" && !student && (
        <p role="alert" className="text-center text-sm text-danger">
          {pre.data.name} is inactive, so fees cannot be collected.
        </p>
      )}

      <Card title={student ? undefined : "Student"} center={!student}>
        {student ? (
          <div className="flex flex-wrap items-center gap-4">
            <IconTile name="cap" box="h-16 w-16" size={32} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-3 text-xl font-bold uppercase text-ink">
                {student.name}
                <Badge tone="success">Active</Badge>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
                <span>Adm. No. {student.admissionNo}</span>
                <span className="h-4 w-px bg-line" aria-hidden="true" />
                <span>
                  Class {classLabel(student.classKey)}
                  {student.section ? ` - ${student.section}` : ""}
                </span>
                {student.fatherName && (
                  <>
                    <span className="h-4 w-px bg-line" aria-hidden="true" />
                    <span>Father: {student.fatherName}</span>
                  </>
                )}
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setPicked(null);
                setDismissed(true);
                setSearch("");
              }}
            >
              Change student
            </Button>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-xl flex-col gap-3 text-center">
            <Input
              label="Search student"
              placeholder="Name, father, mobile or scholar number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            {q.length < 2 && (
              <>
                <p className="text-sm text-ink-muted">
                  Type at least 2 letters or digits.
                </p>
                <FindStudentArt />
              </>
            )}
            {found.isFetching && <Spinner label="Searching" />}
            {found.isError && (
              <ErrorState
                message={found.error.message}
                onRetry={() => found.refetch()}
              />
            )}
            {found.data && found.data.rows.length === 0 && (
              <EmptyState
                title="No active student found"
                description="Try another name or number."
              />
            )}
            {found.data && found.data.rows.length > 0 && (
              <ul className="divide-y divide-line rounded-card border border-line">
                {found.data.rows.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(s)}
                      className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-app"
                    >
                      <span className="font-medium text-ink">
                        {s.name}{" "}
                        <span className="text-ink-muted">
                          · Sch. {s.admissionNo}
                        </span>
                      </span>
                      <span className="text-sm text-ink-muted">
                        {classLabel(s.classKey)}
                        {s.section ? `-${s.section}` : ""}
                        {s.fatherName ? ` · ${s.fatherName}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      {student && (
        <>
          <div role="tablist" aria-label="Fee type" className="flex gap-3">
            {[
              ["school", "School Fees", "cap"],
              ["transport", "Transport Fees", "bus"],
            ].map(([k, label, icon]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => setKind(k)}
                className={`inline-flex min-h-12 items-center gap-2 rounded-xl px-5 text-sm font-semibold transition ${
                  kind === k
                    ? "bg-brand text-white shadow-glow"
                    : "glass border border-line text-ink hover:shadow-lift"
                }`}
              >
                <Icon name={icon} size={20} />
                {label}
              </button>
            ))}
          </div>
          <CollectForm
            key={`${student.id}-${kind}`}
            student={student}
            kind={kind}
          />
        </>
      )}
    </div>
  );
}

function CollectForm({ student, kind }) {
  const { notify } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dues = useQuery({
    queryKey: ["dues", student.id, kind],
    queryFn: () => api(`/api/students/${student.id}/dues?kind=${kind}`),
  });
  // One key per open form: a double click or a retry can never make two receipts (rule 5).
  const keyRef = useRef(newIdempotencyKey());
  // null = "take the value the system worked out" (what is due today). Typing replaces it.
  const [f, setF] = useState({
    old: null,
    current: null,
    admission: null,
    form: null,
    tc: "",
    other: "",
    otherNote: "",
    late: null, // null = take the calculated late fee
    lateRemark: "",
    // How the parent pays. Cash and UPI / QR can both be on: that is a split receipt.
    useCash: true,
    cashAmt: null, // null = whatever is left after the typed amounts
    useUpi: false,
    upiParts: [{ amount: null, bankId: "", reference: "" }],
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const set = (patch) => setF((p) => ({ ...p, ...patch }));

  const d = dues.data;
  const rem = d?.remaining ?? {};
  const oldHead = kind === "school" ? "old_fees" : "transport_old";
  const curHead = kind === "school" ? "tuition" : "transport";
  const lateCalc = d?.lateFeeCalculatedPaise ?? 0;

  // What is due today, per fee head: this is what the amount boxes start with.
  const dueTodayOf = (head) =>
    (d?.instalments ?? [])
      .filter((i) => i.isDue || i.isOverdue)
      .flatMap((i) => i.items ?? [])
      .filter((x) => x.head === head)
      .reduce((n, x) => n + x.due, 0);
  const rupees = (paise) =>
    paise > 0 ? paiseToRupeesString(paise).replace(/\.00$/, "") : "";
  const defaults = {
    old: rupees(rem[oldHead] ?? 0),
    current: rupees(dueTodayOf(curHead)),
    admission: rupees(rem.admission ?? 0),
    form: rupees(rem.form ?? 0),
    tc: "",
    other: "",
  };
  const eff = (key) => f[key] ?? defaults[key];

  // Amount boxes are typed in rupees. A bad box makes the total unknown and blocks Collect.
  const parse = (v) => {
    if (String(v).trim() === "") return { paise: 0 };
    try {
      const paise = rupeesToPaise(v);
      return paise < 0 ? { error: "Cannot be negative" } : { paise };
    } catch {
      return { error: "Enter a valid amount" };
    }
  };
  const p = {
    old: parse(eff("old")),
    current: parse(eff("current")),
    admission: parse(eff("admission")),
    form: parse(eff("form")),
    tc: parse(eff("tc")),
    other: parse(eff("other")),
    late: f.late === null ? { paise: lateCalc } : parse(f.late),
  };
  const bad = Object.values(p).some((x) => x.error);
  const lateWaived = p.late.error ? 0 : Math.max(0, lateCalc - p.late.paise);
  const total = bad
    ? null
    : p.old.paise +
      p.current.paise +
      p.admission.paise +
      p.form.paise +
      p.tc.paise +
      p.other.paise +
      p.late.paise;

  // ----- how it is paid -----
  // UPI / QR money lands in a bank account: the Cashier picks it (the Admin's default is preselected).
  const banks = useQuery({
    queryKey: ["banks", "options"],
    queryFn: () => api("/api/banks/options"),
    enabled: f.useUpi,
  });
  const bankList = banks.data?.banks ?? [];
  const defaultBank =
    bankList.find((b) => b.defaultForModes.includes("upi"))?.id || "";
  const setPart = (i, patch) =>
    set({
      upiParts: f.upiParts.map((u, j) => (j === i ? { ...u, ...patch } : u)),
    });
  // Every payment box: typed ones are fixed, the first untyped one takes what is left of the total.
  const boxes = [
    ...(f.useCash
      ? [{ key: "cash", typed: f.cashAmt === null ? null : parse(f.cashAmt) }]
      : []),
    ...(f.useUpi
      ? f.upiParts.map((u, i) => ({
          key: `u${i}`,
          typed: u.amount === null ? null : parse(u.amount),
        }))
      : []),
  ];
  const payBad = boxes.some((b) => b.typed?.error);
  const typedSum = boxes.reduce(
    (n, b) => n + (b.typed && !b.typed.error ? b.typed.paise : 0),
    0,
  );
  const autoKey = boxes.find((b) => !b.typed)?.key;
  const leftOver = total === null || payBad ? 0 : Math.max(0, total - typedSum);
  const amountOf = (key) => {
    const b = boxes.find((x) => x.key === key);
    if (!b) return 0;
    if (b.typed) return b.typed.error ? 0 : b.typed.paise;
    return key === autoKey ? leftOver : 0;
  };
  const shown = (key, typedText) =>
    typedText !== null ? typedText : rupees(amountOf(key));
  const cashPaise = f.useCash ? amountOf("cash") : 0;
  const upiRows = f.useUpi
    ? f.upiParts.map((u, i) => ({
        ...u,
        paise: amountOf(`u${i}`),
        bank: u.bankId || defaultBank,
      }))
    : [];
  const upiUsed = upiRows.filter((u) => u.paise > 0);
  const paidSum = cashPaise + upiRows.reduce((n, u) => n + u.paise, 0);
  const cashOnly = f.useCash && upiUsed.length === 0;
  // Cash alone may be more than the total (the parent hands a bigger note): that is "change".
  const diff = total === null || payBad ? null : paidSum - total;
  const change = cashOnly && diff !== null && diff > 0 ? diff : 0;
  const payMismatch = diff !== null && (cashOnly ? diff < 0 : diff !== 0);

  const missing =
    (!f.useCash &&
      !f.useUpi &&
      "Choose how the parent is paying: Cash, UPI / QR, or both.") ||
    (payBad && "Enter valid amounts in the payment boxes.") ||
    (total > 0 &&
      payMismatch &&
      (diff < 0
        ? `Payments are short by ${formatINR(-diff, { hideZeroPaise: true })}.`
        : `Payments are more than the total by ${formatINR(diff, { hideZeroPaise: true })}.`)) ||
    (upiUsed.some((u) => !u.bank) &&
      "Choose the bank account for each UPI / QR amount.") ||
    (upiUsed.some((u) => u.reference.trim().length < 4) &&
      "Enter the UPI / QR reference for each UPI / QR amount.") ||
    (lateWaived > 0 &&
      f.lateRemark.trim().length < 3 &&
      "Write the reason for reducing the late fee.") ||
    (p.other.paise > 0 &&
      f.otherNote.trim().length < 2 &&
      'Write what the "Other" fee is for.') ||
    null;
  const canSubmit = !bad && total > 0 && !missing;

  // The server gets the legacy single-mode shape when one payment pays it all, else payments[].
  const paymentBody = () => {
    if (upiUsed.length === 0) return { mode: "cash" };
    if (cashPaise === 0 && upiUsed.length === 1)
      return {
        mode: "upi",
        bankId: upiUsed[0].bank,
        reference: upiUsed[0].reference.trim(),
      };
    return {
      payments: [
        ...(cashPaise > 0 ? [{ mode: "cash", amountPaise: cashPaise }] : []),
        ...upiUsed.map((u) => ({
          mode: "upi",
          amountPaise: u.paise,
          bankId: u.bank,
          reference: u.reference.trim(),
        })),
      ],
    };
  };

  const collect = useMutation({
    mutationFn: () =>
      api("/api/receipts", {
        method: "POST",
        idempotencyKey: keyRef.current,
        body: {
          studentId: student.id,
          kind,
          ...paymentBody(),
          input: {
            oldPaise: p.old.paise,
            newPaise: p.current.paise,
            admissionPaise: p.admission.paise,
            formPaise: p.form.paise,
            tcPaise: p.tc.paise,
            otherPaise: p.other.paise,
            otherNote: p.other.paise > 0 ? f.otherNote.trim() : undefined,
            lateFeePaise: p.late.paise,
            lateFeeRemark: lateWaived > 0 ? f.lateRemark.trim() : undefined,
          },
        },
      }),
    onSuccess: async (receipt) => {
      await queryClient.invalidateQueries({ queryKey: ["dues"] });
      await queryClient.invalidateQueries({ queryKey: ["ledger"] });
      // WHY: Fees Database, dashboards, bank and cash balances and the receipts list must show this payment at once.
      await queryClient.invalidateQueries({ queryKey: ["fees-database"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["receipts"] });
      await queryClient.invalidateQueries({ queryKey: ["money"] });
      await queryClient.invalidateQueries({ queryKey: ["cashbook"] });
      await queryClient.invalidateQueries({ queryKey: ["fee-details"] });
      await queryClient.invalidateQueries({ queryKey: ["day-close"] });
      await queryClient.invalidateQueries({ queryKey: ["report"] });
      notify(`Receipt ${receipt.number} created.`, "success");
      navigate(`/receipts/${receipt.id}`, { state: { fresh: true } });
    },
    onError: (e) => {
      setFieldErrors(e.fields ?? {});
      // A refused payment saved nothing, so the next try may use a new key.
      if (e.status >= 400 && e.status < 500)
        keyRef.current = newIdempotencyKey();
      notify(
        `${e.message}${e.requestId ? ` (ref ${e.requestId})` : ""}`,
        "error",
      );
    },
  });

  if (dues.isPending) return <Spinner label="Loading dues" />;
  if (dues.isError)
    return (
      <ErrorState message={dues.error.message} onRetry={() => dues.refetch()} />
    );

  if (d && d.planPosted === false)
    return (
      <Card title="Fees not posted yet" center>
        <p className="text-sm text-ink-muted">
          This student has no fees posted for {d.fy}, so nothing can be
          collected. Fees are posted automatically every month, so the Admin
          should check this student's class and village and the fee chart
          (Dashboard shows what could not be priced).
        </p>
      </Card>
    );

  const nothingPending = !(
    rem[oldHead] ||
    rem[curHead] ||
    rem.admission ||
    rem.form
  );
  const amountBox = (key, label, pending, extra = {}) => (
    <Input
      label={label}
      inputMode="decimal"
      placeholder="0"
      value={eff(key)}
      hint={
        pending !== undefined
          ? `Pending ${formatINR(pending, { hideZeroPaise: true })}`
          : undefined
      }
      error={p[key]?.error ?? fieldErrors[extra.field]}
      onChange={(e) => set({ [key]: e.target.value })}
    />
  );
  const bankOptions = [
    {
      value: "",
      label: banks.isPending
        ? "Loading banks..."
        : bankList.length
          ? "Choose a bank"
          : "No bank account yet. Ask the Admin to add one.",
    },
    ...bankList.map((b) => ({
      value: b.id,
      label: `${b.name}${b.last4 ? ` ••••${b.last4}` : ""}`,
    })),
  ];

  // Month rows: the whole financial year, April to March. Months with no fee posted say so.
  const rows = monthRows(d.instalments, d.fy, d.asOf);
  const totalPending = rows.reduce(
    (n, i) => n + (i.notPosted ? 0 : (i.due ?? 0)),
    0,
  );
  const modeTile = (on, toggle, icon, label) => (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={toggle}
      className={`relative flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border-2 text-sm font-semibold transition ${
        on
          ? "border-brand bg-blue-100 text-brand shadow-glow"
          : "border-line bg-white text-ink hover:border-blue-400"
      }`}
    >
      {on && (
        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white">
          <Icon name="check" size={13} />
        </span>
      )}
      <Icon name={icon} size={24} />
      {label}
    </button>
  );
  const money = (n) => formatINR(n, { hideZeroPaise: true });

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_440px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card
          icon="calendar"
          title="Fee Schedule"
          subtitle={`${kind === "school" ? "School fees" : "Transport fees"} · all 12 months, April to March`}
          actions={
            kind === "transport" && !student.usesTransport && !rem[oldHead] ? (
              <Badge tone="warning">Student does not use the bus</Badge>
            ) : null
          }
        >
          {rows.length === 0 ? (
            <EmptyState
              title="No fees posted"
              description="No fees are posted for this student in this year. The Admin posts the fee plan from the student's profile."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-blue-200 text-xs uppercase text-blue-800">
                  <tr>
                    <th className="px-4 py-2 font-medium">Month</th>
                    <th className="px-4 py-2 font-medium">Due date</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Pending
                    </th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((i) => (
                    <tr
                      key={`${i.dueDate ?? ""}-${i.period}`}
                      className={i.notPosted ? "text-ink-muted" : ""}
                    >
                      <td className="px-4 py-2">{periodLabel(i.period)}</td>
                      <td className="px-4 py-2">{i.dueDate ?? "-"}</td>
                      <td className="px-4 py-2 text-right">
                        {i.notPosted
                          ? "-"
                          : formatINR(i.due, { hideZeroPaise: true })}
                      </td>
                      <td className="px-4 py-2">
                        {i.notPosted ? (
                          <Badge>
                            {i.past ? "No fee posted" : "Not due yet"}
                          </Badge>
                        ) : i.due === 0 ? (
                          <Badge tone="success">Paid</Badge>
                        ) : i.isOverdue ? (
                          <Badge tone="danger">Overdue</Badge>
                        ) : i.isDue ? (
                          <Badge tone="warning">Due</Badge>
                        ) : (
                          <Badge>Not due yet</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl bg-blue-100 px-4 py-3">
              <div>
                <p className="text-xs text-ink-muted">
                  Total pending (whole year)
                </p>
                <p className="text-xl font-bold text-ink">
                  {money(totalPending)}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">Due till today</p>
                <p className="text-xl font-bold text-ink">
                  {money(d.dueNowPaise ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">Collecting now</p>
                <p className="text-xl font-bold text-brand">
                  {total === null ? "-" : money(total)}
                </p>
              </div>
            </div>
          )}
          {nothingPending && rows.length > 0 && (
            <p className="mt-3 text-sm text-ink-muted">
              Everything posted for this year is paid. Parents like this deserve
              a medal.
            </p>
          )}
        </Card>
      </div>

      <div className="lg:sticky lg:top-4">
        <Card
          icon="card"
          title="Collect & Pay"
          subtitle="Fees in, receipt out. No haggling, no hide-and-seek."
        >
          <div className="flex flex-col gap-4">
            <p className="rounded-xl bg-blue-200 px-4 py-3 text-2xl font-bold text-brand">
              Total to collect:{" "}
              {total === null ? "-" : formatINR(total, { hideZeroPaise: true })}
            </p>
            {total === 0 && !nothingPending && (
              <p className="-mt-2 text-sm text-ink-muted">
                Zero rupees so far. The school bell is ringing, not the cash
                box.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {rem[oldHead] > 0 &&
                amountBox("old", "Old fees (₹)", rem[oldHead], {
                  field: "oldPaise",
                })}
              {amountBox(
                "current",
                kind === "school" ? "Tuition fees (₹)" : "Transport fees (₹)",
                rem[curHead] ?? 0,
                { field: "newPaise" },
              )}
              {kind === "school" &&
                rem.admission > 0 &&
                amountBox("admission", "Admission fees (₹)", rem.admission, {
                  field: "admissionPaise",
                })}
              {kind === "school" &&
                rem.form > 0 &&
                amountBox("form", "Form fees (₹)", rem.form, {
                  field: "formPaise",
                })}
              {kind === "school" &&
                amountBox("tc", "T.C. (₹)", undefined, { field: "tcPaise" })}
              {kind === "school" &&
                amountBox("other", "Other (₹)", undefined, {
                  field: "otherPaise",
                })}
            </div>
            {kind === "school" && p.other.paise > 0 && (
              <Input
                label="Other: what is it for?"
                required
                value={f.otherNote}
                error={fieldErrors.otherNote}
                onChange={(e) => set({ otherNote: e.target.value })}
              />
            )}
            {lateCalc > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Late fee to charge (₹)"
                  inputMode="decimal"
                  hint={`Calculated ${formatINR(lateCalc, { hideZeroPaise: true })}`}
                  value={
                    f.late === null ? paiseToRupeesString(lateCalc) : f.late
                  }
                  error={p.late.error ?? fieldErrors.lateFeePaise}
                  onChange={(e) => set({ late: e.target.value })}
                />
                {lateWaived > 0 && (
                  <Input
                    label="Reason for reducing"
                    required
                    value={f.lateRemark}
                    error={fieldErrors.lateFeeRemark}
                    onChange={(e) => set({ lateRemark: e.target.value })}
                  />
                )}
              </div>
            )}

            <div className="border-t border-line pt-4">
              <p className="mb-2 text-sm font-semibold text-ink">
                How is the parent paying?{" "}
                <span className="font-normal text-ink-muted">
                  (pick one, or both)
                </span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                {modeTile(
                  f.useCash,
                  () => set({ useCash: !f.useCash, cashAmt: null }),
                  "cash",
                  "Cash",
                )}
                {modeTile(
                  f.useUpi,
                  () => set({ useUpi: !f.useUpi }),
                  "qr",
                  "UPI / QR",
                )}
              </div>
            </div>

            {f.useCash && (
              <Input
                label="Cash amount (₹)"
                inputMode="decimal"
                placeholder="0"
                value={shown("cash", f.cashAmt)}
                error={boxes.find((b) => b.key === "cash")?.typed?.error}
                onChange={(e) => set({ cashAmt: e.target.value })}
              />
            )}
            {f.useUpi &&
              f.upiParts.map((u, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-3 rounded-xl border border-line bg-blue-100/60 p-3"
                >
                  <Select
                    label={`Bank account${f.upiParts.length > 1 ? ` ${i + 1}` : ""}`}
                    value={u.bankId || defaultBank}
                    onChange={(e) => setPart(i, { bankId: e.target.value })}
                    options={bankOptions}
                  />
                  <Input
                    label={`Bank amount${f.upiParts.length > 1 ? ` ${i + 1}` : ""} (₹)`}
                    inputMode="decimal"
                    placeholder="0"
                    value={shown(`u${i}`, u.amount)}
                    error={boxes.find((b) => b.key === `u${i}`)?.typed?.error}
                    onChange={(e) => setPart(i, { amount: e.target.value })}
                  />
                  <Input
                    label="UPI / QR reference no."
                    value={u.reference}
                    onChange={(e) => setPart(i, { reference: e.target.value })}
                  />
                  {f.upiParts.length > 1 && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        set({ upiParts: f.upiParts.filter((_, j) => j !== i) })
                      }
                    >
                      Remove this bank
                    </Button>
                  )}
                </div>
              ))}
            {f.useUpi && f.upiParts.length < 3 && (
              <Button
                variant="secondary"
                onClick={() =>
                  set({
                    upiParts: [
                      ...f.upiParts,
                      { amount: null, bankId: "", reference: "" },
                    ],
                  })
                }
              >
                + Add another bank account
              </Button>
            )}

            {total > 0 && diff !== null && (
              <p
                className={`rounded-xl px-4 py-2 text-sm font-medium ${
                  payMismatch
                    ? "bg-red-100 text-danger"
                    : "bg-green-100 text-success"
                }`}
              >
                {payMismatch
                  ? diff < 0
                    ? `${money(-diff)} still missing. Check the other pocket?`
                    : `${money(diff)} extra. Generous parent, or a typo?`
                  : change > 0
                    ? `Change to return: ${money(change)}. Please do not keep it as a tip.`
                    : "Payments match the total. The accountant is smiling."}
              </p>
            )}

            <Button
              className="w-full"
              loading={collect.isPending}
              disabled={!canSubmit}
              onClick={() => collect.mutate()}
            >
              {total
                ? `Collect ${money(total)} & Generate Receipt`
                : "Collect & Generate Receipt"}
            </Button>
            {missing && total > 0 && (
              <p className="text-sm text-danger">{missing}</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * Month rows for the dues table: the whole financial year, April to March, for school and transport.
 * A month with no fee posted is "Not due yet" when it is still to come and "No fee posted" when it has passed.
 */
function monthRows(instalments, fy, asOf) {
  if (!/^\d{4}-\d{2}$/.test(fy ?? "")) return instalments;
  const start = Number(fy.slice(0, 4));
  const byPeriod = new Map(instalments.map((i) => [i.period, i]));
  const nowPeriod = /^\d{4}-\d{2}/.test(asOf ?? "") ? asOf.slice(0, 7) : null;
  const rows = [];
  for (let n = 0; n < 12; n += 1) {
    const month = ((3 + n) % 12) + 1; // April first
    const year = month >= 4 ? start : start + 1;
    const period = `${year}-${String(month).padStart(2, "0")}`;
    rows.push(
      byPeriod.get(period) ?? {
        period,
        notPosted: true,
        past: nowPeriod !== null && period < nowPeriod,
      },
    );
  }
  // Old-fee / one-time rows stay visible too.
  const extra = instalments.filter(
    (i) => !rows.some((r) => r.period === i.period),
  );
  return [...extra, ...rows];
}
