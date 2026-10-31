import { Router } from "express";
import { z } from "zod";
import { CLASS_KEYS, getFinancialYear, todayIst } from "@erp/shared";
import { requireRole } from "../middleware/requireRole.js";
import { buildFeeRows, totalsOf } from "../services/feesDatabase.js";
import { summarizeByClass } from "../services/feeSummary.js";
import { lastPlanRun } from "../services/monthlyPlan.js";

/** The school session runs June to March (owner, 2026-10-31): 10 months. */
export function sessionMonths(fy) {
  const start = Number(String(fy).slice(0, 4));
  return [
    ...[6, 7, 8, 9, 10, 11, 12].map(
      (m) => `${start}-${String(m).padStart(2, "0")}`,
    ),
    ...[1, 2, 3].map((m) => `${start + 1}-${String(m).padStart(2, "0")}`),
  ];
}
export const lastDayOf = (month) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
const summaryQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  status: z.enum(["active", "inactive", "all"]).default("active"),
});

/**
 * Admin / Principal overview: funds, fees, class-wise students and dues, pending approvals.
 * Every number is computed from the real records (nothing typed in). Transfer Certificates
 * are not on it because that module is not built yet - a zero would be a fake number.
 */
export function adminDashboardRouter(deps, authenticate) {
  const router = Router();
  router.get(
    "/dashboard/overview",
    authenticate,
    requireRole("admin", "principal"),
    async (req, res, next) => {
      try {
        const tenantId = req.user.tenantId;
        const fy = getFinancialYear(new Date());
        const today = todayIst();
        const [funds, pending, rows, todayReceipts, cancellations] =
          await Promise.all([
            deps.moneyStore.overview(tenantId),
            deps.moneyStore.pendingCounts(tenantId),
            buildFeeRows({
              deps,
              tenantId,
              fy,
              filters: { status: "active" },
              asOf: today,
            }),
            deps.receiptStore.list({
              tenantId,
              from: today,
              to: today,
              page: 1,
              pageSize: 1,
            }),
            deps.receiptStore.countPendingCancellations(tenantId),
          ]);
        const byClass = new Map();
        for (const r of rows) {
          const c = byClass.get(r.classKey) ?? {
            classKey: r.classKey,
            students: 0,
            dueNowPaise: 0,
          };
          c.students += 1;
          c.dueNowPaise += r.dueNowPaise;
          byClass.set(r.classKey, c);
        }
        res.json({
          fy,
          funds,
          fees: totalsOf(rows),
          noPlanStudents: rows.filter((r) => !r.planPosted).length,
          // Students the automatic monthly posting could not price (grouped by reason), or null.
          feePlan: lastPlanRun(),
          classes: CLASS_KEYS.filter((k) => byClass.has(k)).map((k) =>
            byClass.get(k),
          ),
          pending: { ...pending, cancellations },
          // The store returns groups (kind x mode); a total of only what still counts is summed here.
          today: {
            paise: todayReceipts.groups.reduce((n, g) => n + g.paise, 0),
            count: todayReceipts.groups.reduce((n, g) => n + g.count, 0),
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );
  // School fees and Bus fees by class + section, up to the end of the chosen month.
  router.get(
    "/dashboard/fee-summary",
    authenticate,
    requireRole("admin", "principal"),
    async (req, res, next) => {
      try {
        const q = summaryQuery.parse(req.query);
        const tenantId = req.user.tenantId;
        const fy = getFinancialYear(new Date());
        const months = sessionMonths(fy);
        const now = todayIst().slice(0, 7);
        const month =
          q.month ??
          (now < months[0] ? months[0] : now > months[9] ? months[9] : now);
        if (!months.includes(month))
          return res.status(400).json({
            error: {
              code: "BAD_MONTH",
              message: `Choose a month from ${months[0]} to ${months[9]}.`,
              requestId: req.id,
            },
          });
        const rows = await buildFeeRows({
          deps,
          tenantId,
          fy,
          filters: q.status === "all" ? {} : { status: q.status },
          asOf: lastDayOf(month),
        });
        res.json({
          fy,
          month,
          months,
          status: q.status,
          school: summarizeByClass(rows, "school"),
          bus: summarizeByClass(rows, "bus"),
        });
      } catch (err) {
        next(err);
      }
    },
  );
  return router;
}
