import { describe, expect, it } from "vitest";
import { DayCloseRuleError, checkClose, expectedCash } from "./dayClose.js";

describe("Day Close rules", () => {
  it("expected cash = cash receipts minus cash cancelled that same day", () => {
    expect(
      expectedCash({ cashReceiptPaise: 500000, cashCancelledPaise: 120000 }),
    ).toBe(380000);
  });
  it("a matching count needs no reason", () => {
    expect(checkClose({ expectedPaise: 100000, countedPaise: 100000 })).toEqual(
      {
        differencePaise: 0,
      },
    );
  });
  it("a difference needs a reason and is returned signed", () => {
    expect(() =>
      checkClose({ expectedPaise: 100000, countedPaise: 90000 }),
    ).toThrow(DayCloseRuleError);
    expect(
      checkClose({
        expectedPaise: 100000,
        countedPaise: 90000,
        reason: "Change given",
      }),
    ).toEqual({ differencePaise: -10000 });
  });
  it("rejects negative and fractional counts", () => {
    expect(() =>
      checkClose({ expectedPaise: 0, countedPaise: -1, reason: "xxx" }),
    ).toThrow();
    expect(() =>
      checkClose({ expectedPaise: 0, countedPaise: 1.5, reason: "xxx" }),
    ).toThrow();
  });
});
