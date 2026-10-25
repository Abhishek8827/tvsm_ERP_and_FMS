import { addDaysToDateString, istDateString } from "./financialYear.js";
import { assertPaise } from "./money.js";

/**
 * Fee rules confirmed by the school (see DECISIONS.md):
 *  - Monthly instalments for 10 months, June to March, due on the 15th.
 *  - Tuition and transport are monthly. Admission and form fee are charged once (not monthly).
 *  - Late fee: a flat amount (Rs 100), once for each overdue month, after a 10 day grace period.
 *    It applies to tuition and transport only. It is shown separately from the fee itself.
 * All money is integer paise.
 */
export const BILLING_MONTHS = [6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
export const MONTHLY_HEADS = ["tuition", "transport"];
export const ONE_TIME_HEADS = ["admission", "form"];
export const LATE_FEE_HEADS = MONTHLY_HEADS;

export const DEFAULT_FEE_CONFIG = {
  dueDay: 15,
  graceDays: 10,
  lateFeePaise: 10_000,
};

/** "2026-27" -> 2026 */
export function sessionStartYear(fy) {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m) throw new Error(`Invalid session: ${fy}`);
  return Number(m[1]);
}

/** The 10 instalments of a session: [{ period: '2026-06', dueDate: '2026-06-15' }, ...] */
export function instalmentSchedule(fy, dueDay = DEFAULT_FEE_CONFIG.dueDay) {
  const start = sessionStartYear(fy);
  return BILLING_MONTHS.map((month) => {
    const year = month >= 6 ? start : start + 1;
    const mm = String(month).padStart(2, "0");
    return {
      period: `${year}-${mm}`,
      dueDate: `${year}-${mm}-${String(dueDay).padStart(2, "0")}`,
    };
  });
}

/**
 * Charges to post for a student when the session's fee plan is created.
 * `classFee` = { tuition, admission, form } and `transportMonthly` are paise.
 * Optional heads are only charged to students who chose them (transport needs a village).
 */
export function buildCharges({
  fy,
  classFee,
  transportMonthly = 0,
  chargeAdmission = false,
  config,
}) {
  const cfg = { ...DEFAULT_FEE_CONFIG, ...config };
  const schedule = instalmentSchedule(fy, cfg.dueDay);
  const charges = [];
  for (const { period, dueDate } of schedule) {
    if (classFee?.tuition > 0)
      charges.push({
        head: "tuition",
        period,
        dueDate,
        amount: classFee.tuition,
      });
    if (transportMonthly > 0)
      charges.push({
        head: "transport",
        period,
        dueDate,
        amount: transportMonthly,
      });
  }
  const first = schedule[0];
  if (chargeAdmission) {
    // WHY the first due date: a one-time fee belongs to the start of the session.
    if (classFee?.admission > 0) {
      charges.push({
        head: "admission",
        period: "once",
        dueDate: first.dueDate,
        amount: classFee.admission,
      });
    }
    if (classFee?.form > 0) {
      charges.push({
        head: "form",
        period: "once",
        dueDate: first.dueDate,
        amount: classFee.form,
      });
    }
  }
  for (const c of charges) assertPaise(c.amount, `${c.head} ${c.period}`);
  return charges;
}

/**
 * Works out what a student owes as of a given day (IST "YYYY-MM-DD").
 *
 * charges: [{ id, head, period, dueDate, amount }]
 * credits: [{ appliesTo, kind: 'payment'|'concession'|'reversal', amount }]   (amount may be negative for reversals)
 * lateFeesSettled: periods whose late fee is already charged or paid
 *
 * Definitions (so every screen says the same thing):
 *  - billed       everything charged
 *  - outstanding  billed - concession - paid  (the total still owed, including future months)
 *  - dueNow       unpaid part of charges whose due date has arrived
 *  - overdue      unpaid part of charges whose due date + grace days has passed
 *  - lateFee      flat fee for each overdue month that still has tuition/transport unpaid
 */
export function computeDues({
  charges,
  credits = [],
  asOf,
  config,
  lateFeesSettled = [],
}) {
  const cfg = { ...DEFAULT_FEE_CONFIG, ...config };
  const settled = new Set(lateFeesSettled);
  const creditByCharge = new Map();
  for (const credit of credits) {
    const row = creditByCharge.get(credit.appliesTo) ?? {
      paid: 0,
      concession: 0,
    };
    if (credit.kind === "concession") row.concession += credit.amount;
    else row.paid += credit.amount; // payments and (negative) reversals
    creditByCharge.set(credit.appliesTo, row);
  }

  const byPeriod = new Map();
  const totals = {
    billed: 0,
    concession: 0,
    paid: 0,
    outstanding: 0,
    dueNow: 0,
    overdue: 0,
    lateFee: 0,
  };

  for (const charge of [...charges].sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate),
  )) {
    const applied = creditByCharge.get(charge.id) ?? { paid: 0, concession: 0 };
    const due = Math.max(0, charge.amount - applied.concession - applied.paid);
    const isDue = charge.dueDate <= asOf;
    const isOverdue = asOf > addDaysToDateString(charge.dueDate, cfg.graceDays);

    totals.billed += charge.amount;
    totals.concession += applied.concession;
    totals.paid += applied.paid;
    totals.outstanding += due;
    if (isDue) totals.dueNow += due;
    if (isOverdue) totals.overdue += due;

    const key = `${charge.dueDate}|${charge.period}`;
    const bucket = byPeriod.get(key) ?? {
      period: charge.period,
      dueDate: charge.dueDate,
      items: [],
      billed: 0,
      due: 0,
      lateFee: 0,
      isDue,
      isOverdue,
    };
    bucket.items.push({
      id: charge.id,
      head: charge.head,
      amount: charge.amount,
      paid: applied.paid,
      concession: applied.concession,
      due,
    });
    bucket.billed += charge.amount;
    bucket.due += due;
    if (
      isOverdue &&
      LATE_FEE_HEADS.includes(charge.head) &&
      due > 0 &&
      !settled.has(charge.period)
    ) {
      bucket.lateFee = cfg.lateFeePaise; // flat, once per month (not per head)
    }
    byPeriod.set(key, bucket);
  }

  const instalments = [...byPeriod.values()];
  totals.lateFee = instalments.reduce((sum, i) => sum + i.lateFee, 0);
  return { asOf, instalments, totals };
}

export function todayIst(now = new Date()) {
  return istDateString(now);
}
