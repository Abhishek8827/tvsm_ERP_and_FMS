import { Router } from 'express';
import writeXlsxFile from 'write-excel-file/node';
import { z } from 'zod';
import {
  CLASS_KEYS,
  ReceiptRuleError,
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
  feeStatus: z.enum(['noplan', 'overdue', 'pending', 'clear']).optional(),
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
const rebateBody = z.object({
  fy: z.string().regex(/^\d{4}-\d{2}$/),
  kind: z.enum(['school', 'transport']),
  amountPaise: z.number().int().positive().max(100_000_000_00),
  head: z
    .enum(['tuition', 'admission', 'form', 'transport', 'old_fees', 'transport_old'])
    .optional(),
  reason: z.string().trim().min(3, 'Write the reason').max(300),
});
const reverseBody = z.object({ reason: z.string().trim().min(3, 'Write the reason').max(300) });

const shapeRebate = (r) => ({
  id: String(r._id),
  studentId: String(r.studentId),
  student: r.student ?? null,
  fy: r.fy,
  kind: r.kind,
  totalPaise: r.totalPaise,
  reason: r.reason,
  status: r.status,
  reversedReason: r.reversedReason ?? null,
  createdByName: r.createdByName ?? null,
  createdAt: r.createdAt,
});

/**
 * Fees Database. Everyone signed in can LOOK (the Cashier too, read-only and without Excel);
 * only the Admin changes anything (apply fees is in ledger.js; rebates are here).
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
    const { fy: _fy, feeStatus, minDue, maxDue, ...studentFilters } = f;
    const rows = await buildFeeRows({
      deps,
      tenantId: req.user.tenantId,
      fy,
      filters: studentFilters,
      asOf: todayIst(),
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
      const head = [
        'Sch. No',
        'Student',
        'Father',
        'Class',
        'Section',
        'Village',
        'Bus',
        'Billed (₹)',
        'Paid (₹)',
        'Rebate (₹)',
        'Outstanding (₹)',
        'Due till today (₹)',
        'Overdue (₹)',
        'Late fee (₹)',
        'School due till today (₹)',
        'Bus due till today (₹)',
      ];
      const r = (p) => p / 100;
      const body = sortRows(rows, 'class').map((x) => [
        x.admissionNo,
        x.name,
        x.fatherName,
        classLabel(x.classKey),
        x.section,
        x.village,
        x.usesTransport ? 'Yes' : 'No',
        r(x.billedPaise),
        r(x.paidPaise),
        r(x.rebatePaise),
        r(x.outstandingPaise),
        r(x.dueNowPaise),
        r(x.overduePaise),
        r(x.lateFeePaise),
        r(x.school.dueNowPaise),
        r(x.transport.dueNowPaise),
      ]);
      const buffer = await writeXlsxFile([
        head.map((value) => ({ value, fontWeight: 'bold' })),
        ...body,
      ]).toBuffer();
      await recordAudit(deps, req, {
        action: 'export',
        entity: 'fees_database',
        newValue: { rows: rows.length, fy },
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
