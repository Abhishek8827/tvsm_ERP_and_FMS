import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function build(forFees = async () => [], charges = []) {
  const deps = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: {
      findByFirebaseUid: async (_t, uid) => users[uid],
      touchLogin: async () => {},
    },
    auditStore: { append: async () => {} },
    moneyStore: {
      overview: async () => ({ cashPaise: 1, pettyPaise: 2, banks: [] }),
      pendingCounts: async () => ({ vouchers: 3, reversals: 1 }),
    },
    studentStore: { forFees },
    feeStore: { get: async () => null },
    chargeStore: { listForStudents: async () => charges },
    receiptStore: {
      linesForStudents: async () => [],
      // Same shape as the real store: groups of kind x mode, not "totals".
      list: async () => ({
        groups: [
          { kind: "school", mode: "cash", paise: 700, count: 2 },
          { kind: "school", mode: "upi", paise: 300, count: 1 },
        ],
      }),
      countPendingCancellations: async () => 4,
    },
    rebateStore: { activeForStudents: async () => [] },
  };
  return createApp(env, createLogger("silent"), deps);
}

describe("dashboard overview", () => {
  it("Admin and Principal get it; Cashier gets 403", async () => {
    const app = build();
    expect(
      (await request(app).get("/api/dashboard/overview").set(as("cashier")))
        .status,
    ).toBe(403);
    for (const who of ["admin", "principal"])
      expect(
        (await request(app).get("/api/dashboard/overview").set(as(who))).status,
      ).toBe(200);
  });
  it("always carries today's total and the pending counts", async () => {
    const r = await request(build())
      .get("/api/dashboard/overview")
      .set(as("admin"));
    expect(r.body.today).toEqual({ paise: 1000, count: 3 });
    expect(r.body.pending).toEqual({
      vouchers: 3,
      reversals: 1,
      cancellations: 4,
    });
    expect(r.body.funds.cashPaise).toBe(1);
  });
});

describe("dashboard fees by kind", () => {
  afterEach(() => vi.useRealTimers());
  it('School and Bus rows: billed - collected - rebate = due, and "not yet due" is separate', async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T05:00:00Z")); // 6 Nov: June-Oct are due (10th), Nov is not yet
    const sid = "a".repeat(24);
    const month = (head, m, amountPaise) => ({
      _id: `${head}${m}`.padEnd(24, "0"),
      studentId: sid,
      fy: "2026-27",
      head,
      period: `2026-${String(m).padStart(2, "0")}`,
      dueDate: `2026-${String(m).padStart(2, "0")}-10`,
      amountPaise,
    });
    const charges = [6, 7, 8, 9, 10, 11].flatMap((m) => [
      month("tuition", m, 77000),
      month("transport", m, 30000),
    ]);
    const student = { _id: sid, admissionNo: '1', name: 'A', classKey: 'LKG', status: 'active', usesTransport: true }; // prettier-ignore
    const r = await request(build(async () => [student], charges)).get('/api/dashboard/overview').set(as('admin')); // prettier-ignore
    expect(r.body.feesByKind.school).toMatchObject({
      billedPaise: 5 * 77000,
      paidPaise: 0,
      rebatePaise: 0,
      dueNowPaise: 5 * 77000,
      notYetDuePaise: 77000,
    });
    expect(r.body.feesByKind.bus).toMatchObject({
      billedPaise: 5 * 30000,
      dueNowPaise: 5 * 30000,
      notYetDuePaise: 30000,
    });
    for (const k of ["school", "bus"]) {
      const t = r.body.feesByKind[k];
      expect(t.billedPaise - t.paidPaise - t.rebatePaise).toBe(t.dueNowPaise);
    }
  });
});

describe("dashboard class strength", () => {
  const people = [
    { classKey: "1", status: "active" },
    { classKey: "1", status: "active" },
    { classKey: "NURSERY", status: "active" },
    { classKey: "1", status: "inactive" },
  ];
  const forFees = async (_t, f) =>
    people.filter((p) => !f.status || p.status === f.status);
  const get = (app, who, q = "") =>
    request(app).get(`/api/dashboard/class-strength${q}`).set(as(who));
  it("counts active students per class by default, in class order", async () => {
    const r = await get(build(forFees), "admin");
    expect(r.status).toBe(200);
    expect(r.body.rows).toEqual([
      { classKey: "NURSERY", students: 1 },
      { classKey: "1", students: 2 },
    ]);
    expect(r.body.totalStudents).toBe(3);
  });
  it("can show inactive or all students", async () => {
    const app = build(forFees);
    expect((await get(app, "principal", "?status=inactive")).body.rows).toEqual(
      [{ classKey: "1", students: 1 }],
    );
    expect((await get(app, "admin", "?status=all")).body.totalStudents).toBe(4);
    expect((await get(app, "admin", "?status=zzz")).status).toBe(400);
  });
  it("is not for the Cashier", async () => {
    expect((await get(build(forFees), "cashier")).status).toBe(403);
  });
});

describe("dashboard fee summary (School and Bus tables)", () => {
  const get = (app, who, q = "") =>
    request(app).get(`/api/dashboard/fee-summary${q}`).set(as(who));
  it("Admin and Principal can read it; the Cashier gets 403; no token 401", async () => {
    const app = build();
    expect((await get(app, "admin")).status).toBe(200);
    expect((await get(app, "principal")).status).toBe(200);
    expect((await get(app, "cashier")).status).toBe(403);
    expect((await request(app).get("/api/dashboard/fee-summary")).status).toBe(
      401,
    );
  });
  it("gives the ten session months June to March, two tables and a total", async () => {
    const r = await get(build(), "admin");
    expect(r.body.months).toHaveLength(10);
    expect(r.body.months[0].endsWith("-06")).toBe(true);
    expect(r.body.months[9].endsWith("-03")).toBe(true);
    expect(r.body.months).toContain(r.body.month);
    expect(r.body.school.total).toMatchObject({
      students: 0,
      duesPaise: 0,
      duePct: null,
    });
    expect(r.body.bus.rows).toEqual([]);
  });
  it("refuses a month outside the session and a wrong status", async () => {
    const app = build();
    expect((await get(app, "admin", "?month=2020-01")).body.error.code).toBe(
      "BAD_MONTH",
    );
    expect((await get(app, "admin", "?status=zzz")).status).toBe(400);
    expect((await get(app, "admin", "?month=abc")).status).toBe(400);
  });
});
