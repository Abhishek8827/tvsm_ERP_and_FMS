import { AuditLog } from "../models/AuditLog.js";

/**
 * Audit housekeeping (owner's decision, 2026-10-29): sign-in / sign-out / idle-logout / export
 * entries older than 14 days are removed. EVERYTHING else (money, approvals, certificates,
 * deletes, user and setting changes, blocked logins) is kept for good.
 * The audit model blocks deletes on purpose, so this goes to the raw collection, and it can only
 * ever touch the four routine actions below. Each clean-up leaves one summary entry behind.
 */
export const ROUTINE_ACTIONS = ["login", "logout", "idle_logout", "export"];
export const RETENTION_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

export const cutoffFor = (now = new Date()) =>
  new Date(now.getTime() - RETENTION_DAYS * DAY);

export async function pruneRoutineAudit({
  tenantId,
  now = new Date(),
  collection = AuditLog.collection,
  append = (entry) => AuditLog.create([entry]),
}) {
  const cutoff = cutoffFor(now);
  const res = await collection.deleteMany({
    tenantId,
    action: { $in: ROUTINE_ACTIONS },
    at: { $lt: cutoff },
  });
  const removed = res.deletedCount ?? 0;
  if (removed > 0) {
    await append({
      tenantId,
      userRole: "system",
      action: "delete",
      entity: "audit_housekeeping",
      newValue: {
        removed,
        actions: ROUTINE_ACTIONS,
        olderThan: cutoff.toISOString(),
      },
      reason: `Routine sign-in/out entries older than ${RETENTION_DAYS} days removed`,
    });
  }
  return { removed, cutoff };
}

/** Runs once at start and then daily. A failure is logged and retried; it never stops the server. */
export function startAuditRetentionJob({ tenantId, logger, everyMs = DAY }) {
  const run = () =>
    pruneRoutineAudit({ tenantId })
      .then(
        (r) =>
          r.removed &&
          logger.info({ removed: r.removed }, "Old routine audit removed"),
      )
      .catch((err) =>
        logger.error({ err }, "Audit housekeeping failed; will try again"),
      );
  void run();
  const timer = setInterval(run, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
