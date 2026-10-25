import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/requireRole.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { recordAudit } from "../services/audit.js";
import { AppError } from "../utils/errors.js";

const EXPORT_LIMIT = 20_000;
const BOM = String.fromCharCode(0xfeff); // lets Excel read Hindi / English text correctly
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date");
const query = z.object({
  userId: z.string().trim().max(40).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  entity: z.string().trim().max(60).optional(),
  from: date.optional(),
  to: date.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  pageSize: z.coerce.number().int().min(10).max(200).optional(),
});

/** One cell of the CSV: quoted, and made harmless if a spreadsheet would read it as a formula. */
export const csvCell = (v) => {
  let s =
    v === undefined || v === null
      ? ""
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/**
 * The audit log screen. Admin and Principal can LOOK and export; nobody can change or delete an
 * entry (there is no route for it, and the model refuses it). Exporting is itself logged.
 */
export function auditLogRouter(deps, authenticate) {
  const router = Router();
  const view = [authenticate, requireRole("admin", "principal")];
  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };
  const filtersOf = (q) => ({
    userId: q.userId,
    action: q.action,
    entity: q.entity,
    from: q.from,
    to: q.to,
    q: q.q,
  });
  const shape = (r) => ({
    id: String(r._id),
    at: r.at,
    userId: r.userId ?? null,
    userName: r.userName ?? null,
    userRole: r.userRole ?? null,
    action: r.action,
    entity: r.entity,
    entityId: r.entityId ?? null,
    oldValue: r.oldValue ?? null,
    newValue: r.newValue ?? null,
    reason: r.reason ?? null,
  });
  const checkRange = (q) => {
    if (q.from && q.to && q.from > q.to)
      throw new AppError(
        "BAD_RANGE",
        422,
        "The start date is after the end date.",
      );
  };

  router.get(
    "/audit-log/options",
    ...view,
    wrap(async (req, res) => {
      res.json({
        ...(await deps.auditStore.options(req.user.tenantId)),
        actions: AUDIT_ACTIONS,
      });
    }),
  );

  router.get(
    "/audit-log",
    ...view,
    wrap(async (req, res) => {
      const q = query.parse(req.query);
      checkRange(q);
      const page = q.page ?? 1;
      const pageSize = q.pageSize ?? 50;
      const out = await deps.auditStore.list({
        tenantId: req.user.tenantId,
        filters: filtersOf(q),
        page,
        pageSize,
      });
      res.json({ total: out.total, page, pageSize, rows: out.rows.map(shape) });
    }),
  );

  router.get(
    "/audit-log/export",
    ...view,
    wrap(async (req, res) => {
      const q = query.parse(req.query);
      checkRange(q);
      const out = await deps.auditStore.list({
        tenantId: req.user.tenantId,
        filters: filtersOf(q),
        page: 1,
        pageSize: EXPORT_LIMIT + 1,
      });
      if (out.total > EXPORT_LIMIT)
        throw new AppError(
          "TOO_MANY_ROWS",
          422,
          "Too many entries for one file. Narrow the dates.",
        );
      const head = [
        "Time (IST)",
        "User",
        "Role",
        "Action",
        "Record type",
        "Record",
        "Old value",
        "New value",
        "Reason",
      ];
      const lines = [head.map(csvCell).join(",")];
      for (const r of out.rows.map(shape))
        lines.push(
          [
            new Date(r.at).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
            }),
            r.userName ?? r.userId ?? "",
            r.userRole ?? "",
            r.action,
            r.entity,
            r.entityId ?? "",
            r.oldValue,
            r.newValue,
            r.reason ?? "",
          ]
            .map(csvCell)
            .join(","),
        );
      // The export is logged (PRD 4.12), after the data is read and before it is sent.
      await recordAudit(
        deps,
        req,
        {
          action: "export",
          entity: "audit_log",
          newValue: { ...filtersOf(q), rows: out.rows.length },
        },
        { critical: true },
      );
      res
        .set("Content-Type", "text/csv; charset=utf-8")
        .set("Content-Disposition", 'attachment; filename="audit-log.csv"')
        .send(`${BOM}${lines.join("\r\n")}\r\n`);
    }),
  );

  return router;
}
