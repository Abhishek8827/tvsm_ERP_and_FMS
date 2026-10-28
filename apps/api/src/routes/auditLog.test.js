import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../config/env.js";
import { createLogger } from "../utils/logger.js";
import { csvCell } from "./auditLog.js";

const TENANT = "tvsm";
const env = loadEnv({
  MONGODB_URI: "mongodb://unused",
  NODE_ENV: "test",
  DEFAULT_TENANT_ID: TENANT,
});
const mk = (id, role) => ({
  _id: id, firebaseUid: id, email: `${id}@x.com`, name: id, role, tenantId: TENANT, isActive: true,
}); // prettier-ignore
const users = {
  admin: mk("admin", "admin"),
  principal: mk("principal", "principal"),
  cashier: mk("cashier", "cashier"),
};
const as = (t) => ({ Authorization: `Bearer ${t}` });

function build(total = 2) {
  const audit = [];
  const seen = [];
  const rows = [
    {
      _id: "a1",
      at: new Date("2026-10-13T06:00:00Z"),
      userId: "u1",
      userName: "Asha",
      userRole: "cashier",
      action: "create",
      entity: "receipt",
      entityId: "S-1",
      newValue: { totalPaise: 450000 },
      reason: 'x, "y"',
    },
    {
      _id: "a2",
      at: new Date("2026-10-12T06:00:00Z"),
      userId: "u2",
      userName: null,
      userRole: "admin",
      action: "override",
      entity: "late_fee",
      reason: '=HYPERLINK("evil")',
    },
  ];
  const deps = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: {
      findByFirebaseUid: async (_t, uid) => users[uid],
      touchLogin: async () => {},
    },
    auditStore: {
      append: async (e) => audit.push(e),
      list: async (x) => {
        seen.push(x);
        return { total, rows };
      },
      options: async () => ({
        users: [{ id: "u1", name: "Asha", role: "cashier" }],
        entities: ["receipt"],
      }),
    },
  };
  return { app: createApp(env, createLogger("silent"), deps), audit, seen };
}

describe("Audit log routes", () => {
  it("Admin and Principal can read it; the Cashier cannot", async () => {
    const { app } = build();
    for (const who of ["admin", "principal"]) {
      const r = await request(app).get("/api/audit-log").set(as(who));
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ total: 2, page: 1, pageSize: 50 });
      expect(r.body.rows[0]).toMatchObject({
        userName: "Asha",
        action: "create",
        entity: "receipt",
      });
    }
    expect(
      (await request(app).get("/api/audit-log").set(as("cashier"))).status,
    ).toBe(403);
    expect(
      (await request(app).get("/api/audit-log/options").set(as("cashier")))
        .status,
    ).toBe(403);
  });
  it("passes the filters on and rejects bad ones", async () => {
    const { app, seen } = build();
    await request(app)
      .get(
        "/api/audit-log?userId=u1&action=approve&entity=receipt&from=2026-10-01&to=2026-10-13&q=abc&page=2&pageSize=20",
      )
      .set(as("admin"));
    expect(seen[0]).toMatchObject({
      page: 2,
      pageSize: 20,
      filters: {
        userId: "u1",
        action: "approve",
        entity: "receipt",
        from: "2026-10-01",
        to: "2026-10-13",
        q: "abc",
      },
    });
    expect(
      (await request(app).get("/api/audit-log?action=hack").set(as("admin")))
        .status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get("/api/audit-log?from=2026-10-13&to=2026-10-01")
          .set(as("admin"))
      ).status,
    ).toBe(422);
  });
  it("has no way to change or delete an entry", async () => {
    const { app } = build();

    //prettier-ignore
    for (const m of ["post", "put", "patch", "delete"]) {
      const r = await request(app)[m]("/api/audit-log").set(as("admin")).send({});
      expect([404, 405]).toContain(r.status);
    }
  });
  it("CSV export is quoted, formula-safe, and the export itself is logged", async () => {
    const { app, audit } = build();
    const r = await request(app)
      .get("/api/audit-log/export?from=2026-10-01")
      .set(as("principal"));
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/csv/);
    expect(r.text).toContain('"x, ""y"""');
    expect(r.text).toContain(`"'=HYPERLINK(""evil"")"`);
    expect(audit.at(-1)).toMatchObject({
      action: "export",
      entity: "audit_log",
    });
  });
  it("refuses an export that is too big", async () => {
    const { app } = build(20_001);
    expect(
      (await request(app).get("/api/audit-log/export").set(as("admin"))).status,
    ).toBe(422);
  });
  it("csvCell neutralises formulas and quotes", () => {
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvCell(null)).toBe('""');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});
