import { Router } from "express";
import { CLASS_KEYS, getFinancialYear, todayIst } from "@erp/shared";
import { requireRole } from "../middleware/requireRole.js";
import { buildFeeRows, totalsOf } from "../services/feesDatabase.js";
import { lastPlanRun } from "../services/monthlyPlan.js";

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
  return router;
}
