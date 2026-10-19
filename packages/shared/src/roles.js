import { z } from 'zod';
/** One role per account (confirmed). Separate accounts for separate roles. */
export const ROLES = ['admin', 'principal', 'cashier'];
export const roleSchema = z.enum(ROLES);
/**
 * Role-based navigation matches the Figma sidebars:
 *  Cashier:   Dashboard, Collect Fee, Receipts, Students, Expenses, Petty Cash
 *  Principal: Dashboard, Approvals, Reports, Students, Bank & Cash, Audit Log
 *  Admin:     Dashboard, Students, Fee Structure, Fees & Receipts, Fees Database, Expenses,
 *             Petty Cash, Bank & Cash, Reports, TC & Bonafide, Data Import, Users & Settings, Audit Log
 * Server-side RBAC (Step 2) is the real enforcement; this only drives the UI.
 */
export const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', path: '/', roles: ROLES, availableFromStep: 1 },
  {
    key: 'collect-fee',
    label: 'Collect Fee',
    path: '/collect-fee',
    roles: ['cashier'],
    availableFromStep: 4,
  },
  {
    key: 'receipts',
    label: 'Receipts',
    path: '/receipts',
    roles: ['cashier'],
    availableFromStep: 5,
  },
  {
    key: 'approvals',
    label: 'Approvals',
    path: '/approvals',
    roles: ['principal'],
    availableFromStep: 8,
  },
  { key: 'students', label: 'Students', path: '/students', roles: ROLES, availableFromStep: 3 },
  {
    key: 'fee-structure',
    label: 'Fee Structure',
    path: '/fee-structure',
    // Cashier and Principal can only LOOK at the chart; only Admin can change it.
    roles: ['admin', 'principal', 'cashier'],
    availableFromStep: 3,
  },
  {
    key: 'fees-receipts',
    label: 'Fees & Receipts',
    path: '/fees-receipts',
    roles: ['admin'],
    availableFromStep: 5,
  },
  {
    key: 'fees-database',
    label: 'Fees Database',
    path: '/fees-database',
    roles: ['admin', 'principal'],
    availableFromStep: 10,
  },
  {
    key: 'expenses',
    label: 'Expenses',
    path: '/expenses',
    roles: ['admin', 'cashier'],
    availableFromStep: 6,
  },
  {
    key: 'petty-cash',
    label: 'Petty Cash',
    path: '/petty-cash',
    roles: ['admin', 'cashier'],
    availableFromStep: 6,
  },
  {
    key: 'day-close',
    label: 'Day Close',
    path: '/day-close',
    roles: ['admin', 'principal', 'cashier'],
    availableFromStep: 7,
  },
  {
    key: 'bank-cash',
    label: 'Bank & Cash',
    path: '/bank-cash',
    roles: ['admin', 'principal'],
    availableFromStep: 9,
  },
  {
    key: 'reports',
    label: 'Reports',
    path: '/reports',
    roles: ['admin', 'principal'],
    availableFromStep: 12,
  },
  {
    key: 'tc-bonafide',
    label: 'TC & Bonafide',
    path: '/tc-bonafide',
    roles: ['admin'],
    availableFromStep: 11,
  },
  {
    key: 'data-import',
    label: 'Data Import',
    path: '/data-import',
    roles: ['admin'],
    availableFromStep: 3,
  },
  {
    key: 'users-settings',
    label: 'Users & Settings',
    path: '/users-settings',
    roles: ['admin'],
    availableFromStep: 9,
  },
  {
    key: 'audit-log',
    label: 'Audit Log',
    path: '/audit-log',
    roles: ['admin', 'principal'],
    availableFromStep: 12,
  },
];
export function navForRole(role) {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
