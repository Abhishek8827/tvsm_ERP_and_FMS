import { getFinancialYear } from '@erp/shared';
import { postPlans } from './feePlan.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;

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
