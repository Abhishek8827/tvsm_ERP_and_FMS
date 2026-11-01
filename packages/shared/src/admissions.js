import { ReceiptRuleError } from "./collect.js";

/**
 * New Admissions (owner's spec, 2026-11-01). A child who has handed in an admission form is NOT
 * a student yet: the form and its fees live in a separate "New Admissions" list until the Admin
 * admits the child, and only then a student record is made.
 */
export const FORM_FEE_PAISE = 10_000; // Rs 100 per admission form (fixed)

export const ADMISSION_STATUSES = ["pending", "admitted", "cancelled"];
export const ADMISSION_STATUS_LABEL = {
  pending: "Decision Pending",
  admitted: "Admitted",
  cancelled: "Cancelled",
};

/** "2026-27": the session the form number and the record belong to. */
export const isSession = (s) =>
  /^\d{4}-\d{2}$/.test(s ?? "") &&
  (Number(s.slice(0, 4)) + 1) % 100 === Number(s.slice(5, 7));

/** NEW/2026-27/001. Three digits to start; a larger serial simply gets longer, never repeats. */
export const formNumber = (session, seq) =>
  `NEW/${session}/${String(seq).padStart(3, "0")}`;

export const paymentStatus = (duePaise, paidPaise) =>
  paidPaise <= 0 ? "unpaid" : paidPaise >= duePaise ? "paid" : "partial";

/**
 * Where one form stands. `receipts` = the admission receipts that still count (cancelled ones
 * left out). Each head has what is asked, what is paid, what is left, and Paid / Partial / Unpaid.
 */
export function admissionDues({
  formFeePaise,
  admissionFeePaise,
  receipts = [],
}) {
  const paid = { form: 0, admission: 0 };
  for (const r of receipts)
    for (const l of r.lines ?? [])
      if (l.head in paid) paid[l.head] += l.amountPaise;
  const head = (due, got) => ({
    duePaise: due,
    paidPaise: got,
    leftPaise: Math.max(0, due - got),
    status: paymentStatus(due, got),
  });
  const form = head(formFeePaise, paid.form);
  const admission = head(admissionFeePaise, paid.admission);
  return {
    form,
    admission,
    totalPaise: form.duePaise + admission.duePaise,
    collectedPaise: form.paidPaise + admission.paidPaise,
    outstandingPaise: form.leftPaise + admission.leftPaise,
  };
}

/** Checks one payment against what is still pending and returns the receipt lines. */
export function planAdmissionReceipt({ dues, input }) {
  const lines = [];
  for (const [key, head, label] of [
    ["formPaise", "form", "Form fee"],
    ["admissionPaise", "admission", "Admission fee"],
  ]) {
    const v = input[key] ?? 0;
    if (!Number.isInteger(v) || v < 0)
      throw new ReceiptRuleError(
        "BAD_AMOUNT",
        `${label}: enter a valid amount.`,
        key,
      );
    if (v > dues[head].leftPaise)
      throw new ReceiptRuleError(
        "MORE_THAN_DUE",
        `${label}: amount is more than what is pending.`,
        key,
      );
    if (v > 0) lines.push({ head, amountPaise: v });
  }
  const totalPaise = lines.reduce((n, l) => n + l.amountPaise, 0);
  if (totalPaise <= 0)
    throw new ReceiptRuleError(
      "NOTHING_TO_PAY",
      "Enter an amount to collect.",
      "formPaise",
    );
  return {
    lines,
    totalPaise,
    dueAfterPaise: dues.outstandingPaise - totalPaise,
  };
}

/** Student fields an admission form carries over to the student when admitted (existing fields only). */
export const ADMISSION_STUDENT_FIELDS = [
  "name",
  "fatherName",
  "motherName",
  "classKey",
  "stream",
  "gender",
  "dateOfBirth",
  "contactNo",
  "address",
  "category",
  "nationality",
  "caste",
  "samagraId",
  "pen",
  "aparId",
  "aadhaar",
];
