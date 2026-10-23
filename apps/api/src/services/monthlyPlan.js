import { getFinancialYear } from '@erp/shared';
import { postPlans } from './feePlan.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;

// What the last run could NOT price (e.g. a class with no fee in the chart). Kept in memory so
// the Dashboard can warn instead of silently leaving those students without fees.
let lastRun = null;
export function lastPlanRun() {
  if (!lastRun) return null;
  const groups = new Map();
  for (const x of lastRun.skipped) {
    const g = groups.get(x.reason) ?? { reason: x.reason, count: 0, examples: [] };
    g.count += 1;
    if (g.examples.length < 3) g.examples.push(`${x.admissionNo} ${x.name}`);
    groups.set(x.reason, g);
  }
  return { at: lastRun.at, students: lastRun.students, problems: [...groups.values()] };
}

/**
 * Posts this month's fees for every active student. Safe to run any number of times: charges
 * that already exist are skipped, so a restart or two servers cannot create doubles.
 */
export async function runMonthlyPlan({ deps, tenantId, logger, now = new Date() }) {
  const students = await deps.studentStore.activeForPlan(tenantId);
  const result = await postPlans({
    deps,
    tenantId,
    students,
    fy: getFinancialYear(now),
  });
  lastRun = { at: now.toISOString(), students: result.students, skipped: result.skipped };
  logger.info(
    {
      fy: result.fy,
      students: result.students,
      studentsWithNewCharges: result.posted,
      newCharges: result.newCharges,
      skipped: result.skipped.length,
    },
    'Monthly fee posting finished',
  );
  return result;
}

/**
 * Runs the posting now and then every 6 hours, so on the 1st of each month (IST) the new month
 * is posted automatically without anyone pressing a button. A failure is logged and tried again
 * at the next run; it never stops the server.
 */
export function startMonthlyPlanJob({ deps, tenantId, logger, everyMs = SIX_HOURS }) {
  const run = () =>
    runMonthlyPlan({ deps, tenantId, logger }).catch((err) =>
      logger.error({ err }, 'Monthly fee posting failed; will try again'),
    );
  void run();
  const timer = setInterval(run, everyMs);
  timer.unref?.(); // never keeps the process alive by itself
  return () => clearInterval(timer);
}
