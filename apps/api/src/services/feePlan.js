import { buildCharges } from '@erp/shared';
import { AppError } from '../utils/errors.js';

const SCHOOL_HEADS = ['tuition', 'admission', 'form'];
const TRANSPORT_HEADS = ['transport'];

/**
 * The year's charges for ONE student from the fee chart. `kinds` = which modules to post
 * ('school' = tuition + (for new admissions) admission/form, 'transport' = bus fee).
 * Throws AppError when the chart cannot price the student (so nothing is guessed).
 */
export function chargesForStudent({ student, chart, fy, kinds = ['school', 'transport'] }) {
  if (!chart) throw new AppError('NO_FEE_STRUCTURE', 409, `No fee chart exists for ${fy} yet.`);
  const row = chart.classFees.find((c) => c.classKey === student.classKey);
  if (!row) throw new AppError('NO_CLASS_FEE', 409, 'The fee chart has no fee for this class.');
  let transportMonthly = 0;
  if (kinds.includes('transport') && student.usesTransport) {
    const village = chart.villages.find((v) => v.name === student.village?.toUpperCase());
    if (!village)
      throw new AppError(
        'NO_VILLAGE_FEE',
        409,
        `Bus fee for village "${student.village}" is not in the fee chart. Add it first.`,
      );
    transportMonthly = village.monthlyPaise;
  }
  const heads = [
    ...(kinds.includes('school') ? SCHOOL_HEADS : []),
    ...(kinds.includes('transport') ? TRANSPORT_HEADS : []),
  ];
  return buildCharges({
    fy,
    classFee: {
      tuition: row.monthlyTuitionPaise,
      admission: row.admissionPaise,
      form: chart.formFeePaise,
    },
    transportMonthly,
    // WHY: admission and form fee are for new admissions only (confirmed by the school).
    chargeAdmission: !!student.isNewAdmission,
    config: chart,
  }).filter((c) => heads.includes(c.head));
}

/**
 * Posts the year's charges for many students. A student the chart cannot price (missing class
 * fee or village) is SKIPPED WITH A REASON, never guessed. Safe to repeat: charges that
 * already exist are not added twice.
 */
export async function postPlans({ deps, tenantId, students, fy, kinds }) {
  const chart = await deps.feeStore.get(tenantId, fy);
  let posted = 0;
  let charges = 0;
  const skipped = [];
  for (const student of students) {
    try {
      const list = chargesForStudent({ student, chart, fy, kinds });
      const added = await deps.chargeStore.postMany(tenantId, student._id, fy, list);
      if (added > 0) posted += 1;
      charges += added;
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      skipped.push({ admissionNo: student.admissionNo, name: student.name, reason: err.message });
    }
  }
  return { fy, students: students.length, posted, newCharges: charges, skipped };
}
