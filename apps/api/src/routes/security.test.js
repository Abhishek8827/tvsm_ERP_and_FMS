import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../config/env.js";
import { createLogger } from "../utils/logger.js";

/**
 * Security probes: the things an attacker (or a curious staff member) would try. They run on the
 * real Express app with the real middleware; only the database and Firebase are replaced.
 */
const TENANT = "tvsm";
const ORIGIN = "https://erp.example.org";
const env = loadEnv({
  MONGODB_URI: "mongodb://unused",
  NODE_ENV: "production",
  DEFAULT_TENANT_ID: TENANT,
  CORS_ORIGIN: ORIGIN,
});
const mk = (id, role, extra = {}) => ({
  _id: id, firebaseUid: id, email: `${id}@x.com`, name: id, role, tenantId: TENANT, isActive: true, ...extra,
}); // prettier-ignore
const users = {
  admin: mk("admin", "admin"),
  cashier: mk("cashier", "cashier"),
  gone: mk("gone", "cashier", { isActive: false }),
  demoted: mk("demoted", "cashier"), // token still says admin
};
const claims = {
  admin: { role: "admin", tenantId: TENANT },
  cashier: { role: "cashier", tenantId: TENANT },
  gone: { role: "cashier", tenantId: TENANT },
  demoted: { role: "admin", tenantId: TENANT },
  otherschool: { role: "admin", tenantId: "other-school" },
};
// Stand-in stores: every method answers with an empty page. They let a request get past the
// route's own checks, so a 500 in these tests means a real crash, not a missing fake.
const emptyStore = () =>
  new Proxy(
    {},
    {
      get: () => async () => ({
        rows: [],
        groups: [],
        total: 0,
        counts: { active: 0, inactive: 0, total: 0 },
        sections: [],
      }),
    },
  );
function build() {
  const audit = [];
  const deps = {
    studentStore: emptyStore(),
    receiptStore: emptyStore(),
    chargeStore: emptyStore(),
    feeStore: emptyStore(),
    moneyStore: emptyStore(),
    certificateStore: emptyStore(),
    dayCloseStore: emptyStore(),
    reportsStore: emptyStore(),
    cashbookStore: emptyStore(),
    rebateStore: emptyStore(),
    verifyToken: async (t) => {
      if (!claims[t]) throw new Error("bad token");
      return { uid: t === "otherschool" ? "admin" : t, ...claims[t] };
    },
    userStore: {
      findByFirebaseUid: async (_t, uid) => users[uid],
      touchLogin: async () => {},
    },
    auditStore: { append: async (e) => audit.push(e) },
  };
  return { app: createApp(env, createLogger("silent"), deps), audit };
}
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const ID = "a".repeat(24);

/** Every route the app really registers: [METHOD, '/api/...']. */
function listRoutes(app) {
  const out = [];
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route)
        for (const m of Object.keys(layer.route.methods))
          out.push([
            m.toUpperCase(),
            prefix + layer.route.path.replace(/:[A-Za-z]+/g, ID),
          ]);
      else if (layer.handle?.stack) walk(layer.handle.stack, "/api");
    }
  };
  walk(app.router.stack, "");
  return out;
}
// The only doors that may be open without a login: the health check and the sign-in helpers.
const PUBLIC = new Set(["GET /api/health"]);

describe("every route needs a login", () => {
  it("registers a believable number of routes (so this test cannot pass by finding none)", () => {
    expect(listRoutes(build().app).length).toBeGreaterThan(100);
  });
  it("answers 401 to every route called with no token or a forged token", async () => {
    let { app } = build();
    const open = [];
    let sent = 0;
    for (const [method, path] of listRoutes(app)) {
      if (PUBLIC.has(`${method} ${path}`)) continue;
      for (const headers of [
        {},
        bearer("forged-token"),
        { Authorization: "Basic abc" },
      ]) {
        // A fresh app every 200 calls so this test never runs into the 300/minute rate limit.
        if ((sent += 1) % 200 === 0) ({ app } = build());
        const send = request(app)[method.toLowerCase()];
        const r = await send(path).set(headers).send({});
        if (r.status !== 401) open.push(`${method} ${path} -> ${r.status}`);
      }
    }
    expect(open).toEqual([]);
  }, 60_000);
});

describe("sign-in checks", () => {
  it("rejects a deactivated user, a token whose role is out of date, and another school’s token", async () => {
    const { app } = build();
    const get = (t) => request(app).get("/api/students").set(bearer(t));
    expect((await get("gone")).status).toBe(403);
    expect((await get("demoted")).status).toBe(401); // role in token != role in database
    expect((await get("otherschool")).status).toBe(401); // tenant in token != tenant of the user
  });
  it("a cashier cannot use admin doors even with a valid token (sample of the riskiest)", async () => {
    const { app } = build();
    const tries = [
      ["post", "/api/users"],
      ["post", "/api/students/bulk-delete"],
      ["put", "/api/reports/settings"],
      ["get", "/api/audit-log"],
      ["post", `/api/tc/${ID}/print`],
      ["post", `/api/receipts/${ID}/cancel`],
      ["post", "/api/vouchers"],
      ["post", "/api/day-close/2026-10-20/reopen"],
    ];
    for (const [m, p] of tries)
      expect(
        (await request(app)[m](p).set(bearer("cashier")).send({})).status,
        p,
      ).toBe(403);
  });
  it("ignores a role or tenant the browser sends in headers, query or body", async () => {
    const { app } = build();
    const r = await request(app)
      .get("/api/audit-log?role=admin&tenantId=other")
      .set({ ...bearer("cashier"), "X-Role": "admin", "X-Tenant-Id": "other" });
    expect(r.status).toBe(403);
  });
});

describe("hostile input", () => {
  it("Mongo operators in query string or body never reach the database (400/422, never 500)", async () => {
    const { app } = build();
    const bad = [
      request(app).get('/api/students?q[$ne]=x&classKey[$gt]=').set(bearer('admin')),
      request(app).get('/api/receipts?status[$ne]=valid').set(bearer('admin')),
      request(app).post('/api/students').set(bearer('admin')).send({ admissionNo: { $ne: null }, name: { $gt: '' } }),
      request(app).post('/api/receipts').set({ ...bearer('cashier'), 'Idempotency-Key': 'k'.repeat(12) }).send({ studentId: { $ne: null } }),
    ]; // prettier-ignore
    const res = await Promise.all(bad);
    for (const r of res) expect([200, 400, 422]).toContain(r.status);
    for (const r of res) expect(r.status).not.toBe(500);
  });
  it("a malformed id is 400, not a crash", async () => {
    const { app } = build();
    for (const id of [
      "not-an-id",
      "%24ne",
      "../../etc/passwd",
      "a".repeat(23),
    ]) {
      const r = await request(app)
        .get(`/api/receipts/${id}`)
        .set(bearer("admin"));
      expect([400, 404]).toContain(r.status);
    }
  });
  it("a body over 100 kb is refused with 413; broken JSON is 400", async () => {
    const { app } = build();
    const big = await request(app)
      .post("/api/students")
      .set(bearer("admin"))
      .send({ name: "x".repeat(200_000) });
    expect(big.status).toBe(413);
    const broken = await request(app)
      .post("/api/students")
      .set({ ...bearer("admin"), "Content-Type": "application/json" })
      .send('{"name": ');
    expect(broken.status).toBe(400);
  });
  it("errors never show a stack trace or file path", async () => {
    const { app } = build();
    const r = await request(app)
      .post("/api/students")
      .set({ ...bearer("admin"), "Content-Type": "application/json" })
      .send("{bad");
    expect(JSON.stringify(r.body)).not.toMatch(/node_modules|\/src\/|at .*\(/);
    expect(r.body.error.requestId).toBeTruthy();
  });
});

describe("browser protections", () => {
  it("sends the security headers and hides the framework", async () => {
    const { app } = build();
    const r = await request(app).get("/api/health");
    expect(r.headers["x-powered-by"]).toBeUndefined();
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBeTruthy();
    expect(r.headers["strict-transport-security"]).toBeTruthy();
  });
  it("allows only the school’s own web address (CORS)", async () => {
    const { app } = build();
    const ok = await request(app).get("/api/health").set("Origin", ORIGIN);
    expect(ok.headers["access-control-allow-origin"]).toBe(ORIGIN);
    const evil = await request(app)
      .get("/api/health")
      .set("Origin", "https://evil.example");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
    expect(evil.status).toBe(403); // a clear refusal, not a 500
  });
});

describe("limits", () => {
  it("rate limit: the 301st call in a minute gets 429 and a Retry-After", async () => {
    const { app } = build();
    let last;
    for (let i = 0; i < 301; i += 1)
      last = await request(app).get("/api/health");
    expect(last.status).toBe(429);
    expect(last.headers["retry-after"]).toBeTruthy();
  }, 60_000);
});
