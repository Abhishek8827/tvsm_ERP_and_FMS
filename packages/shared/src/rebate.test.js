import { describe, expect, it } from "vitest";
import { buildCharges, moduleDues, planRebate } from "./index.js";

const charges = buildCharges({
  fy: "2026-27",
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

describe("planRebate", () => {
  it("takes the oldest unpaid charges first and lowers what is due", () => {
    const lines = planRebate({
      kind: "school",
      charges,
      receipts: [],
      asOf: "2026-10-01",
      amountPaise: 150000,
    });
    expect(lines.map((l) => l.amountPaise)).toEqual([100000, 50000]);
    const after = moduleDues({
      kind: "school",
      charges,
      receipts: [{ lines: [], concessionLines: lines }],
      asOf: "2026-10-01",
    });
    expect(after.totals.concession).toBe(150000);
    expect(after.totals.outstanding).toBe(
      charges.reduce((n, c) => n + c.amount, 0) - 150000,
    );
  });
  it("refuses more than what is unpaid, zero, and fractions", () => {
    const total = charges.reduce((n, c) => n + c.amount, 0);
    expect(() =>
      planRebate({
        kind: "school",
        charges,
        receipts: [],
        amountPaise: total + 1,
      }),
    ).toThrow();
    expect(() =>
      planRebate({ kind: "school", charges, receipts: [], amountPaise: 0 }),
    ).toThrow();
    expect(() =>
      planRebate({ kind: "school", charges, receipts: [], amountPaise: 10.5 }),
    ).toThrow();
  });
});

describe("planRebate: heads and order", () => {
  const mixed = [
    {
      id: "old",
      head: "old_fees",
      period: "opening",
      dueDate: "2026-04-01",
      amount: 50000,
    },
    ...charges.slice(0, 3),
    {
      id: "adm",
      head: "admission",
      period: "once",
      dueDate: "2026-06-15",
      amount: 200000,
    },
  ];
  it('"last" takes the newest month first', () => {
    const lines = planRebate({
      kind: "school",
      charges: mixed,
      receipts: [],
      asOf: "2026-10-01",
      amountPaise: 150000,
      heads: ["old_fees", "tuition"],
      order: "last",
    });
    // newest tuition month first, then the one before it
    expect(lines.map((l) => l.chargeId)).toEqual(["c2", "c1"]);
    expect(lines.map((l) => l.amountPaise)).toEqual([100000, 50000]);
  });
  it("heads keep a rebate away from other fees (admission rebate lowers only admission)", () => {
    const lines = planRebate({
      kind: "school",
      charges: mixed,
      receipts: [],
      asOf: "2026-10-01",
      amountPaise: 200000,
      heads: ["admission"],
    });
    expect(lines).toEqual([
      {
        chargeId: "adm",
        head: "admission",
        period: "once",
        amountPaise: 200000,
      },
    ]);
    expect(() =>
      planRebate({
        kind: "school",
        charges: mixed,
        receipts: [],
        amountPaise: 200001,
        heads: ["admission"],
      }),
    ).toThrow();
  });
});

describe("late fee waiver", () => {
  it("a waived month carries no late fee, others still do", () => {
    const asOf = "2026-08-30"; // June and July are past their grace days
    const mine = charges.slice(0, 3);
    const before = moduleDues({
      kind: "school",
      charges: mine,
      receipts: [],
      asOf,
    });
    const lateMonths = before.instalments
      .filter((i) => i.lateFee > 0)
      .map((i) => i.period);
    expect(lateMonths.length).toBeGreaterThanOrEqual(2);
    const waived = moduleDues({
      kind: "school",
      charges: mine,
      receipts: [
        {
          lines: [],
          concessionLines: [],
          lateFee: { periods: [lateMonths[0]] },
        },
      ],
      asOf,
    });
    const after = waived.instalments
      .filter((i) => i.lateFee > 0)
      .map((i) => i.period);
    expect(after).not.toContain(lateMonths[0]);
    expect(after).toContain(lateMonths[1]);
  });
});
