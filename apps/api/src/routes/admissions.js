import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  ADMISSION_STATUSES,
  ADMISSION_STATUS_LABEL,
  CLASS_KEYS,
  FORM_FEE_PAISE,
  ReceiptRuleError,
  STREAMS,
  admissionDues,
  getFinancialYear,
  isSession,
  planAdmissionReceipt,
  todayIst,
} from "@erp/shared";
import { requireRole } from "../middleware/requireRole.js";
import { recordAudit } from "../services/audit.js";
import { AppError, notFound } from "../utils/errors.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-01");
const session = z.string().refine(isSession, "Use a session like 2026-27");
const text = (max) => z.string().trim().max(max);
const idemKey = z
  .string({ error: "Idempotency-Key header is required" })
  .regex(
    /^[\w-]{8,100}$/,
    "Idempotency-Key must be 8-100 letters, digits, - or _",
  );
const paise = z.number().int().min(0).max(100_000_000);

const details = {
  name: text(100).min(2, "Enter the child’s name"),
  fatherName: text(100).optional(),
  motherName: text(100).optional(),
  classKey: z.enum(CLASS_KEYS, { error: "Choose the class" }),
  stream: z.enum(STREAMS).nullable().optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  dateOfBirth: dateField.optional(),
  contactNo: text(20).optional(),
  address: text(300).optional(),
  category: text(20).optional(),
  nationality: text(40).optional(),
  caste: text(40).optional(),
  samagraId: text(30).optional(),
  pen: text(30).optional(),
  aparId: text(30).optional(),
  aadhaar: text(20).optional(),
  formSubmittedOn: dateField.optional(),
  collectedBy: text(60).optional(),
};
const createBody = z.object(details);
const editBody = z.object(
  Object.fromEntries(
    Object.entries(details).map(([k, v]) => [k, v.optional()]),
  ),
);
const statusBody = z.object({
  status: z.enum(["pending", "cancelled"]),
  reason: text(300).optional(),
});
const admitBody = z.object({ scholarNo: z.union([z.string(), z.number()]) });
const payBody = z.object({
  input: z.object({
    formPaise: paise.optional(),
    admissionPaise: paise.optional(),
  }),
  mode: z.enum(["cash", "upi"]),
  reference: text(60).optional(),
  bankId: objectId.optional(),
});
const listQuery = z.object({
  session: z.string().optional(), // a session, or "all"
  status: z.enum(ADMISSION_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const iso = (d) => (d ? new Date(d).toISOString() : null);
const shapeReceipt = (r) => ({
  id: String(r._id),
  number: r.number,
  issuedAt: iso(r.issuedAt),
  mode: r.mode,
  totalPaise: r.totalPaise,
  lines: r.lines.map((l) => ({ head: l.head, amountPaise: l.amountPaise })),
});
/** The form as the screens see it, with where its two fees stand. */
export function shapeAdmission(
  a,
  receipts = [],
  { withReceipts = false } = {},
) {
  const dues = admissionDues({
    formFeePaise: a.formFeePaise,
    admissionFeePaise: a.admissionFeePaise,
    receipts,
  });
  return {
    id: String(a._id),
    session: a.session,
    formNo: a.formNo,
    status: a.status,
    statusLabel: ADMISSION_STATUS_LABEL[a.status],
    name: a.name,
    fatherName: a.fatherName ?? null,
    motherName: a.motherName ?? null,
    classKey: a.classKey,
    stream: a.stream ?? null,
    gender: a.gender ?? null,
    dateOfBirth: a.dateOfBirth
      ? new Date(a.dateOfBirth).toISOString().slice(0, 10)
      : null,
    contactNo: a.contactNo ?? null,
    address: a.address ?? null,
    category: a.category ?? null,
    nationality: a.nationality ?? null,
    caste: a.caste ?? null,
    samagraId: a.samagraId ?? null,
    pen: a.pen ?? null,
    aparId: a.aparId ?? null,
    aadhaarLast4: a.aadhaar ? String(a.aadhaar).slice(-4) : null,
    formSubmittedOn: a.formSubmittedOn,
    collectedBy: a.collectedBy ?? null,
    formFeePaise: a.formFeePaise,
    admissionFeePaise: a.admissionFeePaise,
    dues,
    createdByName: a.createdByName ?? null,
    createdAt: iso(a.createdAt),
    cancelReason: a.cancelReason ?? null,
    studentId: a.studentId ? String(a.studentId) : null,
    scholarNo: a.scholarNo ?? null,
    admittedAt: iso(a.admittedAt),
    admittedByName: a.admittedByName ?? null,
    ...(withReceipts ? { receipts: receipts.map(shapeReceipt) } : {}),
  };
}

/**
 * New Admissions. Admin and Cashier both enter forms and collect the form / admission fee; only
 * the Admin edits details, sets the status, admits and chooses the session. The Principal can look.
 * Fee payments are real receipts (own A-FY series) so they reach Day Close, Cashbook and Reports.
 */
export function admissionsRouter(deps, authenticate) {
  const router = Router();
  const look = [authenticate, requireRole("admin", "principal", "cashier")];
  const enter = [authenticate, requireRole("admin", "cashier")];
  const adminOnly = [authenticate, requireRole("admin")];
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };
  const currentSession = async (tenantId) =>
    (await deps.admissionStore.getSettings(tenantId))?.session ??
    getFinancialYear(new Date());
  const load = async (tenantId, id) => {
    const a = await deps.admissionStore.findById(tenantId, objectId.parse(id));
    if (!a) throw notFound("Admission form");
    return a;
  };
  const receiptsOf = (tenantId, id) =>
    deps.admissionStore.receiptsFor(tenantId, [id]);
  /** The admission fee of this class from the Fee Structure of the session. */
  async function admissionFeeFor(tenantId, sessionKey, classKey) {
    const chart = await deps.feeStore.get(tenantId, sessionKey);
    if (!chart)
      throw new AppError(
        "NO_FEE_STRUCTURE",
        422,
        `Set the Fee Structure for ${sessionKey} first; the admission fee comes from it.`,
      );
    const row = chart.classFees?.find((c) => c.classKey === classKey);
    if (!row)
      throw new AppError(
        "NO_CLASS_FEE",
        422,
        "The Fee Structure has no admission fee for this class.",
        { classKey: "No fee set for this class" },
      );
    return row.admissionPaise;
  }

  router.get(
    "/admissions/settings",
    ...look,
    wrap(async (req, res) => {
      res.json({
        session: await currentSession(req.user.tenantId),
        formFeePaise: FORM_FEE_PAISE,
      });
    }),
  );
  router.put(
    "/admissions/settings",
    ...adminOnly,
    wrap(async (req, res) => {
      const { session: next } = z.object({ session }).parse(req.body);
      const before = await currentSession(req.user.tenantId);
      await deps.admissionStore.saveSettings(req.user.tenantId, next, req.user);
      await recordAudit(
        deps,
        req,
        {
          action: "update",
          entity: "admission_settings",
          oldValue: { session: before },
          newValue: { session: next },
        },
        { critical: true },
      );
      res.json({ session: next, formFeePaise: FORM_FEE_PAISE });
    }),
  );

  router.get(
    "/admissions/next-scholar-no",
    ...adminOnly,
    wrap(async (req, res) => {
      res.json({
        scholarNo: String(
          await deps.admissionStore.nextScholarNo(req.user.tenantId),
        ),
      });
    }),
  );

  // Same name + father or date of birth already in Students / New Admissions. A WARNING only.
  router.get(
    "/admissions/similar",
    ...enter,
    wrap(async (req, res) => {
      const q = z
        .object({
          name: text(100).min(2),
          fatherName: text(100).optional(),
          dateOfBirth: dateField.optional(),
        })
        .parse(req.query);
      const found = await deps.admissionStore.findSimilar(req.user.tenantId, q);
      res.json({
        students: found.students.map((s) => ({
          id: String(s._id),
          admissionNo: s.admissionNo,
          name: s.name,
          fatherName: s.fatherName ?? null,
          classKey: s.classKey,
          status: s.status,
        })),
        admissions: found.admissions.map((a) => ({
          id: String(a._id),
          formNo: a.formNo,
          name: a.name,
          fatherName: a.fatherName ?? null,
          classKey: a.classKey,
          status: a.status,
        })),
      });
    }),
  );

  router.get(
    "/admissions",
    ...look,
    wrap(async (req, res) => {
      const q = listQuery.parse(req.query);
      const tenantId = req.user.tenantId;
      const sessionKey =
        q.session === "all"
          ? undefined
          : (q.session ?? (await currentSession(tenantId)));
      const { rows, total } = await deps.admissionStore.list({
        tenantId,
        ...q,
        session: sessionKey,
      });
      const receipts = await deps.admissionStore.receiptsFor(
        tenantId,
        rows.map((r) => r._id),
      );
      const by = new Map();
      for (const r of receipts) {
        const k = String(r.studentId);
        by.set(k, [...(by.get(k) ?? []), r]);
      }
      res.json({
        page: q.page,
        pageSize: q.pageSize,
        total,
        session: sessionKey ?? "all",
        rows: rows.map((a) => shapeAdmission(a, by.get(String(a._id)) ?? [])),
      });
    }),
  );

  router.get(
    "/admissions/:id",
    ...look,
    wrap(async (req, res) => {
      const a = await load(req.user.tenantId, req.params.id);
      res.json(
        shapeAdmission(a, await receiptsOf(req.user.tenantId, a._id), {
          withReceipts: true,
        }),
      );
    }),
  );

  router.post(
    "/admissions",
    rateLimit({
      windowMs: 60_000,
      limit: 60,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
    ...enter,
    wrap(async (req, res) => {
      const key = idemKey.parse(req.get("Idempotency-Key"));
      const body = createBody.parse(req.body);
      const tenantId = req.user.tenantId;
      const sessionKey = await currentSession(tenantId);
      const admissionFeePaise = await admissionFeeFor(
        tenantId,
        sessionKey,
        body.classKey,
      );
      const { admission, replay } = await deps.admissionStore.create({
        tenantId,
        session: sessionKey,
        idempotencyKey: key,
        user: req.user,
        data: {
          ...body,
          dateOfBirth: body.dateOfBirth
            ? new Date(`${body.dateOfBirth}T00:00:00.000Z`)
            : undefined,
          formSubmittedOn: body.formSubmittedOn ?? todayIst(),
          collectedBy: body.collectedBy || req.user.name,
          formFeePaise: FORM_FEE_PAISE,
          admissionFeePaise,
        },
      });
      if (!replay)
        await recordAudit(deps, req, {
          action: "create",
          entity: "admission_form",
          entityId: String(admission._id),
          newValue: {
            formNo: admission.formNo,
            name: admission.name,
            classKey: admission.classKey,
          },
        });
      res.status(replay ? 200 : 201).json(shapeAdmission(admission, []));
    }),
  );

  router.patch(
    "/admissions/:id",
    ...adminOnly,
    wrap(async (req, res) => {
      const tenantId = req.user.tenantId;
      const before = await load(tenantId, req.params.id);
      if (before.status === "admitted")
        throw new AppError(
          "ALREADY_ADMITTED",
          409,
          "This child is already a student. Edit the details in Students.",
        );
      const body = editBody.parse(req.body);
      const data = {
        ...body,
        ...(body.dateOfBirth
          ? { dateOfBirth: new Date(`${body.dateOfBirth}T00:00:00.000Z`) }
          : {}),
      };
      if (body.classKey && body.classKey !== before.classKey) {
        const live = await receiptsOf(tenantId, before._id);
        if (
          admissionDues({ ...before, receipts: live }).admission.paidPaise > 0
        )
          throw new AppError(
            "CLASS_LOCKED",
            409,
            "Admission fee is already collected, so the class cannot be changed. Cancel that receipt first.",
            { classKey: "Locked after payment" },
          );
        data.admissionFeePaise = await admissionFeeFor(
          tenantId,
          before.session,
          body.classKey,
        );
      }
      const saved = await deps.admissionStore.update(
        tenantId,
        before._id,
        data,
      );
      if (!saved)
        throw new AppError(
          "ALREADY_ADMITTED",
          409,
          "This child is already a student.",
        );
      await recordAudit(deps, req, {
        action: "update",
        entity: "admission_form",
        entityId: String(saved._id),
        oldValue: { name: before.name, classKey: before.classKey },
        newValue: { name: saved.name, classKey: saved.classKey },
      });
      res.json(
        shapeAdmission(saved, await receiptsOf(tenantId, saved._id), {
          withReceipts: true,
        }),
      );
    }),
  );

  router.post(
    "/admissions/:id/status",
    ...adminOnly,
    wrap(async (req, res) => {
      const tenantId = req.user.tenantId;
      const body = statusBody.parse(req.body);
      const a = await load(tenantId, req.params.id);
      if (a.status === "admitted")
        throw new AppError(
          "ALREADY_ADMITTED",
          409,
          "An admitted child cannot be moved back.",
        );
      if (a.status === body.status)
        return res.json(shapeAdmission(a, await receiptsOf(tenantId, a._id)));
      const saved = await deps.admissionStore.setStatus({
        tenantId,
        id: a._id,
        from: a.status,
        to: body.status,
        reason: body.reason,
        user: req.user,
      });
      if (!saved)
        throw new AppError(
          "STATUS_CHANGED",
          409,
          "The status was changed by someone else. Reload.",
        );
      await recordAudit(
        deps,
        req,
        {
          action: body.status === "cancelled" ? "cancel" : "update",
          entity: "admission_form",
          entityId: String(a._id),
          oldValue: { status: a.status },
          newValue: { status: body.status },
          reason: body.reason,
        },
        { critical: true },
      );
      res.json(shapeAdmission(saved, await receiptsOf(tenantId, saved._id)));
    }),
  );

  router.post(
    "/admissions/:id/admit",
    rateLimit({
      windowMs: 60_000,
      limit: 30,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
    ...adminOnly,
    wrap(async (req, res) => {
      const tenantId = req.user.tenantId;
      const { scholarNo } = admitBody.parse(req.body);
      if (!/^[0-9]{1,15}$/.test(String(scholarNo)))
        throw new AppError(
          "BAD_SCHOLAR_NO",
          422,
          "The scholar number must be digits only.",
          {
            scholarNo: "Digits only",
          },
        );
      const a = await load(tenantId, req.params.id);
      const out = await deps.admissionStore.admit({
        tenantId,
        id: a._id,
        scholarNo,
        user: req.user,
      });
      if (!out.replay)
        await recordAudit(deps, req, {
          action: "create",
          entity: "student",
          entityId: String(out.studentId),
          newValue: {
            scholarNo: String(scholarNo),
            formNo: a.formNo,
            name: a.name,
          },
          reason: "Admitted from New Admissions",
        });
      res.status(out.replay ? 200 : 201).json({
        ...shapeAdmission(out.admission, await receiptsOf(tenantId, a._id)),
        replay: out.replay,
      });
    }),
  );

  router.post(
    "/admissions/:id/receipts",
    rateLimit({
      windowMs: 60_000,
      limit: 60,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
    ...enter,
    wrap(async (req, res) => {
      const key = idemKey.parse(req.get("Idempotency-Key"));
      const body = payBody.parse(req.body);
      const tenantId = req.user.tenantId;
      if (body.mode === "upi" && (body.reference ?? "").length < 4)
        throw new AppError(
          "REFERENCE_REQUIRED",
          422,
          "Enter the UPI / QR reference number.",
          {
            reference: "Reference number is required",
          },
        );
      let bank = null;
      if (body.mode === "upi") {
        bank = body.bankId
          ? await deps.moneyStore.findActiveBank(tenantId, body.bankId)
          : null;
        if (!bank)
          throw new AppError(
            "BANK_REQUIRED",
            422,
            "Choose the bank account that received the money.",
            {
              bankId: "Choose the bank account",
            },
          );
      }
      const a = await load(tenantId, req.params.id);
      if (a.status === "cancelled")
        throw new AppError(
          "ADMISSION_CANCELLED",
          409,
          "This admission is cancelled; no fee can be collected.",
        );
      if (await deps.dayCloseStore.isClosed(tenantId, todayIst()))
        throw new AppError(
          "DAY_CLOSED",
          409,
          "Today's Day Close is done, so fees cannot be collected. Ask the Admin to reopen the day.",
        );
      const { receipt, replay } = await deps.receiptStore.issue({
        tenantId,
        studentId: a._id,
        fy: getFinancialYear(new Date()),
        kind: "admission",
        allYears: true,
        idempotencyKey: key,
        build: async (prior) => {
          const dues = admissionDues({
            formFeePaise: a.formFeePaise,
            admissionFeePaise: a.admissionFeePaise,
            receipts: prior,
          });
          let plan;
          try {
            plan = planAdmissionReceipt({ dues, input: body.input });
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
            totalPaise: plan.totalPaise,
            monthLabel: "",
            dueAfterPaise: plan.dueAfterPaise,
            mode: body.mode,
            reference: body.mode === "cash" ? undefined : body.reference,
            bankId: bank ? String(bank._id) : undefined,
            bankName: bank?.name,
            cashierId: String(req.user.id),
            cashierName: req.user.name,
            student: {
              admissionNo: a.formNo, // the form number stands in until a scholar number exists
              name: a.name,
              fatherName: a.fatherName,
              classKey: a.classKey,
              address: a.address,
              contactNo: a.contactNo,
            },
          };
        },
        audit: (saved, s) =>
          recordAudit(
            deps,
            req,
            {
              action: "create",
              entity: "receipt",
              entityId: String(saved._id),
              newValue: {
                number: saved.number,
                kind: saved.kind,
                totalPaise: saved.totalPaise,
                mode: saved.mode,
                admissionId: String(a._id),
              },
            },
            { critical: true, session: s },
          ),
      });
      res.status(replay ? 200 : 201).json({
        receipt: shapeReceipt(receipt),
        replay,
        admission: shapeAdmission(a, await receiptsOf(tenantId, a._id), {
          withReceipts: true,
        }),
      });
    }),
  );

  return router;
}
