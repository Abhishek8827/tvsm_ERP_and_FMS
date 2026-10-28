import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BonafideCertificate } from "../models/BonafideCertificate.js";
import { Receipt } from "../models/Receipt.js";
import { Rebate } from "../models/Rebate.js";
import { TransferCertificate } from "../models/TransferCertificate.js";
import { makeStudentStore } from "./stores.js";

/**
 * Real-database test of the "cannot delete a student who has records" query. Rows are inserted
 * straight into the collections (only tenantId + studentId matter here). Skipped, loudly, where
 * no mongod is available.
 */
let repl;
try {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
} catch (err) {
  console.warn(
    "[studentDelete.db.test] no mongod available, DB tests skipped:",
    err.message,
  );
}
const haveDb = repl !== undefined;
const store = makeStudentStore();
const T = "tvsm";
const oid = () => new mongoose.Types.ObjectId();

describe.skipIf(!haveDb)(
  "students with records cannot be deleted (real database)",
  () => {
    beforeAll(async () => {
      await mongoose.connect(repl.getUri(), { dbName: "sd" });
    }, 120_000);
    afterAll(async () => {
      await mongoose.disconnect();
      await repl.stop();
    });

    it("names every kind of record, ignores other schools, and leaves clean students out", async () => {
      const [a, b, c, d] = [oid(), oid(), oid(), oid()];
      await Receipt.collection.insertOne({ tenantId: T, studentId: a });
      await TransferCertificate.collection.insertOne({
        tenantId: T,
        studentId: a,
      });
      await Rebate.collection.insertOne({ tenantId: T, studentId: b });
      await BonafideCertificate.collection.insertOne({
        tenantId: T,
        studentId: c,
      });
      await Receipt.collection.insertOne({
        tenantId: "other-school",
        studentId: d,
      });

      const out = await store.recordsBlockingDelete(T, [a, b, c, d]);
      expect(out.get(String(a)).sort()).toEqual([
        "Transfer Certificate",
        "receipt",
      ]);
      expect(out.get(String(b))).toEqual(["rebate"]);
      expect(out.get(String(c))).toEqual(["Bonafide certificate"]);
      expect(out.has(String(d))).toBe(false); // another school's receipt does not count
      expect((await store.recordsBlockingDelete(T, [oid()])).size).toBe(0);
    });
  },
);
