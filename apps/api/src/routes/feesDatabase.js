import { Router } from 'express';
import writeXlsxFile from 'write-excel-file/node';
import { z } from 'zod';
import {
  CLASS_KEYS,
  ReceiptRuleError,
  computeDues,
  creditsFromReceipts,
  lateSettledFromReceipts,
  classLabel,
  getFinancialYear,
  istDateString,
  planRebate,
  todayIst,
} from '@erp/shared';
import { requireRole } from '../middleware/requireRole.js';
import { recordAudit } from '../services/audit.js';
import { buildFeeRows, filterRows, sortRows, totalsOf } from '../services/feesDatabase.js';
import { AppError, notFound } from '../utils/errors.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXPORT_LIMIT = 6000;
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const rupeesToPaise = z.coerce
  .number()
  .min(0)
  .transform((r) => Math.round(r * 100));
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Bad id');

const filterQuery = z.object({
  fy: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  q: z.string().trim().max(60).optional(),
  classKey: z.enum(CLASS_KEYS).optional(),
  section: z.string().trim().max(5).optional(),
  status: z.enum(['active', 'inactive']).default('active'),
  transport: bool.optional(),
  newAdmission: bool.optional(),
  rte: bool.optional(),
  village: z.string().trim().max(60).optional(),
  category: z.string().trim().max(10).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  feeStatus: z
    .enum(['noplan', 'overdue', 'pending', 'clear', 'school_paid_bus_pending'])
    .optional(),
  // "Dues up to this month" (YYYY-MM): fees due by the END of that month, whatever is paid today.
  upto: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  // Rupees in the URL, paise inside (rule: money is paise on the server).
  minDue: rupeesToPaise.optional(),
  maxDue: rupeesToPaise.optional(),
});
const listQuery = filterQuery.extend({
  sort: z.enum(['admissionNo', 'name', 'class', 'outstanding', 'dueNow', 'paid']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
// Last day of a "YYYY-MM" month, e.g. 2026-09 -> 2026-09-30 (the day dues are worked out for).
const endOfMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const rebateBody = z.object({
  fy: z.string().regex(/^\d{4}-\d{2}$/),
  kind: z.enum(['school', 'transport']),
  amountPaise: z.number().int().positive().max(100_000_000_00),
  head: z
    .enum(['tuition', 'admission', 'form', 'transport', 'old_fees', 'transport_old'])
    .optional(),
  reason: z.string().trim().min(3, 'Write the reason').max(300),
});
const waiverBody = z.object({
  fy: z.string().regex(/^\d{4}-\d{2}$/),
  periods: z.array(z.string().min(1).max(20)).min(1, 'Choose at least one month').max(12),
  reason: z.string().trim().min(3, 'Write the reason').max(300),
});
const reverseBody = z.object({ reason: z.string().trim().min(3, 'Write the reason').max(300) });

const shapeRebate = (r) => ({
  id: String(r._id),
  studentId: String(r.studentId),
  student: r.student ?? null,
  fy: r.fy,
  kind: r.kind,
  periods: r.periods ?? [],
  totalPaise: r.totalPaise,
  reason: r.reason,
  status: r.status,
  reversedReason: r.reversedReason ?? null,
  createdByName: r.createdByName ?? null,
  createdAt: r.createdAt,
});

/**
 * Fees Database. Everyone signed in can LOOK (the Cashier too, read-only and without Excel);
 * only the Admin changes anything (late-fee waivers here; rebates have their own module,
 * rebates.js; fees are posted automatically every month).
 */
export function feesDatabaseRouter(deps, authenticate) {
  const router = Router();
  const all = [authenticate, requireRole('admin', 'principal', 'cashier')];
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };
  const ruleToHttp = (fn) => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof ReceiptRuleError)
        throw new AppError(e.code, 422, e.message, e.field ? { [e.field]: e.message } : undefined);
      throw e;
    }
  };

  async function rowsFor(req, f) {
    const fy = f.fy ?? getFinancialYear(new Date());
    const { fy: _fy, feeStatus, minDue, maxDue, upto, ...studentFilters } = f;
    const rows = await buildFeeRows({
      deps,
      tenantId: req.user.tenantId,
      fy,
      filters: studentFilters,
      asOf: upto ? endOfMonth(upto) : todayIst(),
    });
    return {
      fy,
      rows: filterRows(rows, { feeStatus, minDuePaise: minDue, maxDuePaise: maxDue }),
    };
  }

  router.get(
    '/fees-database',
    ...all,
    wrap(async (req, res) => {
      const f = listQuery.parse(req.query);
      const { fy, rows } = await rowsFor(req, f);
      const sorted = sortRows(rows, f.sort, f.dir);
      res.json({
        fy,
        page: f.page,
        pageSize: f.pageSize,
        total: sorted.length,
        totals: totalsOf(rows),
        rows: sorted.slice((f.page - 1) * f.pageSize, f.page * f.pageSize),
      });
    }),
  );

  router.get(
    '/fees-database/export',
    authenticate,
    requireRole('admin', 'principal'),
    wrap(async (req, res) => {
      const f = filterQuery.parse(req.query);
      const { fy, rows } = await rowsFor(req, f);
      if (rows.length > EXPORT_LIMIT)
        throw new AppError('TOO_MANY_ROWS', 413, 'Too many students. Narrow the filters.');
      // Every column of the school's sheet is always exported (hiding columns is only on screen).
      const head = [
        'S.NO',
        'SCH. ID',
        'STUDENT NAME',
        'CLASS',
        'SECTION',
        'ADDRESS',
        'CONTACT NO.',
        'OLD SCHOOL DUE',
        'OLD BUS DUE',
        'NEW SCHOOL RECEIVABLE',
        'NEW BUS RECEIVABLE',
        'ADM FEES REC.',
        'FORM FEES REC.',
        'NEW SCHOOL FEE PAID',
        'NEW BUS FEE PAID',
        'ADMISSION FEE PAID',
        'FORM FEE PAID',
        'SCHOOL - REBATE',
        'TRANSPORT - REBATE',
        'ADMISSION - REBATE',
        'NEW SCHOOL FEES DUE',
        'NEW BUS FEES DUE',
        'ADM FEES DUE',
        'FORM FEES DUE',
        'TOTAL DUES',
        'LATE FEE (PENALTY, NOT IN TOTAL)',
        'STATUS',
      ];
      const r = (p) => p / 100;
      const body = sortRows(rows, 'class').map((x, i) => [
        i + 1,
        x.admissionNo,
        x.name,
        classLabel(x.classKey),
        x.section,
        x.address,
        x.contactNo,
        r(x.cols.oldSchoolDue),
        r(x.cols.oldBusDue),
        r(x.cols.newSchoolReceivable),
        r(x.cols.newBusReceivable),
        r(x.cols.admReceivable),
        r(x.cols.formReceivable),
        r(x.cols.newSchoolPaid),
        r(x.cols.newBusPaid),
        r(x.cols.admPaid),
        r(x.cols.formPaid),
        r(x.cols.schoolRebate),
        r(x.cols.transportRebate),
        r(x.cols.admissionRebate),
        r(x.cols.newSchoolDue),
        r(x.cols.newBusDue),
        r(x.cols.admDue),
        r(x.cols.formDue),
        r(x.dueNowPaise),
        r(x.lateFeePaise),
        x.status === 'active' ? 'Active' : 'Inactive',
      ]);
      const buffer = await writeXlsxFile([
        head.map((value) => ({ value, fontWeight: 'bold' })),
        ...body,
      ]).toBuffer();
      await recordAudit(deps, req, {
        action: 'export',
        entity: 'fees_database',
        newValue: { rows: rows.length, fy, upto: f.upto ?? null },
      });
      res
        .set('Content-Type', XLSX)
        .set(
          'Content-Disposition',
          `attachment; filename="fees-database-${istDateString(new Date())}.xlsx"`,
        )
        .send(buffer);
    }),
  );

  // ----- rebates -----
  router.get(
    '/students/:id/rebates',
    authenticate,
    requireRole('admin', 'principal'),
    wrap(async (req, res) => {
      const rows = await deps.rebateStore.listForStudent(
        req.user.tenantId,
        objectId.parse(req.params.id),
      );
      res.json({ rows: rows.map(shapeRebate) });
    }),
  );

  router.post(
    '/students/:id/rebates',
    authenticate,
    requireRole('admin'),
    wrap(async (req, res) => {
      const body = rebateBody.parse(req.body);
      const tenantId = req.user.tenantId;
      const student = await deps.studentStore.findById(tenantId, objectId.parse(req.params.id));
      if (!student) throw notFound('Student');
      const rows = await deps.chargeStore.listForStudent(tenantId, student._id, body.fy);
      const charges = rows.map((c) => ({
        id: String(c._id),
        head: c.head,
        period: c.period,
        dueDate: c.dueDate,
        amount: c.amountPaise,
      }));
      if (charges.length === 0)
        throw new AppError(
          'NO_FEE_PLAN',
          409,
          'This student has no fees posted for that year. Apply fees first.',
        );
      const chart = await deps.feeStore.get(tenantId, body.fy);
      const saved = await deps.rebateStore.create({
        tenantId,
        studentId: student._id,
        fy: body.fy,
        kind: body.kind,
        rebateType: body.kind,
        reason: body.reason,
        student: {
          name: student.name,
          admissionNo: student.admissionNo,
          classKey: student.classKey,
        },
        user: req.user,
        // Runs inside the transaction on freshly read receipts and rebates.
        build: (prior) =>
          ruleToHttp(() =>
            planRebate({
              kind: body.kind,
              charges,
              receipts: prior,
              asOf: todayIst(),
              config: chart ?? undefined,
              amountPaise: body.amountPaise,
              head: body.head,
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
              reason: body.reason,
              newValue: {
                student: student.admissionNo,
                fy: body.fy,
                kind: body.kind,
                totalPaise: doc.totalPaise,
              },
            },
            { critical: true },
          ),
      });
      res.status(201).json(shapeRebate(saved));
    }),
  );

  // Late-fee relaxation: the Admin waives the late fee of chosen overdue months, with a reason.
  // Stored like a rebate (so it can be reversed and is audited) but it carries months, not money.
  router.post(
    '/students/:id/late-fee-waivers',
    authenticate,
    requireRole('admin'),
    wrap(async (req, res) => {
      const body = waiverBody.parse(req.body);
      const tenantId = req.user.tenantId;
      const student = await deps.studentStore.findById(tenantId, objectId.parse(req.params.id));
      if (!student) throw notFound('Student');
      const rows = await deps.chargeStore.listForStudent(tenantId, student._id, body.fy);
      const charges = rows.map((c) => ({
        id: String(c._id),
        head: c.head,
        period: c.period,
        dueDate: c.dueDate,
        amount: c.amountPaise,
      }));
      const chart = await deps.feeStore.get(tenantId, body.fy);
      const saved = await deps.rebateStore.create({
        tenantId,
        studentId: student._id,
        fy: body.fy,
        kind: 'late_fee',
        reason: body.reason,
        student: {
          name: student.name,
          admissionNo: student.admissionNo,
          classKey: student.classKey,
        },
        user: req.user,
        // Inside the transaction, on freshly read data: only months that REALLY carry a late fee
        // right now can be waived (so a month cannot be waived twice or before it is late).
        build: (prior) => {
          const dues = computeDues({
            charges,
            credits: creditsFromReceipts(prior),
            asOf: todayIst(),
            config: chart ?? undefined,
            lateFeesSettled: lateSettledFromReceipts(prior),
          });
          const late = new Map(
            dues.instalments.filter((i) => i.lateFee > 0).map((i) => [i.period, i.lateFee]),
          );
          const bad = body.periods.filter((p) => !late.has(p));
          if (bad.length)
            throw new AppError(
              'NO_LATE_FEE',
              422,
              `No late fee is pending for: ${bad.join(', ')}.`,
              { periods: 'Choose months that have a late fee' },
            );
          return {
            lines: [],
            periods: body.periods,
            totalPaise: body.periods.reduce((n, p) => n + late.get(p), 0),
          };
        },
        audit: (doc) =>
          recordAudit(
            deps,
            req,
            {
              action: 'create',
              entity: 'late_fee_waiver',
              entityId: String(doc._id),
              reason: body.reason,
              newValue: {
                student: student.admissionNo,
                fy: body.fy,
                periods: body.periods,
                totalPaise: doc.totalPaise,
              },
            },
            { critical: true },
          ),
      });
      res.status(201).json(shapeRebate(saved));
    }),
  );

  router.post(
    '/rebates/:id/reverse',
    authenticate,
    requireRole('admin'),
    wrap(async (req, res) => {
      const { reason } = reverseBody.parse(req.body);
      const id = objectId.parse(req.params.id);
      const done = await deps.rebateStore.reverse({
        tenantId: req.user.tenantId,
        id,
        reason,
        user: req.user,
      });
      if (!done) throw new AppError('NOT_FOUND', 404, 'Rebate not found or already reversed.');
      await recordAudit(
        deps,
        req,
        { action: 'cancel', entity: 'rebate', entityId: id, reason },
        { critical: true },
      );
      res.json(shapeRebate(done));
    }),
  );

  return router;
}
