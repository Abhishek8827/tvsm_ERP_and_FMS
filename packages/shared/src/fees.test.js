import { describe, expect, it } from "vitest";
import { normalizeClass } from "./classes.js";
import { addDaysToDateString } from "./financialYear.js";
import { buildCharges, computeDues, instalmentSchedule } from "./fees.js";

const classFee4 = { tuition: 120_000, admission: 200_000, form: 10_000 }; // class 4th: 1200, 2000, 100

describe("instalment schedule", () => {
  it("has 10 months, June to March, due on the 10th, and Jan-Mar fall in the next year", () => {
    const s = instalmentSchedule("2026-27");
    expect(s).toHaveLength(10);
    expect(s[0]).toEqual({ period: "2026-06", dueDate: "2026-06-10" });
    expect(s[6]).toEqual({ period: "2026-12", dueDate: "2026-12-10" });
    expect(s[7]).toEqual({ period: "2027-01", dueDate: "2027-01-10" });
    expect(s[9]).toEqual({ period: "2027-03", dueDate: "2027-03-10" });
  });
});

describe("buildCharges", () => {
  it("yearly tuition is monthly x 10 as on the school chart", () => {
    const charges = buildCharges({ fy: "2026-27", classFee: classFee4 });
    const tuition = charges.filter((c) => c.head === "tuition");
    expect(tuition).toHaveLength(10);
    expect(tuition.reduce((s, c) => s + c.amount, 0)).toBe(1_200_000); // Rs 12,000
    expect(charges.some((c) => c.head === "transport")).toBe(false); // optional: only if chosen
    expect(charges.some((c) => c.head === "admission")).toBe(false);
  });
  it("adds transport only with a village amount, and admission + form exactly once", () => {
    const charges = buildCharges({
      fy: "2026-27",
      classFee: classFee4,
      transportMonthly: 100_000,
      chargeAdmission: true,
    });
    expect(charges.filter((c) => c.head === "transport")).toHaveLength(10);
    expect(charges.filter((c) => c.head === "admission")).toHaveLength(1);
    expect(charges.filter((c) => c.head === "form")).toHaveLength(1);
    expect(charges.find((c) => c.head === "admission").dueDate).toBe(
      "2026-06-10",
    );
  });
  it("rejects non-integer money", () => {
    expect(() =>
      buildCharges({ fy: "2026-27", classFee: { tuition: 100.5 } }),
    ).toThrow();
  });
});

function ledger(extra = {}) {
  const charges = buildCharges({
    fy: "2026-27",
    classFee: classFee4,
    transportMonthly: 50_000,
  }).map((c, i) => ({ ...c, id: `c${i}` }));
  return { charges, ...extra };
}

describe("computeDues", () => {
  it("before any due date nothing is due now but everything is outstanding", () => {
    const r = computeDues({ ...ledger(), asOf: "2026-06-01" });
    expect(r.totals.dueNow).toBe(0);
    expect(r.totals.outstanding).toBe(10 * (120_000 + 50_000));
    expect(r.totals.lateFee).toBe(0);
  });
  it("on the due date it is due now but not yet overdue, and has no late fee (10 day grace)", () => {
    const r = computeDues({ ...ledger(), asOf: "2026-06-10" });
    expect(r.totals.dueNow).toBe(170_000);
    expect(r.totals.overdue).toBe(0);
    expect(r.totals.lateFee).toBe(0);
    expect(
      computeDues({ ...ledger(), asOf: "2026-06-20" }).totals.lateFee,
    ).toBe(0); // last grace day
  });
  it("from the 21st, one flat Rs 100 late fee for the month, not per head", () => {
    const r = computeDues({ ...ledger(), asOf: "2026-06-21" });
    expect(r.totals.overdue).toBe(170_000);
    expect(r.totals.lateFee).toBe(10_000); // tuition + transport are both late, still Rs 100 once
  });
  it("late fee is once per overdue month: three months overdue = Rs 300", () => {
    const r = computeDues({ ...ledger(), asOf: "2026-08-30" }); // Jun, Jul, Aug all past grace
    expect(r.totals.lateFee).toBe(30_000);
    expect(r.instalments.filter((i) => i.lateFee > 0)).toHaveLength(3);
  });
  it("a fully paid month has no late fee and a partly paid month keeps it", () => {
    const l = ledger();
    const june = l.charges.filter((c) => c.period === "2026-06");
    const paidAll = june.map((c) => ({
      appliesTo: c.id,
      kind: "payment",
      amount: c.amount,
    }));
    expect(
      computeDues({ ...l, credits: paidAll, asOf: "2026-06-30" }).totals
        .lateFee,
    ).toBe(0);
    const paidTuitionOnly = [
      { appliesTo: june[0].id, kind: "payment", amount: june[0].amount },
    ];
    const partly = computeDues({
      ...l,
      credits: paidTuitionOnly,
      asOf: "2026-06-30",
    });
    expect(partly.totals.lateFee).toBe(10_000); // transport of June still unpaid
    expect(partly.totals.overdue).toBe(50_000);
  });
  it("already settled late fees are not charged again", () => {
    const r = computeDues({
      ...ledger(),
      asOf: "2026-06-30",
      lateFeesSettled: ["2026-06"],
    });
    expect(r.totals.lateFee).toBe(0);
  });
  it("outstanding = billed - concession - paid, and a reversal puts the amount back", () => {
    const l = ledger();
    const c0 = l.charges[0];
    const credits = [
      { appliesTo: c0.id, kind: "concession", amount: 20_000 },
      { appliesTo: c0.id, kind: "payment", amount: 100_000 },
    ];
    const r = computeDues({ ...l, credits, asOf: "2026-06-01" });
    expect(r.totals.billed - r.totals.concession - r.totals.paid).toBe(
      r.totals.outstanding,
    );
    expect(r.totals.outstanding).toBe(10 * 170_000 - 120_000);
    const reversed = computeDues({
      ...l,
      credits: [
        ...credits,
        { appliesTo: c0.id, kind: "reversal", amount: -100_000 },
      ],
      asOf: "2026-06-01",
    });
    expect(reversed.totals.outstanding).toBe(10 * 170_000 - 20_000);
  });
  it("never reports a negative due for an over-credited charge", () => {
    const l = ledger();
    const r = computeDues({
      ...l,
      credits: [
        { appliesTo: l.charges[0].id, kind: "payment", amount: 999_999 },
      ],
      asOf: "2026-06-01",
    });
    expect(r.instalments[0].items[0].due).toBe(0);
  });
});

describe("helpers", () => {
  it("adds days across month and year ends", () => {
    expect(addDaysToDateString("2026-12-25", 10)).toBe("2027-01-04");
    expect(addDaysToDateString("2027-02-20", 10)).toBe("2027-03-02");
  });
  it("recognises the class names used in the Excel sheet", () => {
    expect(normalizeClass("1st")).toBe("1");
    expect(normalizeClass("5TH")).toBe("5");
    expect(normalizeClass("Class 9")).toBe("9");
    expect(normalizeClass("play group")).toBe("PG");
    expect(normalizeClass("Nursery")).toBe("NURSERY");
    expect(normalizeClass("13th")).toBeNull();
    expect(normalizeClass("")).toBeNull();
  });
});
