import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditLog } from "../models/AuditLog.js";
import { Charge } from "../models/Charge.js";
import { ExpensePayment } from "../models/ExpensePayment.js";
import { ExpenseVoucher } from "../models/ExpenseVoucher.js";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { PettyEntry } from "../models/PettyEntry.js";
import { Receipt } from "../models/Receipt.js";
import { ReceiptCancellation } from "../models/ReceiptCancellation.js";
import { makeReportsStore } from "./reportsStore.js";
import { makeAuditStore } from "./stores.js";

/**
 * Real-database test of the report queries (income, expenses, balances, receivable, payables,
 * Day Book) and of the audit-log listing. Skipped, loudly, where no mongod can be downloaded.
 */
let repl;
try {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
} catch (err) {
  console.warn(
    "[reportsStore.db.test] no mongod available, DB tests skipped:",
    err.message,
  );
}
const haveDb = repl !== undefined;
const store = makeReportsStore();
const audits = makeAuditStore();
const T = "tvsm";
const sid = new mongoose.Types.ObjectId();
const oid = () => new mongoose.Types.ObjectId();

beforeAll(async () => {
  if (!repl) return;
  await mongoose.connect(repl.getUri(), { dbName: "test" });
}, 120_000);
afterAll(async () => {
  if (!repl) return;
  await mongoose.disconnect();
  await repl.stop();
});

let n = 0;
const receipt = (o) => {
  n += 1;
  return {
    tenantId: T, kind: 'school', fy: '2026-27', seq: n, number: `S-${n}`, studentId: sid,
    student: { admissionNo: '7', name: 'Asha' }, dueAfterPaise: 0, mode: 'cash', cashierId: 'c1',
    idempotencyKey: `k${n}`, issuedAt: new Date('2026-10-05T06:00:00Z'), ...o,
  };
}; // prettier-ignore

describe.skipIf(!haveDb)("reports on a real database", () => {
  it("income = receipt lines by head + late fee; a cancelled receipt never counts", async () => {
    const a = await Receipt.create(
      receipt({
        lines: [
          { head: "tuition", amountPaise: 100000 },
          { head: "transport", amountPaise: 20000 },
        ],
        lateFee: { chargedPaise: 5000 },
        totalPaise: 125000,
      }),
    );
    const b = await Receipt.create(
      receipt({
        lines: [{ head: "tuition", amountPaise: 70000 }],
        totalPaise: 70000,
      }),
    );
    await ReceiptCancellation.create({
      tenantId: T,
      receiptId: b._id,
      studentId: sid,
      receiptNumber: b.number,
      status: "cancelled",
      reason: "wrong",
    });
    const inc = await store.income(T, "2026-10-01", "2026-10-31");
    expect(inc.byHead).toEqual({ tuition: 100000, transport: 20000 });
    expect(inc.latePaise).toBe(5000);
    const none = await store.income(T, "2026-11-01", "2026-11-30");
    expect(none.byHead).toEqual({});
    expect(a.number).toBeTruthy();
  });

  it("expenses = vouchers paid (net of reversals) + petty cash, by head", async () => {
    const pay = await ExpensePayment.create({
      tenantId: T,
      fy: "2026-27",
      seq: 1,
      voucherId: oid(),
      voucherNumber: "EXP/1",
      date: "2026-10-06",
      headName: "Salaries",
      payeeName: "Staff",
      mode: "cash",
      amountPaise: 300000,
      authorisedBy: "President",
      idempotencyKey: "p1",
      createdBy: "a",
    });
    await LedgerEntry.create([
      {
        tenantId: T,
        account: "cash",
        amountPaise: -300000,
        type: "expense_payment",
        refId: String(pay._id),
        entryDate: "2026-10-06",
      },
      {
        tenantId: T,
        account: "cash",
        amountPaise: 50000,
        type: "payment_reversal",
        refId: String(pay._id),
        entryDate: "2026-10-07",
      },
    ]);
    await PettyEntry.create({
      tenantId: T,
      fy: "2026-27",
      seq: 1,
      date: "2026-10-08",
      headName: "Stationery",
      payeeName: "Shop",
      particulars: "pens",
      amountPaise: 12000,
      idempotencyKey: "pe1",
      createdBy: "a",
    });
    const rows = await store.expenses(T, "2026-10-01", "2026-10-31");
    const by = Object.fromEntries(rows.map((r) => [r.head, r.paise]));
    expect(by).toEqual({ Salaries: 250000, Stationery: 12000 });
  });

  it("balances include cash receipts, opening entries and online receipts per bank", async () => {
    await LedgerEntry.create({
      tenantId: T,
      account: "cash",
      amountPaise: 1000000,
      type: "opening",
      entryDate: "2026-04-01",
    });
    await Receipt.create(
      receipt({
        lines: [{ head: "tuition", amountPaise: 40000 }],
        totalPaise: 40000,
        mode: "upi",
        bankId: "b1",
      }),
    );
    const bal = await store.balances(T, "2026-10-31");
    // 1,000,000 opening - 300,000 + 50,000 reversal + 125,000 cash receipt (the cancelled one is out)
    expect(bal.cash).toBe(875000);
    expect(bal["bank:b1"]).toBe(40000);
  });

  it("receivable = charges due - paid - rebates; payables = approved - paid", async () => {
    const c1 = await Charge.create({
      tenantId: T,
      studentId: sid,
      fy: "2026-27",
      head: "tuition",
      period: "2026-10",
      dueDate: "2026-10-15",
      amountPaise: 200000,
    });
    await Charge.create({
      tenantId: T,
      studentId: sid,
      fy: "2026-27",
      head: "tuition",
      period: "2026-12",
      dueDate: "2026-12-15",
      amountPaise: 999999,
    });
    await Receipt.create(
      receipt({
        lines: [{ head: "tuition", chargeId: c1._id, amountPaise: 60000 }],
        totalPaise: 60000,
      }),
    );
    expect(await store.receivable(T, "2026-10-31")).toBe(140000);
    await ExpenseVoucher.create({
      tenantId: T,
      fy: "2026-27",
      seq: 1,
      number: "V/1",
      date: "2026-10-02",
      headId: oid(),
      headName: "Repairs",
      payeeName: "X",
      particulars: "p",
      amountPaise: 90000,
      status: "approved",
      idempotencyKey: "v1",
      createdBy: "a",
    });
    expect(await store.payables(T, "2026-10-31")).toBe(90000);
  });

  it("Day Book lists receipts and ledger movements, with a name for the expense", async () => {
    const rows = await store.dayBookEntries(T, "2026-10-01", "2026-10-31", [
      { _id: "b1", name: "HDFC" },
    ]);
    expect(rows.some((r) => r.type === "Fee receipt")).toBe(true);
    expect(
      rows.some(
        (r) => r.type === "Expense paid" && r.particulars.includes("Salaries"),
      ),
    ).toBe(true);
    expect(rows.find((r) => r.type === "Expense paid").outPaise).toBe(300000);
  });

  it("settings keep a history; the audit log lists newest first, filters, and names the user", async () => {
    await store.saveSettings({
      tenantId: T,
      fixedAssetsPaise: 1,
      capitalPaise: 2,
      reason: "first",
      user: { name: "Admin" },
    });
    const s = await store.saveSettings({
      tenantId: T,
      fixedAssetsPaise: 3,
      capitalPaise: 4,
      reason: "second",
      user: { name: "Admin" },
    });
    expect(s.history).toHaveLength(2);
    await AuditLog.create([
      {
        tenantId: T,
        at: new Date("2026-10-01T05:00:00Z"),
        action: "create",
        entity: "receipt",
        entityId: "S-1",
        userId: "nobody",
      },
      {
        tenantId: T,
        at: new Date("2026-10-02T05:00:00Z"),
        action: "override",
        entity: "late_fee",
        reason: "Bank delay",
      },
    ]);
    const all = await audits.list({ tenantId: T, page: 1, pageSize: 50 });
    expect(all.rows[0].action).toBe("override");
    const f = await audits.list({
      tenantId: T,
      filters: { action: "create", from: "2026-10-01", to: "2026-10-01" },
      page: 1,
      pageSize: 50,
    });
    expect(f.total).toBe(1);
    const q = await audits.list({
      tenantId: T,
      filters: { q: "bank" },
      page: 1,
      pageSize: 50,
    });
    expect(q.total).toBe(1);
    expect((await audits.options(T)).entities).toEqual(["late_fee", "receipt"]);
  });
});
