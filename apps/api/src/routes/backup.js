import express, { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { requireRole } from "../middleware/requireRole.js";
import { recordAudit } from "../services/audit.js";
import {
  BackupFileError,
  RESTORE_PHRASE,
  buildBackup,
  parseBackup,
  restoreBackup,
} from "../services/backup.js";
import { AppError } from "../utils/errors.js";

export const REMINDER_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, "0");
const istStamp = (d) => {
  const t = new Date(d.getTime() + 330 * 60_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}-${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}`;
};

/**
 * Backup & Restore. Admin only. The last backup is read from the audit log (entity `backup`,
 * action `create`; the 14-day clean-up never touches it), so there is nothing else to store.
 */
export function backupRouter(deps, authenticate) {
  const router = Router();
  const admin = [authenticate, requireRole("admin")];
  const svc = deps.backupService ?? { buildBackup, parseBackup, restoreBackup };
  const limit = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

  router.get(
    "/backup/status",
    ...admin,
    wrap(async (req, res) => {
      const { rows } = await deps.auditStore.list({
        tenantId: req.user.tenantId,
        filters: { entity: "backup", action: "create" },
        page: 1,
        pageSize: 1,
      });
      const last = rows[0]?.at ? new Date(rows[0].at) : null;
      const daysSince = last
        ? Math.floor((Date.now() - last.getTime()) / DAY)
        : null;
      res.json({
        lastBackupAt: last,
        daysSince,
        reminderDays: REMINDER_DAYS,
        reminder: daysSince === null || daysSince >= REMINDER_DAYS,
      });
    }),
  );

  router.get(
    "/backup/download",
    ...admin,
    limit,
    wrap(async (req, res) => {
      const now = new Date();
      const file = await svc.buildBackup(req.user.tenantId, { now });
      await recordAudit(
        deps,
        req,
        {
          action: "create",
          entity: "backup",
          newValue: { counts: file.counts },
        },
        { critical: true },
      );
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="tvsm-erp-backup-${istStamp(now)}.json"`,
      );
      res.send(JSON.stringify(file));
    }),
  );

  router.post(
    "/backup/restore",
    ...admin,
    limit,
    express.raw({ type: "application/octet-stream", limit: "200mb" }),
    wrap(async (req, res) => {
      if (req.query.confirm !== RESTORE_PHRASE)
        throw new AppError(
          "CONFIRM_REQUIRED",
          400,
          `Type ${RESTORE_PHRASE} to confirm.`,
        );
      if (!Buffer.isBuffer(req.body) || req.body.length === 0)
        throw new AppError("NO_FILE", 400, "Choose the backup file first.");
      let outcome;
      try {
        const file = svc.parseBackup(req.body, req.user.tenantId);
        outcome = await svc.restoreBackup(file, req.user.tenantId);
      } catch (err) {
        if (err instanceof BackupFileError)
          throw new AppError("BAD_BACKUP", 422, err.message);
        throw err;
      }
      await recordAudit(
        deps,
        req,
        {
          action: "create",
          entity: "backup_restore",
          newValue: { totals: outcome.totals, unknown: outcome.unknown },
        },
        { critical: true },
      );
      res.json(outcome);
    }),
  );

  return router;
}
