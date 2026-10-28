import {
  REBATE_CATEGORIES,
  classInWords,
  classPlainLabel,
  computeDues,
  creditsFromReceipts,
  dateInWords,
  duesPaidUpToMonth,
  lateSettledFromReceipts,
  monthYearLabel,
  nextClassKey,
} from "@erp/shared";

const isoDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** The student's dues for this FY as of a day (same maths as the ledger screen). */
export async function studentDues({ deps, tenantId, student, fy, asOf }) {
  const chart = await deps.feeStore.get(tenantId, fy);
  const [rows, receipts] = await Promise.all([
    deps.chargeStore.listForStudent(tenantId, student._id, fy),
    deps.receiptStore.listForStudent(tenantId, student._id, fy),
  ]);
  const charges = rows.map((c) => ({
    id: String(c._id),
    head: c.head,
    period: c.period,
    dueDate: c.dueDate,
    amount: c.amountPaise,
  }));
  return computeDues({
    charges,
    credits: creditsFromReceipts(receipts),
    asOf,
    config: chart ?? undefined,
    lateFeesSettled: lateSettledFromReceipts(receipts),
  });
}

/** Field 14 text: the category and reason of every active rebate of this FY, or "None". */
export async function concessionText({ deps, tenantId, student, fy }) {
  const all = await deps.rebateStore.listForStudent(tenantId, student._id);
  const parts = all
    .filter(
      (r) => r.status === "active" && r.fy === fy && r.kind !== "late_fee",
    )
    .map((r) => {
      const cat = REBATE_CATEGORIES[r.category]?.label ?? "Concession";
      return r.reason ? `${cat} - ${r.reason}` : cat;
    });
  return [...new Set(parts)].join("; ") || "None";
}

/** What the Admin must still fill in before a TC can be made (the record lacks it). */
export function missingTcFields(s) {
  const need = [
    ["fatherName", "Father's name"],
    ["motherName", "Mother's name"],
    ["dateOfBirth", "Date of birth"],
    ["category", "Category"],
    ["nationality", "Nationality"],
    ["firstAdmissionDate", "Date of first admission"],
    ["firstAdmissionClass", "Class at first admission"],
  ];
  return need.filter(([k]) => !s[k]).map(([key, label]) => ({ key, label }));
}

/** The student with the Admin's typed values laid over it (what the TC will be made from). */
export function mergeStudent(student, patch = {}) {
  const out = { ...student };
  for (const [k, v] of Object.entries(patch))
    if (v !== undefined && v !== "") out[k] = v;
  return out;
}

/** Fields 1-8, 13, 14 exactly as they will be printed (stored on the TC as its snapshot). */
export function buildSnapshot({ student, dues, concession }) {
  const dob = isoDate(student.dateOfBirth);
  const paidUpto = duesPaidUpToMonth(dues.instalments);
  return {
    admissionNo: student.admissionNo,
    name: student.name,
    motherName: student.motherName,
    fatherName: student.fatherName,
    dob,
    dobInWords: dateInWords(dob),
    nationality: student.nationality,
    category: student.category,
    firstAdmissionDate: isoDate(student.firstAdmissionDate),
    firstAdmissionClass: classPlainLabel(student.firstAdmissionClass),
    lastClass: student.classKey,
    lastClassInWords: classInWords(student.classKey),
    section: student.section ?? "",
    duesPaidUpto: paidUpto ? monthYearLabel(paidUpto) : "Nil",
    feeConcession: concession,
  };
}

/** Rule: nothing may be due now (late fee included). Returns the amount in paise (0 = clear). */
export const pendingPaise = (dues) => dues.totals.dueNow + dues.totals.lateFee;

/** Promotion default: the next class, or "Course completed" after class 12. */
export function defaultPromotion(classKey) {
  const next = nextClassKey(classKey);
  return !next || classKey === "12" ? "Course completed" : "Yes, to next class";
}

export function shapeTc(t, { copyNo } = {}) {
  return {
    id: String(t._id),
    fy: t.fy,
    slNo: t.slNo,
    bookNo: t.bookNo,
    studentId: String(t.studentId),
    snapshot: t.snapshot,
    entered: t.entered,
    duesOverride: t.duesOverride ?? null,
    status: t.status,
    cancelReason: t.cancelReason ?? null,
    cancelledAt: t.cancelledAt ?? null,
    cancelledByName: t.cancelledByName ?? null,
    duplicateCount: t.duplicateCount ?? 0,
    copyNo: copyNo ?? null,
    issuedByName: t.issuedByName ?? null,
    approvedByName: t.approvedByName ?? null,
    originalPrinted: Boolean(t.originalPrintedAt),
    createdAt: t.createdAt,
  };
}

export function shapeBonafide(b, { copyNo } = {}) {
  return {
    id: String(b._id),
    fy: b.fy,
    seq: b.seq,
    number: b.number,
    studentId: String(b.studentId),
    snapshot: b.snapshot,
    academicYear: b.academicYear,
    purpose: b.purpose,
    dateOfIssue: b.dateOfIssue,
    status: b.status,
    cancelReason: b.cancelReason ?? null,
    cancelledByName: b.cancelledByName ?? null,
    cancelledAt: b.cancelledAt ?? null,
    duplicateCount: b.duplicateCount ?? 0,
    copyNo: copyNo ?? null,
    issuedByName: b.issuedByName ?? null,
    approvedByName: b.approvedByName ?? null,
    originalPrinted: Boolean(b.originalPrintedAt),
    createdAt: b.createdAt,
  };
}

/** A TC or Bonafide request: what the Admin asked for, and what the Principal decided. */
export function shapeRequest(r) {
  return {
    id: String(r._id),
    kind: r.kind,
    studentId: String(r.studentId),
    studentName: r.studentName,
    admissionNo: r.admissionNo,
    fy: r.fy,
    status: r.status,
    preview: r.preview,
    duesOverride: r.duesOverride ?? null,
    requestedByName: r.requestedByName ?? null,
    decidedByName: r.decidedByName ?? null,
    decidedAt: r.decidedAt ?? null,
    rejectReason: r.rejectReason ?? null,
    certificateId: r.certificateId ?? null,
    certificateNumber: r.certificateNumber ?? null,
    createdAt: r.createdAt,
  };
}
