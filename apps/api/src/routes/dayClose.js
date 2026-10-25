import { Router } from "express";
import { z } from "zod";
import { DayCloseRuleError, checkClose, todayIst } from "@erp/shared";
import { requireRole } from "../middleware/requireRole.js";
import { recordAudit } from "../services/audit.js";
import { AppError } from "../utils/errors.js";

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-22");
const closeBody = z.object({
  date: dateField.optional(),
  countedCashPaise: z.number().int().min(0).max(100_000_000_00),
  reason: z.string().trim().max(300).optional(),
});
const reopenBody = z.object({
  reason: z.string().trim().min(3, "Write the reason").max(300),
});
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const shape = (r) =>
  r && {
    date: r.date,
    status: r.status,
    expectedCashPaise: r.expectedCashPaise,
    countedCashPaise: r.countedCashPaise,
    differencePaise: r.differencePaise,
    differenceReason: r.differenceReason ?? null,
    upiPaise: r.upiPaise,
    qrPaise: r.qrPaise,
    receiptCount: r.receiptCount,
    closedByName: r.closedByName ?? null,
    closedAt: r.closedAt ?? null,
    reopenedByName: r.reopenedByName ?? null,
    reopenReason: r.reopenReason ?? null,
  };

/**
 * Day Close. The Cashier closes the school's day by counting cash; Principal and Admin can look;
 * only the Admin can reopen (reason compulsory). A closed day blocks Collect Fee (see receipts).
 */
export function dayCloseRouter(deps, authenticate) {
  const router = Router();
  const everyone = [authenticate, requireRole("admin", "principal", "cashier")];
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

  // Live figures for a day (default today) plus its close record, if any.
  router.get(
    "/day-close/summary",
    ...everyone,
    wrap(async (req, res) => {
      const date = dateField.default(todayIst()).parse(req.query.date);
      const tenantId = req.user.tenantId;
      const [totals, record] = await Promise.all([
        deps.dayCloseStore.dayTotals(tenantId, date),
        deps.dayCloseStore.get(tenantId, date),
      ]);
      res.json({ ...totals, today: todayIst(), record: shape(record) });
    }),
  );

  router.get(
    "/day-close",
    ...everyone,
    wrap(async (req, res) => {
      const { page, pageSize } = listQuery.parse(req.query);
      const { rows, total } = await deps.dayCloseStore.list({
        tenantId: req.user.tenantId,
        page,
        pageSize,
      });
      res.json({ page, pageSize, total, rows: rows.map(shape) });
    }),
  );

  router.post(
    "/day-close",
    authenticate,
    requireRole("cashier"),
    wrap(async (req, res) => {
      const body = closeBody.parse(req.body);
      const date = body.date ?? todayIst();
      if (date > todayIst())
        throw new AppError(
          "FUTURE_DATE",
          422,
          "A day that has not come cannot be closed.",
          {
            date: "Future date",
          },
        );
      const tenantId = req.user.tenantId;
      // Figures are worked out HERE from the receipts; the browser only sends what was counted.
      const totals = await deps.dayCloseStore.dayTotals(tenantId, date);
      let differencePaise;
      try {
        ({ differencePaise } = checkClose({
          expectedPaise: totals.expectedCashPaise,
          countedPaise: body.countedCashPaise,
          reason: body.reason,
        }));
      } catch (e) {
        if (e instanceof DayCloseRuleError)
          throw new AppError(
            e.code,
            422,
            e.message,
            e.field ? { [e.field]: e.message } : undefined,
          );
        throw e;
      }
      const saved = await deps.dayCloseStore.close({
        tenantId,
        date,
        user: req.user,
        figures: {
          expectedCashPaise: totals.expectedCashPaise,
          countedCashPaise: body.countedCashPaise,
          differencePaise,
          differenceReason: differencePaise !== 0 ? body.reason : undefined,
          upiPaise: totals.upiPaise,
          qrPaise: totals.qrPaise,
          receiptCount: totals.receiptCount,
        },
      });
      if (!saved)
        throw new AppError(
          "ALREADY_CLOSED",
          409,
          "This day is already closed.",
        );
      await recordAudit(
        deps,
        req,
        {
          action: "create",
          entity: "day_close",
          entityId: date,
          reason: differencePaise !== 0 ? body.reason : undefined,
          newValue: {
            expectedCashPaise: totals.expectedCashPaise,
            countedCashPaise: body.countedCashPaise,
            differencePaise,
          },
        },
        { critical: true },
      );
      res.status(201).json(shape(saved));
    }),
  );

  router.post(
    "/day-close/:date/reopen",
    authenticate,
    requireRole("admin"),
    wrap(async (req, res) => {
      const date = dateField.parse(req.params.date);
      const { reason } = reopenBody.parse(req.body);
      const saved = await deps.dayCloseStore.reopen({
        tenantId: req.user.tenantId,
        date,
        reason,
        user: req.user,
      });
      if (!saved)
        throw new AppError("NOT_FOUND", 404, "That day is not closed.");
      await recordAudit(
        deps,
        req,
        { action: "update", entity: "day_close", entityId: date, reason },
        { critical: true },
      );
      res.json(shape(saved));
    }),
  );

  return router;
}
