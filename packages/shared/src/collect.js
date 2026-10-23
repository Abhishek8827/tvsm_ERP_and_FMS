import { computeDues, todayIst } from './fees.js';
import { assertPaise } from './money.js';

/**
 * Fee collection rules (confirmed by the school). The server runs this on every payment; the
 * browser only shows the result. All money is integer paise.
 *
 * Two separate modules, each with its own receipts and receipt numbers (late fee is shared: one
 * Rs 100 per overdue month for the student, not one per module):
 *  - school:    old fees, tuition, admission, form, late fee, T.C., other
 *  - transport: old transport fees, transport (new), late fee
 * Rules:
 *  - Payments are taken oldest first (a later month is never paid before an earlier one).
 *  - New fees cannot be paid while old fees are still pending after this payment.
 *  - Advance payment is allowed, up to the year's total.
 *  - The late fee can only be REDUCED by the cashier, and a reason is compulsory when it is.
 *  - The cashier cannot give a concession (the Admin rebate module comes later).
 */
export const MODULES = ['school', 'transport'];
export const MODULE_HEADS = {
  school: { old: 'old_fees', current: 'tuition', once: ['admission', 'form'] },
  transport: { old: 'transport_old', current: 'transport', once: [] },
};
export const HEAD_LABEL = {
  old_fees: 'Old Fees',
  tuition: 'Tuition Fees',
  admission: 'Admission Fees',
  form: 'Form Fees',
  late: 'Late Fees',
  tc: 'T.C.',
  other: 'Other',
  transport_old: 'Old Transport Fees',
  transport: 'Transport Fees',
};
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]; // prettier-ignore

export class ReceiptRuleError extends Error {
  constructor(code, message, field) {
    super(message);
    this.code = code;
    this.field = field;
  }
}

const headsOf = (kind) => {
  const h = MODULE_HEADS[kind];
  return [h.old, h.current, ...h.once];
};

/** Receipt number, e.g. S-FY2026-27/2054 (school) or T-FY2026-27/0123 (transport). */
export function receiptNumber(kind, fy, seq) {
  return `${kind === 'transport' ? 'T' : 'S'}-FY${fy}/${String(seq).padStart(4, '0')}`;
}

/** Payments recorded on receipts -> credits that computeDues understands. */
export function creditsFromReceipts(receipts) {
  const credits = [];
  for (const r of receipts)
    for (const l of r.lines ?? [])
      if (l.chargeId)
        credits.push({ appliesTo: String(l.chargeId), kind: 'payment', amount: l.amountPaise });
  // Rebates (Admin concessions) reduce what a charge asks for, exactly like a payment, but they
  // are not money received, so they come in as `concessionLines`, never as receipt lines.
  for (const r of receipts)
    for (const l of r.concessionLines ?? [])
      credits.push({ appliesTo: String(l.chargeId), kind: 'concession', amount: l.amountPaise });
  return credits;
}

/**
 * Months whose late fee was already dealt with on an earlier receipt. WHY both kinds together:
 * the school decided it is ONE Rs 100 per overdue month for the student, whichever receipt
 * (school or transport) is made first. (`_kind` is kept so callers need not change.)
 */
export function lateSettledFromReceipts(receipts, _kind) {
  return receipts.flatMap((r) => r.lateFee?.periods ?? []);
}

/** What a student owes in ONE module, charge by charge. */
export function moduleDues({ kind, charges, receipts, asOf = todayIst(), config }) {
  const mine = charges.filter((c) => headsOf(kind).includes(c.head));
  return computeDues({
    charges: mine,
    credits: creditsFromReceipts(receipts),
    asOf,
    config,
    lateFeesSettled: lateSettledFromReceipts(receipts, kind),
  });
}

const dueOf = (dues, head) =>
  dues.instalments.flatMap((i) => i.items).filter((x) => x.head === head);
const sum = (rows) => rows.reduce((s, r) => s + r.due, 0);

/** Takes `amount` from the oldest unpaid charges first. Returns [{ item, take }]. */
function allocate(dues, head, amount, field) {
  const rows = [];
  let left = amount;
  for (const inst of dues.instalments) {
    for (const item of inst.items) {
      if (item.head !== head || item.due <= 0 || left <= 0) continue;
      const take = Math.min(item.due, left);
      rows.push({ item, take, period: inst.period });
      left -= take;
    }
  }
  if (left > 0)
    throw new ReceiptRuleError(
      'OVER_PAYMENT',
      `${HEAD_LABEL[head]}: amount is more than what is pending.`,
      field,
    );
  return rows;
}

function monthLabel(allocations) {
  const monthly = allocations.filter((a) => /^\d{4}-\d{2}$/.test(a.period));
  const done = monthly
    .filter((a) => a.take === a.item.due)
    .map((a) => a.period)
    .sort();
  const name = (p) => MONTH_NAMES[Number(p.slice(5)) - 1];
  // WHY only fully paid months: if a parent pays June plus a little extra, the receipt still says June.
  if (done.length > 0)
    return done.length === 1 ? name(done[0]) : `${name(done[0])} - ${name(done[done.length - 1])}`;
  if (monthly.length > 0) return `${name(monthly.map((a) => a.period).sort()[0])} (part)`;
  return '';
}

/**
 * Checks one payment request against the rules and returns the receipt lines.
 * input: { oldPaise, newPaise, admissionPaise, formPaise, tcPaise, otherPaise, otherNote,
 *          lateFeePaise, lateFeeRemark }   (all optional, default 0)
 */
export function planReceipt({ kind, charges, receipts, asOf = todayIst(), config, input }) {
  const h = MODULE_HEADS[kind];
  const v = {
    oldPaise: 0, newPaise: 0, admissionPaise: 0, formPaise: 0, tcPaise: 0, otherPaise: 0,
    lateFeePaise: 0, ...input,
  }; // prettier-ignore
  for (const [k, value] of Object.entries(v)) {
    if (k.endsWith('Paise')) {
      try {
        assertPaise(value, k);
      } catch {
        throw new ReceiptRuleError('BAD_AMOUNT', 'Amounts must be whole paise.', k);
      }
      if (value < 0) throw new ReceiptRuleError('BAD_AMOUNT', 'Amounts cannot be negative.', k);
    }
  }
  if (kind === 'transport' && (v.admissionPaise || v.formPaise || v.tcPaise || v.otherPaise))
    throw new ReceiptRuleError('BAD_HEAD', 'Transport receipts have only old, new and late fee.');

  const before = moduleDues({ kind, charges, receipts, asOf, config });
  const allocations = [
    ...allocate(before, h.old, v.oldPaise, 'oldPaise'),
    ...allocate(before, h.current, v.newPaise, 'newPaise'),
    ...(kind === 'school'
      ? [
          ...allocate(before, 'admission', v.admissionPaise, 'admissionPaise'),
          ...allocate(before, 'form', v.formPaise, 'formPaise'),
        ]
      : []),
  ];

  // Rule: new fees only after old fees are cleared (this payment counts towards clearing them).
  const oldLeft = sum(dueOf(before, h.old)) - v.oldPaise;
  if (oldLeft > 0 && (v.newPaise > 0 || v.admissionPaise > 0 || v.formPaise > 0))
    throw new ReceiptRuleError(
      'OLD_FEES_PENDING',
      `Old fees are still pending. Collect old fees first before taking new fees.`,
      'newPaise',
    );

  const calculatedLate = before.totals.lateFee;
  if (v.lateFeePaise > calculatedLate)
    throw new ReceiptRuleError(
      'LATE_FEE_TOO_HIGH',
      'The late fee can only be reduced, not increased.',
      'lateFeePaise',
    );
  const remark = (v.lateFeeRemark ?? '').trim();
  if (v.lateFeePaise < calculatedLate && remark.length < 3)
    throw new ReceiptRuleError(
      'LATE_REMARK_REQUIRED',
      'Please write the reason for reducing the late fee.',
      'lateFeeRemark',
    );
  if (v.otherPaise > 0 && !(v.otherNote ?? '').trim())
    throw new ReceiptRuleError(
      'OTHER_NOTE_REQUIRED',
      'Please write what the "Other" charge is for.',
      'otherNote',
    );

  const lines = allocations.map((a) => ({
    head: a.item.head,
    period: a.period,
    chargeId: a.item.id,
    amountPaise: a.take,
  }));
  if (v.lateFeePaise > 0) lines.push({ head: 'late', amountPaise: v.lateFeePaise });
  if (v.tcPaise > 0) lines.push({ head: 'tc', amountPaise: v.tcPaise });
  if (v.otherPaise > 0)
    lines.push({ head: 'other', amountPaise: v.otherPaise, note: v.otherNote.trim() });
  const totalPaise = lines.reduce((s, l) => s + l.amountPaise, 0);
  if (totalPaise <= 0) throw new ReceiptRuleError('EMPTY', 'Enter an amount to collect.');

  const lateFee = {
    calculatedPaise: calculatedLate,
    chargedPaise: v.lateFeePaise,
    remark: v.lateFeePaise < calculatedLate ? remark : '',
    // Every overdue month counted now is settled: a reduced late fee is not asked for again.
    periods: before.instalments.filter((i) => i.lateFee > 0).map((i) => i.period),
  };

  // "Fees due" printed on the receipt = what is due till today after this payment.
  const afterCredits = [...receipts, { kind, lines: lines.filter((l) => l.chargeId) }];
  const after = moduleDues({ kind, charges, receipts: afterCredits, asOf, config });
  // Old dues and new dues are printed separately. Advance months (not yet due) are in neither.
  const dueItems = after.instalments.filter((i) => i.isDue).flatMap((i) => i.items);
  const dueAfterOldPaise = dueItems.filter((x) => x.head === h.old).reduce((a, x) => a + x.due, 0);
  return {
    lines,
    lateFee,
    totalPaise,
    monthLabel: monthLabel(allocations),
    dueAfterPaise: after.totals.dueNow,
    dueAfterOldPaise,
    dueAfterNewPaise: after.totals.dueNow - dueAfterOldPaise,
  };
}

/**
 * Splits a rebate (concession) over the student's unpaid charges, oldest first, for ONE module.
 * WHY oldest first: the same order payments use, so a rebate never leaves an old month unpaid
 * while a later month is reduced. `head`/`heads` limit it to some heads (e.g. only tuition).
 * `order: 'last'` takes the newest month first instead (the Admin picks this per rebate).
 * Throws when the amount is more than what is still unpaid (a rebate cannot make a credit).
 */
export function planRebate({
  kind,
  charges,
  receipts,
  asOf = todayIst(),
  config,
  amountPaise,
  head,
  heads,
  order = 'oldest',
}) {
  // `heads` (a list) lets one rebate cover e.g. old fees + tuition; `head` stays for old callers.
  const only = heads ?? (head ? [head] : null);
  try {
    assertPaise(amountPaise, 'amountPaise');
  } catch {
    throw new ReceiptRuleError('BAD_AMOUNT', 'Amount must be whole paise.', 'amountPaise');
  }
  if (amountPaise <= 0)
    throw new ReceiptRuleError('BAD_AMOUNT', 'Enter a rebate amount.', 'amountPaise');
  const dues = moduleDues({ kind, charges, receipts, asOf, config });
  const items = dues.instalments
    .flatMap((i) => i.items.map((x) => ({ ...x, period: i.period })))
    .filter((x) => x.due > 0 && (!only || only.includes(x.head)));
  // order 'last' = the newest month first (BC / OTP style rebates are adjusted in the LAST month's
  // fee). dueDate strings sort in time order, so a plain reverse of the oldest-first list works.
  if (order === 'last') items.reverse();
  const open = items.reduce((n, x) => n + x.due, 0);
  if (amountPaise > open)
    throw new ReceiptRuleError(
      'REBATE_TOO_BIG',
      'The rebate is more than what is still unpaid.',
      'amountPaise',
    );
  let left = amountPaise;
  const lines = [];
  for (const x of items) {
    if (left === 0) break;
    const take = Math.min(left, x.due);
    lines.push({ chargeId: x.id, head: x.head, period: x.period, amountPaise: take });
    left -= take;
  }
  return lines;
}
