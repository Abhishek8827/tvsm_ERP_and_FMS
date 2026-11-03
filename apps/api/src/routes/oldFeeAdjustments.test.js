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
const ID = "a".repeat(24);
const mk = (uid, role) => ({
  _id: uid,
  firebaseUid: uid,
  email: `${uid}@x.com`,
  name: uid,
  role,
  tenantId: TENANT,
  isActive: true,
});
const users = Object.fromEntries(
  ["admin", "principal", "cashier"].map((r) => [r, mk(r, r)]),
);
const as = (t) => ({ Authorization: `Bearer ${t}` });
const good = {
  fy: "2026-27",
  category: "school",
  newTotalPaise: 300000,
  effectiveDate: "2026-06-01",
  reason: "Joined mid session",
};

function build() {
  const audit = [];
  const created = [];
  const deps = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: {
      findByFirebaseUid: async (_t, uid) => users[uid],
      touchLogin: async () => {},
    },
    auditStore: { append: async (e) => audit.push(e) },
    studentStore: {
      findById: async (_t, id) =>
        id === ID
          ? { _id: ID, name: "Asha", admissionNo: "7", status: "active" }
          : null,
    },
    oldFeeStore: {
      listForStudent: async () => [
        {
          _id: "x1",
          fy: "2026-27",
          head: "transport_old",
          previousPaise: 0,
          newPaise: 5000,
          reason: "r",
        },
      ],
      create: async (args) => {
        created.push(args);
        const doc = {
          _id: "n1",
          fy: args.fy,
          head: args.head,
          previousPaise: 500000,
          newPaise: args.newPaise,
          effectiveDate: args.effectiveDate,
          reason: args.reason,
          createdByName: "admin",
          createdAt: new Date(),
        };
        await args.audit(doc, undefined);
        return doc;
      },
    },
  };
  return { app: createApp(env, createLogger("silent"), deps), audit, created };
}

describe("Edit Old Fees API", () => {
  it("only the Admin can edit; everyone signed in can read the history", async () => {
    const { app } = build();
    for (const who of ["principal", "cashier"])
      expect(
        (
          await request(app)
            .post(`/api/students/${ID}/old-fee-adjustments`)
            .set(as(who))
            .send(good)
        ).status,
      ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/students/${ID}/old-fee-adjustments`)
          .send(good)
      ).status,
    ).toBe(401);
    for (const who of ["admin", "principal", "cashier"]) {
      const res = await request(app)
        .get(`/api/students/${ID}/old-fee-adjustments`)
        .set(as(who));
      expect(res.status).toBe(200);
      expect(res.body.adjustments[0]).toMatchObject({
        category: "transport",
        label: "Old bus fee",
      });
    }
  });

  it("saves the correction for the chosen category and writes the audit entry with old and new value, reason and user", async () => {
    const { app, audit, created } = build();
    const res = await request(app)
      .post(`/api/students/${ID}/old-fee-adjustments`)
      .set(as("admin"))
      .send(good);
    expect(res.status).toBe(201);
    expect(created[0]).toMatchObject({
      head: "old_fees",
      newPaise: 300000,
      fy: "2026-27",
    });
    expect(audit.at(-1)).toMatchObject({
      entity: "old_fee",
      action: "update",
      reason: "Joined mid session",
      oldValue: { totalPaise: 500000, head: "old_fees" },
      newValue: { totalPaise: 300000, scholarNo: "7" },
      userRole: "admin",
    });
    const bus = await request(app)
      .post(`/api/students/${ID}/old-fee-adjustments`)
      .set(as("admin"))
      .send({ ...good, category: "transport" });
    expect(created.at(-1).head).toBe("transport_old");
    expect(bus.status).toBe(201);
  });

  it("refuses a missing reason, a bad amount, a future date, a future session and an unknown student", async () => {
    const { app, created } = build();
    const post = (b, id = ID) =>
      request(app)
        .post(`/api/students/${id}/old-fee-adjustments`)
        .set(as("admin"))
        .send(b);
    expect((await post({ ...good, reason: "" })).status).toBe(400);
    expect((await post({ ...good, newTotalPaise: -1 })).status).toBe(400);
    expect((await post({ ...good, newTotalPaise: 10.5 })).status).toBe(400);
    expect((await post({ ...good, category: "other" })).status).toBe(400);
    expect((await post({ ...good, effectiveDate: "2999-01-01" })).status).toBe(
      400,
    );
    expect((await post({ ...good, fy: "2999-00" })).status).toBe(400);
    expect((await post(good, "b".repeat(24))).status).toBe(404);
    expect(created).toHaveLength(0);
  });
});
