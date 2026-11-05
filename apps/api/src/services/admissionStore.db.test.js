import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NewAdmission } from "../models/NewAdmission.js";
import { Student } from "../models/Student.js";
import { makeAdmissionStore } from "./admissionStore.js";

/**
 * Real-database test of admitting and numbering: two Admins admitting at the same moment must get
 * two different scholar numbers, a failed admit must leave no half-made student, and form numbers
 * must never repeat. Skipped, loudly, where no mongod exists.
 */
let repl;
try {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
} catch (err) {
  console.warn(
    "[admissionStore.db.test] no mongod available, DB tests skipped:",
    err.message,
  );
}
const haveDb = repl !== undefined;
const store = makeAdmissionStore();
const user = { id: "u1", name: "Asha" };
let n = 0;
const form = (tenantId, extra = {}) =>
  store.create({
    tenantId,
    session: "2026-27",
    idempotencyKey: `k-${(n += 1)}-abcdefgh`,
    user,
    data: {
      name: `Child ${n}`,
      classKey: "1",
      formSubmittedOn: "2026-11-01",
      formFeePaise: 10000,
      admissionFeePaise: 500000,
      ...extra,
    },
  });
const seedStudent = (tenantId, admissionNo) =>
  Student.create({
    tenantId,
    admissionNo,
    name: `S${admissionNo}`,
    nameLower: `s${admissionNo}`,
    classKey: "1",
  });

describe.skipIf(!haveDb)("new admissions on a real database", () => {
  beforeAll(async () => {
    await mongoose.connect(repl.getUri(), { dbName: "adm" });
    await NewAdmission.init();
    await Student.init();
  }, 120_000);
  afterAll(async () => {
    await mongoose.disconnect();
    await repl.stop();
  });

  it("form numbers are gap-free per session, and a repeated key makes no second form", async () => {
    const T = "t-forms";
    const a = await form(T);
    const b = await form(T);
    expect([a.admission.formNo, b.admission.formNo]).toEqual([
      "NEW/2026-27/001",
      "NEW/2026-27/002",
    ]);
    const again = await store.create({
      tenantId: T,
      session: "2026-27",
      idempotencyKey: a.admission.idempotencyKey,
      user,
      data: {
        name: "X",
        classKey: "1",
        formSubmittedOn: "2026-11-01",
        formFeePaise: 1,
        admissionFeePaise: 1,
      },
    });
    expect(again.replay).toBe(true);
    expect(await NewAdmission.countDocuments({ tenantId: T })).toBe(2);
  });

  it("suggests highest + 1, and admitting makes ONE student with that number", async () => {
    const T = "t-next";
    await seedStudent(T, "1249");
    await seedStudent(T, "1250");
    await seedStudent(T, "OLD-7"); // not a plain number: ignored
    const { admission } = await form(T);
    expect(await store.nextScholarNo(T)).toBe(1251);
    const out = await store.admit({
      tenantId: T,
      id: admission._id,
      scholarNo: "1251",
      user,
    });
    expect(out.admission).toMatchObject({
      status: "admitted",
      scholarNo: "1251",
    });
    expect(
      await Student.countDocuments({ tenantId: T, admissionNo: "1251" }),
    ).toBe(1);
    expect(await store.nextScholarNo(T)).toBe(1252);
    // the same click again: no second student
    const again = await store.admit({
      tenantId: T,
      id: admission._id,
      scholarNo: "1251",
      user,
    });
    expect(again.replay).toBe(true);
    expect(await Student.countDocuments({ tenantId: T })).toBe(4);
  });

  it("two Admins admitting at once never get the same number", async () => {
    const T = "t-race";
    await seedStudent(T, "10");
    const a = (await form(T)).admission;
    const b = (await form(T)).admission;
    const results = await Promise.allSettled([
      store.admit({ tenantId: T, id: a._id, scholarNo: "11", user }),
      store.admit({ tenantId: T, id: b._id, scholarNo: "11", user }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(bad[0].reason).toMatchObject({ code: "SCHOLAR_NO_CHANGED" });
    expect(bad[0].reason.fields.scholarNo).toBe("12");
    // the loser confirms the new number and succeeds
    const loserId = ok[0].value.admission._id.equals(a._id) ? b._id : a._id;
    const retry = await store.admit({
      tenantId: T,
      id: loserId,
      scholarNo: "12",
      user,
    });
    expect(retry.admission.scholarNo).toBe("12");
    const numbers = (await Student.find({ tenantId: T }).lean())
      .map((s) => s.admissionNo)
      .sort();
    expect(numbers).toEqual(["10", "11", "12"]);
  });

  it("a deleted student's number is not handed out again", async () => {
    const T = "t-reuse";
    await seedStudent(T, "500");
    const { admission } = await form(T);
    await store.admit({
      tenantId: T,
      id: admission._id,
      scholarNo: "501",
      user,
    });
    await Student.deleteOne({ tenantId: T, admissionNo: "501" });
    expect(await store.nextScholarNo(T)).toBe(502);
  });

  it("a failed admit leaves no student and the form stays pending", async () => {
    const T = "t-fail";
    await seedStudent(T, "7");
    const { admission } = await form(T);
    await expect(
      store.admit({ tenantId: T, id: admission._id, scholarNo: "99", user }),
    ).rejects.toMatchObject({ code: "SCHOLAR_NO_CHANGED" });
    expect(await Student.countDocuments({ tenantId: T })).toBe(1);
    expect(
      (await NewAdmission.findOne({ tenantId: T, _id: admission._id }).lean())
        .status,
    ).toBe("pending");
  });
});
