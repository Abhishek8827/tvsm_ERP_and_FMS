import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/requireRole.js";
import { recordAudit } from "../services/audit.js";
import { shapeWhatsapp } from "../services/whatsappService.js";
import { AppError, notFound } from "../utils/errors.js";

const params = z.object({
  kind: z.enum(["receipt", "tc"]),
  refId: z.string().regex(/^[a-f\d]{24}$/i, "Bad id"),
});

/**
 * Who may see / retry: receipts - Cashier, Admin (Principal can look); Transfer Certificates -
 * Admin (Principal can look). The Cashier never sees certificate messages.
 */
const CAN_VIEW = {
  receipt: ["admin", "principal", "cashier"],
  tc: ["admin", "principal"],
};
const CAN_RETRY = { receipt: ["admin", "cashier"], tc: ["admin"] };

export function whatsappRouter(deps, authenticate) {
  const router = Router();
  const wa = () => deps.whatsapp;
  const guard = (table) => (req, _res, next) => {
    try {
      req.wa = params.parse(req.params);
    } catch (e) {
      return next(e);
    }
    if (!table[req.wa.kind].includes(req.user.role))
      return next(
        new AppError("FORBIDDEN", 403, "You are not allowed to do this"),
      );
    next();
  };
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

  router.get(
    "/whatsapp/status",
    authenticate,
    requireRole("admin", "principal", "cashier"),
    (_req, res) => res.json({ configured: !!wa()?.configured }),
  );

  router.get(
    "/whatsapp/:kind/:refId",
    authenticate,
    guard(CAN_VIEW),
    wrap(async (req, res) => {
      const { kind, refId } = req.wa;
      const message = wa()?.configured
        ? await wa().status(req.user.tenantId, kind, refId)
        : null;
      res.json({
        configured: !!wa()?.configured,
        message: shapeWhatsapp(message),
      });
    }),
  );

  router.post(
    "/whatsapp/:kind/:refId/retry",
    authenticate,
    guard(CAN_RETRY),
    wrap(async (req, res) => {
      const { kind, refId } = req.wa;
      if (!wa()?.configured)
        throw new AppError(
          "WHATSAPP_OFF",
          409,
          "WhatsApp is not set up for this school yet",
        );
      const out = await wa().retry(req.user.tenantId, kind, refId);
      if (out.result === "missing") throw notFound("WhatsApp message");
      if (out.result === "busy" && out.message?.status === "sent")
        throw new AppError(
          "ALREADY_SENT",
          409,
          "This message was already sent",
        );
      if (out.result === "busy")
        throw new AppError(
          "BUSY",
          409,
          "This message is being sent right now. Check again shortly.",
        );
      await recordAudit(deps, req, {
        action: "update",
        entity: "whatsapp_message",
        entityId: refId,
        newValue: { kind, retried: true, result: out.result },
      });
      res.json({ configured: true, message: shapeWhatsapp(out.message) });
    }),
  );

  return router;
}
