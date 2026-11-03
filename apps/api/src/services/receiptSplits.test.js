import { describe, expect, it } from "vitest";
import { buildCashbook } from "./cashbook.js";
import {
  accountOfSplit,
  finishPayments,
  paidIn,
  resolvePayments,
  splitsOf,
} from "./receiptSplits.js";

const BANK = "b".repeat(24);
const findBank = async (_t, id) =>
  id === BANK ? { _id: BANK, name: "SBI" } : null;
const resolve = (body) => resolvePayments({ body, tenantId: "t", findBank });

describe("splitsOf", () => {
  it("treats an old single-mode receipt as one payment", () => {
    expect(
      splitsOf({ mode: "upi", totalPaise: 500, bankId: BANK, bankName: "SBI" }),
    ).toEqual([
      expect.objectContaining({ mode: "upi", amountPaise: 500, bankId: BANK }),
    ]);
  });
  it("uses payments[] when present", () => {
    const payments = [{ mode: "cash", amountPaise: 200 }];
    expect(splitsOf({ mode: "split", totalPaise: 200, payments })).toBe(
      payments,
    );
  });
  it("accountOfSplit maps cash, bank and unassigned", () => {
    expect(accountOfSplit({ mode: "cash" })).toBe("cash");
    expect(accountOfSplit({ mode: "upi", bankId: BANK })).toBe(`bank:${BANK}`);
    expect(accountOfSplit({ mode: "upi" })).toBe("online:unassigned");
  });
});

describe("resolvePayments + finishPayments", () => {
  it("legacy single mode takes the whole total", async () => {
    const out = finishPayments(await resolve({ mode: "cash" }), 3500);
    expect(out).toMatchObject({
      mode: "cash",
      payments: [{ mode: "cash", amountPaise: 3500 }],
    });
  });
  it("cash + UPI becomes a split receipt that adds up", async () => {
    const d = await resolve({
      payments: [
        { mode: "cash", amountPaise: 2000 },
        { mode: "upi", amountPaise: 1500, reference: "UTR1234", bankId: BANK },
      ],
    });
    const out = finishPayments(d, 3500);
    expect(out.mode).toBe("split");
    expect(out.bankId).toBeUndefined();
    expect(out.payments).toHaveLength(2);
    expect(out.payments[1]).toMatchObject({
      bankName: "SBI",
      reference: "UTR1234",
    });
  });
  it("rejects a total that does not match the server total", async () => {
    const d = await resolve({
      payments: [
        { mode: "cash", amountPaise: 2000 },
        { mode: "upi", amountPaise: 1000, reference: "UTR1234", bankId: BANK },
      ],
    });
    expect(() => finishPayments(d, 3500)).toThrow(
      expect.objectContaining({ code: "SPLIT_MISMATCH" }),
    );
  });
  it("needs a reference and an active bank for every UPI part", async () => {
    await expect(
      resolve({
        payments: [
          { mode: "upi", amountPaise: 5, reference: "x", bankId: BANK },
        ],
      }),
    ).rejects.toMatchObject({ code: "REFERENCE_REQUIRED" });
    await expect(
      resolve({
        payments: [{ mode: "upi", amountPaise: 5, reference: "UTR1234" }],
      }),
    ).rejects.toMatchObject({ code: "BANK_REQUIRED" });
  });
  it("needs some payment, and cash only once", async () => {
    await expect(resolve({})).rejects.toMatchObject({
      code: "PAYMENT_REQUIRED",
    });
    await expect(
      resolve({
        payments: [
          { mode: "cash", amountPaise: 1 },
          { mode: "cash", amountPaise: 2 },
        ],
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_CASH" });
  });
});

describe("cashbook with a split receipt", () => {
  it("puts each part in its own account", () => {
    const r = {
      _id: "r1",
      number: "S-1",
      kind: "school",
      mode: "split",
      totalPaise: 3500,
      student: { name: "A" },
      payments: [
        { mode: "cash", amountPaise: 2000 },
        { mode: "upi", amountPaise: 1500, bankId: BANK, bankName: "SBI" },
      ],
    };
    expect(paidIn(r, "cash")).toBe(2000);
    const c = buildCashbook({
      date: "2026-11-03",
      receipts: [r],
      ledgerDay: [],
      opening: {},
      payments: [],
      banks: [{ _id: BANK, name: "SBI" }],
      settings: null,
    });
    expect(c.cash.receiptsPaise).toBe(2000);
    expect(c.online.banks[0]).toMatchObject({
      receiptsPaise: 1500,
      closingPaise: 1500,
    });
    expect(c.school.rows[0]).toMatchObject({
      cashPaise: 2000,
      onlinePaise: 1500,
      bankName: "SBI",
    });
    expect(c.totals.closingPaise).toBe(3500);
  });
});
