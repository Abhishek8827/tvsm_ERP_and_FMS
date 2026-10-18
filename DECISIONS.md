# DECISIONS

Every business rule answered by the school, and every "you decide" choice, with the reason.
Any later change is appended with its date. Nothing here was invented by the developer unless marked **[dev decision]**.

## 2026-10-18 - Step 0/1 answers

### Process

- Build order: original 13 steps (Cashier 4-7, Principal 8, Admin 9-12, hardening 13). Approval APIs and tests are built in Steps 5-7; the Principal UI in Step 8.
- Attendance and academic management: **Step 14, after financial go-live**, with its own Step 0 questions.
- Develop and test 100% on localhost first; deploy only after approval.
- Every major step: report, then wait for "continue".

### Roles

- 1 Admin, 1 Principal, 1 real Cashier (2 cashier accounts exist only for faster data entry). One role per account.
- Principal is the only approver; no delegate.
- Desktop and mobile both required (Principal approves from phone).

### Fees (from the school's fee chart)

- Monthly class fees: Play Group/Nursery 700; LKG/UKG 770; 1st-3rd 1000; 4th-5th 1200; 6th-8th 1500; 9th-11th 1800. Yearly = monthly x 10.
- Bus fee by village (23 villages listed; more to be added later).
- Admission fee by class and a Form fee of 100 for all classes (chart supplied).
- Billing: **10 months, June to March**. Transport follows the same schedule (assumed - confirm).
- Late fee: Rs 100 per month, 10-day grace, applies to tuition and transport. Overdue carries forward and is shown as a separate line.
- Partial payments allowed, allocated oldest instalment first. Cashier cannot skip older dues; only Admin can, with a reason.
- Concessions: no Principal approval. Cashier limit to be set (**open**). Sibling link set by Admin.
- Cheques accepted (Admin marks cleared/bounced). Refunds and bank payments: Admin only.

### Documents and numbering

- Receipt series continues: last used number 2053; resets each April; format `FY2026-27/0001`-style (**exact format to confirm**).
- Half-A4 receipt, two copies (office/student). Optional note-in/note-out fields at collection.
- TC: Day-one build uses the supplied TC print frame; school will change it later.

### Day Close, expenses, petty cash

- Day Close is school-wide. Cashier counts, Admin verifies, only Admin reopens with a reason.
- Expenses entered and paid by Admin, approved by Principal (threshold **open**).
- Petty cash float Rs 10,000; voucher approval and replenishment approval both needed.

### Messaging

- WhatsApp: free "Share on WhatsApp" button (wa.me link + downloaded PDF) for now. Cloud API later behind a provider interface. Staff approval alerts are in-app only until then.
- No unofficial WhatsApp automation tools.

### Data

- Student data and history in Excel; downloadable import templates will be provided.
- Demo opening balances are for development only; production blocked until real, accountant-reviewed balances exist.

## 2026-10-18 - Developer decisions (Step 1)

- **[dev decision]** Monorepo: `apps/api`, `apps/web`, `packages/shared`, pnpm workspaces.
- **[dev decision]** Local MongoDB as a single-node replica set via docker-compose (transactions required).
- **[dev decision]** `@erp/shared` ships TypeScript source; API bundles it with tsup, web via Vite.
- **[dev decision]** Tenant plugin also blocks tenantId changes in updates and requires a concrete string (not `$ne`/`$exists`).
- **[dev decision]** Step 1 sign-in is a development-only role picker, replaced by Firebase login in Step 2.
- **[dev decision]** Vite 5 (not 6) to match the vitest 2 toolchain.

## 2026-10-18 - Step 2 decisions

- Language: **plain JavaScript (JSX)**, not TypeScript - the owner is new to TypeScript. MERN otherwise unchanged. Zod validation kept.
- Always use the latest dependency versions (Express 5, Mongoose 9, React 19, Vite 8, Tailwind 4, Zod 4).
- Database: MongoDB Atlas directly (no Docker). Code goes to GitHub; owner pulls and runs locally.
- Idle logout after **10 minutes** of inactivity (shared counter PCs).
- 4 accounts: 1 Admin, 1 Principal, 2 Cashier (same person, two accounts for faster entry). Each has one role.
- **[dev decision]** The database role is the source of truth; the Firebase claim must match it or the token is treated as stale (401, client refreshes once).
- **[dev decision]** Verified tokens are cached for 60 s (checkRevoked on) so a disabled account is cut off within a minute without a Firebase round-trip on every request.
- **[dev decision]** Failed passwords are logged by Firebase, not by our server (they never reach it). Successful login, logout and idle logout are audited.
- **[dev decision]** Passwords for seed accounts come only from environment variables, never from code or chat.

## Open items (blocking later steps)

See the Step 1 report for the list with the step each one blocks.
