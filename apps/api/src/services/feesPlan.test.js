import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postAdvanceMonths, postLastMonth, postPlans } from './feePlan.js';
import { lastPlanRun, runMonthlyPlan } from './monthlyPlan.js';

const chart = {
  fy: '2026-27',
  classFees: [{ classKey: '1', monthlyTuitionPaise: 100000, admissionPaise: 0 }],
  villages: [],
  formFeePaise: 0,
};
const student = { _id: 's1', admissionNo: '1', name: 'Asha', classKey: '1' };

function fakeDeps() {
  const charges = [];
  return {
    charges,
    deps: {
      feeStore: { get: async () => chart },
      studentStore: { activeForPlan: async () => [student] },
      receiptStore: { listForStudent: async () => [] },
      chargeStore: {
        listForStudent: async () => charges.map((c, i) => ({ ...c, _id: `c${i}` })),
        postMany: async (_t, _s, _fy, list) => {
          let n = 0;
          for (const c of list)
            if (!charges.some((x) => x.period === c.period && x.head === c.head)) {
              charges.push({ ...c, amountPaise: c.amount });
              n += 1;
            }
          return n;
        },
      },
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-10T06:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('month-by-month fee posting', () => {
  it('posts June to the current month only, and never twice', async () => {
    const { deps, charges } = fakeDeps();
    const a = await postPlans({ deps, tenantId: 't', students: [student], fy: '2026-27' });
    expect(a.newCharges).toBe(3);
    const b = await postPlans({ deps, tenantId: 't', students: [student], fy: '2026-27' });
    expect(b.newCharges).toBe(0);
    expect(charges).toHaveLength(3);
  });

  it('the monthly job posts the new month on its own when a month begins', async () => {
    const { deps, charges } = fakeDeps();
    const logger = { info: () => {}, error: () => {} };
    await runMonthlyPlan({ deps, tenantId: 't', logger });
    expect(charges).toHaveLength(3);
    vi.setSystemTime(new Date('2026-09-01T00:30:00Z'));
    await runMonthlyPlan({ deps, tenantId: 't', logger, now: new Date() });
    expect(charges).toHaveLength(4);
  });

  it('a student the chart cannot price is skipped with a reason, not guessed', async () => {
    const { deps } = fakeDeps();
    const odd = { ...student, _id: 's2', admissionNo: '2', classKey: '9' };
    const r = await postPlans({ deps, tenantId: 't', students: [odd], fy: '2026-27' });
    expect(r.skipped[0].reason).toMatch(/no fee for this class/i);
  });
});

describe('advance payment posts only the months it needs', () => {
  it('paying 2 months more than posted posts exactly 2 more months', async () => {
    const { deps, charges } = fakeDeps();
    await postPlans({ deps, tenantId: 't', students: [student], fy: '2026-27' }); // Jun-Aug
    const added = await postAdvanceMonths({
      deps,
      tenantId: 't',
      student,
      fy: '2026-27',
      kind: 'school',
      wantPaise: 500000, // 3 months open (300000) + 2 more
    });
    expect(added).toBe(2);
    expect(charges).toHaveLength(5);
  });
  it('posts nothing when the amount already fits, or when there is no fee chart', async () => {
    const { deps } = fakeDeps();
    await postPlans({ deps, tenantId: 't', students: [student], fy: '2026-27' });
    expect(
      await postAdvanceMonths({
        deps,
        tenantId: 't',
        student,
        fy: '2026-27',
        kind: 'school',
        wantPaise: 300000,
      }),
    ).toBe(0);
    deps.feeStore.get = async () => null;
    expect(
      await postAdvanceMonths({
        deps,
        tenantId: 't',
        student,
        fy: '2026-27',
        kind: 'school',
        wantPaise: 900000,
      }),
    ).toBe(0);
  });
  it('never goes past the end of the year', async () => {
    const { deps, charges } = fakeDeps();
    await postAdvanceMonths({
      deps,
      tenantId: 't',
      student,
      fy: '2026-27',
      kind: 'school',
      wantPaise: 99_000_000,
    });
    expect(charges).toHaveLength(10);
  });
});

describe('last month posting and the unpriced warning', () => {
  it('postLastMonth posts only March, once', async () => {
    const { deps, charges } = fakeDeps();
    const args = { deps, tenantId: 't', student, fy: '2026-27', kind: 'school' };
    expect(await postLastMonth(args)).toBe(1);
    expect(await postLastMonth(args)).toBe(0);
    expect(charges).toHaveLength(1);
    expect(charges[0].dueDate.startsWith('2027-03')).toBe(true);
  });
  it('postLastMonth does nothing (no error) when the chart cannot price the student', async () => {
    const { deps } = fakeDeps();
    const odd = { ...student, classKey: '9th' };
    expect(
      await postLastMonth({ deps, tenantId: 't', student: odd, fy: '2026-27', kind: 'school' }),
    ).toBe(0);
  });
  it('the monthly run remembers who it could not price, grouped by reason, for the Dashboard', async () => {
    const { deps } = fakeDeps();
    deps.studentStore.activeForPlan = async () => [
      student,
      { _id: 's2', admissionNo: '2', name: 'Ravi', classKey: '9th' },
      { _id: 's3', admissionNo: '3', name: 'Meera', classKey: '9th' },
    ];
    await runMonthlyPlan({ deps, tenantId: 't', logger: { info: () => {}, error: () => {} } });
    const run = lastPlanRun();
    expect(run.problems).toHaveLength(1);
    expect(run.problems[0]).toMatchObject({
      count: 2,
      reason: 'The fee chart has no fee for this class.',
    });
    expect(run.problems[0].examples).toEqual(['2 Ravi', '3 Meera']);
  });
});
