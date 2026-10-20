import { Router } from 'express';
import { z } from 'zod';
import { buildCharges, computeDues, creditsFromReceipts, moduleDues, todayIst } from '@erp/shared';
import { requireRole } from '../middleware/requireRole.js';
import { recordAudit } from '../services/audit.js';
import { AppError, notFound } from '../utils/errors.js';

const fyField = z.string().regex(/^\d{4}-\d{2}$/, 'Use a year like 2026-27');
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
        if (!chart)
          throw new AppError('NO_FEE_STRUCTURE', 409, `No fee chart exists for ${fy} yet.`);
        const row = chart.classFees.find((c) => c.classKey === student.classKey);
        if (!row)
          throw new AppError('NO_CLASS_FEE', 409, 'The fee chart has no fee for this class.');

        let transportMonthly = 0;
        if (student.usesTransport) {
          const village = chart.villages.find((v) => v.name === student.village?.toUpperCase());
          if (!village)
            throw new AppError(
              'NO_VILLAGE_FEE',
              409,
              `Bus fee for village "${student.village}" is not in the fee chart. Add it first.`,
            );
          transportMonthly = village.monthlyPaise;
        }

        const charges = buildCharges({
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
        });
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
        });
        // School and transport have separate receipts and separate late fees.
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
          totals: { ...dues.totals, lateFee: school.totals.lateFee + transport.totals.lateFee },
          modules: { school: school.totals, transport: transport.totals },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
