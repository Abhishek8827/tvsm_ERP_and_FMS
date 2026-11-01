import { describe, expect, it, vi } from "vitest";
import { runDayAutoLock } from "./dayAutoLock.js";

describe("day auto-lock", () => {
  it("locks past days through the store and writes one audit entry per day", async () => {
    const audit = [];
    const deps = {
      dayCloseStore: {
        autoLockPastDays: vi.fn(async () => [
          { date: "2026-10-30", expectedCashPaise: 5000, receiptCount: 2 },
          { date: "2026-10-31", expectedCashPaise: 0, receiptCount: 1 },
        ]),
      },
      auditStore: { append: async (e) => audit.push(e) },
    };
    const out = await runDayAutoLock({
      deps,
      tenantId: "tvsm",
      today: "2026-11-01",
      logger: { info() {} },
    });
    expect(deps.dayCloseStore.autoLockPastDays).toHaveBeenCalledWith({
      tenantId: "tvsm",
      today: "2026-11-01",
    });
    expect(out).toHaveLength(2);
    expect(audit.map((a) => a.entityId)).toEqual(["2026-10-30", "2026-10-31"]);
    expect(audit[0]).toMatchObject({ entity: "day_close", userRole: "system" });
  });
  it("does nothing when no day needs locking", async () => {
    const audit = [];
    const out = await runDayAutoLock({
      deps: {
        dayCloseStore: { autoLockPastDays: async () => [] },
        auditStore: { append: async (e) => audit.push(e) },
      },
      tenantId: "tvsm",
      today: "2026-11-01",
      logger: { info() {} },
    });
    expect(out).toEqual([]);
    expect(audit).toEqual([]);
  });
});
