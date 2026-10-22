import { Router } from 'express';
import { z } from 'zod';
import {
  computeDues,
  creditsFromReceipts,
  lateSettledFromReceipts,
  moduleDues,
  todayIst,
} from '@erp/shared';
import { requireRole } from '../middleware/requireRole.js';
import { recordAudit } from '../services/audit.js';
import { chargesForStudent, postPlans } from '../services/feePlan.js';
import { AppError, notFound } from '../utils/errors.js';

const fyField = z.string().regex(/^\d{4}-\d{2}$/, 'Use a year like 2026-27');
const applyBody = z.object({
  fy: fyField,
  kinds: z
    .array(z.enum(['school', 'transport']))
    .min(1)
    .default(['school', 'transport']),
  classKey: z.string().optional(),
  studentIds: z.array(z.string()).max(2000).optional(),
});
const planBody = z.object({ fy: fyField });
const ledgerQuery = z.object({
  fy: fyField,
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * Student fee plan and ledger.
 *  - POST  /students/:id/fee-plan  (Admin) posts the year's charges from the fee chart.
 *  - GET   /students/:id/ledger    (all roles) shows charges, dues and late fee as of a day.
 * All maths runs here on the server in integer paise (rule 1); the browser only displays it.
 */
export function ledgerRouter(deps, authenticate) {
  const router = Router();

  router.post(
    '/students/:id/fee-plan',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        const { fy } = planBody.parse(req.body);
        const tenantId = req.user.tenantId;
        const student = await deps.studentStore.findById(tenantId, req.params.id);
        if (!student) throw notFound('Student');
        if (student.status !== 'active')
          throw new AppError('STUDENT_INACTIVE', 409, 'This student is inactive.');
        const chart = await deps.feeStore.get(tenantId, fy);
        const charges = chargesForStudent({ student, chart, fy });
        const created = await deps.chargeStore.postMany(tenantId, student._id, fy, charges);
        await recordAudit(deps, req, {
          action: 'create',
          entity: 'fee_plan',
          entityId: String(student._id),
          newValue: { fy, charges: charges.length, newlyAdded: created },
        });
        res
          .status(created > 0 ? 201 : 200)
          .json({ fy, charges: charges.length, newlyAdded: created });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/students/:id/ledger',
    authenticate,
    requireRole('admin', 'principal', 'cashier'),
    async (req, res, next) => {
      try {
        const { fy, asOf } = ledgerQuery.parse(req.query);
        const tenantId = req.user.tenantId;
        const student = await deps.studentStore.findById(tenantId, req.params.id);
        if (!student) throw notFound('Student');
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
        const day = asOf ?? todayIst();
        const config = chart ?? undefined;
        const dues = computeDues({
          charges,
          credits: creditsFromReceipts(receipts),
          asOf: day,
          config,
          lateFeesSettled: lateSettledFromReceipts(receipts),
        });
        // School and transport have separate receipts; the late fee is ONE Rs 100 per month for both.
        const school = moduleDues({ kind: 'school', charges, receipts, asOf: day, config });
        const transport = moduleDues({ kind: 'transport', charges, receipts, asOf: day, config });
        res.json({
          fy,
          student: {
            id: String(student._id),
            name: student.name,
            admissionNo: student.admissionNo,
          },
          ...dues,
          planPosted: charges.length > 0,
          modules: { school: school.totals, transport: transport.totals },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // Bulk: post (or top up) the year's charges for a class or for every active student.
  router.post('/fee-plan/apply', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const body = applyBody.parse(req.body);
      const tenantId = req.user.tenantId;
      const students = await deps.studentStore.activeForPlan(tenantId, {
        classKey: body.classKey,
        ids: body.studentIds,
      });
      const result = await postPlans({ deps, tenantId, students, fy: body.fy, kinds: body.kinds });
      await recordAudit(deps, req, {
        action: 'create',
        entity: 'fee_plan_bulk',
        newValue: {
          fy: body.fy,
          kinds: body.kinds,
          classKey: body.classKey ?? 'all',
          students: result.students,
          newCharges: result.newCharges,
          skipped: result.skipped.length,
        },
      });
      res.json({ ...result, skipped: result.skipped.slice(0, 200) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
