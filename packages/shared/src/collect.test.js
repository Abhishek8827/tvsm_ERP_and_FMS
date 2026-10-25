import { describe, expect, it } from "vitest";
import { ReceiptRuleError, planReceipt, receiptNumber } from "./collect.js";
import { buildCharges } from "./fees.js";

const rs = (n) => n * 100;
const plan = buildCharges({
  fy: "2026-27",
  classFee: { tuition: rs(1000), admission: 0, form: 0 },
});
const tuition = plan.map((c, i) => ({ ...c, id: `t${i}` }));
const bus = buildCharges({
  fy: "2026-27",
  classFee: { tuition: 0 },
  transportMonthly: rs(700),
}).map((c, i) => ({ ...c, id: `b${i}` }));
const old = [
  {
    id: "o1",
    head: "old_fees",
    period: "opening",
    dueDate: "2026-06-01",
    amount: rs(2000),
  },
];
const ask = (extra) => {
  try {
    planReceipt(extra);
  } catch (e) {
    return e;
  }
};

describe("receipt numbers", () => {
  it("uses S for school and T for transport", () => {
    expect(receiptNumber("school", "2026-27", 2054)).toBe("S-FY2026-27/2054");
    expect(receiptNumber("transport", "2026-27", 123)).toBe("T-FY2026-27/0123");
  });
});

describe("planReceipt", () => {
  const base = {
    kind: "school",
    charges: tuition,
    receipts: [],
    asOf: "2026-06-20",
  };

  it("writes the month as June when June is paid with a little extra for July", () => {
    const r = planReceipt({ ...base, input: { newPaise: rs(1400) } });
    expect(r.monthLabel).toBe("June");
    expect(r.lines.map((l) => l.amountPaise)).toEqual([rs(1000), rs(400)]);
  });

  it("writes June - July when two months are fully paid", () => {
    const r = planReceipt({ ...base, input: { newPaise: rs(2000) } });
    expect(r.monthLabel).toBe("June - July");
  });

  it("takes the oldest month first, even for a part payment", () => {
    const r = planReceipt({ ...base, input: { newPaise: rs(500) } });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({
      period: "2026-06",
      amountPaise: rs(500),
    });
    expect(r.monthLabel).toBe("June (part)");
  });

  it("allows advance payment up to the year total but not beyond", () => {
    expect(
      planReceipt({ ...base, input: { newPaise: rs(10000) } }).totalPaise,
    ).toBe(rs(10000));
    expect(ask({ ...base, input: { newPaise: rs(10001) } }).code).toBe(
      "OVER_PAYMENT",
    );
  });

  it("refuses new fees while old fees are still pending", () => {
    const e = ask({
      ...base,
      charges: [...old, ...tuition],
      input: { newPaise: rs(1000) },
    });
    expect(e).toBeInstanceOf(ReceiptRuleError);
    expect(e.code).toBe("OLD_FEES_PENDING");
    // clearing the old fees in the same payment is fine
    const ok = planReceipt({
      ...base,
      charges: [...old, ...tuition],
      input: { oldPaise: rs(2000), newPaise: rs(1000) },
    });
    expect(ok.totalPaise).toBe(rs(3000));
  });

  it("late fee: only reducible, reason compulsory, and settled once", () => {
    const late = { ...base, asOf: "2026-07-01" }; // June is 16 days past its due date
    const full = planReceipt({
      ...late,
      input: { newPaise: rs(1000), lateFeePaise: rs(100) },
    });
    expect(full.lateFee).toMatchObject({
      calculatedPaise: rs(100),
      chargedPaise: rs(100),
    });
    expect(
      ask({ ...late, input: { newPaise: rs(1000), lateFeePaise: rs(101) } })
        .code,
    ).toBe("LATE_FEE_TOO_HIGH");
    expect(
      ask({ ...late, input: { newPaise: rs(1000), lateFeePaise: 0 } }).code,
    ).toBe("LATE_REMARK_REQUIRED");
    const waived = planReceipt({
      ...late,
      input: {
        newPaise: rs(1000),
        lateFeePaise: 0,
        lateFeeRemark: "Bank delay",
      },
    });
    expect(waived.lateFee.periods).toEqual(["2026-06"]);
    // next receipt: June's late fee is not asked again
    const next = planReceipt({
      ...late,
      receipts: [
        {
          kind: "school",
          lines: waived.lines.filter((l) => l.chargeId),
          lateFee: waived.lateFee,
        },
      ],
      input: { newPaise: rs(1000) },
    });
    expect(next.lateFee.calculatedPaise).toBe(0);
  });

  it("transport: only old, new and late; no school-only heads", () => {
    const t = {
      kind: "transport",
      charges: bus,
      receipts: [],
      asOf: "2026-06-20",
    };
    expect(planReceipt({ ...t, input: { newPaise: rs(700) } }).monthLabel).toBe(
      "June",
    );
    expect(
      ask({ ...t, input: { newPaise: rs(700), tcPaise: rs(5) } }).code,
    ).toBe("BAD_HEAD");
  });

  it("school and transport do not mix: school charges are untouched by a bus receipt", () => {
    const e = ask({
      kind: "transport",
      charges: tuition,
      receipts: [],
      asOf: "2026-06-20",
      input: { newPaise: rs(100) },
    });
    expect(e.code).toBe("OVER_PAYMENT");
  });

  it("other charge needs a note; empty receipt refused; TC and other are added", () => {
    expect(ask({ ...base, input: { otherPaise: rs(50) } }).code).toBe(
      "OTHER_NOTE_REQUIRED",
    );
    expect(ask({ ...base, input: {} }).code).toBe("EMPTY");
    const r = planReceipt({
      ...base,
      input: { tcPaise: rs(100), otherPaise: rs(50), otherNote: "Diary" },
    });
    expect(r.totalPaise).toBe(rs(150));
  });

  it("reports what is still due till today after the payment", () => {
    const r = planReceipt({
      ...base,
      asOf: "2026-07-20",
      input: { newPaise: rs(1000), lateFeePaise: rs(100) },
    });
    expect(r.dueAfterPaise).toBe(rs(1000)); // July is due, June paid
  });

  it("late fee is ONE Rs 100 per overdue month for both kinds: a school receipt settles the bus late fee too", () => {
    const asOf = "2026-07-01";
    const school = planReceipt({
      ...base,
      asOf,
      input: { newPaise: rs(1000), lateFeePaise: rs(100) },
    });
    const busBase = { kind: "transport", charges: bus, asOf };
    const first = planReceipt({
      ...busBase,
      receipts: [],
      input: { newPaise: rs(700), lateFeePaise: rs(100) },
    });
    expect(first.lateFee.calculatedPaise).toBe(rs(100));
    const second = planReceipt({
      ...busBase,
      receipts: [
        {
          kind: "school",
          lines: school.lines.filter((l) => l.chargeId),
          lateFee: school.lateFee,
        },
      ],
      input: { newPaise: rs(700) },
    });
    expect(second.lateFee.calculatedPaise).toBe(0);
  });
});

describe("advance payment and old/new dues split", () => {
  const base = {
    kind: "school",
    charges: [...old, ...tuition],
    receipts: [],
    asOf: "2026-06-20",
  };

  it("advance goes to the NEW fees of future months and leaves old fees untouched", () => {
    // Old fees cleared first, then 3 months paid (June due, July and Aug in advance).
    const first = planReceipt({
      ...base,
      input: { oldPaise: rs(2000), newPaise: rs(3000) },
    });
    const oldLines = first.lines.filter((l) => l.head === "old_fees");
    expect(oldLines.reduce((a, l) => a + l.amountPaise, 0)).toBe(rs(2000));
    const tuitionLines = first.lines.filter((l) => l.head === "tuition");
    expect(tuitionLines.map((l) => l.period)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
    expect(first.monthLabel).toBe("June - August");
    // Nothing is due till today after that: advance months are in neither bucket.
    expect(first.dueAfterOldPaise).toBe(0);
    expect(first.dueAfterNewPaise).toBe(0);
  });

  it("prints old dues and new dues separately", () => {
    const r = planReceipt({
      ...base,
      input: { oldPaise: rs(500), newPaise: 0 },
    });
    expect(r.dueAfterOldPaise).toBe(rs(1500));
    expect(r.dueAfterNewPaise).toBe(rs(1000)); // June tuition fell due on the 15th
  });
});
