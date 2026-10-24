import { Router } from 'express';
import { z } from 'zod';
import { CLASS_KEYS, STREAMS, STREAM_CLASSES, getFinancialYear } from '@erp/shared';
import { requireRole } from '../middleware/requireRole.js';
import { recordAudit } from '../services/audit.js';
import { postPlans } from '../services/feePlan.js';
import { AppError, notFound } from '../utils/errors.js';

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(60).optional(),
  classKey: z.enum(CLASS_KEYS).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  section: z.string().trim().max(5).optional(),
  // Default order: scholar number, smallest first. Name sorts A to Z.
  sort: z
    .enum(['admissionNo', 'name', 'class', 'section', 'address', 'status'])
    .default('admissionNo'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});
const bulkDeleteBody = z.object({
  ids: z
    .array(z.string().regex(/^[a-f\d]{24}$/i, 'Invalid student id'))
    .min(1)
    .max(100),
  reason: z.string().trim().min(3, 'Please give a reason').max(200),
});

const text = (max = 100) => z.string().trim().max(max);
const studentFields = z.object({
  admissionNo: text(20).min(1, 'Admission number is required'),
  name: text().min(1, 'Name is required'),
  fatherName: text().optional(),
  motherName: text().optional(),
  classKey: z.enum(CLASS_KEYS),
  stream: z.enum(STREAMS).nullish(),
  section: text(5).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  dateOfBirth: z.coerce.date().optional(),
  contactNo: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Contact must be 10 digits')
    .optional(),
  address: text(200).optional(),
  category: text(10).optional(),
  nationality: text(40).optional(),
  firstAdmissionDate: z.coerce.date().optional(),
  firstAdmissionClass: z.enum(CLASS_KEYS).optional(),
  pen: text(20).optional(),
  aparId: text(20).optional(),
  caste: text().optional(),
  samagraId: text(20).optional(),
  aadhaar: z
    .string()
    .trim()
    .regex(/^\d{12}$/, 'Aadhaar must be 12 digits')
    .optional(),
  bankAccount: text(25).optional(),
  ifsc: text(15).optional(),
  formNo: text(30).optional(),
  isNewAdmission: z.boolean().default(false),
  isRTE: z.boolean().default(false),
  status: z.enum(['active', 'inactive']).default('active'),
  inactiveReason: z.enum(['left_with_tc', 'left_without_tc']).nullish(),
});

// Cross-field rules shared by create and update.
function checkRules(d) {
  const fields = {};
  if (d.classKey && STREAM_CLASSES.includes(d.classKey) && !d.stream)
    fields.stream = 'Stream is required for 11th and 12th';
  if (d.status === 'inactive' && !d.inactiveReason)
    fields.inactiveReason = 'Choose: left with TC or left without TC';
  if (Object.keys(fields).length)
    throw new AppError('VALIDATION_ERROR', 400, 'Some fields are invalid.', fields);
}

/**
 * Shape sent to the browser. WHY here: hiding sensitive fields only in the UI is not safe (rule 12).
 *  - Admin sees Aadhaar, bank account and IFSC in full (Admin's decision).
 *  - Principal sees only the last 4 Aadhaar digits. Cashier sees none of these.
 */
export function shapeStudent(s, role) {
  const out = {
    id: String(s._id),
    admissionNo: s.admissionNo,
    name: s.name,
    fatherName: s.fatherName ?? null,
    motherName: s.motherName ?? null,
    classKey: s.classKey,
    stream: s.stream ?? null,
    section: s.section ?? null,
    gender: s.gender ?? null,
    dateOfBirth: s.dateOfBirth ?? null,
    contactNo: s.contactNo ?? null,
    address: s.address ?? null,
    category: s.category ?? null,
    nationality: s.nationality ?? null,
    firstAdmissionDate: s.firstAdmissionDate ?? null,
    firstAdmissionClass: s.firstAdmissionClass ?? null,
    pen: s.pen ?? null,
    aparId: s.aparId ?? null,
    caste: s.caste ?? null,
    samagraId: s.samagraId ?? null,
    formNo: s.formNo ?? null,
    isNewAdmission: !!s.isNewAdmission,
    isRTE: !!s.isRTE,
    usesTransport: !!s.usesTransport,
    village: s.village ?? null,
    status: s.status,
    inactiveReason: s.inactiveReason ?? null,
  };
  if (role === 'admin') {
    out.aadhaar = s.aadhaar ?? null;
    out.bankAccount = s.bankAccount ?? null;
    out.ifsc = s.ifsc ?? null;
  } else if (role === 'principal' && s.aadhaar) {
    out.aadhaarLast4 = s.aadhaar.slice(-4);
  }
  return out;
}

/** Students: everyone signed in can read; only Admin can create or edit. */
export function studentsRouter(deps, authenticate) {
  const router = Router();
  const read = [authenticate, requireRole('admin', 'principal', 'cashier')];
  const write = [authenticate, requireRole('admin')];

  router.get('/students', ...read, async (req, res, next) => {
    try {
      const query = listQuery.parse(req.query);
      const { rows, total, counts, sections } = await deps.studentStore.list({
        tenantId: req.user.tenantId,
        ...query,
      });
      res.json({
        page: query.page,
        pageSize: query.pageSize,
        total,
        counts,
        sections,
        rows: rows.map((s) => shapeStudent(s, req.user.role)),
      });
    } catch (err) {
      next(err);
    }
  });

  // Admin only. PERMANENT delete (Admin decision), so the scholar number becomes free again.
  // One audit entry per student is written BEFORE anything is removed (critical: if the audit
  // cannot be saved, nothing is deleted). Step 4 must also refuse to delete a student who has
  // receipts, because receipts are immutable.
  router.post('/students/bulk-delete', ...write, async (req, res, next) => {
    try {
      const { ids, reason } = bulkDeleteBody.parse(req.body);
      const tenantId = req.user.tenantId;
      const found = await deps.studentStore.findManyByIds(tenantId, ids);
      if (found.length === 0) throw notFound('Students');
      for (const s of found) {
        await recordAudit(
          deps,
          req,
          {
            action: 'delete',
            entity: 'student',
            entityId: String(s._id),
            oldValue: {
              admissionNo: s.admissionNo,
              name: s.name,
              classKey: s.classKey,
              status: s.status,
            },
            reason,
          },
          { critical: true },
        );
      }
      const foundIds = found.map((s) => s._id);
      await deps.chargeStore.deleteForStudents(tenantId, foundIds);
      const deleted = await deps.studentStore.deleteMany(tenantId, foundIds);
      deps.logger.info({ requestId: req.id, deleted }, 'Students permanently deleted');
      res.json({ deleted, requested: ids.length });
    } catch (err) {
      next(err);
    }
  });

  router.get('/students/:id', ...read, async (req, res, next) => {
    try {
      const s = await deps.studentStore.findById(req.user.tenantId, req.params.id);
      if (!s) throw notFound('Student');
      res.json(shapeStudent(s, req.user.role));
    } catch (err) {
      next(err);
    }
  });

  router.post('/students', ...write, async (req, res, next) => {
    try {
      const data = studentFields.parse(req.body);
      checkRules(data);
      let created;
      try {
        created = await deps.studentStore.create(req.user.tenantId, data);
      } catch (err) {
        if (err?.code === 11000)
          throw new AppError('DUPLICATE', 409, 'This admission number already exists.', {
            admissionNo: 'Already used by another student',
          });
        throw err;
      }
      await recordAudit(deps, req, {
        action: 'create',
        entity: 'student',
        entityId: String(created._id),
        newValue: {
          admissionNo: created.admissionNo,
          name: created.name,
          classKey: created.classKey,
        },
      });
      // WHY: without posted charges the cashier cannot take any payment (pending shows 0).
      // A missing fee chart must not block admission, so the result is reported, not thrown.
      const plan = await postPlans({
        deps,
        tenantId: req.user.tenantId,
        students: [created],
        fy: getFinancialYear(new Date()),
      });
      res.status(201).json({ ...shapeStudent(created, req.user.role), feePlan: plan });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/students/:id', ...write, async (req, res, next) => {
    try {
      const data = studentFields.partial().parse(req.body);
      const before = await deps.studentStore.findById(req.user.tenantId, req.params.id);
      if (!before) throw notFound('Student');
      checkRules({ ...before, ...data });
      // Clearing "inactive" also clears the reason.
      if (data.status === 'active') data.inactiveReason = null;
      const updated = await deps.studentStore.update(req.user.tenantId, req.params.id, data);
      // Audit stores only which fields changed (no Aadhaar/bank numbers in the log).
      const changed = Object.keys(data).filter((k) => !['aadhaar', 'bankAccount'].includes(k));
      await recordAudit(deps, req, {
        action: 'update',
        entity: 'student',
        entityId: req.params.id,
        oldValue: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
        newValue: Object.fromEntries(changed.map((k) => [k, data[k] ?? null])),
      });
      res.json(shapeStudent(updated, req.user.role));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
