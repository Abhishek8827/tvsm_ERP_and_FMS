import { z } from "zod";
/** One role per account (confirmed). Separate accounts for separate roles. */
export const ROLES = ["admin", "principal", "cashier"];
export const roleSchema = z.enum(ROLES);
/**
 * Role-based navigation matches the Figma sidebars:
 *  Cashier:   Dashboard, Collect Fee, Receipts, Students, Day Close (no Petty Cash, no Bank & Cash)
 *  Principal: Dashboard, Approvals, Rebates (view), Reports, Students, Expenses, Petty Cash, Bank & Cash, Audit Log
 *  Admin:     Dashboard, Students, Fee Structure, Fees & Receipts, Fees Database, Rebates, Expenses,
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
    label: "Collect Fee",
    path: "/collect-fee",
    roles: ["cashier", "admin"],
    availableFromStep: 4,
  },
  {
    key: "receipts",
    label: "Receipts",
    path: "/receipts",
    roles: ["cashier"],
    availableFromStep: 5,
  },
  {
    key: "approvals",
    label: "Approvals",
    path: "/approvals",
    roles: ["principal"],
    availableFromStep: 8,
  },
  {
    key: "students",
    label: "Students",
    path: "/students",
    roles: ROLES,
    availableFromStep: 3,
  },
  {
    key: "fee-structure",
    label: "Fee Structure",
    path: "/fee-structure",
    // Cashier and Principal can only LOOK at the chart; only Admin can change it.
    roles: ["admin", "principal", "cashier"],
    availableFromStep: 3,
  },
  {
    key: "fees-receipts",
    label: "Fees & Receipts",
    path: "/fees-receipts",
    roles: ["admin"],
    availableFromStep: 5,
  },
  {
    key: "fees-database",
    label: "Fees Database",
    path: "/fees-database",
    // Everyone can LOOK; the Cashier sees it read-only (no export, no changes).
    roles: ["admin", "principal", "cashier"],
    availableFromStep: 6,
  },
  {
    key: "rebates",
    label: "Rebates",
    path: "/rebates",
    // Admin gives, imports and reverses; the Principal can look and export. Not for the Cashier.
    roles: ["admin", "principal"],
    availableFromStep: 8,
  },
  {
    key: "transport",
    label: "Transport",
    path: "/transport",
    // Everyone can look (the Cashier needs it at the counter); only the Admin changes it.
    roles: ROLES,
    availableFromStep: 8,
  },
  {
    key: "cashbook",
    label: "Cashbook",
    path: "/cashbook",
    // The school's daily notebook as a report. Everyone can look; only the Admin edits settings.
    roles: ROLES,
    availableFromStep: 8,
  },
  {
    key: "expenses",
    label: "Expenses",
    path: "/expenses",
    // Admin makes vouchers; the Principal approves and views. The Cashier has no expense screen.
    roles: ["admin", "principal"],
    availableFromStep: 6,
  },
  {
    key: "petty-cash",
    label: "Petty Cash",
    path: "/petty-cash",
    // The Cashier has no petty cash screen (removed 2026-10-29).
    roles: ["admin", "principal"],
    availableFromStep: 6,
  },
  {
    key: "day-close",
    label: "Day Close",
    path: "/day-close",
    roles: ["admin", "principal", "cashier"],
    availableFromStep: 7,
  },
  {
    key: "bank-cash",
    label: "Bank & Cash",
    path: "/bank-cash",
    // The Cashier has no Bank & Cash screen and no PIN (removed 2026-10-29).
    roles: ["admin", "principal"],
    availableFromStep: 6,
  },
  {
    key: "reports",
    label: "Reports",
    path: "/reports",
    roles: ["admin", "principal"],
    availableFromStep: 12,
  },
  {
    key: "tc-bonafide",
    label: "TC & Bonafide",
    path: "/tc-bonafide",
    roles: ["admin", "principal", "cashier"], // Principal and Cashier can only look
    availableFromStep: 8,
  },
  {
    key: "data-import",
    label: "Data Import",
    path: "/data-import",
    roles: ["admin"],
    availableFromStep: 3,
  },
  {
    key: "users-settings",
    label: "Users & Settings",
    path: "/users-settings",
    roles: ["admin"],
    availableFromStep: 6,
  },
  {
    key: "audit-log",
    label: "Audit Log",
    path: "/audit-log",
    roles: ["admin", "principal"],
    availableFromStep: 12,
  },
];
export function navForRole(role) {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
