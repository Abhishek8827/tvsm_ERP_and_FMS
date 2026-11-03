import { Router } from "express";
import { z } from "zod";
import { getFinancialYear, todayIst } from "@erp/shared";
import { requireRole } from "../middleware/requireRole.js";
import { recordAudit } from "../services/audit.js";
import { OLD_HEADS, OLD_HEAD_LABEL } from "../services/oldFees.js";
import { AppError, notFound } from "../utils/errors.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Bad id");
const fyField = z.string().regex(/^\d{4}-\d{2}$/, "Use a year like 2026-27");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const body = z.object({
  fy: fyField,
  category: z.enum(["school", "transport"]),
  // The NEW TOTAL old fee in paise (the Admin types rupees; the browser converts).
  newTotalPaise: z.number().int().min(0).max(100_000_000),
  effectiveDate: day,
  reason: z.string().trim().min(3, "Please give a reason").max(200),
});

export const shapeAdjustment = (a) => ({
  id: String(a._id),
  fy: a.fy,
  category: a.head === OLD_HEADS.transport ? "transport" : "school",
  label: OLD_HEAD_LABEL[a.head],
  previousPaise: a.previousPaise,
  newPaise: a.newPaise,
  effectiveDate: a.effectiveDate,
  reason: a.reason,
  createdByName: a.createdByName ?? null,
  createdAt: a.createdAt,
  createdCharge: !!a.createdCharge,
});

/**
 * Edit Old Fees (Admin only). The old fee is the balance brought from before this system. A
 * correction never edits the imported charge or any receipt: it is a new, audited entry, and the
 * fee engine reads the corrected total. A total below what was already paid is refused.
 */
export function oldFeeAdjustmentsRouter(deps, authenticate) {
  const router = Router();
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

  router.get(
    "/students/:id/old-fee-adjustments",
    authenticate,
    requireRole("admin", "principal", "cashier"),
    wrap(async (req, res) => {
      const { fy } = z.object({ fy: fyField.optional() }).parse(req.query);
      const tenantId = req.user.tenantId;
      const student = await deps.studentStore.findById(
        tenantId,
        objectId.parse(req.params.id),
      );
      if (!student) throw notFound("Student");
      const rows = await deps.oldFeeStore.listForStudent(
        tenantId,
        student._id,
        fy,
      );
      res.json({ adjustments: rows.map(shapeAdjustment) });
    }),
  );

  router.post(
    "/students/:id/old-fee-adjustments",
    authenticate,
    requireRole("admin"),
    wrap(async (req, res) => {
      const b = body.parse(req.body);
      const tenantId = req.user.tenantId;
      const student = await deps.studentStore.findById(
        tenantId,
        objectId.parse(req.params.id),
      );
      if (!student) throw notFound("Student");
      if (b.effectiveDate > todayIst())
        throw new AppError(
          "BAD_DATE",
          400,
          "The effective date cannot be in the future.",
          {
            effectiveDate: "In the future",
          },
        );
      if (b.fy > getFinancialYear(new Date()))
        throw new AppError(
          "BAD_SESSION",
          400,
          "That academic session has not started.",
          {
            fy: "Not started",
          },
        );
      const head = OLD_HEADS[b.category];
      const saved = await deps.oldFeeStore.create({
        tenantId,
        studentId: student._id,
        fy: b.fy,
        head,
        newPaise: b.newTotalPaise,
        effectiveDate: b.effectiveDate,
        reason: b.reason,
        student: { name: student.name, admissionNo: student.admissionNo },
        user: req.user,
        audit: (doc, session) =>
          recordAudit(
            deps,
            req,
            {
              action: "update",
              entity: "old_fee",
              entityId: String(student._id),
              reason: b.reason,
              oldValue: { head, fy: b.fy, totalPaise: doc.previousPaise },
              newValue: {
                head,
                fy: b.fy,
                totalPaise: doc.newPaise,
                effectiveDate: b.effectiveDate,
                scholarNo: student.admissionNo,
                createdCharge: doc.createdCharge,
              },
            },
            { critical: true, session },
          ),
      });
      res.status(201).json(shapeAdjustment(saved));
    }),
  );

  return router;
}
