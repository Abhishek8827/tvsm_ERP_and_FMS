import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createTokenVerifier } from "./auth/tokenVerifier.js";
import { loadEnv } from "./config/env.js";
import { requireRole } from "./middleware/requireRole.js";
import { AuditLog } from "./models/AuditLog.js";
import { createLogger } from "./utils/logger.js";

const TENANT = "tvsm";
const env = loadEnv({
  MONGODB_URI: "mongodb://unused",
  NODE_ENV: "test",
  DEFAULT_TENANT_ID: TENANT,
});
const logger = createLogger("silent");

// One fake account per role, plus awkward cases. Tokens are plain strings in these tests.
const users = {
  "uid-admin": {
    _id: "u1",
    firebaseUid: "uid-admin",
    email: "a@x.com",
    name: "Admin",
    role: "admin",
    tenantId: TENANT,
    isActive: true,
  },
  "uid-principal": {
    _id: "u2",
    firebaseUid: "uid-principal",
    email: "p@x.com",
    name: "Principal",
    role: "principal",
    tenantId: TENANT,
    isActive: true,
  },
  "uid-cashier": {
    _id: "u3",
    firebaseUid: "uid-cashier",
    email: "c@x.com",
    name: "Cashier",
    role: "cashier",
    tenantId: TENANT,
    isActive: true,
  },
  "uid-off": {
    _id: "u4",
    firebaseUid: "uid-off",
    email: "o@x.com",
    name: "Left",
    role: "cashier",
    tenantId: TENANT,
    isActive: false,
  },
};
const tokens = {
  admin: { uid: "uid-admin", role: "admin", tenantId: TENANT },
  principal: { uid: "uid-principal", role: "principal", tenantId: TENANT },
  cashier: { uid: "uid-cashier", role: "cashier", tenantId: TENANT },
  off: { uid: "uid-off", role: "cashier", tenantId: TENANT },
  stale: { uid: "uid-cashier", role: "admin", tenantId: TENANT }, // claims say admin, DB says cashier
  otherTenant: {
    uid: "uid-cashier",
    role: "cashier",
    tenantId: "other-school",
  },
  stranger: { uid: "uid-nobody", role: "admin", tenantId: TENANT },
};

function build() {
  const audit = [];
  const touched = [];
  const auth = {
    verifyToken: async (t) => {
      if (!(t in tokens))
        throw Object.assign(new Error("bad token"), {
          code: "auth/argument-error",
        });
      return tokens[t];
    },
    userStore: {
      findByFirebaseUid: async (_tenant, uid) => users[uid] ?? null,
      touchLogin: async (tenantId, id) => touched.push({ tenantId, id }),
      list: async () => ({ rows: Object.values(users), total: 4 }),
    },
    auditStore: { append: async (e) => audit.push(e) },
  };
  return { app: createApp(env, logger, auth), audit, touched };
}
const as = (token) => ({ Authorization: `Bearer ${token}` });

describe("authentication", () => {
  const { app, audit } = build();

  it("rejects a request with no token (401)", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });
  it("rejects a garbage token (401) without leaking details", async () => {
    const res = await request(app).get("/api/auth/me").set(as("garbage"));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
    expect(JSON.stringify(res.body)).not.toMatch(/argument-error/);
  });
  it("403 when the login has no account in this school", async () => {
    const res = await request(app).get("/api/auth/me").set(as("stranger"));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NO_ACCOUNT");
  });
  it("403 and an audit entry for a deactivated account", async () => {
    const res = await request(app).get("/api/auth/me").set(as("off"));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCOUNT_DISABLED");
    expect(audit.at(-1)).toMatchObject({
      action: "login_blocked",
      entity: "user",
      entityId: "u4",
    });
  });
  it("401 CLAIMS_STALE when the token role disagrees with the database role", async () => {
    const res = await request(app).get("/api/auth/me").set(as("stale"));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("CLAIMS_STALE");
  });
  it("401 when the token belongs to another school", async () => {
    const res = await request(app).get("/api/auth/me").set(as("otherTenant"));
    expect(res.status).toBe(401);
  });
  it("/auth/me returns the DATABASE role, ignoring anything the client claims", async () => {
    const res = await request(app)
      .get("/api/auth/me?role=admin")
      .set({ ...as("cashier"), "X-Role": "admin" });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: "cashier", email: "c@x.com" });
  });
});

describe("role permissions (wrong role => 403, every role tested)", () => {
  const { app } = build();
  // endpoint x role matrix. true = allowed (200), false = forbidden (403)
  const matrix = [
    {
      method: "get",
      path: "/api/auth/me",
      admin: true,
      principal: true,
      cashier: true,
    },
    {
      method: "get",
      path: "/api/users",
      admin: true,
      principal: false,
      cashier: false,
    },
  ];
  for (const row of matrix) {
    for (const role of ["admin", "principal", "cashier"]) {
      it(`${role} ${row.method.toUpperCase()} ${row.path} -> ${row[role] ? 200 : 403}`, async () => {
        const res = await request(app)[row.method](row.path).set(as(role));
        expect(res.status).toBe(row[role] ? 200 : 403);
        if (!row[role]) expect(res.body.error.code).toBe("FORBIDDEN");
      });
    }
  }
  it("/users is unreachable without a token", async () => {
    expect((await request(app).get("/api/users")).status).toBe(401);
  });
  it("/users paginates and validates its query", async () => {
    const ok = await request(app)
      .get("/api/users?page=1&pageSize=2")
      .set(as("admin"));
    expect(ok.body).toMatchObject({ page: 1, pageSize: 2, total: 4 });
    const bad = await request(app)
      .get("/api/users?pageSize=9999")
      .set(as("admin"));
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.pageSize).toBeTruthy();
  });
  it("requireRole needs at least one role and denies a missing user", () => {
    expect(() => requireRole()).toThrow();
    const next = vi.fn();
    requireRole("admin")({}, {}, next);
    expect(next.mock.calls[0][0].status).toBe(401);
  });
});

describe("session events (login audit)", () => {
  it("records the login, who did it, and updates last login", async () => {
    const { app, audit, touched } = build();
    const res = await request(app)
      .post("/api/auth/session-event")
      .set(as("cashier"))
      .send({ event: "login" });
    expect(res.status).toBe(204);
    expect(audit[0]).toMatchObject({
      action: "login",
      entity: "session",
      userId: "u3",
      userRole: "cashier",
      tenantId: TENANT,
    });
    expect(touched).toEqual([{ tenantId: TENANT, id: "u3" }]);
  });
  it("records idle logout", async () => {
    const { app, audit } = build();
    await request(app)
      .post("/api/auth/session-event")
      .set(as("admin"))
      .send({ event: "idle_logout" });
    expect(audit[0].action).toBe("idle_logout");
  });
  it("rejects an unknown event with a field error", async () => {
    const { app } = build();
    const res = await request(app)
      .post("/api/auth/session-event")
      .set(as("admin"))
      .send({ event: "hack" });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.event).toBeTruthy();
  });
  it("does not lock the user out when the audit write fails", async () => {
    const { app } = build();
    const failing = createApp(env, logger, {
      verifyToken: async () => tokens.admin,
      userStore: {
        findByFirebaseUid: async () => users["uid-admin"],
        touchLogin: async () => {},
        list: async () => ({ rows: [], total: 0 }),
      },
      auditStore: {
        append: async () => {
          throw new Error("db down");
        },
      },
    });
    const res = await request(failing)
      .post("/api/auth/session-event")
      .set(as("x"))
      .send({ event: "login" });
    expect(res.status).toBe(204);
    expect(app).toBeTruthy();
  });
});

describe("when Firebase is not configured", () => {
  const app = createApp(env, logger, undefined);
  it("protected routes say so (503) and health still answers", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AUTH_NOT_CONFIGURED");
    expect((await request(app).get("/api/health")).status).toBe(503); // db down in tests, route exists
  });
});

describe("token verifier cache", () => {
  it("verifies once inside the window, again after it, and never caches failures", async () => {
    let t = 1_000_000;
    const auth = {
      verifyIdToken: vi.fn(async () => ({ uid: "x", exp: t / 1000 + 3600 })),
    };
    const verify = createTokenVerifier(auth, { ttlMs: 60_000, now: () => t });
    await verify("tok");
    await verify("tok");
    expect(auth.verifyIdToken).toHaveBeenCalledTimes(1);
    expect(auth.verifyIdToken).toHaveBeenCalledWith("tok", true); // checkRevoked on
    t += 61_000;
    await verify("tok");
    expect(auth.verifyIdToken).toHaveBeenCalledTimes(2);

    auth.verifyIdToken.mockRejectedValueOnce(new Error("revoked"));
    await expect(verify("other")).rejects.toThrow("revoked");
    await verify("other");
    expect(auth.verifyIdToken).toHaveBeenCalledTimes(4);
  });
});

describe("audit log is append-only (rule 11)", () => {
  const blocked = [
    [
      "updateOne",
      () => AuditLog.updateOne({ tenantId: TENANT }, { reason: "edited" }),
    ],
    [
      "updateMany",
      () => AuditLog.updateMany({ tenantId: TENANT }, { reason: "edited" }),
    ],
    [
      "findOneAndUpdate",
      () => AuditLog.findOneAndUpdate({ tenantId: TENANT }, { reason: "x" }),
    ],
    [
      "replaceOne",
      () =>
        AuditLog.replaceOne(
          { tenantId: TENANT },
          { action: "login", entity: "x" },
        ),
    ],
    ["deleteOne", () => AuditLog.deleteOne({ tenantId: TENANT })],
    ["deleteMany", () => AuditLog.deleteMany({ tenantId: TENANT })],
    ["findOneAndDelete", () => AuditLog.findOneAndDelete({ tenantId: TENANT })],
    [
      "bulkWrite update",
      () =>
        AuditLog.bulkWrite([
          {
            updateOne: {
              filter: { tenantId: TENANT },
              update: { reason: "x" },
            },
          },
        ]),
    ],
  ];
  it.each(blocked)("%s is refused", async (_n, run) => {
    await expect(run()).rejects.toThrow(/append-only/);
  });
  it("re-saving an existing entry is refused", async () => {
    const doc = new AuditLog({
      tenantId: TENANT,
      action: "login",
      entity: "session",
    });
    doc.isNew = false;
    await expect(doc.save()).rejects.toThrow(/append-only/);
  });
});
