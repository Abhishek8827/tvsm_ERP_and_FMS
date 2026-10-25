import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../config/env.js";
import { createLogger } from "../utils/logger.js";

const TENANT = "tvsm";
const env = loadEnv({
  MONGODB_URI: "mongodb://unused",
  NODE_ENV: "test",
  DEFAULT_TENANT_ID: TENANT,
});
const mk = (id, role, extra = {}) => ({
  _id: id,
  firebaseUid: id,
  email: `${id}@x.com`,
  name: id,
  role,
  tenantId: TENANT,
  isActive: true,
  ...extra,
});

let db;
let fbCalls;
let audit;
let app;
beforeEach(() => {
  db = [
    mk("admin", "admin"),
    mk("principal", "principal"),
    mk("cashier", "cashier"),
  ];
  fbCalls = [];
  audit = [];
  const firebaseAuth = {
    createUser: async (d) => {
      fbCalls.push(["createUser", d.email]);
      return { uid: `fb-${d.email}` };
    },
    setCustomUserClaims: async (uid, c) =>
      fbCalls.push(["claims", uid, c.role]),
    updateUser: async (uid, d) =>
      fbCalls.push(["updateUser", uid, Object.keys(d).join(",")]),
    revokeRefreshTokens: async (uid) => fbCalls.push(["revoke", uid]),
    deleteUser: async (uid) => fbCalls.push(["deleteUser", uid]),
  };
  const userStore = {
    findByFirebaseUid: async (_t, uid) =>
      db.find((u) => u.firebaseUid === uid) ?? null,
    touchLogin: async () => {},
    findById: async (_t, id) => db.find((u) => u._id === id) ?? null,
    findByEmail: async (_t, e) => db.find((u) => u.email === e) ?? null,
    create: async (_t, d) => {
      const u = { ...d, _id: `u${db.length + 1}`, tenantId: TENANT };
      db.push(u);
      return u;
    },
    update: async (_t, id, d) =>
      Object.assign(
        db.find((u) => u._id === id),
        d,
      ),
    countActiveAdmins: async () =>
      db.filter((u) => u.role === "admin" && u.isActive).length,
    list: async () => ({ rows: db, total: db.length }),
  };
  app = createApp(env, createLogger("silent"), {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore,
    firebaseAuth,
    auditStore: { append: async (e) => audit.push(e) },
  });
});
const as = (t) => ({ Authorization: `Bearer ${t}` });
const good = {
  name: "New Cashier",
  email: "new@x.com",
  role: "cashier",
  password: "longenough1",
};

describe("Admin users module", () => {
  it("only the Admin may use it (403 for principal and cashier on every route)", async () => {
    for (const who of ["principal", "cashier"]) {
      expect((await request(app).get("/api/users").set(as(who))).status).toBe(
        403,
      );
      expect(
        (await request(app).post("/api/users").set(as(who)).send(good)).status,
      ).toBe(403);
      expect(
        (await request(app).patch("/api/users/cashier").set(as(who)).send({}))
          .status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post("/api/users/cashier/reset-password")
            .set(as(who))
            .send({ password: "longenough1" })
        ).status,
      ).toBe(403);
    }
  });

  it("creates a Firebase account with claims AND a database user, and audits without the password", async () => {
    const res = await request(app)
      .post("/api/users")
      .set(as("admin"))
      .send(good);
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty("password");
    expect(fbCalls).toContainEqual(["createUser", "new@x.com"]);
    expect(fbCalls).toContainEqual(["claims", "fb-new@x.com", "cashier"]);
    expect(
      db.some((u) => u.email === "new@x.com" && u.role === "cashier"),
    ).toBe(true);
    expect(JSON.stringify(audit)).not.toContain("longenough1");
  });

  it("rejects a short password and a duplicate email", async () => {
    const short = await request(app)
      .post("/api/users")
      .set(as("admin"))
      .send({ ...good, password: "short" });
    expect(short.status).toBe(400);
    const dup = await request(app)
      .post("/api/users")
      .set(as("admin"))
      .send({ ...good, email: "cashier@x.com" });
    expect(dup.status).toBe(409);
  });

  it("reset password updates Firebase, ends old sessions, never echoes or audits it", async () => {
    const res = await request(app)
      .post("/api/users/cashier/reset-password")
      .set(as("admin"))
      .send({ password: "brandnewpass1" });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("brandnewpass1");
    expect(fbCalls).toContainEqual(["updateUser", "cashier", "password"]);
    expect(fbCalls).toContainEqual(["revoke", "cashier"]);
    expect(JSON.stringify(audit)).not.toContain("brandnewpass1");
    expect(audit.some((a) => a.entity === "user_password")).toBe(true);
  });

  it("change role and deactivate update claims, disable sign-in and revoke sessions", async () => {
    const role = await request(app)
      .patch("/api/users/cashier")
      .set(as("admin"))
      .send({ role: "principal" });
    expect(role.body.role).toBe("principal");
    expect(fbCalls).toContainEqual(["claims", "cashier", "principal"]);
    expect(fbCalls).toContainEqual(["revoke", "cashier"]);
    const off = await request(app)
      .patch("/api/users/cashier")
      .set(as("admin"))
      .send({ isActive: false });
    expect(off.body.isActive).toBe(false);
    expect(fbCalls).toContainEqual(["updateUser", "cashier", "disabled"]);
  });

  it("an Admin cannot lock themselves out, and the last Admin cannot be removed", async () => {
    const self = await request(app)
      .patch("/api/users/admin")
      .set(as("admin"))
      .send({ isActive: false });
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe("SELF_LOCKOUT");
    db.push(mk("admin2", "admin"));
    // another admin demotes the only OTHER admin -> allowed while 2 exist
    const ok = await request(app)
      .patch("/api/users/admin2")
      .set(as("admin"))
      .send({ role: "cashier" });
    expect(ok.status).toBe(200);
    // now only one admin is left; a second admin session demoting them must be refused
    db.push(mk("admin3", "admin", { isActive: false }));
    const last = await request(app)
      .patch("/api/users/admin")
      .set(as("admin"))
      .send({ role: "cashier" });
    expect(last.status).toBe(409);
  });
});
