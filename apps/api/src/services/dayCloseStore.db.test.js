import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIst } from "@erp/shared";
import { DayClose } from "../models/DayClose.js";
import { Receipt } from "../models/Receipt.js";
import { makeDayCloseStore } from "./dayCloseStore.js";
import { makeReceiptStore } from "./stores.js";

/**
 * Real-database test of the Day Close race: a receipt and a Day Close at the same moment must
 * never both succeed with figures that do not match. Skipped, loudly, where no mongod exists.
 */
let repl;
try {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
} catch (err) {
  console.warn(
    "[dayCloseStore.db.test] no mongod available, DB tests skipped:",
    err.message,
  );
}
const haveDb = repl !== undefined;
const days = makeDayCloseStore();
const receipts = makeReceiptStore();
const user = { id: "u1", name: "Asha" };
const doc = () => ({
  lines: [{ head: "tuition", amountPaise: 100000 }],
  totalPaise: 100000,
  dueAfterPaise: 0,
  mode: "cash",
  cashierId: "c1",
  student: { admissionNo: "1", name: "A" },
});
let n = 0;
const issue = (tenantId) =>
  receipts.issue({
    tenantId,
    studentId: new mongoose.Types.ObjectId(),
    fy: "2026-27",
    kind: "school",
    idempotencyKey: `day-key-${(n += 1)}-${tenantId}`,
    build: async () => doc(),
  });
const figuresOf = (t) => ({
  expectedCashPaise: t.expectedCashPaise,
  countedCashPaise: t.expectedCashPaise,
  differencePaise: 0,
  upiPaise: t.upiPaise,
  qrPaise: t.qrPaise,
  receiptCount: t.receiptCount,
});

describe.skipIf(!haveDb)("day close vs receipts on a real database", () => {
  beforeAll(async () => {
    await mongoose.connect(repl.getUri(), { dbName: "dc" });
    await Receipt.init();
    await DayClose.init();
  }, 120_000);
  afterAll(async () => {
    await mongoose.disconnect();
    await repl.stop();
  });

  it("closes when the figures still match, and a closed day takes no receipt", async () => {
    const T = "t-match";
    await issue(T);
    const totals = await days.dayTotals(T, todayIst());
    const saved = await days.close({
      tenantId: T,
      date: todayIst(),
      user,
      totals,
      figures: figuresOf(totals),
    });
    expect(saved.status).toBe("closed");
    await expect(issue(T)).rejects.toMatchObject({ code: "DAY_CLOSED" });
    expect(
      await days.close({
        tenantId: T,
        date: todayIst(),
        user,
        totals,
        figures: figuresOf(totals),
      }),
    ).toBeNull();
  });

  it("refuses to close with old figures after a receipt arrived in between", async () => {
    const T = "t-stale";
    await issue(T);
    const totals = await days.dayTotals(T, todayIst());
    await issue(T); // a second receipt after the cashier counted
    const out = await days.close({
      tenantId: T,
      date: todayIst(),
      user,
      totals,
      figures: figuresOf(totals),
    });
    expect(out).toEqual({ stale: true });
    expect(await days.isClosed(T, todayIst())).toBe(false);
  });

  it("a receipt and a close at the same moment: either the day closes with the right count, or the receipt waits and the close is asked to recount", async () => {
    const T = "t-race";
    await issue(T);
    const totals = await days.dayTotals(T, todayIst());
    const [r, c] = await Promise.allSettled([
      issue(T),
      days.close({
        tenantId: T,
        date: todayIst(),
        user,
        totals,
        figures: figuresOf(totals),
      }),
    ]);
    const closed = await days.get(T, todayIst());
    const live = await days.dayTotals(T, todayIst());
    if (closed?.status === "closed") {
      // The close won: it must have counted exactly what is in the database now, and the receipt lost.
      expect(closed.receiptCount).toBe(live.receiptCount);
      expect(r.status).toBe("rejected");
    } else {
      // The receipt won: the close must have been told to recount, never saved old figures.
      expect(r.status).toBe("fulfilled");
      expect(c.value).toEqual({ stale: true });
    }
  });
});
