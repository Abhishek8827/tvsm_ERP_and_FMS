import express, { Router } from 'express';
import { readSheet } from 'read-excel-file/universal';
import writeXlsxFile from 'write-excel-file/node';
import { z } from 'zod';
import {
  REBATE_ADJUST_KEYS,
  REBATE_CATEGORIES,
  REBATE_CATEGORY_KEYS,
  classLabel,
  getFinancialYear,
  istDateString,
} from '@erp/shared';
import { requireRole } from '../middleware/requireRole.js';
import { recordAudit } from '../services/audit.js';
import {
  REBATE_IMPORT_HEADERS,
  REBATE_TYPES,
  REBATE_TYPE_KEYS,
  giveRebate,
  parseRebateSheet,
  resolveExtras,
  shapeRebate,
} from '../services/rebates.js';
import { AppError, notFound } from '../utils/errors.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_ROWS = 3000;
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Bad id');
const filters = z.object({
  q: z.string().trim().max(60).optional(),
  type: z.enum([...REBATE_TYPE_KEYS, 'late_fee']).optional(),
  status: z.enum(['active', 'reversed']).optional(),
});
const listQuery = filters.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const createBody = z.object({
  studentId: objectId,
  fy: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  // One entry per ticked type (the screen opens an amount box for each ticked type).
  items: z
    .array(
      z.object({
        type: z.enum(REBATE_TYPE_KEYS),
        amountPaise: z.number().int().positive().max(100_000_000_00),
      }),
    )
    .min(1, 'Tick at least one rebate type')
    .max(3),
  // min 2: short real reasons like "BC" must be allowed.
  reason: z.string().trim().min(2, 'Write the reason').max(300),
  // Why it is given. BC needs siblingNo, OTP needs receiptNo (checked against real records).
  category: z.enum(REBATE_CATEGORY_KEYS).default('other'),
  siblingNo: z.string().trim().max(30).optional(),
  receiptNo: z.string().trim().max(40).optional(),
  // Only used for category "other"; the other categories decide it themselves.
  adjustOn: z.enum(REBATE_ADJUST_KEYS).default('oldest'),
});
const ADJUST_LABEL = { last: 'Last month', all: 'All months', oldest: 'Oldest unpaid' };
const importQuery = z.object({ commit: z.enum(['true', 'false']).default('false') });

/**
 * Rebates module. Everyone who may look (Admin, Principal) sees one list of every concession;
 * only the Admin gives, imports or (in fees-database routes) reverses them.
 */
export function rebatesRouter(deps, authenticate) {
  const router = Router();
  const view = [authenticate, requireRole('admin', 'principal')];
  const adminOnly = [authenticate, requireRole('admin')];
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

  // Scholar number -> the student's details, shown on the Give-rebate form before saving.
  router.get(
    '/rebates/lookup/:admissionNo',
    ...adminOnly,
    wrap(async (req, res) => {
      const no = z.string().trim().min(1).max(30).parse(req.params.admissionNo);
      const [s] = await deps.studentStore.findByAdmissionNos(req.user.tenantId, [no]);
      if (!s) throw notFound('Student');
      res.json({
        id: String(s._id),
        admissionNo: s.admissionNo,
        name: s.name,
        fatherName: s.fatherName ?? '',
        classKey: s.classKey,
        section: s.section ?? '',
        address: s.address ?? '',
        contactNo: s.contactNo ?? '',
        status: s.status,
      });
    }),
  );

  router.get(
    '/rebates',
    ...view,
    wrap(async (req, res) => {
      const f = listQuery.parse(req.query);
      const out = await deps.rebateStore.list({ tenantId: req.user.tenantId, ...f });
      res.json({
        page: f.page,
        pageSize: f.pageSize,
        total: out.total,
        totals: { paise: out.active.paise, count: out.active.count },
        rows: out.rows.map(shapeRebate),
      });
    }),
  );

  router.get(
    '/rebates/export',
    ...view,
    wrap(async (req, res) => {
      const f = filters.parse(req.query);
      const out = await deps.rebateStore.list({ tenantId: req.user.tenantId, ...f, all: true });
      const head = [
        'S.No',
        'Sch. ID',
        'Student',
        'Class',
        'Rebate type',
        'Amount (₹)',
        'Category',
        'Sibling Sch. ID',
        'Receipt no',
        'Adjusted on',
        'Reason',
        'Status',
        'Date',
        'Given by',
      ];
      const label = (t) => (t === 'late_fee' ? 'Late fee waiver' : REBATE_TYPES[t]?.label);
      const body = out.rows
        .map(shapeRebate)
        .map((r, i) => [
          i + 1,
          r.student?.admissionNo ?? '',
          r.student?.name ?? '',
          r.student?.classKey ? classLabel(r.student.classKey) : '',
          label(r.type) ?? r.type,
          r.totalPaise / 100,
          r.category ? (REBATE_CATEGORIES[r.category]?.label ?? '') : '',
          r.sibling?.admissionNo ?? '',
          r.receiptNo ?? '',
          r.type === 'late_fee' ? '' : (ADJUST_LABEL[r.adjustOn] ?? 'Oldest unpaid'),
          r.reason,
          r.status === 'reversed' ? `Reversed: ${r.reversedReason ?? ''}` : 'Active',
          istDateString(new Date(r.createdAt)),
          r.createdByName ?? '',
        ]);
      const buffer = await writeXlsxFile([
        head.map((value) => ({ value, fontWeight: 'bold' })),
        ...body,
      ]).toBuffer();
      await recordAudit(deps, req, {
        action: 'export',
        entity: 'rebates',
        newValue: { rows: body.length },
      });
      res
        .set('Content-Type', XLSX)
        .set(
          'Content-Disposition',
          `attachment; filename="rebates-${istDateString(new Date())}.xlsx"`,
        )
        .send(buffer);
    }),
  );

  router.get(
    '/rebates/template',
    ...adminOnly,
    wrap(async (_req, res) => {
      const rows = [
        REBATE_IMPORT_HEADERS.map((value) => ({ value, fontWeight: 'bold' })),
        // One example line so the Admin sees the format (clearly not real data: SCH. ID is text).
        ['1234', 'school', 500, 'BC rebate', 'BC', '5678', '', ''],
      ];
      const buffer = await writeXlsxFile(rows).toBuffer();
      res
        .set('Content-Type', XLSX)
        .set('Content-Disposition', 'attachment; filename="rebate-import-template.xlsx"')
        .send(buffer);
    }),
  );

  // One screen, up to three rebates (school / transport / admission) for one student.
  router.post(
    '/rebates',
    ...adminOnly,
    wrap(async (req, res) => {
      const body = createBody.parse(req.body);
      const types = new Set(body.items.map((i) => i.type));
      if (types.size !== body.items.length)
        throw new AppError('BAD_ITEMS', 422, 'Each rebate type can be given only once.');
      const tenantId = req.user.tenantId;
      const student = await deps.studentStore.findById(tenantId, body.studentId);
      if (!student) throw notFound('Student');
      const fy = body.fy ?? getFinancialYear(new Date());
      const extras = await resolveExtras({
        deps,
        tenantId,
        student,
        category: body.category,
        siblingNo: body.siblingNo,
        receiptNo: body.receiptNo,
      });
      const created = [];
      const failed = [];
      for (const item of body.items) {
        try {
          const saved = await giveRebate({
            deps,
            req,
            student,
            fy,
            type: item.type,
            amountPaise: item.amountPaise,
            reason: body.reason,
            adjustOn: body.adjustOn,
            category: body.category,
            ...extras,
          });
          created.push(shapeRebate(saved));
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          failed.push({ type: item.type, code: err.code, message: err.message });
        }
      }
      // Nothing saved: tell the caller exactly why (the first reason is shown on the form).
      if (created.length === 0) {
        const first = failed[0];
        throw new AppError(first.code, 422, `${REBATE_TYPES[first.type].label}: ${first.message}`);
      }
      res.status(201).json({ created, failed });
    }),
  );

  router.post(
    '/rebates/import',
    ...adminOnly,
    express.raw({ type: 'application/octet-stream', limit: '5mb' }),
    wrap(async (req, res) => {
      const { commit } = importQuery.parse(req.query);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0)
        throw new AppError('NO_FILE', 400, 'Please choose an Excel (.xlsx) file.');
      let sheet;
      try {
        sheet = await readSheet(new Blob([req.body]));
      } catch {
        throw new AppError('BAD_FILE', 400, 'This file could not be read. Use an .xlsx file.');
      }
      if (sheet.length > MAX_ROWS + 1)
        throw new AppError('TOO_MANY_ROWS', 400, `Import up to ${MAX_ROWS} rows at a time.`);
      const parsed = parseRebateSheet(sheet);
      if (parsed.fileError) throw new AppError('BAD_TEMPLATE', 400, parsed.fileError);

      const tenantId = req.user.tenantId;
      const fy = getFinancialYear(new Date());
      const students = await deps.studentStore.findByAdmissionNos(
        tenantId,
        parsed.rows.map((r) => r.admissionNo),
      );
      const byNo = new Map(students.map((s) => [s.admissionNo, s]));
      const errors = [...parsed.errors];
      let ready = 0;
      let created = 0;
      let skippedSame = 0;
      for (const r of parsed.rows) {
        const student = byNo.get(r.admissionNo);
        if (!student) {
          errors.push({ row: r.row, message: `SCH. ${r.admissionNo} not found (skipped)` });
          continue;
        }
        if (
          await deps.rebateStore.hasSame({
            tenantId,
            studentId: student._id,
            fy,
            rebateType: r.type,
            totalPaise: r.amountPaise,
            reason: r.reason,
          })
        ) {
          skippedSame += 1;
          errors.push({
            row: r.row,
            message: `SCH. ${r.admissionNo}: same rebate already given (skipped)`,
          });
          continue;
        }
        let extras;
        try {
          extras = await resolveExtras({
            deps,
            tenantId,
            student,
            category: r.category,
            siblingNo: r.siblingNo,
            receiptNo: r.receiptNo,
          });
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          errors.push({ row: r.row, message: `SCH. ${r.admissionNo}: ${err.message}` });
          continue;
        }
        ready += 1;
        if (commit !== 'true') continue;
        try {
          await giveRebate({
            deps,
            req,
            student,
            fy,
            type: r.type,
            amountPaise: r.amountPaise,
            reason: r.reason,
            adjustOn: r.adjustOn,
            category: r.category,
            ...extras,
          });
          created += 1;
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          ready -= 1;
          errors.push({ row: r.row, message: `SCH. ${r.admissionNo}: ${err.message}` });
        }
      }
      errors.sort((a, b) => a.row - b.row);
      if (commit === 'true')
        await recordAudit(deps, req, {
          action: 'create',
          entity: 'rebate_import',
          newValue: { fy, created, skipped: errors.length },
        });
      res.json({
        committed: commit === 'true',
        fy,
        rowsInFile: parsed.rows.length + parsed.errors.length,
        ready,
        created,
        skipped: errors.length,
        skippedSame,
        errors: errors.slice(0, 200),
      });
    }),
  );

  return router;
}
