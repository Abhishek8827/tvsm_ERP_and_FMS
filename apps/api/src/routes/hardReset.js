import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireRole } from "../middleware/requireRole.js";
import { runWipe } from "../services/dataReset.js";
import { recordAudit } from "../services/audit.js";
import {
  BACKUP_MAX_AGE_MS,
  HARD_RESET_PHRASE,
  HARD_RESET_PLAN,
  sameKey,
  sameSecret,
  verifyPasswordWithFirebase,
} from "../services/hardReset.js";
import { AppError } from "../utils/errors.js";

const body = z.object({
  password: z.string().min(1, "Enter your password"),
  key: z.string().min(1, "Enter the reset key"),
  answer: z.string().min(1, "Answer the security question"),
  reason: z
    .string()
    .trim()
    .min(5, "Write why you are erasing everything")
    .max(300),
  phrase: z.string(),
});

/**
 * Hard reset: erases all school data from the Admin screen. Off by default (see services/hardReset.js
 * for every lock). `deps.hardReset` = { enabled, key, question, answer, webApiKey } from the
 * server's environment; tests pass their own checkers.
 */
export function hardResetRouter(deps, authenticate) {
  const router = Router();
  const admin = [authenticate, requireRole("admin")];
  const cfg = () => deps.hardReset ?? { enabled: false };
  const verifyPassword = deps.verifyPassword ?? verifyPasswordWithFirebase;
  const wipe = deps.runWipe ?? runWipe;
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };
  async function lastBackupAt(tenantId) {
    const { rows } = await deps.auditStore.list({
      tenantId,
      filters: { entity: "backup", action: "create" },
      page: 1,
      pageSize: 1,
    });
    return rows[0]?.at ? new Date(rows[0].at) : null;
  }
  const fresh = (at) => !!at && Date.now() - at.getTime() <= BACKUP_MAX_AGE_MS;

  router.get(
    "/system/hard-reset/status",
    ...admin,
    wrap(async (req, res) => {
      const c = cfg();
      if (!c.enabled) return res.json({ enabled: false });
      const at = await lastBackupAt(req.user.tenantId);
      res.json({
        enabled: true,
        question: c.question,
        phrase: HARD_RESET_PHRASE,
        backupFresh: fresh(at),
        backupMinutes: BACKUP_MAX_AGE_MS / 60000,
      });
    }),
  );

  router.post(
    "/system/hard-reset",
    rateLimit({
      windowMs: 60 * 60_000,
      limit: deps.hardResetLimit ?? 5,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
    ...admin,
    wrap(async (req, res) => {
      const c = cfg();
      if (!c.enabled)
        throw new AppError(
          "HARD_RESET_DISABLED",
          403,
          "Hard reset is switched off on this server.",
        );
      const b = body.parse(req.body);
      const tenantId = req.user.tenantId;
      const refuse = async (what) => {
        await recordAudit(deps, req, {
          action: "login_blocked",
          entity: "hard_reset",
          reason: `Hard reset refused: ${what}`,
        });
        throw new AppError(
          "RESET_REFUSED",
          403,
          `Hard reset refused: ${what}.`,
        );
      };
      if (b.phrase !== HARD_RESET_PHRASE)
        throw new AppError(
          "PHRASE_WRONG",
          422,
          `Type ${HARD_RESET_PHRASE} exactly.`,
          {
            phrase: "Not the exact phrase",
          },
        );
      if (!sameKey(b.key, c.key)) return refuse("the key is wrong");
      if (!sameSecret(b.answer, c.answer))
        return refuse("the security answer is wrong");
      if (
        !(await verifyPassword({
          email: req.user.email,
          password: b.password,
          apiKey: c.webApiKey,
        }))
      )
        return refuse("the password is wrong");
      if (!fresh(await lastBackupAt(tenantId)))
        throw new AppError(
          "BACKUP_REQUIRED",
          409,
          `Download a backup first (within the last ${BACKUP_MAX_AGE_MS / 60000} minutes).`,
        );
      // Written BEFORE the erase, so there is a record even if the erase stops half way.
      await recordAudit(
        deps,
        req,
        {
          action: "delete",
          entity: "hard_reset",
          reason: b.reason,
          newValue: { started: true },
        },
        { critical: true },
      );
      const out = await wipe(tenantId, {
        by: String(req.user.id),
        plan: HARD_RESET_PLAN,
        role: req.user.role,
        entityId: "hard-reset",
        reason: `Hard reset by ${req.user.name}: ${b.reason}`,
      });
      res.json({ removed: out.removed, reset: out.reset });
    }),
  );

  return router;
}
