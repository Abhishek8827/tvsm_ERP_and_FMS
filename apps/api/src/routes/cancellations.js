import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/requireRole.js";
import { recordAudit } from "../services/audit.js";
import { AppError } from "../utils/errors.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Bad id");
const listQuery = z.object({
  status: z.enum(["requested", "cancelled", "rejected"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const rejectBody = z.object({
  reason: z.string().trim().min(3, "Write the reason").max(300),
});

const shape = (c) => ({
  id: String(c._id),
  status: c.status,
  reason: c.reason,
  requestedByName: c.requestedByName ?? null,
  requestedAt: c.requestedAt ?? c.createdAt,
  decidedByName: c.decidedByName ?? null,
  decidedAt: c.decidedAt ?? null,
  decisionNote: c.decisionNote ?? null,
  receipt: c.receipt && {
    id: String(c.receipt._id),
    number: c.receipt.number,
    kind: c.receipt.kind,
    mode: c.receipt.mode,
    totalPaise: c.receipt.totalPaise,
    issuedAt: c.receipt.issuedAt,
    studentName: c.receipt.student?.name ?? null,
    admissionNo: c.receipt.student?.admissionNo ?? null,
  },
  receiptNumber: c.receiptNumber,
});

/**
 * Receipt cancellation approvals. The Cashier asks (receipts.js); the PRINCIPAL is the only one
 * who approves or rejects here. (The Admin can still cancel directly from the receipt.)
 * Approving stops the receipt's payments from counting; the receipt itself is never edited.
 */
export function cancellationsRouter(deps, authenticate) {
  const router = Router();
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

  router.get(
    "/receipt-cancellations",
    authenticate,
    requireRole("admin", "principal"),
    wrap(async (req, res) => {
      const f = listQuery.parse(req.query);
      const out = await deps.receiptStore.listCancellations({
        tenantId: req.user.tenantId,
        ...f,
      });
      res.json({
        page: f.page,
        pageSize: f.pageSize,
        total: out.total,
        rows: out.rows.map(shape),
      });
    }),
  );

  const decide = (decision) =>
    wrap(async (req, res) => {
      const id = objectId.parse(req.params.id);
      const note =
        decision === "reject" ? rejectBody.parse(req.body).reason : undefined;
      const saved = await deps.receiptStore.decideCancellation({
        tenantId: req.user.tenantId,
        id,
        decision,
        note,
        user: req.user,
        audit: (c, session) =>
          recordAudit(
            deps,
            req,
            {
              action: decision === "approve" ? "cancel" : "update",
              entity: "receipt_cancellation",
              entityId: String(c._id),
              reason: note,
              newValue: { receipt: c.receiptNumber, status: c.status },
            },
            { critical: true, session },
          ),
      });
      if (!saved)
        throw new AppError(
          "NOT_FOUND",
          404,
          "This request is not waiting for a decision.",
        );
      res.json(shape(saved));
    });

  router.post(
    "/receipt-cancellations/:id/approve",
    authenticate,
    requireRole("principal"),
    decide("approve"),
  );
  router.post(
    "/receipt-cancellations/:id/reject",
    authenticate,
    requireRole("principal"),
    decide("reject"),
  );
  return router;
}
