import { todayIst } from "@erp/shared";

/**
 * End-of-day auto-lock (owner's decision): a day nobody closed is locked by the system after
 * midnight IST. Counting the cash is optional; an uncounted day shows "Not counted" and the Admin
 * can reopen it so the Cashier can add the count later. Each locked day leaves one audit entry.
 */
export async function runDayAutoLock({
  deps,
  tenantId,
  logger,
  today = todayIst(),
}) {
  const locked = await deps.dayCloseStore.autoLockPastDays({ tenantId, today });
  for (const day of locked) {
    await deps.auditStore.append({
      tenantId,
      userRole: "system",
      action: "create",
      entity: "day_close",
      entityId: day.date,
      reason: "Locked automatically after midnight; cash not counted",
      newValue: {
        expectedCashPaise: day.expectedCashPaise,
        receiptCount: day.receiptCount,
      },
    });
  }
  if (locked.length)
    logger.info({ days: locked.map((d) => d.date) }, "Past days auto-locked");
  return locked;
}

/** Runs at start and then every hour; a failure is logged and retried, never fatal. */
export function startDayAutoLockJob({
  deps,
  tenantId,
  logger,
  everyMs = 60 * 60 * 1000,
}) {
  const run = () =>
    runDayAutoLock({ deps, tenantId, logger }).catch((err) =>
      logger.error({ err }, "Day auto-lock failed; will try again"),
    );
  void run();
  const timer = setInterval(run, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
