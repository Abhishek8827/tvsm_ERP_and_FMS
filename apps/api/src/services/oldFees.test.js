import { describe, expect, it } from "vitest";
import {
  applyOldFeeAdjustments,
  checkOldFeeChange,
  deltaMap,
} from "./oldFees.js";

const charge = (over) => ({
  _id: "c1",
  studentId: "s1",
  head: "old_fees",
  period: "opening",
  dueDate: "2026-06-01",
  amountPaise: 500000,
  ...over,
});
const adj = (over) => ({
  studentId: "s1",
  head: "old_fees",
  deltaPaise: -100000,
  ...over,
});

describe("applyOldFeeAdjustments", () => {
  it("adds the corrections to the imported old fee and remembers the imported amount", () => {
    const out = applyOldFeeAdjustments(
      [charge()],
      [adj(), adj({ deltaPaise: 30000 })],
    );
    expect(out[0]).toMatchObject({
      amountPaise: 430000,
      importedPaise: 500000,
      _id: "c1",
    });
  });
  it("leaves other heads, other students and uncorrected charges alone", () => {
    const tuition = charge({ _id: "c2", head: "tuition", period: "2026-06" });
    const other = charge({ _id: "c3", studentId: "s2" });
    const out = applyOldFeeAdjustments([tuition, other], [adj()]);
    expect(out).toEqual([tuition, other]);
  });
  it("does not mix up old school and old bus fees", () => {
    const bus = charge({
      _id: "c4",
      head: "transport_old",
      amountPaise: 80000,
    });
    const out = applyOldFeeAdjustments(
      [charge(), bus],
      [adj({ head: "transport_old", deltaPaise: -30000 })],
    );
    expect(out.find((c) => c._id === "c1").amountPaise).toBe(500000);
    expect(out.find((c) => c._id === "c4").amountPaise).toBe(50000);
  });
  it("drops an old fee corrected down to nothing", () => {
    expect(
      applyOldFeeAdjustments([charge()], [adj({ deltaPaise: -500000 })]),
    ).toEqual([]);
  });
  it("sums deltas per student and head", () => {
    expect(deltaMap([adj(), adj({ deltaPaise: 5 })]).get("s1|old_fees")).toBe(
      -99995,
    );
  });
});

describe("checkOldFeeChange", () => {
  const ok = { currentPaise: 500000, creditedPaise: 200000 };
  it("allows a higher or a lower total that still covers what is paid", () => {
    expect(() => checkOldFeeChange({ ...ok, newPaise: 700000 })).not.toThrow();
    expect(() => checkOldFeeChange({ ...ok, newPaise: 200000 })).not.toThrow();
  });
  it("blocks a total below what is already paid or rebated", () => {
    expect(() => checkOldFeeChange({ ...ok, newPaise: 199900 })).toThrowError(
      /already been paid/,
    );
    try {
      checkOldFeeChange({ ...ok, newPaise: 0 });
    } catch (e) {
      expect(e.code).toBe("BELOW_PAID");
      expect(e.status).toBe(409);
    }
  });
  it("refuses a change to the same amount (no duplicate entry) and bad amounts", () => {
    expect(() => checkOldFeeChange({ ...ok, newPaise: 500000 })).toThrowError(
      /Nothing to change/,
    );
    expect(() => checkOldFeeChange({ ...ok, newPaise: -1 })).toThrowError(
      /valid amount/,
    );
    expect(() => checkOldFeeChange({ ...ok, newPaise: 1.5 })).toThrowError(
      /valid amount/,
    );
  });
});
