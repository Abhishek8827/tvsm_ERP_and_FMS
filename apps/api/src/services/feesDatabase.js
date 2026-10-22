import {
  CLASS_KEYS,
  computeDues,
  creditsFromReceipts,
  lateSettledFromReceipts,
  moduleDues,
} from '@erp/shared';

const emptyTotals = () => ({
  students: 0,
  billedPaise: 0,
  paidPaise: 0,
  rebatePaise: 0,
  outstandingPaise: 0,
  dueNowPaise: 0,
  overduePaise: 0,
  lateFeePaise: 0,
});

/**
 * One row per student with the numbers from the SAME fee engine the cashier uses (so this
 * screen can never disagree with Collect Fee). Fees are worked out for the filtered students
 * only; the fee-status filter, sort and paging then run on those rows.
 */
export async function buildFeeRows({ deps, tenantId, fy, filters, asOf }) {
  const students = await deps.studentStore.forFees(tenantId, filters);
  const ids = students.map((s) => s._id);
  const chart = await deps.feeStore.get(tenantId, fy);
  const [chargeRows, receipts, rebates] = ids.length
    ? await Promise.all([
        deps.chargeStore.listForStudents(tenantId, ids, fy),
        deps.receiptStore.linesForStudents(tenantId, ids, fy),
        deps.rebateStore.activeForStudents(tenantId, ids, fy),
      ])
    : [[], [], []];

  const group = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = String(r.studentId);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };
  const chargesBy = group(chargeRows);
  const receiptsBy = group(receipts);
  const rebatesBy = group(rebates);

  return students.map((s) => {
    const key = String(s._id);
    const charges = (chargesBy.get(key) ?? []).map((c) => ({
      id: String(c._id),
      head: c.head,
      period: c.period,
      dueDate: c.dueDate,
      amount: c.amountPaise,
    }));
    const active = rebatesBy.get(key) ?? [];
    const concessionLines = active.flatMap((r) => r.lines);
    const waivedPeriods = active.flatMap((r) => r.periods ?? []);
    const mine = [
      ...(receiptsBy.get(key) ?? []),
      ...(concessionLines.length || waivedPeriods.length
        ? [{ lines: [], concessionLines, lateFee: { periods: waivedPeriods } }]
        : []),
    ];
    const config = chart ?? undefined;
    const all = computeDues({
      charges,
      credits: creditsFromReceipts(mine),
      asOf,
      config,
      lateFeesSettled: lateSettledFromReceipts(mine),
    });
    const school = moduleDues({ kind: 'school', charges, receipts: mine, asOf, config }).totals;
    const transport = moduleDues({
      kind: 'transport',
      charges,
      receipts: mine,
      asOf,
      config,
    }).totals;
    return {
      id: key,
      admissionNo: s.admissionNo,
      name: s.name,
      fatherName: s.fatherName ?? '',
      classKey: s.classKey,
      section: s.section ?? '',
      village: s.village ?? '',
      usesTransport: !!s.usesTransport,
      isNewAdmission: !!s.isNewAdmission,
      isRTE: !!s.isRTE,
      status: s.status,
      planPosted: charges.length > 0,
      billedPaise: all.totals.billed,
      paidPaise: all.totals.paid,
      rebatePaise: all.totals.concession,
      outstandingPaise: all.totals.outstanding,
      dueNowPaise: all.totals.dueNow,
      overduePaise: all.totals.overdue,
      lateFeePaise: all.totals.lateFee,
      school: { outstandingPaise: school.outstanding, dueNowPaise: school.dueNow },
      transport: { outstandingPaise: transport.outstanding, dueNowPaise: transport.dueNow },
    };
  });
}

const FEE_STATUS = {
  noplan: (r) => !r.planPosted,
  overdue: (r) => r.overduePaise > 0,
  pending: (r) => r.dueNowPaise > 0,
  clear: (r) => r.planPosted && r.dueNowPaise === 0,
};

export function filterRows(rows, { feeStatus, minDuePaise, maxDuePaise }) {
  let out = rows;
  if (feeStatus && FEE_STATUS[feeStatus]) out = out.filter(FEE_STATUS[feeStatus]);
  if (minDuePaise !== undefined) out = out.filter((r) => r.dueNowPaise >= minDuePaise);
  if (maxDuePaise !== undefined) out = out.filter((r) => r.dueNowPaise <= maxDuePaise);
  return out;
}

const SORTERS = {
  admissionNo: (a, b) => a.admissionNo.localeCompare(b.admissionNo, 'en', { numeric: true }),
  name: (a, b) => a.name.localeCompare(b.name),
  class: (a, b) =>
    CLASS_KEYS.indexOf(a.classKey) - CLASS_KEYS.indexOf(b.classKey) ||
    a.section.localeCompare(b.section) ||
    a.admissionNo.localeCompare(b.admissionNo, 'en', { numeric: true }),
  outstanding: (a, b) => a.outstandingPaise - b.outstandingPaise,
  dueNow: (a, b) => a.dueNowPaise - b.dueNowPaise,
  paid: (a, b) => a.paidPaise - b.paidPaise,
};

export function sortRows(rows, sort = 'admissionNo', dir = 'asc') {
  const cmp = SORTERS[sort] ?? SORTERS.admissionNo;
  const way = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => way * cmp(a, b) || SORTERS.admissionNo(a, b));
}

export function totalsOf(rows) {
  const t = emptyTotals();
  for (const r of rows) {
    t.students += 1;
    t.billedPaise += r.billedPaise;
    t.paidPaise += r.paidPaise;
    t.rebatePaise += r.rebatePaise;
    t.outstandingPaise += r.outstandingPaise;
    t.dueNowPaise += r.dueNowPaise;
    t.overduePaise += r.overduePaise;
    t.lateFeePaise += r.lateFeePaise;
  }
  return t;
}
