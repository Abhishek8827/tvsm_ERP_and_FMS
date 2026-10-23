import { ReceiptRuleError, planRebate, rupeesToPaise, todayIst } from '@erp/shared';
import { AppError } from '../utils/errors.js';
import { recordAudit } from './audit.js';
import { postLastMonth } from './feePlan.js';

/**
 * The three kinds of rebate the Admin gives. `kind` is the fee MODULE the fee engine works in
 * (admission belongs to the school module); `heads` limits which fees the rebate may lower.
 */
export const REBATE_TYPES = {
  school: { kind: 'school', heads: ['old_fees', 'tuition'], label: 'School fees' },
  transport: { kind: 'transport', heads: ['transport_old', 'transport'], label: 'Transport fees' },
  admission: { kind: 'school', heads: ['admission'], label: 'Admission fees' },
};
export const REBATE_TYPE_KEYS = Object.keys(REBATE_TYPES);

export const typeOf = (r) =>
  r.rebateType ??
  (r.kind === 'late_fee' ? 'late_fee' : r.kind === 'transport' ? 'transport' : 'school');

export const shapeRebate = (r) => ({
  id: String(r._id),
  studentId: String(r.studentId),
  student: r.student ?? null,
  fy: r.fy,
  kind: r.kind,
  type: typeOf(r),
  adjustOn: r.adjustOn ?? 'oldest',
  periods: r.periods ?? [],
  totalPaise: r.totalPaise,
  reason: r.reason,
  status: r.status,
  reversedReason: r.reversedReason ?? null,
  createdByName: r.createdByName ?? null,
  createdAt: r.createdAt,
});

function ruleToHttp(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ReceiptRuleError)
      throw new AppError(e.code, 422, e.message, e.field ? { [e.field]: e.message } : undefined);
    throw e;
  }
}

/**
 * Gives ONE rebate to ONE student (used by the Rebates screen and by the Excel import, so both
 * follow exactly the same rules). The amount can never be more than what is still unpaid, and
 * the same rebate (student + type + amount + reason, still active) is never saved twice, so a
 * double-click or a repeated import is harmless.
 */
export async function giveRebate({ deps, req, student, fy, type, amountPaise, reason, adjustOn }) {
  const tenantId = req.user.tenantId;
  const def = REBATE_TYPES[type];
  if (!def) throw new AppError('BAD_TYPE', 422, 'Choose school, transport or admission.');
  // Admission is a one-time fee: "last month" has no meaning for it.
  const order = type === 'admission' ? 'oldest' : adjustOn === 'last' ? 'last' : 'oldest';

  if (
    await deps.rebateStore.hasSame({
      tenantId,
      studentId: student._id,
      fy,
      rebateType: type,
      totalPaise: amountPaise,
      reason,
    })
  )
    throw new AppError(
      'DUPLICATE_REBATE',
      409,
      'This same rebate (type, amount and reason) is already given to this student.',
    );

  // BC / OTP style rebates lower the last month, which is not posted yet: post just that month.
  if (order === 'last') await postLastMonth({ deps, tenantId, student, fy, kind: def.kind });

  const rows = await deps.chargeStore.listForStudent(tenantId, student._id, fy);
  const charges = rows.map((c) => ({
    id: String(c._id),
    head: c.head,
    period: c.period,
    dueDate: c.dueDate,
    amount: c.amountPaise,
  }));
  if (charges.length === 0)
    throw new AppError('NO_FEE_PLAN', 409, 'This student has no fees posted for that year yet.');
  const chart = await deps.feeStore.get(tenantId, fy);

  return deps.rebateStore.create({
    tenantId,
    studentId: student._id,
    fy,
    kind: def.kind,
    rebateType: type,
    adjustOn: order,
    reason,
    student: { name: student.name, admissionNo: student.admissionNo, classKey: student.classKey },
    user: req.user,
    // Runs inside the transaction on freshly read receipts and rebates.
    build: (prior) =>
      ruleToHttp(() =>
        planRebate({
          kind: def.kind,
          charges,
          receipts: prior,
          asOf: todayIst(),
          config: chart ?? undefined,
          amountPaise,
          heads: def.heads,
          order,
        }),
      ),
    audit: (doc) =>
      recordAudit(
        deps,
        req,
        {
          action: 'create',
          entity: 'rebate',
          entityId: String(doc._id),
          reason,
          newValue: {
            student: student.admissionNo,
            fy,
            type,
            adjustOn: order,
            totalPaise: doc.totalPaise,
          },
        },
        { critical: true },
      ),
  });
}

// ---------------------------------------------------------------- Excel import (pure parsing)

export const REBATE_IMPORT_HEADERS = [
  'SCH. ID',
  'REBATE TYPE',
  'AMOUNT (₹)',
  'REASON',
  'ADJUST ON',
];
const norm = (h) =>
  String(h ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
const FIELD = {
  SCHID: 'admissionNo',
  SCH: 'admissionNo',
  ADMISSIONNO: 'admissionNo',
  REBATETYPE: 'type',
  TYPE: 'type',
  AMOUNT: 'amount',
  REASON: 'reason',
  ADJUSTON: 'adjustOn', // optional column: "last" or "oldest"
  ADJUST: 'adjustOn',
};
const TYPE_WORDS = {
  school: 'school',
  'school fees': 'school',
  tuition: 'school',
  transport: 'transport',
  'transport fees': 'transport',
  bus: 'transport',
  admission: 'admission',
  'admission fees': 'admission',
};
const empty = (c) => c === null || c === undefined || String(c).trim() === '';

/** @returns {{ fileError?: string, rows: object[], errors: {row:number,message:string}[] }} */
export function parseRebateSheet(sheet) {
  if (!Array.isArray(sheet) || sheet.length === 0)
    return { fileError: 'The file is empty.', rows: [], errors: [] };
  const fieldAt = sheet[0].map((h) => FIELD[norm(h)]);
  for (const need of ['admissionNo', 'type', 'amount', 'reason'])
    if (!fieldAt.includes(need))
      return {
        fileError: 'Columns SCH. ID, REBATE TYPE, AMOUNT and REASON are needed. Use the template.',
        rows: [],
        errors: [],
      };
  const rows = [];
  const errors = [];
  const seen = new Map();
  for (let i = 1; i < sheet.length; i += 1) {
    const cells = sheet[i];
    const rowNo = i + 1;
    if (!cells || cells.every(empty)) continue;
    const raw = {};
    fieldAt.forEach((f, col) => {
      if (f && raw[f] === undefined) raw[f] = cells[col];
    });
    const problems = [];
    const admissionNo = String(raw.admissionNo ?? '').trim();
    if (!admissionNo) problems.push('SCH. ID is empty');
    const type =
      TYPE_WORDS[
        String(raw.type ?? '')
          .trim()
          .toLowerCase()
      ];
    if (!type) problems.push('REBATE TYPE must be school, transport or admission');
    let amountPaise = 0;
    try {
      const cell = raw.amount;
      amountPaise = rupeesToPaise(typeof cell === 'number' ? cell.toFixed(2) : String(cell ?? ''));
      if (!(amountPaise > 0)) problems.push('AMOUNT must be more than zero');
    } catch {
      problems.push(`AMOUNT "${raw.amount ?? ''}" is not a valid amount`);
    }
    const reason = String(raw.reason ?? '').trim();
    if (reason.length < 2) problems.push('REASON is needed (for example BC, OTP)');
    const adjustWord = String(raw.adjustOn ?? '')
      .trim()
      .toLowerCase();
    if (adjustWord && !['last', 'last month', 'oldest', 'oldest first'].includes(adjustWord))
      problems.push('ADJUST ON must be "last" or "oldest" (or empty)');
    const adjustOn = adjustWord.startsWith('last') ? 'last' : 'oldest';
    if (problems.length === 0) {
      const key = `${admissionNo}|${type}|${amountPaise}|${reason.toLowerCase()}`;
      if (seen.has(key)) problems.push(`Same row is repeated (also in row ${seen.get(key)})`);
      else seen.set(key, rowNo);
    }
    if (problems.length) errors.push({ row: rowNo, message: problems.join('; ') });
    else rows.push({ row: rowNo, admissionNo, type, amountPaise, reason, adjustOn });
  }
  return { rows, errors };
}
