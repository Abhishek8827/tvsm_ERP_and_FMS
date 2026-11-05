import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { classLabel, formatINR, rupeesInWords, SCHOOL } from "@erp/shared";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { printHtml } from "../lib/printHtml";
import { receiptMessage, waLink } from "../lib/whatsapp";
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  Spinner,
  useToast,
} from "../components/ui";

// Rows printed on the receipt, in the order of the school's paper receipt book.
const ROWS = {
  school: [
    ["admission_form", "Form Fees", ["form"]],
    ["admission", "Admission Fees", ["admission"]],
    ["tuition", "Tuition Fees", ["tuition"]],
    ["old", "Old Fees", ["old_fees"]],
    ["late", "Late Fees", ["late"]],
    ["tc", "T.C.", ["tc"]],
    ["other", "Other", ["other"]],
  ],
  transport: [
    ["transport", "Transport Fees (New)", ["transport"]],
    ["old", "Old Fees", ["transport_old"]],
    ["late", "Late Fees", ["late"]],
  ],
};
const MODE_LABEL = { cash: "Cash", upi: "UPI / QR" };
const when = (iso) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** One copy (Student copy or Office copy), laid out like the Figma "Fee Receipt (A4 half)" design. */
function Copy({ r, copyName, duplicate, cancelled }) {
  const rows = ROWS[r.kind];
  const amountOf = (heads) => {
    const lines = r.lines.filter((l) => heads.includes(l.head));
    return lines.length ? lines.reduce((s, l) => s + l.amountPaise, 0) : null;
  };
  const otherLabel = r.lines.find((l) => l.head === "other")?.label;
  const s = r.student;
  const periodRows = new Set(["tuition", "transport"]);
  const shown = rows
    .map(([key, label, heads]) => ({ key, label, amount: amountOf(heads) }))
    .filter((x) => x.amount !== null);
  return (
    <div className="copy">
      <div className="rh">
        <img src="/logo.jpg" alt="" />
        <div>
          <div className="rh-name">{SCHOOL.name}</div>
          <div className="rh-addr">
            {SCHOOL.addressLine} · MPBSE Affiliation No. {SCHOOL.affiliationNo}{" "}
            · School Code {SCHOOL.schoolCode}
          </div>
        </div>
      </div>
      <div className="title">FEE RECEIPT</div>
      <div className="tags">
        <span>
          {copyName} ·{" "}
          {r.kind === "transport" ? "Transport fees" : "School fees"}
        </span>
        {cancelled && <span className="dup">CANCELLED</span>}
        {duplicate && <span className="dup">DUPLICATE</span>}
      </div>
      <div className="grid2">
        <span>
          Receipt No. <b>{r.number}</b>
        </span>
        <span>
          Student <b>{s.name}</b>
        </span>
        <span>Date and time {when(r.issuedAt)}</span>
        <span>
          Admission No. <b>{s.admissionNo}</b>
        </span>
        <span>Academic year {r.fy}</span>
        <span>
          Class / Section {classLabel(s.classKey)}
          {s.section ? `-${s.section}` : ""}
        </span>
        <span />
        <span>Father&apos;s name {s.fatherName || "-"}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Fee head</th>
            <th style={{ width: "30%" }}>Period</th>
            <th style={{ width: "24%" }}>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((x) => (
            <tr key={x.key}>
              <td>
                {x.key === "other" && otherLabel
                  ? `Other: ${otherLabel}`
                  : x.label}
              </td>
              <td>{periodRows.has(x.key) ? r.monthLabel || "-" : "-"}</td>
              <td className="num">
                {formatINR(x.amount, { hideZeroPaise: true }).replace("₹", "")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="total">
        <span>Total received</span>
        <b>{formatINR(r.totalPaise, { hideZeroPaise: true })}</b>
      </div>
      <div className="words">{rupeesInWords(r.totalPaise)}</div>
      <div className="line">
        <span>
          Payment mode{" "}
          <b>
            {r.mode === "split"
              ? r.payments
                  .map(
                    (p) =>
                      `${MODE_LABEL[p.mode]} ${formatINR(p.amountPaise, { hideZeroPaise: true })}`,
                  )
                  .join(" + ")
              : MODE_LABEL[r.mode]}
          </b>
        </span>
        <span>
          {r.payments
            ?.filter((p) => p.reference)
            .map((p) => `Reference ${p.reference}`)
            .join(", ") || (r.reference ? `Reference ${r.reference}` : "")}
        </span>
        <span>
          Balance due after this receipt{" "}
          <b>{formatINR(r.dueAfterPaise ?? 0, { hideZeroPaise: true })}</b>
        </span>
      </div>
      <div className="line sub">
        <span>
          Old Dues:{" "}
          <b>{formatINR(r.dueAfterOldPaise ?? 0, { hideZeroPaise: true })}</b>
        </span>
        <span>
          New Dues:{" "}
          <b>{formatINR(r.dueAfterNewPaise ?? 0, { hideZeroPaise: true })}</b>
        </span>
      </div>
      <div className="note">
        Fees once paid are non-refundable except as per school policy.
        {r.cashierName ? ` Cashier: ${r.cashierName}` : ""}
      </div>
      <div className="note">
        Computer generated receipt. Reprints are marked DUPLICATE.
      </div>
    </div>
  );
}

// Layout of the receipt, used on screen AND inside the clean print page.
const SHEET_CSS = `
.sheet{display:flex;width:210mm;height:148.5mm;background:#fff;color:#000;font-size:8.5pt;line-height:1.25}
.copy{width:105mm;height:148.5mm;padding:5mm;box-sizing:border-box;border-right:1px dashed #666;display:flex;flex-direction:column;gap:1.4mm}
.copy:last-child{border-right:0}
.rh{display:flex;align-items:center;gap:2mm;border-bottom:1.5px solid #1e3a8a;padding-bottom:1.5mm}
.rh img{width:11mm;height:11mm;object-fit:contain;flex:none}
.rh-name{font-weight:800;font-size:9pt;color:#1e3a8a;line-height:1.15}
.rh-addr{font-size:6pt;color:#333;line-height:1.25}
.title{text-align:center;font-weight:700;font-size:10pt;letter-spacing:.6px}
.tags{display:flex;justify-content:space-between;font-size:7.5pt;font-weight:700}
.dup{border:1.5px solid #b00;color:#b00;padding:0 2mm;transform:rotate(-4deg)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:.6mm 3mm;font-size:7.8pt}
.line{display:flex;justify-content:space-between;gap:2mm;font-size:7.8pt}
.line.sub{font-size:7pt;color:#333}
table{width:100%;border-collapse:collapse;font-size:8pt}
th,td{border:1px solid #000;padding:.7mm 1.2mm}
th{text-align:left;background:#eef2ff}
.num{text-align:right}
.total{display:flex;justify-content:space-between;border:1px solid #000;padding:1mm 1.5mm;font-size:9.5pt}
.words{font-size:7.5pt;font-style:italic}
.note{font-size:6.5pt;color:#333}
.note:last-child{margin-top:auto}
`;
// Only for the clean print page: A4 sheet with no margins, nothing else.
const PAGE_CSS = `@page{size:A4 portrait;margin:0}html,body{margin:0;background:#fff}`;

/**
 * Shows one receipt and prints it on the TOP HALF of an A4 sheet: Student copy on the left,
 * Office copy on the right. The first print right after collecting is the original; every later
 * print is stamped DUPLICATE (same number) and is written to the audit log.
 */
export function ReceiptView() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [printedOnce, setPrintedOnce] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [printing, setPrinting] = useState(false);
  const sheetRef = useRef(null);
  const fresh = Boolean(location.state?.fresh);

  const receipt = useQuery({
    queryKey: ["receipt", id],
    queryFn: () => api(`/api/receipts/${id}`),
  });
  async function printNow() {
    setPrinting(true);
    try {
      await printHtml({
        html: sheetRef.current.outerHTML,
        css: SHEET_CSS + PAGE_CSS,
        title: `Receipt ${receipt.data.number}`,
      });
    } catch (e) {
      notify(`Could not open the print window. ${e.message}`, "error");
    } finally {
      setPrinting(false);
    }
  }
  const reprint = useMutation({
    mutationFn: () => api(`/api/receipts/${id}/reprint`, { method: "POST" }),
    onSuccess: () => {
      // The DUPLICATE stamp must be in the page BEFORE it is copied for printing.
      flushSync(() => setDuplicate(true));
      void printNow();
    },
    onError: (e) =>
      notify(
        `${e.message}${e.requestId ? ` (ref ${e.requestId})` : ""}`,
        "error",
      ),
  });

  const cancelMutation = useMutation({
    mutationFn: () =>
      api(
        role === "admin"
          ? `/api/receipts/${id}/cancel`
          : `/api/receipts/${id}/cancel-request`,
        {
          method: "POST",
          body: { reason },
        },
      ),
    onSuccess: async () => {
      setCancelOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["receipt", id] });
      await queryClient.invalidateQueries({ queryKey: ["receipts"] });
      await queryClient.invalidateQueries({ queryKey: ["fees-database"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      notify(
        role === "admin"
          ? "Receipt cancelled."
          : "Cancellation request sent for approval.",
        "success",
      );
    },
    onError: (e) =>
      notify(
        `${e.message}${e.requestId ? ` (ref ${e.requestId})` : ""}`,
        "error",
      ),
  });

  if (receipt.isPending) return <Spinner label="Loading receipt" />;
  if (receipt.isError)
    return (
      <ErrorState
        message={receipt.error.message}
        onRetry={() => receipt.refetch()}
      />
    );
  const r = receipt.data;

  const cancelled = r.status === "cancelled";
  const original = fresh && !printedOnce && !cancelled;
  const canReprint = role === "cashier" || role === "admin";
  const waHref = waLink(
    r.student.contactNo,
    receiptMessage(r, when(r.issuedAt)),
  );

  return (
    <div className="flex flex-col gap-4">
      <style>{SHEET_CSS}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => (fresh ? navigate("/collect-fee") : navigate(-1))}
          >
            {fresh ? "← Back to Collect Fee" : "← Back"}
          </Button>
          <h1 className="text-2xl font-semibold text-ink">
            Receipt {r.number}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {original ? (
            <Button
              loading={printing}
              onClick={() => {
                setPrintedOnce(true);
                void printNow();
              }}
            >
              Print receipt
            </Button>
          ) : (
            canReprint && (
              <Button
                loading={reprint.isPending || printing}
                onClick={() => reprint.mutate()}
              >
                Print duplicate
              </Button>
            )
          )}
          {waHref ? (
            <a
              className="inline-flex min-h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-app"
              href={waHref}
              target="_blank"
              rel="noreferrer"
            >
              Send on WhatsApp
            </a>
          ) : (
            <Button
              variant="secondary"
              disabled
              title="No valid mobile number saved for this student"
            >
              Send on WhatsApp
            </Button>
          )}
          {r.status === "valid" && (role === "admin" || role === "cashier") && (
            <Button variant="danger" onClick={() => setCancelOpen(true)}>
              {role === "admin" ? "Cancel receipt" : "Request cancellation"}
            </Button>
          )}
          {role === "cashier" && (
            <Link
              to="/collect-fee"
              className="inline-flex min-h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-app"
            >
              New collection
            </Link>
          )}
        </div>
      </div>
      {cancelled && (
        <div className="no-print flex items-center gap-2">
          <Badge tone="danger">Cancelled</Badge>
          <span className="text-sm text-ink-muted">
            {r.cancellation?.reason}
            {r.cancellation?.decidedByName
              ? ` (by ${r.cancellation.decidedByName})`
              : ""}
          </span>
        </div>
      )}
      {r.status === "valid" && r.rejection && (
        <div
          role="status"
          className="no-print rounded-card border border-line bg-surface p-3 text-sm"
        >
          <Badge tone="danger">Cancellation rejected</Badge>
          <p className="mt-2 text-ink">
            {r.rejection.decidedByName ? `${r.rejection.decidedByName}: ` : ""}
            {r.rejection.reason || "No reason was written."}
          </p>
          <p className="text-ink-muted">
            Your request was: {r.rejection.requestedReason}
          </p>
        </div>
      )}
      {r.status === "cancel_requested" && (
        <div className="no-print flex items-center gap-2">
          <Badge tone="warning">Cancellation requested</Badge>
          <span className="text-sm text-ink-muted">
            Waiting for approval: {r.cancellation?.reason}
          </span>
        </div>
      )}
      <p className="no-print text-sm text-ink-muted">
        {original
          ? "Print once now: this is the original receipt. Any later print is marked DUPLICATE."
          : "This receipt has been issued. Printing again marks it DUPLICATE and is recorded."}{" "}
        Choose A4 paper, margins None, scale 100%.
      </p>
      <div className="overflow-x-auto">
        <div ref={sheetRef} className="sheet border border-line">
          <Copy
            r={r}
            copyName="STUDENT COPY"
            duplicate={duplicate}
            cancelled={cancelled}
          />
          <Copy
            r={r}
            copyName="OFFICE COPY"
            duplicate={duplicate}
            cancelled={cancelled}
          />
        </div>
      </div>
      <ConfirmDialog
        open={cancelOpen}
        tone="danger"
        title={
          role === "admin" ? "Cancel this receipt?" : "Request cancellation?"
        }
        description={
          role === "admin"
            ? "The receipt stays on record, marked CANCELLED, and its payments stop counting, so those fees become payable again. This is written to the audit log."
            : "The receipt stays valid until it is approved. The reason is written to the audit log."
        }
        confirmLabel={role === "admin" ? "Cancel receipt" : "Send request"}
        requireReason
        onReasonChange={setReason}
        loading={cancelMutation.isPending}
        onConfirm={() => cancelMutation.mutate()}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  );
}
