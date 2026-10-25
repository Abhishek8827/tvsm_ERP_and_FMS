import { Router } from 'express';
import writeXlsxFile from 'write-excel-file/node';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  HEAD_LABEL,
  MODULES,
  ReceiptRuleError,
  getFinancialYear,
  istDateString,
  moduleDues,
  planReceipt,
  todayIst,
} from '@erp/shared';
import { requireRole } from '../middleware/requireRole.js';
import { recordAudit } from '../services/audit.js';
import { postAdvanceMonths } from '../services/feePlan.js';
import { AppError, notFound } from '../utils/errors.js';

// UPI and QR payments must carry the bank's reference so they can be matched with the statement.
const MODES_NEEDING_REFERENCE = ['upi', 'qr'];
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const paise = z.number().int().min(0).max(100_000_000);
const kindField = z.enum(MODULES);
const issueBody = z.object({
  studentId: objectId,
  kind: kindField,
  input: z.object({
    oldPaise: paise.optional(),
    newPaise: paise.optional(),
    admissionPaise: paise.optional(),
    formPaise: paise.optional(),
    tcPaise: paise.optional(),
    otherPaise: paise.optional(),
    otherNote: z.string().trim().max(80).optional(),
    lateFeePaise: paise.optional(),
    lateFeeRemark: z.string().trim().max(200).optional(),
  }),
  mode: z.enum(['cash', 'upi', 'qr']),
  reference: z.string().trim().max(60).optional(),
  // Which bank account the UPI / QR money went to (compulsory for UPI and QR).
  bankId: objectId.optional(),
});
const idemKey = z
  .string({ error: 'Idempotency-Key header is required' })
  .regex(/^[\w-]{8,100}$/, 'Idempotency-Key must be 8-100 letters, digits, - or _');

const statusOf = (c) =>
  c?.status === 'cancelled'
    ? 'cancelled'
    : c?.status === 'requested'
      ? 'cancel_requested'
      : 'valid';

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-06-30');
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  from: dateField.optional(),
  to: dateField.optional(),
  kind: kindField.optional(),
  mode: z.enum(['cash', 'upi', 'qr']).optional(),
  q: z.string().trim().max(60).optional(),
  status: z.enum(['valid', 'cancelled']).optional(),
});
const cancelBody = z.object({ reason: z.string().trim().min(3, 'Please give a reason').max(200) });
const EXPORT_LIMIT = 20_000;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const shapeReceipt = (r, extra = {}) => ({
  id: String(r._id),
  number: r.number,
  kind: r.kind,
  fy: r.fy,
  student: r.student,
  lines: r.lines.map((l) => ({
    head: l.head,
    label: l.head === 'other' && l.note ? l.note : HEAD_LABEL[l.head],
    period: l.period ?? null,
    amountPaise: l.amountPaise,
  })),
  lateFee: r.lateFee ?? null,
  totalPaise: r.totalPaise,
  monthLabel: r.monthLabel,
  dueAfterPaise: r.dueAfterPaise,
  dueAfterOldPaise: r.dueAfterOldPaise ?? 0,
  dueAfterNewPaise: r.dueAfterNewPaise ?? r.dueAfterPaise,
  mode: r.mode,
  reference: r.reference ?? null,
  bankName: r.bankName ?? null,
  cashierName: r.cashierName ?? null,
  issuedAt: r.issuedAt,
  status: r.status ?? statusOf(r.cancellation),
  cancellation: r.cancellation
    ? {
        status: r.cancellation.status,
        reason: r.cancellation.reason,
        requestedByName: r.cancellation.requestedByName ?? null,
        decidedByName: r.cancellation.decidedByName ?? null,
      }
    : null,
  ...extra,
});

async function loadStudentAndLedger(deps, tenantId, studentId) {
  const student = await deps.studentStore.findById(tenantId, studentId);
  if (!student) throw notFound('Student');
  const fy = getFinancialYear(new Date());
  const [charges, receipts, chart] = await Promise.all([
    deps.chargeStore.listForStudent(tenantId, student._id, fy),
    deps.receiptStore.listForStudent(tenantId, student._id, fy),
    deps.feeStore.get(tenantId, fy),
  ]);
  return {
    student,
    fy,
    chart,
    receipts,
    charges: charges.map((c) => ({
      id: String(c._id),
      head: c.head,
      period: c.period,
      dueDate: c.dueDate,
      amount: c.amountPaise,
    })),
  };
}

/**
 * Fee collection. Cashier collects; Admin and Principal can only look.
 *  - GET  /students/:id/dues?kind=school|transport   what is pending (server-calculated)
 *  - POST /receipts                                  collect and issue a receipt (needs Idempotency-Key)
 *  - GET  /receipts/:id                              one receipt
 *  - POST /receipts/:id/reprint                      a later print: marked DUPLICATE, audited
 * Receipts are never edited. The server re-checks every rule; the browser is only a convenience.
 */
export function receiptsRouter(deps, authenticate) {
  const router = Router();
  const look = [authenticate, requireRole('admin', 'principal', 'cashier')];

  router.get('/students/:id/dues', ...look, async (req, res, next) => {
    try {
      const kind = kindField.parse(req.query.kind);
      const tenantId = req.user.tenantId;
      const { student, fy, chart, receipts, charges } = await loadStudentAndLedger(
        deps,
        tenantId,
        req.params.id,
      );
      const asOf = todayIst();
      const dues = moduleDues({ kind, charges, receipts, asOf, config: chart ?? undefined });
      const remaining = {};
      for (const i of dues.instalments)
        for (const it of i.items) remaining[it.head] = (remaining[it.head] ?? 0) + it.due;
      res.json({
        kind,
        fy,
        asOf,
        student: {
          id: String(student._id),
          admissionNo: student.admissionNo,
          name: student.name,
          fatherName: student.fatherName ?? null,
          classKey: student.classKey,
          section: student.section ?? null,
          village: student.village ?? null,
          usesTransport: !!student.usesTransport,
          status: student.status,
        },
        planPosted: charges.length > 0, // false: nothing posted yet, so nothing can be collected
        remaining, // still unpaid per head, for the whole year
        lateFeeCalculatedPaise: dues.totals.lateFee,
        dueNowPaise: dues.totals.dueNow,
        instalments: dues.instalments,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/receipts',
    rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }),
    authenticate,
    requireRole('cashier', 'admin'),
    async (req, res, next) => {
      try {
        const key = idemKey.parse(req.get('Idempotency-Key'));
        const body = issueBody.parse(req.body);
        if (MODES_NEEDING_REFERENCE.includes(body.mode) && (body.reference ?? '').length < 4)
          throw new AppError('REFERENCE_REQUIRED', 422, 'Enter the UPI / QR reference number.', {
            reference: 'Reference number is required',
          });
        const tenantId = req.user.tenantId;
        let bank = null;
        if (MODES_NEEDING_REFERENCE.includes(body.mode)) {
          bank = body.bankId ? await deps.moneyStore.findActiveBank(tenantId, body.bankId) : null;
          if (!bank)
            throw new AppError(
              'BANK_REQUIRED',
              422,
              'Choose the bank account that received the money.',
              {
                bankId: 'Choose the bank account',
              },
            );
        }
        // A closed day takes no more receipts (the Admin can reopen it with a reason).
        if (await deps.dayCloseStore.isClosed(tenantId, todayIst()))
          throw new AppError(
            'DAY_CLOSED',
            409,
            "Today's Day Close is done, so fees cannot be collected. Ask the Admin to reopen the day.",
          );
        let loaded = await loadStudentAndLedger(deps, tenantId, body.studentId);
        const { student, fy, chart } = loaded;
        if (student.status !== 'active')
          throw new AppError(
            'STUDENT_INACTIVE',
            409,
            'Fees cannot be collected for an inactive student.',
          );

        // Future months are not posted yet. If more than the posted fee is being paid (advance),
        // post the months it needs first, then read the charges again.
        if ((body.input.newPaise ?? 0) > 0) {
          const added = await postAdvanceMonths({
            deps,
            tenantId,
            student,
            fy,
            kind: body.kind,
            wantPaise: body.input.newPaise,
          });
          if (added > 0) loaded = await loadStudentAndLedger(deps, tenantId, body.studentId);
        }

        const asOf = todayIst();
        const { receipt, replay } = await deps.receiptStore.issue({
          tenantId,
          studentId: student._id,
          fy,
          kind: body.kind,
          idempotencyKey: key,
          // Runs inside the transaction on freshly re-read receipts (see makeReceiptStore.issue).
          build: async (prior) => {
            let plan;
            try {
              plan = planReceipt({
                kind: body.kind,
                charges: loaded.charges,
                receipts: prior,
                asOf,
                config: chart ?? undefined,
                input: body.input,
              });
            } catch (e) {
              if (e instanceof ReceiptRuleError)
                throw new AppError(
                  e.code,
                  422,
                  e.message,
                  e.field ? { [e.field]: e.message } : undefined,
                );
              throw e;
            }
            return {
              lines: plan.lines,
              lateFee: plan.lateFee,
              totalPaise: plan.totalPaise,
              monthLabel: plan.monthLabel,
              dueAfterPaise: plan.dueAfterPaise,
              dueAfterOldPaise: plan.dueAfterOldPaise,
              dueAfterNewPaise: plan.dueAfterNewPaise,
              mode: body.mode,
              reference: body.mode === 'cash' ? undefined : body.reference,
              bankId: bank ? String(bank._id) : undefined,
              bankName: bank?.name,
              cashierId: String(req.user.id),
              cashierName: req.user.name,
              student: {
                admissionNo: student.admissionNo,
                name: student.name,
                fatherName: student.fatherName,
                classKey: student.classKey,
                section: student.section,
                address: student.address,
                contactNo: student.contactNo,
                village: student.village,
              },
            };
          },
          audit: async (saved, session) => {
            await recordAudit(
              deps,
              req,
              {
                action: 'create',
                entity: 'receipt',
                entityId: String(saved._id),
                newValue: {
                  number: saved.number,
                  kind: saved.kind,
                  totalPaise: saved.totalPaise,
                  mode: saved.mode,
                  studentId: String(saved.studentId),
                },
              },
              { critical: true, session },
            );
            // Every reduced late fee is audited on its own, with the cashier's reason.
            if (saved.lateFee && saved.lateFee.chargedPaise < saved.lateFee.calculatedPaise)
              await recordAudit(
                deps,
                req,
                {
                  action: 'override',
                  entity: 'late_fee',
                  entityId: String(saved._id),
                  oldValue: { calculatedPaise: saved.lateFee.calculatedPaise },
                  newValue: { chargedPaise: saved.lateFee.chargedPaise },
                  reason: saved.lateFee.remark,
                },
                { critical: true, session },
              );
          },
        });
        res.status(replay ? 200 : 201).json(shapeReceipt(receipt, { replay }));
      } catch (err) {
        next(err);
      }
    },
  );

  // List + totals for the Receipts / Fees & Receipts screens and the Cashier dashboard.
  router.get('/receipts', ...look, async (req, res, next) => {
    try {
      const f = listQuery.parse(req.query);
      const out = await deps.receiptStore.list({ tenantId: req.user.tenantId, ...f });
      const totals = { paise: 0, count: 0, byKind: {}, byMode: {} };
      for (const g of out.groups) {
        totals.paise += g.paise;
        totals.count += g.count;
        totals.byKind[g.kind] = (totals.byKind[g.kind] ?? 0) + g.paise;
        totals.byMode[g.mode] = (totals.byMode[g.mode] ?? 0) + g.paise;
      }
      res.json({
        rows: out.rows.map((r) => shapeReceipt(r)),
        total: out.total,
        page: f.page,
        pageSize: f.pageSize,
        totals, // only receipts that still count (cancelled ones are left out)
      });
    } catch (err) {
      next(err);
    }
  });

  // Admin only. Must stay above /receipts/:id.
  router.get('/receipts/export', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const f = listQuery.omit({ page: true, pageSize: true }).parse(req.query);
      const rows = await deps.receiptStore.listAll({
        tenantId: req.user.tenantId,
        ...f,
        limit: EXPORT_LIMIT + 1,
      });
      if (rows.length > EXPORT_LIMIT)
        throw new AppError(
          'TOO_MANY_ROWS',
          413,
          `More than ${EXPORT_LIMIT} receipts match. Narrow the dates and export again.`,
        );
      const head = [
        'Receipt No',
        'Date (IST)',
        'Type',
        'Sch. No',
        'Student',
        'Class',
        'Month',
        'Old Fees',
        'Tuition/Transport',
        'Admission',
        'Form',
        'Late Fee',
        'T.C.',
        'Other',
        'Total (₹)',
        'Mode',
        'Reference',
        'Cashier',
        'Status',
      ];
      const rupees = (paise) => paise / 100;
      const sum = (r, heads) =>
        rupees(
          r.lines.filter((l) => heads.includes(l.head)).reduce((a, l) => a + l.amountPaise, 0),
        );
      const body = rows.map((r) => [
        r.number,
        istDateString(r.issuedAt),
        r.kind === 'school' ? 'School' : 'Transport',
        r.student?.admissionNo ?? '',
        r.student?.name ?? '',
        r.student?.classKey ?? '',
        r.monthLabel ?? '',
        sum(r, ['old_fees', 'transport_old']),
        sum(r, ['tuition', 'transport']),
        sum(r, ['admission']),
        sum(r, ['form']),
        sum(r, ['late']),
        sum(r, ['tc']),
        sum(r, ['other']),
        rupees(r.totalPaise),
        r.mode.toUpperCase(),
        r.reference ?? '',
        r.cashierName ?? '',
        r.status === 'cancelled' ? 'Cancelled' : 'Valid',
      ]);
      const buffer = await writeXlsxFile([
        head.map((value) => ({ value, fontWeight: 'bold' })),
        ...body,
      ]).toBuffer();
      await recordAudit(deps, req, {
        action: 'export',
        entity: 'receipts',
        newValue: { rows: rows.length, filters: f },
      });
      res
        .set('Content-Type', XLSX)
        .set(
          'Content-Disposition',
          `attachment; filename="receipts-${istDateString(new Date())}.xlsx"`,
        )
        .send(buffer);
    } catch (err) {
      next(err);
    }
  });

  router.get('/receipts/:id', ...look, async (req, res, next) => {
    try {
      const r = await deps.receiptStore.findById(req.user.tenantId, objectId.parse(req.params.id));
      if (!r) throw notFound('Receipt');
      res.json(shapeReceipt(r));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/receipts/:id/reprint',
    authenticate,
    requireRole('admin', 'cashier'),
    async (req, res, next) => {
      try {
        const r = await deps.receiptStore.findById(
          req.user.tenantId,
          objectId.parse(req.params.id),
        );
        if (!r) throw notFound('Receipt');
        await recordAudit(
          deps,
          req,
          {
            action: 'reprint',
            entity: 'receipt',
            entityId: String(r._id),
            newValue: { number: r.number },
          },
          { critical: true },
        );
        res.json(shapeReceipt(r, { duplicate: true }));
      } catch (err) {
        next(err);
      }
    },
  );

  // The Cashier asks for a receipt to be cancelled. Approval is built in Step 8.
  router.post(
    '/receipts/:id/cancel-request',
    authenticate,
    requireRole('cashier'),
    async (req, res, next) => {
      try {
        const { reason } = cancelBody.parse(req.body);
        const tenantId = req.user.tenantId;
        const r = await deps.receiptStore.findById(tenantId, objectId.parse(req.params.id));
        if (!r) throw notFound('Receipt');
        const made = await deps.receiptStore.requestCancel({
          tenantId,
          receipt: r,
          reason,
          user: req.user,
          audit: (saved, session) =>
            recordAudit(
              deps,
              req,
              {
                action: 'create',
                entity: 'receipt_cancellation',
                entityId: String(saved._id),
                newValue: { receiptId: String(r._id), number: r.number, status: 'requested' },
                reason,
              },
              { critical: true, session },
            ),
        });
        if (!made)
          throw new AppError(
            'ALREADY_CANCELLING',
            409,
            'This receipt is already cancelled or already has a cancellation request.',
          );
        res.status(201).json({ id: String(made._id), status: 'cancel_requested' });
      } catch (err) {
        next(err);
      }
    },
  );

  // The Admin cancels directly, without Principal approval. The receipt itself is never edited;
  // its payments simply stop counting, so the fees become payable again.
  router.post(
    '/receipts/:id/cancel',
    authenticate,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        const { reason } = cancelBody.parse(req.body);
        const tenantId = req.user.tenantId;
        const r = await deps.receiptStore.findById(tenantId, objectId.parse(req.params.id));
        if (!r) throw notFound('Receipt');
        const done = await deps.receiptStore.cancelDirect({
          tenantId,
          receipt: r,
          reason,
          user: req.user,
          audit: (saved, session) =>
            recordAudit(
              deps,
              req,
              {
                action: 'cancel',
                entity: 'receipt',
                entityId: String(r._id),
                oldValue: { number: r.number, totalPaise: r.totalPaise },
                newValue: { status: 'cancelled' },
                reason,
              },
              { critical: true, session },
            ),
        });
        if (!done)
          throw new AppError('ALREADY_CANCELLED', 409, 'This receipt is already cancelled.');
        res.json({ id: String(r._id), status: 'cancelled' });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
