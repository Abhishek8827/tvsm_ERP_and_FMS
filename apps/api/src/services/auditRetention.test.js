import { describe, expect, it } from "vitest";
import {
  cutoffFor,
  pruneRoutineAudit,
  ROUTINE_ACTIONS,
} from "./auditRetention.js";

const now = new Date("2026-11-20T10:00:00Z");

describe("audit retention", () => {
  it("cutoff is exactly 14 days back", () => {
    expect(cutoffFor(now).toISOString()).toBe("2026-11-06T10:00:00.000Z");
  });

  it("deletes only the routine actions older than the cutoff, for this school only", async () => {
    let filter;
    const added = [];
    const out = await pruneRoutineAudit({
      tenantId: "tvsm",
      now,
      collection: {
        deleteMany: async (f) => {
          filter = f;
          return { deletedCount: 7 };
        },
      },
      append: async (e) => added.push(e),
    });
    expect(out.removed).toBe(7);
    expect(filter.tenantId).toBe("tvsm");
    expect(filter.action.$in).toEqual([
      "login",
      "logout",
      "idle_logout",
      "export",
    ]);
    for (const kept of [
      "create",
      "update",
      "cancel",
      "approve",
      "issue",
      "delete",
      "login_blocked",
    ])
      expect(ROUTINE_ACTIONS).not.toContain(kept);
    expect(filter.at.$lt.toISOString()).toBe("2026-11-06T10:00:00.000Z");
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      action: "delete",
      entity: "audit_housekeeping",
    });
    expect(added[0].newValue.removed).toBe(7);
  });

  it("writes no summary when nothing was removed", async () => {
    const added = [];
    await pruneRoutineAudit({
      tenantId: "tvsm",
      now,
      collection: { deleteMany: async () => ({ deletedCount: 0 }) },
      append: async (e) => added.push(e),
    });
    expect(added).toHaveLength(0);
  });
});
