import { describe, expect, it } from "vitest";
import { crumbsFor } from "./Breadcrumbs";

const labels = (path, role = "admin") =>
  crumbsFor(path, role).map((c) => c.label);

describe("breadcrumb trail", () => {
  it("has none on the Dashboard", () => {
    expect(crumbsFor("/", "admin")).toEqual([]);
  });
  it("is Home > category > page, from the same list as the sidebar", () => {
    expect(labels("/cashbook")).toEqual([
      "Home",
      "Accounts & Finance",
      "Cashbook",
    ]);
    expect(labels("/system-settings")).toEqual([
      "Home",
      "Administration & Setup",
      "System Settings",
    ]);
  });
  it("leaves the category out when the role has a single link in it", () => {
    expect(labels("/collect-fee", "cashier")).toEqual([
      "Home",
      "Fee Management",
      "Collect Fee",
    ]);
    expect(labels("/reports", "principal")).toEqual([
      "Home",
      "Reports & Audit",
      "Reports & Analytics",
    ]);
  });
  it("only the open page and categories are plain text; the rest link back", () => {
    const c = crumbsFor("/fees-database/students/x1", "admin");
    expect(c.map((x) => x.to)).toEqual([
      "/",
      undefined,
      "/fees-database",
      undefined,
    ]);
    expect(c.at(-1).label).toBe("Student Fee Details");
  });
  it("knows the sub pages", () => {
    expect(labels("/students/new")).toEqual([
      "Home",
      "Student Management",
      "Student Directory",
      "Add student",
    ]);
    expect(labels("/students/s1/edit").slice(-2)).toEqual([
      "Student profile",
      "Edit",
    ]);
    expect(labels("/receipts/r1", "cashier").slice(-2)).toEqual([
      "Receipts",
      "Receipt",
    ]);
    expect(labels("/receipts/r1", "admin").slice(-2)).toEqual([
      "Fees & Receipts",
      "Receipt",
    ]);
    expect(labels("/data-import/old-fees").slice(-1)).toEqual([
      "Import old fees",
    ]);
  });
});
