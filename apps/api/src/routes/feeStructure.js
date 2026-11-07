import { Router } from "express";
import { z } from "zod";
import { CLASS_KEYS, todayIst } from "@erp/shared";
import { requireRole } from "../middleware/requireRole.js";
import { recordAudit } from "../services/audit.js";
import { notFound } from "../utils/errors.js";

const paise = z.number().int().min(0).max(100_000_000);
const body = z.object({
  classFees: z
    .array(
      z.object({
        classKey: z.enum(CLASS_KEYS),
        monthlyTuitionPaise: paise,
        admissionPaise: paise,
      }),
    )
    .min(1),
  formFeePaise: paise,
  villages: z.array(
    z.object({ name: z.string().trim().min(1).max(50), monthlyPaise: paise }),
  ),
  dueDay: z.number().int().min(1).max(28).default(10),
  graceDays: z.number().int().min(0).max(60).default(10),
  lateFeePaise: paise.default(10000),
});
export const DUE_DAY_CONFIRM = "CHANGE DUE DATE";
const dueDayBody = z.object({
  dueDay: z.number().int().min(1).max(28),
  reason: z
    .string()
    .trim()
    .min(5, "Write the reason (at least 5 letters)")
    .max(300),
  confirm: z.literal(DUE_DAY_CONFIRM, {
    message: `Type ${DUE_DAY_CONFIRM} to confirm`,
  }),
});
const fyParam = z.string().regex(/^\d{4}-\d{2}$/, "Use a year like 2026-27");

const shape = (f) => ({
  fy: f.fy,
  classFees: f.classFees,
  formFeePaise: f.formFeePaise,
  villages: f.villages,
  dueDay: f.dueDay,
  graceDays: f.graceDays,
  lateFeePaise: f.lateFeePaise,
});

/** Fee chart: all roles can read (Cashier needs amounts); only Admin can change it. */
export function feeStructureRouter(deps, authenticate) {
  const router = Router();

  router.get(
    "/fee-structure/:fy",
    authenticate,
    requireRole("admin", "principal", "cashier"),
    async (req, res, next) => {
      try {
        const fy = fyParam.parse(req.params.fy);
        const found = await deps.feeStore.get(req.user.tenantId, fy);
        if (!found) throw notFound("Fee structure for this year");
        res.json(shape(found));
      } catch (err) {
        next(err);
      }
    },
  );

  router.put(
    "/fee-structure/:fy",
    authenticate,
    requireRole("admin"),
    async (req, res, next) => {
      try {
        const fy = fyParam.parse(req.params.fy);
        const data = body.parse(req.body);
        const before = await deps.feeStore.get(req.user.tenantId, fy);
        // The due day has its own guarded setting; saving the chart never changes it.
        if (before) data.dueDay = before.dueDay;
        const saved = await deps.feeStore.save(req.user.tenantId, fy, data);
        await recordAudit(deps, req, {
          action: before ? "update" : "create",
          entity: "fee_structure",
          entityId: fy,
          oldValue: before ? shape(before) : undefined,
          newValue: shape(saved),
        });
        res.json(shape(saved));
      } catch (err) {
        next(err);
      }
    },
  );

  router.put(
    "/fee-structure/:fy/due-day",
    authenticate,
    requireRole("admin"),
    async (req, res, next) => {
      try {
        const fy = fyParam.parse(req.params.fy);
        const input = dueDayBody.parse(req.body);
        const before = await deps.feeStore.get(req.user.tenantId, fy);
        if (!before) throw notFound("Fee structure for this year");
        const saved = await deps.feeStore.setDueDay(
          req.user.tenantId,
          fy,
          input.dueDay,
        );
        const moved = await deps.chargeStore.moveMonthlyDueDay(
          req.user.tenantId,
          fy,
          input.dueDay,
          todayIst(),
        );
        await recordAudit(deps, req, {
          action: "update",
          entity: "fee_structure",
          entityId: fy,
          reason: input.reason,
          oldValue: { dueDay: before.dueDay },
          newValue: { dueDay: saved.dueDay, chargesMoved: moved },
        });
        res.json({ ...shape(saved), chargesMoved: moved });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
