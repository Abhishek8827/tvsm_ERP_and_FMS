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
const ID = "a".repeat(24);

function build() {
  const audit = [];
  const rows = [
    {
      _id: ID,
      status: "requested",
      reason: "Wrong amount",
      receiptNumber: "S-FY2026-27/0001",
      receipt: {
        _id: "r1",
        number: "S-FY2026-27/0001",
        totalPaise: 100000,
        student: { name: "Asha" },
      },
    },
  ];
  const deps = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: {
      findByFirebaseUid: async (_t, uid) => users[uid],
      touchLogin: async () => {},
    },
    auditStore: { append: async (e) => audit.push(e) },
    receiptStore: {
      listCancellations: async () => ({ rows, total: rows.length }),
      decideCancellation: async ({ id, decision, note, user, audit: log }) => {
        const c = rows.find(
          (r) => String(r._id) === id && r.status === "requested",
        );
        if (!c) return null;
        Object.assign(c, {
          status: decision === "approve" ? "cancelled" : "rejected",
          decidedByName: user.name,
          decisionNote: note,
        });
        if (log) await log(c);
        return c;
      },
    },
  };
  return { app: createApp(env, createLogger("silent"), deps), audit, rows };
}

describe("receipt cancellation approvals", () => {
  it("Admin and Principal can list; Cashier cannot", async () => {
    const { app } = build();
    expect(
      (
        await request(app)
          .get("/api/receipt-cancellations")
          .set(as("principal"))
      ).status,
    ).toBe(200);
    expect(
      (await request(app).get("/api/receipt-cancellations").set(as("admin")))
        .status,
    ).toBe(200);
    expect(
      (await request(app).get("/api/receipt-cancellations").set(as("cashier")))
        .status,
    ).toBe(403);
  });
  it("only the Principal decides (Admin and Cashier get 403)", async () => {
    const { app, rows } = build();
    for (const who of ["admin", "cashier"]) {
      expect(
        (
          await request(app)
            .post(`/api/receipt-cancellations/${ID}/approve`)
            .set(as(who))
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post(`/api/receipt-cancellations/${ID}/reject`)
            .set(as(who))
            .send({ reason: "no no" })
        ).status,
      ).toBe(403);
    }
    expect(rows[0].status).toBe("requested");
  });
  it("approve cancels and is audited; deciding again is 404", async () => {
    const { app, audit } = build();
    const r = await request(app)
      .post(`/api/receipt-cancellations/${ID}/approve`)
      .set(as("principal"));
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("cancelled");
    expect(
      audit.some(
        (a) => a.entity === "receipt_cancellation" && a.action === "cancel",
      ),
    ).toBe(true);
    expect(
      (
        await request(app)
          .post(`/api/receipt-cancellations/${ID}/approve`)
          .set(as("principal"))
      ).status,
    ).toBe(404);
  });
  it("reject needs a reason and keeps it", async () => {
    const { app } = build();
    expect(
      (
        await request(app)
          .post(`/api/receipt-cancellations/${ID}/reject`)
          .set(as("principal"))
          .send({})
      ).status,
    ).toBe(400);
    const r = await request(app)
      .post(`/api/receipt-cancellations/${ID}/reject`)
      .set(as("principal"))
      .send({ reason: "Receipt is correct" });
    expect(r.body).toMatchObject({
      status: "rejected",
      decisionNote: "Receipt is correct",
    });
  });
});
