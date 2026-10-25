import request from "supertest";
import writeXlsxFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../config/env.js";
import { OLD_DUES_HEADERS } from "../services/oldDuesImport.js";
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
  const charges = [];
  const audit = [];
  const auth = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: {
      findByFirebaseUid: async (_t, uid) => users[uid],
      touchLogin: async () => {},
    },
    auditStore: { append: async (e) => audit.push(e) },
    studentStore: {
      idsByAdmissionNo: async (_t, nos) =>
        new Map(
          nos.filter((x) => ["1", "2"].includes(x)).map((x) => [x, `id${x}`]),
        ),
    },
    chargeStore: {
      openingKeys: async () =>
        new Set(charges.map((c) => `${c.studentId}|${c.head}`)),
      postBatch: async (_t, _fy, items) => {
        charges.push(...items);
        return items.length;
      },
    },
  };
  return { app: createApp(env, createLogger("silent"), auth), charges, audit };
}
const as = (t) => ({ Authorization: `Bearer ${t}` });
const file = (rows) => writeXlsxFile([OLD_DUES_HEADERS, ...rows]).toBuffer();
const send = (app, buf, commit, who = "admin") =>
  request(app)
    .post(`/api/old-dues/import?commit=${commit}`)
    .set(as(who))
    .set("Content-Type", "application/octet-stream")
    .send(buf);

describe("old fees Excel import", () => {
  it("is Admin only", async () => {
    const { app } = build();
    const buf = await file([["1", 100, null]]);
    expect((await send(app, buf, false, "cashier")).status).toBe(403);
    expect((await send(app, buf, false, "principal")).status).toBe(403);
    expect(
      (await request(app).get("/api/old-dues/template").set(as("cashier")))
        .status,
    ).toBe(403);
    expect(
      (await request(app).get("/api/old-dues/template").set(as("admin")))
        .status,
    ).toBe(200);
  });

  it("checking saves nothing; importing saves old school and old transport charges in paise", async () => {
    const { app, charges, audit } = build();
    const buf = await file([
      ["1", 3000, 1500.5],
      ["2", null, 700],
    ]);
    const check = await send(app, buf, false);
    expect(check.body).toMatchObject({
      committed: false,
      ready: 3,
      skipped: 0,
    });
    expect(charges).toHaveLength(0);
    const done = await send(app, buf, true);
    expect(done.body).toMatchObject({ committed: true, created: 3 });
    expect(charges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          studentId: "id1",
          head: "old_fees",
          period: "opening",
          amountPaise: 300000,
        }),
        expect.objectContaining({
          studentId: "id1",
          head: "transport_old",
          amountPaise: 150050,
        }),
        expect.objectContaining({
          studentId: "id2",
          head: "transport_old",
          amountPaise: 70000,
        }),
      ]),
    );
    expect(audit.some((e) => e.entity === "old_dues_import")).toBe(true);
  });

  it("importing the same file twice adds nothing the second time", async () => {
    const { app, charges } = build();
    const buf = await file([["1", 3000, null]]);
    await send(app, buf, true);
    const second = await send(app, buf, true);
    expect(second.body.created).toBe(0);
    expect(second.body.errors[0].message).toMatch(/already imported/);
    expect(charges).toHaveLength(1);
  });

  it("lists bad rows: unknown student, bad amount, repeated SCH., nothing to import", async () => {
    const { app } = build();
    const r = await send(
      app,
      await file([
        ["99", 100, null],
        ["1", "abc", null],
        ["2", 0, null],
        ["2", 50, null],
        ["2", 60, null],
      ]),
      false,
    );
    const messages = r.body.errors.map((e) => e.message).join(" | ");
    expect(messages).toMatch(/not found/);
    expect(messages).toMatch(/not a valid amount/);
    expect(messages).toMatch(/empty or zero/);
    expect(messages).toMatch(/repeated/);
  });
});
