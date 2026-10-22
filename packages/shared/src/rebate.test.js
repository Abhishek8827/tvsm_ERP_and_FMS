import { describe, expect, it } from 'vitest';
import { buildCharges, moduleDues, planRebate } from './index.js';

const charges = buildCharges({
  fy: '2026-27',
  classFee: { tuition: 100000, admission: 0, form: 0 },
  transportMonthly: 0,
  chargeAdmission: false,
}).map((c, i) => ({
  id: `c${i}`,
  head: c.head,
  period: c.period,
  dueDate: c.dueDate,
  amount: c.amount,
}));

describe('planRebate', () => {
  it('takes the oldest unpaid charges first and lowers what is due', () => {
    const lines = planRebate({
      kind: 'school',
      charges,
      receipts: [],
      asOf: '2026-10-01',
      amountPaise: 150000,
    });
    expect(lines.map((l) => l.amountPaise)).toEqual([100000, 50000]);
    const after = moduleDues({
      kind: 'school',
      charges,
      receipts: [{ lines: [], concessionLines: lines }],
      asOf: '2026-10-01',
    });
    expect(after.totals.concession).toBe(150000);
    expect(after.totals.outstanding).toBe(charges.reduce((n, c) => n + c.amount, 0) - 150000);
  });
  it('refuses more than what is unpaid, zero, and fractions', () => {
    const total = charges.reduce((n, c) => n + c.amount, 0);
    expect(() =>
      planRebate({ kind: 'school', charges, receipts: [], amountPaise: total + 1 }),
    ).toThrow();
    expect(() => planRebate({ kind: 'school', charges, receipts: [], amountPaise: 0 })).toThrow();
    expect(() =>
      planRebate({ kind: 'school', charges, receipts: [], amountPaise: 10.5 }),
    ).toThrow();
  });
});
