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
const users = Object.fromEntries(
  ["admin", "principal", "cashier"].map((r) => [
    r,
    {
      _id: r,
      firebaseUid: r,
      email: `${r}@x.com`,
      name: r,
      role: r,
      tenantId: TENANT,
      isActive: true,
    },
  ]),
);
function build() {
  const audit = [];
  const saved = {};
  const moved = [];
  const auth = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: {
      findByFirebaseUid: async (_t, uid) => users[uid],
      touchLogin: async () => {},
    },
    auditStore: { append: async (e) => audit.push(e) },
    feeStore: {
      get: async (_t, fy) => saved[fy] ?? null,
      save: async (_t, fy, d) => (saved[fy] = { fy, ...d }),
      setDueDay: async (_t, fy, dueDay) =>
        (saved[fy] = { ...saved[fy], dueDay }),
    },
    chargeStore: {
      moveMonthlyDueDay: async (...a) => {
        moved.push(a);
        return 4;
      },
    },
  };
  return {
    app: createApp(env, createLogger("silent"), auth),
    audit,
    saved,
    moved,
  };
}
const as = (t) => ({ Authorization: `Bearer ${t}` });
const chart = {
  classFees: [
    { classKey: "NURSERY", monthlyTuitionPaise: 70000, admissionPaise: 100000 },
  ],
  formFeePaise: 10000,
  villages: [{ name: "Siwal", monthlyPaise: 70000 }],
};

describe("fee structure API", () => {
  it("404 when the year has no chart yet", async () => {
    expect(
      (
        await request(build().app)
          .get("/api/fee-structure/2026-27")
          .set(as("cashier"))
      ).status,
    ).toBe(404);
  });
  it("403 when Principal or Cashier tries to change it", async () => {
    const { app } = build();
    for (const r of ["principal", "cashier"])
      expect(
        (
          await request(app)
            .put("/api/fee-structure/2026-27")
            .set(as(r))
            .send(chart)
        ).status,
      ).toBe(403);
  });
  it("Admin saves it, defaults apply, audit written, Cashier can read", async () => {
    const { app, audit } = build();
    const res = await request(app)
      .put("/api/fee-structure/2026-27")
      .set(as("admin"))
      .send(chart);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      dueDay: 10,
      graceDays: 10,
      lateFeePaise: 10000,
    });
    expect(audit.at(-1)).toMatchObject({
      action: "create",
      entity: "fee_structure",
    });
    expect(
      (await request(app).get("/api/fee-structure/2026-27").set(as("cashier")))
        .status,
    ).toBe(200);
  });
  it("rejects rupee decimals (money must be whole paise)", async () => {
    const { app } = build();
    const bad = { ...chart, formFeePaise: 100.5 };
    expect(
      (
        await request(app)
          .put("/api/fee-structure/2026-27")
          .set(as("admin"))
          .send(bad)
      ).status,
    ).toBe(400);
  });
});

describe("due day setting", () => {
  const ok = {
    dueDay: 5,
    reason: "Board decision",
    confirm: "CHANGE DUE DATE",
  };
  const put = (app, who, b) =>
    request(app).put("/api/fee-structure/2026-27/due-day").set(as(who)).send(b);
  async function withChart() {
    const ctx = build();
    await request(ctx.app)
      .put("/api/fee-structure/2026-27")
      .set(as("admin"))
      .send(chart);
    return ctx;
  }
  it("only Admin can change it", async () => {
    const { app } = await withChart();
    for (const r of ["principal", "cashier"])
      expect((await put(app, r, ok)).status).toBe(403);
  });
  it("needs the reason and the typed confirmation", async () => {
    const { app } = await withChart();
    expect((await put(app, "admin", { ...ok, reason: "x" })).status).toBe(400);
    expect((await put(app, "admin", { ...ok, confirm: "yes" })).status).toBe(
      400,
    );
    expect((await put(app, "admin", { ...ok, dueDay: 31 })).status).toBe(400);
  });
  it("changes the day, moves only unpaid-future months, and writes an audit entry", async () => {
    const { app, audit, moved } = await withChart();
    const r = await put(app, "admin", ok);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dueDay: 5, chargesMoved: 4 });
    expect(moved[0].slice(1, 3)).toEqual(["2026-27", 5]);
    expect(audit.at(-1)).toMatchObject({
      entity: "fee_structure",
      reason: "Board decision",
      oldValue: { dueDay: 10 },
      newValue: { dueDay: 5, chargesMoved: 4 },
    });
  });
  it("saving the fee chart never changes the due day", async () => {
    const { app } = await withChart();
    await put(app, "admin", ok);
    const r = await request(app)
      .put("/api/fee-structure/2026-27")
      .set(as("admin"))
      .send({ ...chart, dueDay: 20 });
    expect(r.body.dueDay).toBe(5);
  });
  it("404 when the year has no chart", async () => {
    expect((await put(build().app, "admin", ok)).status).toBe(404);
  });
});
