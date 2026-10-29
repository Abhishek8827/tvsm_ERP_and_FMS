import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditLog } from "../models/AuditLog.js";
import { BankAccount } from "../models/BankAccount.js";
import { Counter } from "../models/Counter.js";
import { FeeStructure } from "../models/FeeStructure.js";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { ReportSettings } from "../models/ReportSettings.js";
import { Receipt } from "../models/Receipt.js";
import { Student } from "../models/Student.js";
import { User } from "../models/User.js";
import { countPlan, runWipe } from "./dataReset.js";

/** Real-database test of the cleanup. Skipped, loudly, where no mongod is available. */
let repl;
try {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
} catch (err) {
  console.warn(
    "[dataReset.db.test] no mongod available, DB tests skipped:",
    err.message,
  );
}
const haveDb = repl !== undefined;
const T = "tvsm";

describe.skipIf(!haveDb)("data cleaner on a real database", () => {
  beforeAll(async () => {
    await mongoose.connect(repl.getUri(), { dbName: "dr" });
  }, 120_000);
  afterAll(async () => {
    await mongoose.disconnect();
    await repl.stop();
  });

  it("removes test data of this school only, keeps setup, zeroes opening figures, logs itself", async () => {
    const oid = () => new mongoose.Types.ObjectId();
    await Receipt.collection.insertMany([
      { tenantId: T, studentId: oid() },
      { tenantId: "other", studentId: oid() },
    ]);
    await Student.collection.insertOne({ tenantId: T, name: "Test" });
    await LedgerEntry.collection.insertOne({
      tenantId: T,
      account: "cash",
      type: "opening",
      amountPaise: 5000000,
    });
    await Counter.collection.insertOne({
      tenantId: T,
      key: "receipt:school:2026-27",
      seq: 41,
    });
    await AuditLog.collection.insertMany([
      { tenantId: T, action: "create", entity: "receipt", at: new Date() },
      { tenantId: T, action: "create", entity: "student", at: new Date() },
    ]);
    await BankAccount.collection.insertMany([
      { tenantId: T, name: "IDFC (DEMO)", nameLower: "idfc (demo)" },
      { tenantId: T, name: "Kotak Mahindra", nameLower: "kotak mahindra" },
    ]);
    await User.collection.insertOne({
      tenantId: T,
      email: "a@x.com",
      role: "admin",
    });
    await FeeStructure.collection.insertOne({ tenantId: T, fy: "2026-27" });
    await ReportSettings.collection.insertOne({
      tenantId: T,
      fixedAssetsPaise: 900,
      capitalPaise: 800,
      history: [{ reason: "x" }],
    });

    const dry = await countPlan(T);
    expect(dry.find((r) => r.name === "Receipt").count).toBe(1); // other school's receipt not counted
    expect(await Receipt.collection.countDocuments({})).toBe(2); // a dry run changed nothing

    const out = await runWipe(T, { by: "test" });
    expect(out.removed).toMatchObject({
      Receipt: 1,
      Student: 1,
      LedgerEntry: 1,
      Counter: 1,
      AuditLog: 2,
      BankAccount: 1,
    });
    expect(await Receipt.collection.countDocuments({ tenantId: "other" })).toBe(
      1,
    );
    expect(await User.collection.countDocuments({ tenantId: T })).toBe(1);
    expect(await FeeStructure.collection.countDocuments({ tenantId: T })).toBe(
      1,
    );
    expect(
      (await BankAccount.collection.find({ tenantId: T }).toArray()).map(
        (b) => b.name,
      ),
    ).toEqual(["Kotak Mahindra"]);
    const rs = await ReportSettings.collection.findOne({ tenantId: T });
    expect(rs).toMatchObject({
      fixedAssetsPaise: 0,
      capitalPaise: 0,
      history: [],
    });
    const audit = await AuditLog.collection.find({ tenantId: T }).toArray();
    expect(audit).toHaveLength(1); // only the entry that explains this cleanup
    expect(audit[0]).toMatchObject({ action: "delete", entity: "system_data" });
  });
});
