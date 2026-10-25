/**
 * Writes one audit entry for the current request (who, when, what, old/new value, reason).
 * `critical: true` lets the failure propagate so the business action is rolled back together with
 * its audit entry (used from Step 4 inside money transactions). For session events a failed audit
 * write is logged loudly but does not lock people out of the system.
 */
export async function recordAudit(
  deps,
  req,
  entry,
  { critical = false, session } = {},
) {
  const record = {
    tenantId: req.user?.tenantId ?? deps.tenantId,
    userId: req.user?.id ? String(req.user.id) : undefined,
    userRole: req.user?.role,
    requestId: req.id,
    ip: req.ip,
    ...entry,
  };
  try {
    await deps.auditStore.append(record, { session });
  } catch (err) {
    if (critical) throw err;
    deps.logger.error({ err, requestId: req.id }, "Audit write failed");
  }
}
