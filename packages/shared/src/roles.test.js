import { describe, expect, it } from "vitest";
import { navForRole, navLayoutForRole } from "./roles.js";
describe("navForRole", () => {
  it("cashier never sees admin-only screens (the fee chart is view-only for cashier)", () => {
    const keys = navForRole("cashier").map((n) => n.key);
    expect(keys).toContain("collect-fee");
    expect(keys).toContain("fee-structure");
    for (const forbidden of [
      "data-import",
      "users-settings",
      "audit-log",
      "approvals",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
  it("principal is read-only: no approvals inbox and no data-entry screens", () => {
    const keys = navForRole("principal").map((n) => n.key);
    expect(keys).not.toContain("approvals");
    expect(keys).toContain("fee-structure"); // view only
    for (const forbidden of ["collect-fee", "data-import", "users-settings"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
  it("Admin can collect fees too, like the Cashier", () => {
    expect(navForRole("admin").map((n) => n.key)).toContain("collect-fee");
  });
  it("everyone can open TC & Bonafide (only the Admin can make them)", () => {
    for (const r of ["admin", "principal", "cashier"])
      expect(navForRole(r).map((n) => n.key)).toContain("tc-bonafide");
  });
  it("the Admin has the approvals inbox (Cashier cancellation requests)", () => {
    expect(navForRole("admin").map((n) => n.key)).toContain("approvals");
  });
});

describe("navLayoutForRole", () => {
  it("Dashboard first, categories in a fixed order, every link appears exactly once", () => {
    for (const r of ["admin", "principal", "cashier"]) {
      const layout = navLayoutForRole(r);
      expect(layout[0].item.key).toBe("dashboard");
      const keys = layout.flatMap((e) =>
        e.type === "link" ? [e.item.key] : e.items.map((i) => i.key),
      );
      expect(keys.sort()).toEqual(
        navForRole(r)
          .map((n) => n.key)
          .sort(),
      );
    }
  });
  it("a category with one link for that role is a plain link; Admin gets the five categories", () => {
    const cashier = navLayoutForRole("cashier");
    expect(
      cashier.find((e) => e.type === "group" && e.key === "setup"),
    ).toBeUndefined();
    expect(
      cashier.find((e) => e.type === "link" && e.item.key === "fee-structure"),
    ).toBeTruthy();
    const admin = navLayoutForRole("admin")
      .filter((e) => e.type === "group")
      .map((e) => e.key);
    expect(admin).toEqual(["fees", "students", "money", "reports", "setup"]);
  });
});
