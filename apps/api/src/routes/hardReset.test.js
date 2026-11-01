import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../config/env.js";
import { HARD_RESET_PLAN, sameKey, sameSecret } from "../services/hardReset.js";
import { createLogger } from "../utils/logger.js";

const T = "tvsm";
const base = {
  MONGODB_URI: "mongodb://unused",
  NODE_ENV: "test",
  DEFAULT_TENANT_ID: T,
};
const mk = (id, role) => ({
  _id: id,
  firebaseUid: id,
  email: `${id}@x.com`,
  name: id,
  role,
  tenantId: T,
  isActive: true,
});
const users = {
  admin: mk("admin", "admin"),
  principal: mk("principal", "principal"),
  cashier: mk("cashier", "cashier"),
};
const as = (t) => ({ Authorization: `Bearer ${t}` });
const CFG = {
  enabled: true,
  key: "Key-123",
  question: "First school?",
  answer: "Nepanagar Public",
  webApiKey: "web",
};
const good = {
  password: "pw",
  key: "Key-123",
  answer: " nepanagar   PUBLIC ",
  reason: "Go live clean",
  phrase: "ERASE ALL DATA",
};

let audit;
let backupAt;
let passwordOk;
let wiped;
let app;
const build = (hardReset = CFG) => {
  app = createApp(loadEnv(base), createLogger("silent"), {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: T }),
    userStore: {
      findByFirebaseUid: async (_t, uid) => users[uid],
      touchLogin: async () => {},
    },
    auditStore: {
      append: async (e) => audit.push(e),
      list: async () => ({
        rows: backupAt ? [{ at: backupAt }] : [],
        total: 0,
      }),
    },
    hardReset,
    hardResetLimit: 100, // production allows 5 tries an hour
    verifyPassword: async () => passwordOk,
    runWipe: async (_t, opts) => {
      wiped.push(opts);
      return { removed: { Student: 3 }, reset: [] };
    },
  });
};
const go = (who, over = {}) =>
  request(app)
    .post("/api/system/hard-reset")
    .set(as(who))
    .send({ ...good, ...over });
beforeEach(() => {
  audit = [];
  backupAt = new Date();
  passwordOk = true;
  wiped = [];
  build();
});

describe("hard reset", () => {
  it("is off by default: status says so and the erase is refused", async () => {
    build({ enabled: false });
    expect(
      (await request(app).get("/api/system/hard-reset/status").set(as("admin")))
        .body,
    ).toEqual({ enabled: false });
    const r = await go("admin");
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("HARD_RESET_DISABLED");
    expect(wiped).toHaveLength(0);
  });
  it("Admin only", async () => {
    for (const who of ["principal", "cashier"]) {
      expect((await go(who)).status).toBe(403);
      expect(
        (await request(app).get("/api/system/hard-reset/status").set(as(who)))
          .status,
      ).toBe(403);
    }
    expect(wiped).toHaveLength(0);
  });
  it("status shows the question (never the answer) and whether a fresh backup exists", async () => {
    const s = (
      await request(app).get("/api/system/hard-reset/status").set(as("admin"))
    ).body;
    expect(s).toMatchObject({
      enabled: true,
      question: "First school?",
      backupFresh: true,
    });
    expect(JSON.stringify(s)).not.toContain("Nepanagar");
    backupAt = new Date(Date.now() - 20 * 60_000);
    expect(
      (await request(app).get("/api/system/hard-reset/status").set(as("admin")))
        .body.backupFresh,
    ).toBe(false);
  });
  it("every lock must pass: phrase, key, answer, password, fresh backup", async () => {
    expect(
      (await go("admin", { phrase: "erase all data" })).body.error.code,
    ).toBe("PHRASE_WRONG");
    expect((await go("admin", { key: "key-123" })).body.error.code).toBe(
      "RESET_REFUSED",
    );
    expect((await go("admin", { answer: "other" })).body.error.code).toBe(
      "RESET_REFUSED",
    );
    passwordOk = false;
    expect((await go("admin")).body.error.code).toBe("RESET_REFUSED");
    passwordOk = true;
    backupAt = null;
    expect((await go("admin")).body.error.code).toBe("BACKUP_REQUIRED");
    expect((await go("admin", { reason: "no" })).status).toBe(400);
    expect(wiped).toHaveLength(0);
    // wrong key / answer / password attempts are written to the audit log
    expect(audit.filter((a) => a.entity === "hard_reset").length).toBe(3);
  });
  it("with everything right: audit first, then erase; the audit log itself is kept", async () => {
    const r = await go("admin");
    expect(r.status).toBe(200);
    expect(r.body.removed).toEqual({ Student: 3 });
    expect(
      audit.find((a) => a.entity === "hard_reset" && a.action === "delete")
        .reason,
    ).toBe("Go live clean");
    expect(wiped).toHaveLength(1);
    expect(wiped[0].plan).toBe(HARD_RESET_PLAN);
    const audited = wiped[0].plan.find((p) => p.name === "AuditLog");
    expect(audited.action).toBe("keep");
    expect(wiped[0].plan.find((p) => p.name === "User").action).toBe("keep");
    expect(wiped[0].plan.find((p) => p.name === "Receipt").action).toBe("wipe");
  });
});

describe("secret comparison and settings", () => {
  it("the answer ignores case and extra spaces; the key does not", () => {
    expect(sameSecret("  Nepanagar   public ", "nepanagar public")).toBe(true);
    expect(sameSecret("nepanagar", "nepanagar public")).toBe(false);
    expect(sameKey("Abc", "abc")).toBe(false);
    expect(sameKey("Abc", "Abc")).toBe(true);
  });
  it("the server refuses to start with hard reset on but a lock missing", () => {
    expect(() =>
      loadEnv({ ...base, HARD_RESET_ENABLED: "yes", HARD_RESET_KEY: "k" }),
    ).toThrow(/HARD_RESET_QUESTION/);
    expect(() =>
      loadEnv({
        ...base,
        HARD_RESET_ENABLED: "yes",
        HARD_RESET_KEY: "k",
        HARD_RESET_QUESTION: "q",
        HARD_RESET_ANSWER: "a",
        FIREBASE_WEB_API_KEY: "w",
      }),
    ).not.toThrow();
    expect(loadEnv(base).HARD_RESET_ENABLED).toBe("no");
  });
});
