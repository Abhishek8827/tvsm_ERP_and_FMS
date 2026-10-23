import { buildCharges, moduleDues, todayIst } from '@erp/shared';
import { AppError } from '../utils/errors.js';

const SCHOOL_HEADS = ['tuition', 'admission', 'form'];
const TRANSPORT_HEADS = ['transport'];

/**
 * The year's charges for ONE student from the fee chart. `kinds` = which modules to post
 * ('school' = tuition + (for new admissions) admission/form, 'transport' = bus fee).
 * Throws AppError when the chart cannot price the student (so nothing is guessed).
 *
 * WHY only up to the current month: fees are posted month by month (the school's rule), so a
 * month that has not started yet has no charge. `asOf` is the day it is worked out for; pass
 * `asOf: null` for the whole year (used only to find the months an advance payment needs).
 * One-time fees (admission, form) are always included.
 */
const MONTHLY = ['tuition', 'transport'];
export function chargesForStudent({
  student,
  chart,
  fy,
  kinds = ['school', 'transport'],
  asOf = todayIst(),
}) {
  if (!chart) throw new AppError('NO_FEE_STRUCTURE', 409, `No fee chart exists for ${fy} yet.`);
  const row = chart.classFees.find((c) => c.classKey === student.classKey);
  if (!row) throw new AppError('NO_CLASS_FEE', 409, 'The fee chart has no fee for this class.');
  let transportMonthly = 0;
  if (kinds.includes('transport') && student.usesTransport) {
    const village = chart.villages.find((v) => v.name === student.village?.toUpperCase());
    if (!village)
      throw new AppError(
        'NO_VILLAGE_FEE',
        409,
        `Bus fee for village "${student.village}" is not in the fee chart. Add it first.`,
      );
    transportMonthly = village.monthlyPaise;
  }
  const heads = [
    ...(kinds.includes('school') ? SCHOOL_HEADS : []),
    ...(kinds.includes('transport') ? TRANSPORT_HEADS : []),
  ];
  return buildCharges({
    fy,
    classFee: {
      tuition: row.monthlyTuitionPaise,
      admission: row.admissionPaise,
      form: chart.formFeePaise,
    },
    transportMonthly,
    // WHY: admission and form fee are for new admissions only (confirmed by the school).
    chargeAdmission: !!student.isNewAdmission,
    config: chart,
  }).filter(
    (c) =>
      heads.includes(c.head) &&
      // "2026-10-15" <= "2026-10-31": compare the YYYY-MM part only.
      (asOf === null || !MONTHLY.includes(c.head) || c.dueDate.slice(0, 7) <= asOf.slice(0, 7)),
  );
}

/**
 * Posts the year's charges for many students. A student the chart cannot price (missing class
 * fee or village) is SKIPPED WITH A REASON, never guessed. Safe to repeat: charges that
 * already exist are not added twice.
 */
export async function postPlans({ deps, tenantId, students, fy, kinds, asOf }) {
  const chart = await deps.feeStore.get(tenantId, fy);
  let posted = 0;
  let charges = 0;
  const skipped = [];
  for (const student of students) {
    try {
      const list = chargesForStudent({ student, chart, fy, kinds, asOf });
      const added = await deps.chargeStore.postMany(tenantId, student._id, fy, list);
      if (added > 0) posted += 1;
      charges += added;
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      skipped.push({ admissionNo: student.admissionNo, name: student.name, reason: err.message });
    }
  }
  return { fy, students: students.length, posted, newCharges: charges, skipped };
}

/**
 * Advance payment: when the cashier collects MORE than what is posted and unpaid for the
 * current-fee head, the next months are posted first (in order) until the amount is covered, so
 * "pay next month's fee in advance" works even though future months are not posted yet.
 * Posts nothing when the amount already fits. Never goes past the end of the year. Old fees are
 * checked by the receipt rules afterwards (new fees are blocked while old fees are pending).
 */
export async function postAdvanceMonths({ deps, tenantId, student, fy, kind, wantPaise }) {
  const head = kind === 'school' ? 'tuition' : 'transport';
  const chart = await deps.feeStore.get(tenantId, fy);
  if (!chart) return 0; // nothing can be priced; the receipt rules will explain
  const [rows, receipts] = await Promise.all([
    deps.chargeStore.listForStudent(tenantId, student._id, fy),
    deps.receiptStore.listForStudent(tenantId, student._id, fy),
  ]);
  const posted = rows.map((c) => ({
    id: String(c._id),
    head: c.head,
    period: c.period,
    dueDate: c.dueDate,
    amount: c.amountPaise,
  }));
  const open = moduleDues({
    kind,
    charges: posted,
    receipts,
    asOf: todayIst(),
    config: chart ?? undefined,
  })
    .instalments.flatMap((i) => i.items)
    .filter((x) => x.head === head)
    .reduce((n, x) => n + x.due, 0);
  if (wantPaise <= open) return 0;
  const have = new Set(posted.filter((c) => c.head === head).map((c) => c.period));
  let all;
  try {
    all = chargesForStudent({ student, chart, fy, kinds: [kind], asOf: null });
  } catch (err) {
    if (err instanceof AppError) return 0; // e.g. village fee missing: the rules explain
    throw err;
  }
  const future = all
    .filter((c) => c.head === head && !have.has(c.period))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  let covered = open;
  const needed = [];
  for (const c of future) {
    if (covered >= wantPaise) break;
    needed.push(c);
    covered += c.amount;
  }
  if (needed.length === 0) return 0;
  return deps.chargeStore.postMany(tenantId, student._id, fy, needed);
}

/**
 * A "last month" rebate (BC / OTP style) lowers the final month's fee, but that month is not
 * posted yet (fees are posted month by month). This posts ONLY the last month of the year for the
 * head(s) of `kind`, so the rebate has something to reduce. It is not due until that month, so
 * "due till today" is unchanged. Safe to repeat (charges are never added twice).
 */
export async function postLastMonth({ deps, tenantId, student, fy, kind }) {
  const chart = await deps.feeStore.get(tenantId, fy);
  if (!chart) return 0;
  let all;
  try {
    all = chargesForStudent({ student, chart, fy, kinds: [kind], asOf: null });
  } catch (err) {
    if (err instanceof AppError) return 0; // the rebate step explains what is missing
    throw err;
  }
  const monthly = all.filter((c) => MONTHLY.includes(c.head));
  if (monthly.length === 0) return 0;
  const lastDue = monthly
    .map((c) => c.dueDate)
    .sort()
    .at(-1);
  return deps.chargeStore.postMany(
    tenantId,
    student._id,
    fy,
    monthly.filter((c) => c.dueDate === lastDue),
  );
}
