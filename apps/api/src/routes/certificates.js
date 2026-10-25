import { Router } from 'express';
import { z } from 'zod';
import {
  CLASS_KEYS,
  TC_CONDUCT,
  TC_REASONS,
  bonafideNumber,
  getFinancialYear,
  todayIst,
} from '@erp/shared';
import { requireRole } from '../middleware/requireRole.js';
import { recordAudit } from '../services/audit.js';
import {
  buildSnapshot,
  concessionText,
  defaultPromotion,
  mergeStudent,
  missingTcFields,
  pendingPaise,
  shapeBonafide,
  shapeRequest,
  shapeTc,
  studentDues,
} from '../services/certificates.js';
import { AppError, notFound } from '../utils/errors.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Bad id');
const idemKey = z
  .string({ error: 'Idempotency-Key header is required' })
  .regex(/^[\w-]{8,100}$/, 'Idempotency-Key must be 8-100 letters, digits, - or _');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-13');
const text = (min, max) => z.string().trim().min(min, 'This is required').max(max);
const listQuery = z.object({
  q: z.string().trim().max(60).optional(),
  status: z.enum(['issued', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const settingsBody = z.object({
  tcBookNo: text(1, 20),
  tcStartSl: z.number().int().min(1).max(999999),
});
// Student details the Admin may fill in while making the TC; they are saved back to the student.
const studentPatch = {
  fatherName: text(1, 80).optional(),
  motherName: text(1, 80).optional(),
  category: text(1, 10).optional(),
  dateOfBirth: day.optional(),
  nationality: text(1, 40).optional(),
  firstAdmissionDate: day.optional(),
  firstAdmissionClass: z.enum(CLASS_KEYS).optional(),
  pen: text(1, 30).optional(),
  aparId: text(1, 30).optional(),
};
const tcBody = z
  .object({
    studentId: objectId,
    bookNo: text(1, 20).optional(),
    ...studentPatch,
    lastExam: text(1, 100), // 9
    failedInSameClass: text(1, 60), // 10
    subjects: text(1, 200), // 11
    qualifiedForPromotion: text(1, 100), // 12
    workingDays: z.number().int().min(0).max(366), // 15
    daysPresent: z.number().int().min(0).max(366), // 16
    ncc: text(1, 100).default('Not applicable'), // 17
    games: text(1, 100).default('Not applicable'), // 18
    conduct: z.enum(TC_CONDUCT), // 19
    dateOfApplication: day, // 20
    dateOfIssue: day, // 21
    reason: z.enum(TC_REASONS), // 22
    reasonNote: text(1, 150).optional(),
    remarks: text(1, 200).default('None'), // 23
    duesOverrideReason: text(3, 300).optional(),
  })
  .refine((b) => b.daysPresent <= b.workingDays, {
    message: 'Days present cannot be more than working days',
    path: ['daysPresent'],
  });
const bonafideBody = z.object({
  studentId: objectId,
  purpose: text(2, 200),
  academicYear: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Use a year like 2026-27')
    .optional(),
  dateOfIssue: day.optional(),
});
const cancelBody = z.object({ reason: text(3, 300) });
const requestListQuery = listQuery.extend({
  kind: z.enum(['tc', 'bonafide']).optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});
const slText = (n) => String(n).padStart(4, '0');

const STUDENT_PATCH_KEYS = Object.keys(studentPatch);
const pickPatch = (body) =>
  Object.fromEntries(
    STUDENT_PATCH_KEYS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]),
  );
const toStudentSet = (patch) => ({
  ...patch,
  ...(patch.firstAdmissionDate
    ? { firstAdmissionDate: new Date(`${patch.firstAdmissionDate}T00:00:00.000Z`) }
    : {}),
  ...(patch.dateOfBirth ? { dateOfBirth: new Date(`${patch.dateOfBirth}T00:00:00.000Z`) } : {}),
});

/**
 * Transfer Certificates and Bonafide certificates.
 *   1. The Admin makes a REQUEST (nothing is numbered yet).
 *   2. The Principal approves or rejects it online. Only approval creates the certificate, with
 *      its gap-free number, inside one database transaction (a rejected request takes no number).
 *   3. The Admin prints it: the first print is the original, later ones are DUPLICATE copies.
 * The Cashier can only look. Every call that creates something is idempotent.
 */
export function certificatesRouter(deps, authenticate) {
  const router = Router();
  const view = [authenticate, requireRole('admin', 'principal', 'cashier')];
  const adminOnly = [authenticate, requireRole('admin')];
  const principalOnly = [authenticate, requireRole('principal')];
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };
  const store = deps.certificateStore;
  const settingsOf = async (tenantId) => ({
    tcBookNo: '1',
    tcStartSl: 1,
    ...(await store.getSettings(tenantId)),
  });
  const loadStudent = async (tenantId, id) => {
    const s = await deps.studentStore.findById(tenantId, id);
    if (!s) throw notFound('Student');
    return s;
  };

  /**
   * Checks everything a TC needs and works out what goes on it. Used when the Admin asks (so a
   * mistake is caught at once) and again when the Principal approves (dues may have changed).
   */
  const buildTcDoc = async (tenantId, requesterName, body) => {
    const student = await loadStudent(tenantId, body.studentId);
    const patch = pickPatch(body);
    const merged = mergeStudent(
      { ...student, nationality: student.nationality ?? 'Indian' },
      patch,
    );
    const missing = missingTcFields(merged);
    if (missing.length)
      throw new AppError(
        'VALIDATION',
        400,
        'Fill the missing student details first.',
        Object.fromEntries(missing.map((m) => [m.key, `${m.label} is required`])),
      );
    const fy = getFinancialYear(new Date());
    const dues = await studentDues({ deps, tenantId, student, fy, asOf: todayIst() });
    const due = pendingPaise(dues);
    if (due > 0 && !body.duesOverrideReason)
      throw new AppError(
        'DUES_PENDING',
        409,
        'Fees are still due. Clear them, or give a reason to ask for the TC anyway.',
      );
    const concession = await concessionText({ deps, tenantId, student, fy });
    const settings = await settingsOf(tenantId);
    const snapshot = buildSnapshot({ student: merged, dues, concession });
    const entered = {
      lastExam: body.lastExam,
      failedInSameClass: body.failedInSameClass,
      subjects: body.subjects,
      qualifiedForPromotion: body.qualifiedForPromotion,
      workingDays: body.workingDays,
      daysPresent: body.daysPresent,
      ncc: body.ncc,
      games: body.games,
      conduct: body.conduct,
      dateOfApplication: body.dateOfApplication,
      dateOfIssue: body.dateOfIssue,
      reason: body.reasonNote ? `${body.reason} (${body.reasonNote})` : body.reason,
      remarks: body.remarks,
    };
    const override =
      due > 0
        ? { reason: body.duesOverrideReason, byName: requesterName, duePaise: due }
        : undefined;
    return {
      student,
      patch,
      fy,
      due,
      settings,
      snapshot,
      entered,
      override,
      bookNo: body.bookNo ?? settings.tcBookNo,
    };
  };

  /** What a Bonafide will say. Only for students who are studying now. */
  const buildBonafideDoc = (student, body, fy) => {
    if (!student) throw notFound('Student');
    if (student.status !== 'active')
      throw new AppError(
        'STUDENT_INACTIVE',
        409,
        'A Bonafide certificate is only for students who are studying now.',
      );
    return {
      snapshot: {
        admissionNo: student.admissionNo,
        name: student.name,
        fatherName: student.fatherName ?? '',
        gender: student.gender ?? '',
        classKey: student.classKey,
        section: student.section ?? '',
        dob: student.dateOfBirth ? new Date(student.dateOfBirth).toISOString().slice(0, 10) : '',
      },
      academicYear: body.academicYear ?? fy,
      purpose: body.purpose,
      dateOfIssue: body.dateOfIssue ?? todayIst(),
    };
  };

  const saveRequest = async (doc) => {
    try {
      return await store.createRequest(doc);
    } catch (err) {
      if (err?.code === 'REQUEST_PENDING')
        throw new AppError(
          'REQUEST_PENDING',
          409,
          'A request for this student is already waiting for the Principal.',
        );
      throw err;
    }
  };

  // ---- settings (Book No. and the Sl. No. the year starts from)
  router.get(
    '/certificates/settings',
    ...view,
    wrap(async (req, res) => {
      const tenantId = req.user.tenantId;
      const s = await settingsOf(tenantId);
      const fy = getFinancialYear(new Date());
      res.json({
        tcBookNo: s.tcBookNo,
        tcStartSl: s.tcStartSl,
        fy,
        startLocked: (await store.countTcInFy(tenantId, fy)) > 0,
        history: (s.history ?? []).slice(-10).reverse(),
      });
    }),
  );
  router.put(
    '/certificates/settings',
    ...adminOnly,
    wrap(async (req, res) => {
      const body = settingsBody.parse(req.body);
      const tenantId = req.user.tenantId;
      const fy = getFinancialYear(new Date());
      const before = await settingsOf(tenantId);
      if (body.tcStartSl !== before.tcStartSl && (await store.countTcInFy(tenantId, fy)) > 0)
        throw new AppError(
          'SL_START_LOCKED',
          409,
          'A TC is already issued this year, so the starting Sl. No. cannot change now.',
        );
      const saved = await store.saveSettings({ tenantId, ...body, user: req.user });
      await recordAudit(deps, req, {
        action: 'update',
        entity: 'certificate_settings',
        oldValue: { tcBookNo: before.tcBookNo, tcStartSl: before.tcStartSl },
        newValue: body,
      });
      res.json({ tcBookNo: saved.tcBookNo, tcStartSl: saved.tcStartSl });
    }),
  );

  // ---- Transfer Certificate
  // What the form shows first: the auto fields, what is missing, and whether dues block it.
  router.get(
    '/tc/draft/:studentId',
    ...adminOnly,
    wrap(async (req, res) => {
      const tenantId = req.user.tenantId;
      const student = await loadStudent(tenantId, req.params.studentId);
      const fy = getFinancialYear(new Date());
      const today = todayIst();
      const existing = await store.activeTcForStudent(tenantId, student._id);
      const withDefault = { ...student, nationality: student.nationality ?? 'Indian' };
      const [dues, concession, settings] = await Promise.all([
        studentDues({ deps, tenantId, student, fy, asOf: today }),
        concessionText({ deps, tenantId, student, fy }),
        settingsOf(tenantId),
      ]);
      const snapshot = buildSnapshot({ student: withDefault, dues, concession });
      res.json({
        fy,
        today,
        existingTc: existing ? { id: String(existing._id), slNo: existing.slNo } : null,
        student: { id: String(student._id), status: student.status },
        snapshot,
        pen: student.pen ?? '',
        aparId: student.aparId ?? '',
        missing: missingTcFields(withDefault),
        pendingPaise: pendingPaise(dues),
        duesPaidUpto: snapshot.duesPaidUpto,
        bookNo: settings.tcBookNo,
        nextSl: settings.tcStartSl,
        defaults: {
          qualifiedForPromotion: defaultPromotion(student.classKey),
          ncc: 'Not applicable',
          games: 'Not applicable',
          remarks: 'None',
          dateOfIssue: today,
          dateOfApplication: today,
        },
      });
    }),
  );

  // ---- requests: the Admin asks, the Principal decides
  router.post(
    '/certificate-requests/tc',
    ...adminOnly,
    wrap(async (req, res) => {
      const key = idemKey.parse(req.get('Idempotency-Key'));
      const body = tcBody.parse(req.body);
      const tenantId = req.user.tenantId;
      const first = await store.findRequestByKey(tenantId, key);
      if (first) return res.status(200).json({ ...shapeRequest(first), replay: true });
      if (await store.activeTcForStudent(tenantId, body.studentId))
        throw new AppError('TC_EXISTS', 409, 'A Transfer Certificate is already issued.');
      if (await store.pendingRequestFor(tenantId, body.studentId, 'tc'))
        throw new AppError(
          'REQUEST_PENDING',
          409,
          'A request for this student is already waiting for the Principal.',
        );
      const b = await buildTcDoc(tenantId, req.user.name, body);
      const { request, replay } = await saveRequest({
        tenantId,
        kind: 'tc',
        studentId: body.studentId,
        fy: b.fy,
        payload: body,
        preview: {
          bookNo: b.bookNo,
          snapshot: b.snapshot,
          entered: b.entered,
          ...(b.override ? { duesOverride: b.override } : {}),
        },
        studentName: b.snapshot.name,
        admissionNo: b.snapshot.admissionNo,
        ...(b.override ? { duesOverride: b.override } : {}),
        idempotencyKey: key,
        requestedBy: String(req.user.id),
        requestedByName: req.user.name,
      });
      if (!replay)
        await recordAudit(deps, req, {
          action: 'create',
          entity: 'certificate_request',
          entityId: String(request._id),
          newValue: { kind: 'tc', admissionNo: b.snapshot.admissionNo, name: b.snapshot.name },
          ...(b.override ? { reason: b.override.reason } : {}),
        });
      res.status(replay ? 200 : 201).json({ ...shapeRequest(request), replay });
    }),
  );
  router.post(
    '/certificate-requests/bonafide',
    ...adminOnly,
    wrap(async (req, res) => {
      const key = idemKey.parse(req.get('Idempotency-Key'));
      const body = bonafideBody.parse(req.body);
      const tenantId = req.user.tenantId;
      const first = await store.findRequestByKey(tenantId, key);
      if (first) return res.status(200).json({ ...shapeRequest(first), replay: true });
      const fy = getFinancialYear(new Date());
      const student = await deps.studentStore.findById(tenantId, body.studentId);
      const preview = buildBonafideDoc(student, body, fy);
      if (await store.pendingRequestFor(tenantId, body.studentId, 'bonafide'))
        throw new AppError(
          'REQUEST_PENDING',
          409,
          'A request for this student is already waiting for the Principal.',
        );
      const { request, replay } = await saveRequest({
        tenantId,
        kind: 'bonafide',
        studentId: body.studentId,
        fy,
        payload: body,
        preview,
        studentName: student.name,
        admissionNo: student.admissionNo,
        idempotencyKey: key,
        requestedBy: String(req.user.id),
        requestedByName: req.user.name,
      });
      if (!replay)
        await recordAudit(deps, req, {
          action: 'create',
          entity: 'certificate_request',
          entityId: String(request._id),
          newValue: { kind: 'bonafide', admissionNo: student.admissionNo, name: student.name },
        });
      res.status(replay ? 200 : 201).json({ ...shapeRequest(request), replay });
    }),
  );
  router.get(
    '/certificate-requests',
    ...view,
    wrap(async (req, res) => {
      const q = requestListQuery.parse(req.query);
      const { rows, total } = await store.listRequests({ tenantId: req.user.tenantId, ...q });
      res.json({ rows: rows.map(shapeRequest), total, page: q.page, pageSize: q.pageSize });
    }),
  );
  router.get(
    '/certificate-requests/:id',
    ...view,
    wrap(async (req, res) => {
      const r = await store.getRequest(req.user.tenantId, objectId.parse(req.params.id));
      if (!r) throw notFound('Certificate request');
      res.json(shapeRequest(r));
    }),
  );

  // Approving creates the certificate and its number in ONE transaction. Approving twice (a
  // double click) returns the same certificate.
  router.post(
    '/certificate-requests/:id/approve',
    ...principalOnly,
    wrap(async (req, res) => {
      const tenantId = req.user.tenantId;
      const id = objectId.parse(req.params.id);
      const r = await store.getRequest(tenantId, id);
      if (!r) throw notFound('Certificate request');
      const shapeCert = (kind, c) => (kind === 'tc' ? shapeTc(c) : shapeBonafide(c));
      if (r.status === 'approved') {
        const c =
          r.kind === 'tc'
            ? await store.getTc(tenantId, r.certificateId)
            : await store.getBonafide(tenantId, r.certificateId);
        return res.json({ ...shapeRequest(r), certificate: c ? shapeCert(r.kind, c) : null });
      }
      if (r.status !== 'pending')
        throw new AppError('REQUEST_CLOSED', 409, 'This request was already rejected.');
      const requester = { id: r.requestedBy, name: r.requestedByName };
      const stamp = {
        requestId: String(r._id),
        approvedByName: req.user.name,
        approvedAt: new Date(),
      };
      const key = `req-${r._id}`;
      const closeRequest = async (made, number, session) => {
        const done = await store.markRequestApproved({
          tenantId,
          id,
          certificateId: made._id,
          certificateNumber: number,
          user: req.user,
          session,
        });
        if (!done) throw new AppError('REQUEST_CLOSED', 409, 'This request is no longer waiting.');
        await recordAudit(
          deps,
          req,
          {
            action: 'approve',
            entity: 'certificate_request',
            entityId: String(r._id),
            newValue: { kind: r.kind, number },
          },
          { critical: true, session },
        );
      };
      let cert;
      if (r.kind === 'tc') {
        const b = await buildTcDoc(tenantId, r.requestedByName, r.payload);
        const out = await store.issueTc({
          tenantId,
          studentId: String(r.studentId),
          fy: b.fy,
          startSl: b.settings.tcStartSl,
          idempotencyKey: key,
          user: requester,
          prepare: async (fresh, hasActiveTc) => {
            if (!fresh) throw notFound('Student');
            if (hasActiveTc)
              throw new AppError('TC_EXISTS', 409, 'A Transfer Certificate is already issued.');
            return {
              doc: {
                bookNo: b.bookNo,
                snapshot: b.snapshot,
                entered: b.entered,
                ...(b.override ? { duesOverride: b.override } : {}),
                ...stamp,
              },
              studentPatch: {
                ...toStudentSet(b.patch),
                status: 'inactive',
                inactiveReason: 'left_with_tc',
              },
            };
          },
          audit: async (made, session) => {
            await closeRequest(made, slText(made.slNo), session);
            await recordAudit(
              deps,
              req,
              {
                action: 'issue',
                entity: 'transfer_certificate',
                entityId: String(made._id),
                newValue: {
                  slNo: made.slNo,
                  fy: b.fy,
                  admissionNo: b.snapshot.admissionNo,
                  name: b.snapshot.name,
                },
              },
              { critical: true, session },
            );
            if (b.override)
              await recordAudit(
                deps,
                req,
                {
                  action: 'override',
                  entity: 'tc_dues',
                  entityId: String(made._id),
                  newValue: { duePaise: b.override.duePaise },
                  reason: b.override.reason,
                },
                { critical: true, session },
              );
          },
        });
        cert = shapeTc(out.tc);
      } else {
        const fy = getFinancialYear(new Date());
        const out = await store.issueBonafide({
          tenantId,
          studentId: String(r.studentId),
          fy,
          idempotencyKey: key,
          user: requester,
          prepare: async (s) => ({
            ...buildBonafideDoc(s, r.payload, fy),
            ...stamp,
            makeNumber: (seq) => bonafideNumber(fy, seq),
          }),
          audit: async (made, session) => {
            await closeRequest(made, made.number, session);
            await recordAudit(
              deps,
              req,
              {
                action: 'issue',
                entity: 'bonafide',
                entityId: String(made._id),
                newValue: { number: made.number, admissionNo: made.snapshot.admissionNo },
              },
              { critical: true, session },
            );
          },
        });
        cert = shapeBonafide(out.bonafide);
      }
      const now = await store.getRequest(tenantId, id);
      res.json({ ...shapeRequest(now), certificate: cert });
    }),
  );
  router.post(
    '/certificate-requests/:id/reject',
    ...principalOnly,
    wrap(async (req, res) => {
      const { reason } = cancelBody.parse(req.body);
      const tenantId = req.user.tenantId;
      const id = objectId.parse(req.params.id);
      const done = await store.rejectRequest({
        tenantId,
        id,
        reason,
        user: req.user,
        audit: (made, session) =>
          recordAudit(
            deps,
            req,
            {
              action: 'reject',
              entity: 'certificate_request',
              entityId: String(made._id),
              newValue: { kind: made.kind, admissionNo: made.admissionNo },
              reason,
            },
            { critical: true, session },
          ),
      });
      if (!done) {
        const exists = await store.getRequest(tenantId, id);
        if (!exists) throw notFound('Certificate request');
        throw new AppError('REQUEST_CLOSED', 409, 'This request is no longer waiting.');
      }
      res.json(shapeRequest(done));
    }),
  );

  router.get(
    '/tc',
    ...view,
    wrap(async (req, res) => {
      const q = listQuery.parse(req.query);
      const { rows, total } = await store.listTc({ tenantId: req.user.tenantId, ...q });
      res.json({ rows: rows.map((r) => shapeTc(r)), total, page: q.page, pageSize: q.pageSize });
    }),
  );
  router.get(
    '/tc/:id',
    ...view,
    wrap(async (req, res) => {
      const tc = await store.getTc(req.user.tenantId, objectId.parse(req.params.id));
      if (!tc) throw notFound('Transfer Certificate');
      res.json(shapeTc(tc));
    }),
  );
  // Printing. The first print is the ORIGINAL; later prints are DUPLICATE copies with a copy
  // number, and every print is audited.
  router.post(
    '/tc/:id/print',
    ...adminOnly,
    wrap(async (req, res) => {
      const out = await store.printTc(req.user.tenantId, objectId.parse(req.params.id));
      if (!out) throw notFound('Issued Transfer Certificate');
      await recordAudit(deps, req, {
        action: out.copyNo ? 'reprint' : 'update',
        entity: 'transfer_certificate',
        entityId: String(out.cert._id),
        newValue: {
          slNo: out.cert.slNo,
          printed: out.copyNo ? `duplicate ${out.copyNo}` : 'original',
        },
      });
      res.json(shapeTc(out.cert, { copyNo: out.copyNo }));
    }),
  );
  router.post(
    '/tc/:id/cancel',
    ...adminOnly,
    wrap(async (req, res) => {
      const { reason } = cancelBody.parse(req.body);
      const tc = await store.cancelTc({
        tenantId: req.user.tenantId,
        id: objectId.parse(req.params.id),
        reason,
        user: req.user,
        audit: (made, session) =>
          recordAudit(
            deps,
            req,
            {
              action: 'cancel',
              entity: 'transfer_certificate',
              entityId: String(made._id),
              newValue: { slNo: made.slNo },
              reason,
            },
            { critical: true, session },
          ),
      });
      if (!tc) throw notFound('Issued Transfer Certificate');
      res.json(shapeTc(tc));
    }),
  );

  // ---- Bonafide (made through a request, like the TC)
  router.get(
    '/bonafide',
    ...view,
    wrap(async (req, res) => {
      const q = listQuery.parse(req.query);
      const { rows, total } = await store.listBonafide({ tenantId: req.user.tenantId, ...q });
      res.json({
        rows: rows.map((r) => shapeBonafide(r)),
        total,
        page: q.page,
        pageSize: q.pageSize,
      });
    }),
  );
  router.get(
    '/bonafide/:id',
    ...view,
    wrap(async (req, res) => {
      const b = await store.getBonafide(req.user.tenantId, objectId.parse(req.params.id));
      if (!b) throw notFound('Bonafide certificate');
      res.json(shapeBonafide(b));
    }),
  );
  router.post(
    '/bonafide/:id/print',
    ...adminOnly,
    wrap(async (req, res) => {
      const out = await store.printBonafide(req.user.tenantId, objectId.parse(req.params.id));
      if (!out) throw notFound('Issued Bonafide certificate');
      await recordAudit(deps, req, {
        action: out.copyNo ? 'reprint' : 'update',
        entity: 'bonafide',
        entityId: String(out.cert._id),
        newValue: {
          number: out.cert.number,
          printed: out.copyNo ? `duplicate ${out.copyNo}` : 'original',
        },
      });
      res.json(shapeBonafide(out.cert, { copyNo: out.copyNo }));
    }),
  );

  return router;
}
