import { z } from "zod";
/** One role per account (confirmed). Separate accounts for separate roles. */
export const ROLES = ["admin", "principal", "cashier"];
export const roleSchema = z.enum(ROLES);
/**
 * Role-based navigation matches the Figma sidebars:
 *  Cashier:   Dashboard, Collect Fee, Receipts, Students, Day Close (no Petty Cash, no Bank & Cash)
 *  Principal: read-only (no approvals since 2026-10-31): Dashboard, Rebates (view), Reports, Students, Expenses, Petty Cash, Bank & Cash, Audit Log
 *  Admin:     Dashboard, Approvals (Cashier cancellation requests), Students, Fee Structure, Fees & Receipts, Fees Database, Rebates, Expenses,
 *             Petty Cash, Bank & Cash, Reports, TC & Bonafide, Data Import, Users & Settings, Audit Log
 * Server-side RBAC (Step 2) is the real enforcement; this only drives the UI.
 */
export const NAV_ITEMS = [
  {
    key: "dashboard",
    label: "Dashboard",
    path: "/",
    roles: ROLES,
    availableFromStep: 1,
  },
  {
    key: "collect-fee",
    group: "fees",
    label: "Collect Fee",
    path: "/collect-fee",
    roles: ["cashier", "admin"],
    availableFromStep: 4,
  },
  {
    key: "receipts",
    group: "fees",
    label: "Receipts",
    path: "/receipts",
    roles: ["cashier"],
    availableFromStep: 5,
  },
  {
    key: "approvals",
    label: "Approvals",
    path: "/approvals",
    roles: ["admin"], // Cashier cancellation requests; the Principal is read-only
    availableFromStep: 8,
  },
  {
    key: "students",
    group: "students",
    label: "Students",
    path: "/students",
    roles: ROLES,
    availableFromStep: 3,
  },
  {
    key: "fee-structure",
    group: "setup",
    label: "Fee Structure",
    path: "/fee-structure",
    // Cashier and Principal can only LOOK at the chart; only Admin can change it.
    roles: ["admin", "principal", "cashier"],
    availableFromStep: 3,
  },
  {
    key: "fees-receipts",
    group: "fees",
    label: "Fees & Receipts",
    path: "/fees-receipts",
    roles: ["admin"],
    availableFromStep: 5,
  },
  {
    key: "fees-database",
    group: "fees",
    label: "Fees Database",
    path: "/fees-database",
    // Everyone can LOOK; the Cashier sees it read-only (no export, no changes).
    roles: ["admin", "principal", "cashier"],
    availableFromStep: 6,
  },
  {
    key: "rebates",
    group: "fees",
    label: "Rebates",
    path: "/rebates",
    // Admin gives, imports and reverses; the Principal can look and export. Not for the Cashier.
    roles: ["admin", "principal"],
    availableFromStep: 8,
  },
  {
    key: "transport",
    group: "fees",
    label: "Transport",
    path: "/transport",
    // Everyone can look (the Cashier needs it at the counter); only the Admin changes it.
    roles: ROLES,
    availableFromStep: 8,
  },
  {
    key: "cashbook",
    group: "money",
    label: "Cashbook",
    path: "/cashbook",
    // The school's daily notebook as a report. Everyone can look; only the Admin edits settings.
    roles: ROLES,
    availableFromStep: 8,
  },
  {
    key: "expenses",
    group: "money",
    label: "Expenses",
    path: "/expenses",
    // Admin makes vouchers; the Principal approves and views. The Cashier has no expense screen.
    roles: ["admin", "principal"],
    availableFromStep: 6,
  },
  {
    key: "petty-cash",
    group: "money",
    label: "Petty Cash",
    path: "/petty-cash",
    // The Cashier has no petty cash screen (removed 2026-10-29).
    roles: ["admin", "principal"],
    availableFromStep: 6,
  },
  {
    key: "day-close",
    group: "fees",
    label: "Day Close",
    path: "/day-close",
    roles: ["admin", "principal", "cashier"],
    availableFromStep: 7,
  },
  {
    key: "bank-cash",
    group: "money",
    label: "Bank & Cash",
    path: "/bank-cash",
    // The Cashier has no Bank & Cash screen and no PIN (removed 2026-10-29).
    roles: ["admin", "principal"],
    availableFromStep: 6,
  },
  {
    key: "reports",
    group: "reports",
    label: "Reports",
    path: "/reports",
    roles: ["admin", "principal"],
    availableFromStep: 12,
  },
  {
    key: "tc-bonafide",
    group: "students",
    label: "TC & Bonafide",
    path: "/tc-bonafide",
    roles: ["admin", "principal", "cashier"], // Principal and Cashier can only look
    availableFromStep: 8,
  },
  {
    key: "data-import",
    group: "setup",
    label: "Data Import",
    path: "/data-import",
    roles: ["admin"],
    availableFromStep: 3,
  },
  {
    key: "users-settings",
    group: "setup",
    label: "Users & Settings",
    path: "/users-settings",
    roles: ["admin"],
    availableFromStep: 6,
  },
  {
    key: "audit-log",
    group: "reports",
    label: "Audit Log",
    path: "/audit-log",
    roles: ["admin", "principal"],
    availableFromStep: 12,
  },
];
/** Sidebar categories, in the order they appear. Items without a group (Dashboard, Approvals) stand alone. */
export const NAV_GROUPS = [
  { key: "fees", label: "Fees" },
  { key: "students", label: "Students & Certificates" },
  { key: "money", label: "Money" },
  { key: "reports", label: "Reports & Audit" },
  { key: "setup", label: "Setup" },
];

export function navForRole(role) {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

/**
 * The sidebar for one role: standalone links and collapsible categories, in order. A category that
 * would hold only one link for this role is shown as a plain link (a dropdown of one is pointless).
 */
export function navLayoutForRole(role) {
  const items = navForRole(role);
  const out = [];
  for (const item of items.filter((i) => !i.group))
    out.push({ type: "link", item });
  for (const g of NAV_GROUPS) {
    const inGroup = items.filter((i) => i.group === g.key);
    if (inGroup.length === 1) out.push({ type: "link", item: inGroup[0] });
    else if (inGroup.length > 1)
      out.push({ type: "group", key: g.key, label: g.label, items: inGroup });
  }
  return out;
}
