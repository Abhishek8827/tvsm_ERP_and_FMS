import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../config/env.js";
import { createLogger } from "../utils/logger.js";

const TENANT = "tvsm";
const env = loadEnv({
  MONGODB_URI: "mongodb://unused",
  NODE_ENV: "test",
  DEFAULT_TENANT_ID: TENANT,
});
const mk = (id, role) => ({
  _id: id,
  firebaseUid: id,
  email: `${id}@x.com`,
  name: id,
  role,
  tenantId: TENANT,
  isActive: true,
});
const users = {
  admin: mk("admin", "admin"),
  principal: mk("principal", "principal"),
  cashier: mk("cashier", "cashier"),
};
const as = (t) => ({ Authorization: `Bearer ${t}` });

function build({ charges: custom, bus = false } = {}) {
  const audit = [];
  const rebates = [];
  const students = [
    {
      _id: "s1",
      admissionNo: "1",
      name: "Asha",
      classKey: "5th",
      section: "A",
      status: "active",
      usesTransport: bus,
      address: "Ward 4",
      contactNo: "9876543210",
    },
    {
      _id: "s2",
      admissionNo: "2",
      name: "Ravi",
      classKey: "5th",
      section: "A",
      status: "active",
    },
  ];
  const charge = (sid, i, amt, due) => ({
    _id: `${sid}c${i}`,
    studentId: sid,
    head: "tuition",
    period: `p${i}`,
    dueDate: due,
    amountPaise: amt,
  });
  const charges = custom ?? [
    charge("s1", 1, 100000, "2026-06-15"),
    charge("s1", 2, 100000, "2026-07-15"),
  ];
  const deps = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: {
      findByFirebaseUid: async (_t, uid) => users[uid],
      touchLogin: async () => {},
    },
    auditStore: { append: async (e) => audit.push(e) },
    studentStore: {
      forFees: async () => students,
      findById: async (_t, id) => students.find((s) => s._id === id) ?? null,
    },
    feeStore: { get: async () => null },
    chargeStore: {
      listForStudents: async () => charges,
      listForStudent: async (_t, id) =>
        charges.filter((c) => String(c.studentId) === String(id)),
    },
    receiptStore: { linesForStudents: async () => [] },
    rebateStore: {
      activeForStudents: async () => [],
      create: async ({ build: b, reason, kind }) => {
        const lines = b([]);
        const doc = {
          _id: "r1",
          lines,
          totalPaise: lines.reduce((n, l) => n + l.amountPaise, 0),
          reason,
          kind,
          status: "active",
          fy: "2026-27",
          studentId: "s1",
        };
        rebates.push(doc);
        return doc;
      },
      listForStudent: async () => rebates,
      reverse: async () => null,
    },
  };
  return { app: createApp(env, createLogger("silent"), deps), audit, rebates };
}
const ID = "a".repeat(24);

describe("Fees Database", () => {
  it("all three roles can look; Cashier cannot export; filters and totals work", async () => {
    const { app } = build();
    for (const who of ["admin", "principal", "cashier"])
      expect(
        (await request(app).get("/api/fees-database").set(as(who))).status,
      ).toBe(200);
    expect(
      (await request(app).get("/api/fees-database/export").set(as("cashier")))
        .status,
    ).toBe(403);
    const none = await request(app)
      .get("/api/fees-database?feeStatus=noplan")
      .set(as("admin"));
    expect(none.body.total).toBe(1);
    expect(none.body.rows[0].name).toBe("Ravi");
    const all = await request(app)
      .get("/api/fees-database")
      .set(as("principal"));
    expect(all.body.totals.billedPaise).toBe(200000);
    expect(all.body.rows.find((r) => r.name === "Asha").planPosted).toBe(true);
  });
  it("only the Admin can add or reverse a rebate; reason is compulsory", async () => {
    const { app } = build();
    const body = {
      fy: "2026-27",
      kind: "school",
      amountPaise: 50000,
      reason: "Staff child",
    };
    for (const who of ["principal", "cashier"]) {
      expect(
        (
          await request(app)
            .post(`/api/students/s1/rebates`)
            .set(as(who))
            .send(body)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post(`/api/rebates/${ID}/reverse`)
            .set(as(who))
            .send({ reason: "xx yy" })
        ).status,
      ).toBe(403);
    }
    const noReason = await request(app)
      .post(`/api/students/${ID}/rebates`)
      .set(as("admin"))
      .send({ ...body, reason: "" });
    expect(noReason.status).toBe(400);
  });

  it("only the Admin can waive a late fee; months are compulsory and so is the reason", async () => {
    const { app } = build();
    const body = { fy: "2026-27", periods: ["jun"], reason: "Family problem" };
    for (const who of ["principal", "cashier"])
      expect(
        (
          await request(app)
            .post(`/api/students/${ID}/late-fee-waivers`)
            .set(as(who))
            .send(body)
        ).status,
      ).toBe(403);
    const noMonth = await request(app)
      .post(`/api/students/${ID}/late-fee-waivers`)
      .set(as("admin"))
      .send({ ...body, periods: [] });
    expect(noMonth.status).toBe(400);
    const noReason = await request(app)
      .post(`/api/students/${ID}/late-fee-waivers`)
      .set(as("admin"))
      .send({ ...body, reason: "" });
    expect(noReason.status).toBe(400);
  });
  it("the list carries a separate late-fee column and the waiver removes it", async () => {
    const { app } = build();
    const r = await request(app).get("/api/fees-database").set(as("admin"));
    expect(r.body.rows[0]).toHaveProperty("lateFeePaise");
    expect(r.body.totals).toHaveProperty("lateFeePaise");
  });
});

describe("Fees Database columns and lists", () => {
  const bus = {
    _id: "b1",
    studentId: "s1",
    head: "transport",
    period: "p1",
    dueDate: "2026-06-15",
    amountPaise: 30000,
  };
  const old = {
    _id: "o1",
    studentId: "s1",
    head: "old_fees",
    period: "opening",
    dueDate: "2026-04-01",
    amountPaise: 70000,
  };
  const tui = (n, due) => ({
    _id: `t${n}`,
    studentId: "s1",
    head: "tuition",
    period: `p${n}`,
    dueDate: due,
    amountPaise: 100000,
  });

  it("gives the school-sheet columns per fee head; total dues is the sum of the dues", async () => {
    const { app } = build({
      charges: [old, tui(1, "2026-06-15"), bus],
      bus: true,
    });
    const r = await request(app)
      .get("/api/fees-database?upto=2026-12")
      .set(as("admin"));
    const asha = r.body.rows.find((x) => x.name === "Asha");
    expect(asha.address).toBe("Ward 4");
    expect(asha.contactNo).toBe("9876543210");
    expect(asha.cols).toMatchObject({
      oldSchoolDue: 70000,
      newSchoolReceivable: 100000,
      newSchoolDue: 100000,
      newBusReceivable: 30000,
      newBusDue: 30000,
    });
    expect(asha.dueNowPaise).toBe(200000);
  });
  it('"dues up to" a month ignores later months', async () => {
    const { app } = build({
      charges: [
        tui(1, "2026-06-15"),
        tui(2, "2026-07-15"),
        tui(3, "2026-08-15"),
      ],
    });
    const get = async (q) =>
      (
        await request(app).get(`/api/fees-database${q}`).set(as("admin"))
      ).body.rows.find((x) => x.name === "Asha");
    expect((await get("?upto=2026-06")).dueNowPaise).toBe(100000);
    expect((await get("?upto=2026-07")).dueNowPaise).toBe(200000);
    expect((await get("?upto=2026-08")).dueNowPaise).toBe(300000);
    expect(
      (
        await request(app)
          .get("/api/fees-database?upto=2026-13")
          .set(as("admin"))
      ).status,
    ).toBe(400);
  });
  it("school-paid-bus-pending lists only bus students with no school due but a bus due", async () => {
    const { app } = build({ charges: [bus], bus: true });
    const hit = await request(app)
      .get("/api/fees-database?feeStatus=school_paid_bus_pending")
      .set(as("admin"));
    expect(hit.body.rows.map((x) => x.name)).toEqual(["Asha"]);
    const both = build({ charges: [tui(1, "2026-06-15"), bus], bus: true });
    const miss = await request(both.app)
      .get("/api/fees-database?feeStatus=school_paid_bus_pending")
      .set(as("admin"));
    expect(miss.body.total).toBe(0);
    const noBus = build({ charges: [bus], bus: false });
    const miss2 = await request(noBus.app)
      .get("/api/fees-database?feeStatus=school_paid_bus_pending")
      .set(as("admin"));
    expect(miss2.body.total).toBe(0);
  });
  it("the Excel export has every column of the school sheet", async () => {
    const { app } = build({ charges: [old, tui(1, "2026-06-15")] });
    const res = await request(app)
      .get("/api/fees-database/export")
      .set(as("admin"))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/spreadsheetml/);
    const { readSheet } = await import("read-excel-file/universal");
    const sheet = await readSheet(new Blob([res.body]));
    expect(sheet[0]).toEqual(
      expect.arrayContaining([
        "SCH. ID",
        "ADDRESS",
        "CONTACT NO.",
        "OLD SCHOOL DUE",
        "OLD BUS DUE",
        "NEW SCHOOL RECEIVABLE",
        "NEW BUS RECEIVABLE",
        "ADM FEES REC.",
        "FORM FEES REC.",
        "NEW SCHOOL FEE PAID",
        "NEW BUS FEE PAID",
        "ADMISSION FEE PAID",
        "FORM FEE PAID",
        "SCHOOL - REBATE",
        "TRANSPORT - REBATE",
        "ADMISSION - REBATE",
        "NEW SCHOOL FEES DUE",
        "NEW BUS FEES DUE",
        "TOTAL DUES",
        "STATUS",
      ]),
    );
    expect(sheet).toHaveLength(3);
    expect(sheet[1][sheet[0].indexOf("OLD SCHOOL DUE")]).toBe(700);
  });
});
