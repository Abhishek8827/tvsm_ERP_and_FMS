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

function build() {
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
    studentStore: { forFees: async () => [] },
    feeStore: { get: async () => null },
    chargeStore: { listForStudents: async () => [] },
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
