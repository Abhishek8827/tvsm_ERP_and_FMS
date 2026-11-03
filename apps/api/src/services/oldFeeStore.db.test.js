import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Charge } from "../models/Charge.js";
import { Receipt } from "../models/Receipt.js";
import { makeChargeStore } from "./stores.js";
import { makeOldFeeStore } from "./oldFeeStore.js";

/**
 * Real-database test of Edit Old Fees: the imported charge is never edited, the corrected amount
 * reaches the fee engine, a total below what was paid is refused, and a repeat is refused.
 * Skipped, loudly, where no mongod exists.
 */
let repl;
try {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
} catch (err) {
  console.warn(
    "[oldFeeStore.db.test] no mongod available, DB tests skipped:",
    err.message,
  );
}
const haveDb = repl !== undefined;
const store = makeOldFeeStore();
const charges = makeChargeStore();
const user = { id: "u1", name: "Admin" };
const T = "tvsm";
const FY = "2026-27";
const sid = new mongoose.Types.ObjectId();
const change = (newPaise, extra = {}) =>
  store.create({
    tenantId: T,
    studentId: sid,
    fy: FY,
    head: "old_fees",
    newPaise,
    effectiveDate: "2026-06-01",
    reason: "test",
    student: { name: "A", admissionNo: "1" },
    user,
    ...extra,
  });

describe.skipIf(!haveDb)("old fee corrections on a real database", () => {
  beforeAll(async () => {
    await mongoose.connect(repl.getUri(), { dbName: "oldfee" });
    await Charge.init();
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await repl?.stop();
  });

  it("creates the old fee when none was imported, then corrects it without editing the charge", async () => {
    const made = await change(300000);
    expect(made).toMatchObject({
      previousPaise: 0,
      newPaise: 300000,
      createdCharge: true,
      deltaPaise: 0,
    });
    let list = await charges.listForStudent(T, sid, FY);
    expect(list.find((c) => c.head === "old_fees").amountPaise).toBe(300000);

    await change(450000);
    list = await charges.listForStudent(T, sid, FY);
    const old = list.find((c) => c.head === "old_fees");
    expect(old.amountPaise).toBe(450000);
    expect(old.importedPaise).toBe(300000);
    // the stored charge itself is untouched
    expect(
      (
        await Charge.findOne({
          tenantId: T,
          studentId: sid,
          head: "old_fees",
        }).lean()
      ).amountPaise,
    ).toBe(300000);
  });

  it("refuses the same total again and a total below what is already paid", async () => {
    await expect(change(450000)).rejects.toMatchObject({ code: "NO_CHANGE" });
    const charge = await Charge.findOne({
      tenantId: T,
      studentId: sid,
      head: "old_fees",
    }).lean();
    await Receipt.collection.insertOne({
      tenantId: T,
      studentId: sid,
      fy: FY,
      number: "S-X/1",
      lines: [{ head: "old_fees", chargeId: charge._id, amountPaise: 100000 }],
      totalPaise: 100000,
    });
    await expect(change(99000)).rejects.toMatchObject({ code: "BELOW_PAID" });
    await expect(change(100000)).resolves.toMatchObject({ newPaise: 100000 });
  });

  it("keeps old school and old bus fees apart", async () => {
    await change(70000, { head: "transport_old" });
    const list = await charges.listForStudent(T, sid, FY);
    expect(list.find((c) => c.head === "transport_old").amountPaise).toBe(
      70000,
    );
    expect(list.find((c) => c.head === "old_fees").amountPaise).toBe(100000);
  });
});
