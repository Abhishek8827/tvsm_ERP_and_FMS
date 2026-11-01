import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../config/env.js";
import { BackupFileError } from "../services/backup.js";
import { createLogger } from "../utils/logger.js";

const T = "tvsm";
const env = loadEnv({
  MONGODB_URI: "mongodb://unused",
  NODE_ENV: "test",
  DEFAULT_TENANT_ID: T,
});
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

let audit;
let lastAt;
let svc;
let app;
beforeEach(() => {
  audit = [];
  lastAt = null;
  svc = {
    buildBackup: vi.fn(async () => ({
      format: "tvsm-erp-backup",
      counts: { Receipt: 2 },
      collections: {},
    })),
    parseBackup: vi.fn((buf) => {
      if (buf.toString() === "bad")
        throw new BackupFileError("This is not a TVSM ERP backup file.");
      return { ok: true };
    }),
    restoreBackup: vi.fn(async () => ({
      collections: {},
      totals: { inFile: 3, added: 1, skipped: 2 },
      unknown: [],
    })),
  };
  app = createApp(env, createLogger("silent"), {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: T }),
    userStore: {
      findByFirebaseUid: async (_t, uid) => users[uid],
      touchLogin: async () => {},
    },
    auditStore: {
      append: async (e) => audit.push(e),
      list: async () => ({
        rows: lastAt ? [{ at: lastAt }] : [],
        total: lastAt ? 1 : 0,
      }),
    },
    backupService: svc,
  });
});
const send = (who, body, confirm = "RESTORE BACKUP") =>
  request(app)
    .post(`/api/backup/restore?confirm=${encodeURIComponent(confirm)}`)
    .set(as(who))
    .set("Content-Type", "application/octet-stream")
    .send(body);

describe("Backup & Restore API", () => {
  it("is for the Admin only, on every route", async () => {
    for (const who of ["principal", "cashier"]) {
      expect(
        (await request(app).get("/api/backup/status").set(as(who))).status,
      ).toBe(403);
      expect(
        (await request(app).get("/api/backup/download").set(as(who))).status,
      ).toBe(403);
      expect((await send(who, Buffer.from("x"))).status).toBe(403);
    }
    expect(svc.buildBackup).not.toHaveBeenCalled();
  });

  it("status: reminds when there is no backup, or the last one is 7 or more days old", async () => {
    const never = await request(app).get("/api/backup/status").set(as("admin"));
    expect(never.body).toMatchObject({
      lastBackupAt: null,
      daysSince: null,
      reminder: true,
    });
    lastAt = new Date(Date.now() - 3 * 86400_000);
    const fresh = await request(app).get("/api/backup/status").set(as("admin"));
    expect(fresh.body).toMatchObject({ daysSince: 3, reminder: false });
    lastAt = new Date(Date.now() - 8 * 86400_000);
    expect(
      (await request(app).get("/api/backup/status").set(as("admin"))).body
        .reminder,
    ).toBe(true);
  });

  it('download sends a file and leaves a lasting audit entry (not a routine "export")', async () => {
    const res = await request(app).get("/api/backup/download").set(as("admin"));
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(
      /attachment; filename="tvsm-erp-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json"/,
    );
    expect(JSON.parse(res.text).format).toBe("tvsm-erp-backup");
    expect(audit.find((a) => a.entity === "backup")).toMatchObject({
      action: "create",
    });
  });

  it("restore needs the confirm phrase and a file", async () => {
    expect(
      (await send("admin", Buffer.from("{}"), "yes")).body.error.code,
    ).toBe("CONFIRM_REQUIRED");
    expect((await send("admin", Buffer.alloc(0))).body.error.code).toBe(
      "NO_FILE",
    );
    expect(svc.restoreBackup).not.toHaveBeenCalled();
  });

  it("restore adds what is missing, audits it, and refuses a bad file with 422", async () => {
    const ok = await send("admin", Buffer.from('{"a":1}'));
    expect(ok.status).toBe(200);
    expect(ok.body.totals).toEqual({ inFile: 3, added: 1, skipped: 2 });
    expect(
      audit.find((a) => a.entity === "backup_restore").newValue.totals.added,
    ).toBe(1);
    const bad = await send("admin", Buffer.from("bad"));
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("BAD_BACKUP");
  });
});
