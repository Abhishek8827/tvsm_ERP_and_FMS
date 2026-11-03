import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  classLabel,
  formatINR,
  paiseToRupeesString,
  rupeesToPaise,
} from "@erp/shared";
import { api, newIdempotencyKey } from "../api/client";
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
const MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI / QR" },
];

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
  const [student, setStudent] = useState(null);
  const [kind, setKind] = useState("school");

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const found = useQuery({
    queryKey: ["collect-search", q],
    queryFn: () =>
      api(`/api/students?status=active&pageSize=8&q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2 && !student,
  });

  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <h1 className="text-2xl font-semibold text-ink">Collect Fee</h1>

      <Card title="Student">
        {student ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-ink">
                {student.name}{" "}
                <span className="text-ink-muted">
                  · Sch. {student.admissionNo}
                </span>
              </p>
              <p className="text-sm text-ink-muted">
                Class {classLabel(student.classKey)}
                {student.section ? ` - ${student.section}` : ""}
                {student.fatherName ? ` · Father: ${student.fatherName}` : ""}
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setStudent(null);
                setSearch("");
              }}
            >
              Change student
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
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
                      onClick={() => setStudent(s)}
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
          <div role="tablist" aria-label="Fee type" className="flex gap-2">
            {[
              ["school", "School Fees"],
              ["transport", "Transport Fees"],
            ].map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => setKind(k)}
                className={`min-h-10 rounded-lg px-4 text-sm font-medium ${
                  kind === k
                    ? "bg-brand text-white"
                    : "border border-line bg-surface text-ink"
                }`}
              >
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
  const [f, setF] = useState({
    old: "",
    current: "",
    admission: "",
    form: "",
    tc: "",
    other: "",
    otherNote: "",
    late: null, // null = take the calculated late fee
    lateRemark: "",
    mode: "cash",
    received: "",
    reference: "",
    bankId: "", // '' = use the bank the Admin set as default for this mode
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const set = (patch) => setF((p) => ({ ...p, ...patch }));

  const d = dues.data;
  const rem = d?.remaining ?? {};
  const oldHead = kind === "school" ? "old_fees" : "transport_old";
  const curHead = kind === "school" ? "tuition" : "transport";
  const lateCalc = d?.lateFeeCalculatedPaise ?? 0;

  // Amount boxes are typed in rupees. A bad box makes the total unknown and blocks Collect.
  const parse = (v) => {
    if (v.trim() === "") return { paise: 0 };
    try {
      const paise = rupeesToPaise(v);
      return paise < 0 ? { error: "Cannot be negative" } : { paise };
    } catch {
      return { error: "Enter a valid amount" };
    }
  };
  const p = {
    old: parse(f.old),
    current: parse(f.current),
    admission: parse(f.admission),
    form: parse(f.form),
    tc: parse(f.tc),
    other: parse(f.other),
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
  const needsRef = f.mode !== "cash";
  // UPI / QR money lands in a bank account: the Cashier picks it (the Admin's default is preselected).
  const banks = useQuery({
    queryKey: ["banks", "options"],
    queryFn: () => api("/api/banks/options"),
    enabled: needsRef,
  });
  const bankList = banks.data?.banks ?? [];
  const bankId =
    f.bankId ||
    bankList.find((b) => b.defaultForModes.includes(f.mode))?.id ||
    "";
  const missing =
    (needsRef &&
      !bankId &&
      "Choose the bank account that received the money.") ||
    (needsRef &&
      f.reference.trim().length < 4 &&
      "Enter the UPI / QR reference number.") ||
    (lateWaived > 0 &&
      f.lateRemark.trim().length < 3 &&
      "Write the reason for reducing the late fee.") ||
    (p.other.paise > 0 &&
      f.otherNote.trim().length < 2 &&
      'Write what the "Other" fee is for.') ||
    null;
  const canSubmit = !bad && total > 0 && !missing;

  const collect = useMutation({
    mutationFn: () =>
      api("/api/receipts", {
        method: "POST",
        idempotencyKey: keyRef.current,
        body: {
          studentId: student.id,
          kind,
          mode: f.mode,
          reference: needsRef ? f.reference.trim() : undefined,
          bankId: needsRef ? bankId : undefined,
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
      // WHY: Fees Database, dashboards and the receipts list must show this payment at once.
      await queryClient.invalidateQueries({ queryKey: ["fees-database"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["receipts"] });
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
      <Card title="Fees not posted yet">
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
      value={f[key]}
      hint={
        pending !== undefined
          ? `Pending ${formatINR(pending, { hideZeroPaise: true })}`
          : undefined
      }
      error={p[key]?.error ?? fieldErrors[extra.field]}
      onChange={(e) => set({ [key]: e.target.value })}
    />
  );

  // Month rows. Transport always shows the whole year; months with no fee posted yet are "Not due yet".
  const rows = monthRows(d.instalments, kind, d.fy);
  const received = f.received.trim() === "" ? null : parse(f.received);
  const receivedPaise = received && !received.error ? received.paise : null;
  const shortBy = receivedPaise !== null && total > 0 && receivedPaise < total;
  const change =
    receivedPaise !== null && total !== null ? receivedPaise - total : null;
  const cashShort = f.mode === "cash" && shortBy;
  const blocker =
    missing || (cashShort && "Amount received is less than the total.") || null;
  const ready = canSubmit && !cashShort && !(received && received.error);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card
          title={kind === "school" ? "School fees" : "Transport fees"}
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
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-app text-xs uppercase text-ink-muted">
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
                          <Badge>Not due yet</Badge>
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
          {nothingPending && rows.length > 0 && (
            <p className="mt-3 text-sm text-ink-muted">
              Everything posted for this year is paid.
            </p>
          )}
        </Card>

        <Card title="Fees to collect">
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
            {kind === "school" && p.other.paise > 0 && (
              <Input
                label="Other: what is it for?"
                required
                value={f.otherNote}
                error={fieldErrors.otherNote}
                onChange={(e) => set({ otherNote: e.target.value })}
              />
            )}
          </div>
          {lateCalc > 0 && (
            <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
              <Input
                label="Late fee to charge (₹)"
                inputMode="decimal"
                hint={`Calculated ${formatINR(lateCalc, { hideZeroPaise: true })}`}
                value={f.late === null ? paiseToRupeesString(lateCalc) : f.late}
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
        </Card>
      </div>

      <div className="lg:sticky lg:top-4">
        <Card title="Payment">
          <div className="flex flex-col gap-3">
            <p className="text-2xl font-semibold text-ink">
              Total to collect:{" "}
              {total === null ? "-" : formatINR(total, { hideZeroPaise: true })}
            </p>
            <Select
              label="Payment mode"
              options={MODES}
              value={f.mode}
              onChange={(e) => set({ mode: e.target.value, bankId: "" })}
            />
            {f.mode === "cash" && (
              <>
                <Input
                  label="Amount received (₹)"
                  inputMode="decimal"
                  placeholder="0"
                  value={f.received}
                  error={received?.error}
                  onChange={(e) => set({ received: e.target.value })}
                />
                {change !== null && total > 0 && (
                  <p
                    className={`text-sm font-medium ${change >= 0 ? "text-ink" : "text-danger"}`}
                  >
                    {change >= 0
                      ? `Change to return: ${formatINR(change, { hideZeroPaise: true })}`
                      : `Balance due: ${formatINR(-change, { hideZeroPaise: true })}`}
                  </p>
                )}
              </>
            )}
            {needsRef && (
              <>
                <Select
                  label="Bank account"
                  value={bankId}
                  error={fieldErrors.bankId}
                  onChange={(e) => set({ bankId: e.target.value })}
                  options={[
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
                  ]}
                />
                <Input
                  label="UPI / QR reference no."
                  required
                  value={f.reference}
                  error={fieldErrors.reference}
                  onChange={(e) => set({ reference: e.target.value })}
                />
              </>
            )}
            <Button
              loading={collect.isPending}
              disabled={!ready}
              onClick={() => collect.mutate()}
            >
              {total
                ? `Collect ${formatINR(total, { hideZeroPaise: true })} and create receipt`
                : "Collect and create receipt"}
            </Button>
            {blocker && total > 0 && (
              <p className="text-sm text-danger">{blocker}</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Month rows for the dues table. Transport lists all 12 months of the year; unposted ones are "Not due yet". */
function monthRows(instalments, kind, fy) {
  if (kind !== "transport" || !/^\d{4}-\d{2}$/.test(fy ?? ""))
    return instalments;
  const start = Number(fy.slice(0, 4));
  const byPeriod = new Map(instalments.map((i) => [i.period, i]));
  const rows = [];
  for (let n = 0; n < 12; n += 1) {
    const month = ((3 + n) % 12) + 1; // April first
    const year = month >= 4 ? start : start + 1;
    const period = `${year}-${String(month).padStart(2, "0")}`;
    rows.push(byPeriod.get(period) ?? { period, notPosted: true });
  }
  // Old-fee / one-time rows stay visible too.
  const extra = instalments.filter(
    (i) => !rows.some((r) => r.period === i.period),
  );
  return [...extra, ...rows];
}
