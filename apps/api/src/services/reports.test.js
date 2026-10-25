import { describe, expect, it } from "vitest";
import {
  buildBalanceSheet,
  buildDayBook,
  buildIncomeExpenditure,
  buildTrialBalance,
  expenseLines,
  incomeLines,
} from "./reports.js";

const income = {
  byHead: { tuition: 500000, old_fees: 100000, transport: 200000, transport_old: 50000, admission: 70000, form: 10000, other: 5000 },
  latePaise: 20000,
}; // prettier-ignore

describe("income lines", () => {
  it("groups heads as decided: tuition+old, transport+old, admission+form, late+other", () => {
    const l = Object.fromEntries(
      incomeLines(income).map((x) => [x.key, x.paise]),
    );
    expect(l).toEqual({
      tuition: 600000,
      transport: 250000,
      admission: 80000,
      late: 25000,
    });
  });
  it('an unknown head is not lost: it lands in "Late fees and other"', () => {
    const l = incomeLines({ byHead: { weird: 700 }, latePaise: 0 });
    expect(l.at(-1).paise).toBe(700);
  });
});

describe("expense lines", () => {
  it("adds up the same head, names a missing head, hides zero, sorts", () => {
    const l = expenseLines([
      { head: "Salaries", paise: 1000 },
      { head: "Salaries", paise: 500 },
      { head: "", paise: 300 },
      { head: "Water", paise: 0 },
      { head: "Bus", paise: 200 },
    ]);
    expect(l.map((x) => [x.label, x.paise])).toEqual([
      ["Bus", 200],
      ["Other (no head)", 300],
      ["Salaries", 1500],
    ]);
  });
});

describe("Income & Expenditure", () => {
  const r = buildIncomeExpenditure({
    from: "2026-04-01",
    to: "2026-10-13",
    income,
    expenses: [
      { head: "Salaries", paise: 700000 },
      { head: "Water", paise: 50000 },
    ],
  });
  it("totals and surplus are exact", () => {
    expect(r.totalIncomePaise).toBe(955000);
    expect(r.totalExpenditurePaise).toBe(750000);
    expect(r.surplusPaise).toBe(205000);
    expect(r.compare).toBeNull();
  });
  it("compare adds the earlier period, including a head only the earlier period had", () => {
    const c = buildIncomeExpenditure({
      from: "2026-10-01",
      to: "2026-10-31",
      income,
      expenses: [{ head: "Water", paise: 10 }],
      compare: {
        from: "2026-09-01",
        to: "2026-09-30",
        income: { byHead: { tuition: 1 }, latePaise: 0 },
        expenses: [{ head: "Repairs", paise: 99 }],
      },
    });
    expect(
      c.expenditure.map((e) => [e.label, e.paise, e.comparePaise]),
    ).toEqual([
      ["Repairs", 0, 99],
      ["Water", 10, 0],
    ]);
    expect(c.income[0].comparePaise).toBe(1);
    expect(c.compare).toMatchObject({
      totalIncomePaise: 1,
      totalExpenditurePaise: 99,
      surplusPaise: -98,
    });
  });
});

describe("Balance Sheet", () => {
  const base = {
    asOn: "2026-10-13",
    accounts: {
      cash: 300000,
      petty: 5000,
      "bank:b1": 700000,
      "online:unassigned": 2000,
    },
    banks: [{ _id: "b1", name: "HDFC" }],
    receivablePaise: 900000,
    payablePaise: 40000,
  };
  it("balances when capital + surplus equal the money held and the fixed assets", () => {
    const r = buildBalanceSheet({
      ...base,
      settings: { fixedAssetsPaise: 1000000, capitalPaise: 1500000, set: true },
      surplusToDatePaise: 507000,
    });
    expect(r.totalAssetsPaise).toBe(300000 + 5000 + 700000 + 2000 + 1000000);
    expect(r.totalFundsPaise).toBe(2007000);
    expect(r.differencePaise).toBe(0);
    expect(r.assets.map((a) => a.label)).toContain("HDFC");
  });
  it("shows a difference instead of hiding it; memo items stay out of the totals", () => {
    const r = buildBalanceSheet({
      ...base,
      settings: { fixedAssetsPaise: 0, capitalPaise: 0 },
      surplusToDatePaise: 0,
    });
    expect(r.differencePaise).toBe(1007000);
    expect(r.memo).toEqual({
      feeReceivablePaise: 900000,
      payablesPaise: 40000,
    });
    expect(r.totalAssetsPaise).toBe(1007000);
  });
});

describe("Trial Balance", () => {
  const args = {
    from: "2026-04-01",
    to: "2026-10-13",
    income: { byHead: { tuition: 800000 }, latePaise: 0 },
    expenses: [{ head: "Salaries", paise: 300000 }],
    banks: [],
    surplusBeforePaise: 100000,
  };
  it("debits equal credits when the opening balances agree", () => {
    // cash 900,000 + fixed 500,000 + expenses 300,000 = capital 800,000 + b/f 100,000 + income 800,000
    const r = buildTrialBalance({
      ...args,
      accounts: { cash: 900000 },
      settings: { fixedAssetsPaise: 500000, capitalPaise: 800000 },
    });
    expect(r.differencePaise).toBe(0);
    expect(r.totalDebitPaise).toBe(r.totalCreditPaise);
    expect(r.totalDebitPaise).toBe(1700000);
  });
  it("a mismatch becomes its own line and the two totals still agree", () => {
    const r = buildTrialBalance({
      ...args,
      accounts: { cash: 1000000 },
      settings: { fixedAssetsPaise: 500000, capitalPaise: 800000 },
    });
    expect(r.differencePaise).toBe(100000);
    expect(r.rows.at(-1).label).toBe("Difference in opening balances");
    expect(r.totalDebitPaise).toBe(r.totalCreditPaise);
  });
});

describe("Day Book", () => {
  const e = (n, at, i, o) => ({
    id: n,
    at: new Date(at),
    ref: n,
    inPaise: i,
    outPaise: o,
  });
  const entries = [
    e("b", "2026-10-02T05:00:00Z", 0, 300),
    e("a", "2026-10-01T05:00:00Z", 1000, 0),
    e("c", "2026-10-03T05:00:00Z", 50, 0),
  ];
  it("is in time order with totals over the whole range, and pages", () => {
    const p1 = buildDayBook({
      from: "x",
      to: "y",
      entries,
      page: 1,
      pageSize: 2,
    });
    expect(p1.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(p1).toMatchObject({
      total: 3,
      totalInPaise: 1050,
      totalOutPaise: 300,
    });
    expect(
      buildDayBook({
        from: "x",
        to: "y",
        entries,
        page: 2,
        pageSize: 2,
      }).rows.map((r) => r.id),
    ).toEqual(["c"]);
  });
});
