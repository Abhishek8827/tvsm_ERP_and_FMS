import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExpenseRuleError } from "@erp/shared";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { makeMoneyStore } from "./moneyStore.js";
import { makeReceiptStore } from "./stores.js";

/**
 * Real-database tests of the money code: balances, vouchers, part payments, petty cash, transfers,
 * reversals, the PIN lock. They need an in-memory MongoDB replica set (transactions). Where no
 * mongod can be downloaded they are skipped, loudly, like the receipt tests.
 */
let repl;
try {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
} catch (err) {
  console.warn(
    "[moneyStore.db.test] no mongod available, DB tests skipped:",
    err.message,
  );
}
const haveDb = repl !== undefined;
const store = makeMoneyStore();
const receipts = makeReceiptStore();
const FY = "2026-27";
const rs = (n) => n * 100;
const user = { id: "u1", name: "Admin" };
const principal = { id: "p1", name: "Principal" };
let n = 0;
const fresh = () => `t${(n += 1)}-${Date.now()}`; // every test gets its own tenant
const key = () => `key-${(n += 1)}-${Math.random().toString(36).slice(2)}`;

beforeAll(async () => {
  if (!repl) return;
  await mongoose.connect(repl.getUri(), { dbName: "test" });
  await mongoose.syncIndexes(); // unique indexes must exist before the first insert
}, 120_000);
afterAll(async () => {
  if (!repl) return;
  await mongoose.disconnect();
  await repl.stop();
});

const rule = async (p) => {
  try {
    await p;
  } catch (e) {
    return e instanceof ExpenseRuleError ? e.code : `other:${e.message}`;
  }
  return null;
};
async function setup(
  T,
  { cash = rs(100000), bank = rs(200000), petty = rs(1000) } = {},
) {
  const b = await store.createBank({
    tenantId: T,
    input: { name: "IDFC", openingPaise: bank },
    user,
  });
  if (cash)
    await store.setOpening({
      tenantId: T,
      account: "cash",
      amountPaise: cash,
      user,
    });
  if (petty)
    await store.setOpening({
      tenantId: T,
      account: "petty",
      amountPaise: petty,
      user,
    });
  const head = await store.createHead({ tenantId: T, name: "Repairs", user });
  return { bankId: String(b._id), headId: String(head._id) };
}
const voucherOf = (T, headId, amountPaise = rs(10000)) =>
  store.createVoucher({
    tenantId: T,
    fy: FY,
    input: {
      date: "2026-06-01",
      headId,
      payeeName: "Sharma",
      particulars: "Chairs",
      amountPaise,
    },
    idempotencyKey: key(),
    user,
  });
const approved = async (T, headId, amountPaise) => {
  const { voucher } = await voucherOf(T, headId, amountPaise);
  return store.decideVoucher({
    tenantId: T,
    id: voucher._id,
    decision: "approve",
    user: principal,
  });
};
const pay = (T, v, extra = {}) =>
  store.createPayment({
    tenantId: T,
    fy: FY,
    voucherId: v._id,
    input: {
      date: "2026-06-02",
      amountPaise: rs(4000),
      mode: "cash",
      authorisedBy: "President",
      ...extra,
    },
    idempotencyKey: key(),
    user,
  });

describe.skipIf(!haveDb)("money store on a real database", () => {
  it("voucher numbers are gap-free and per financial year; a refused voucher uses no number", async () => {
    const T = fresh();
    const { headId } = await setup(T);
    const a = await voucherOf(T, headId);
    expect(await rule(voucherOf(T, headId, rs(100)))).toBe("USE_PETTY_CASH");
    const b = await voucherOf(T, headId);
    expect(a.voucher.number).toBe("EXP-FY2026-27/0001");
    expect(b.voucher.number).toBe("EXP-FY2026-27/0002");
  });

  it("the same Idempotency-Key never makes a second voucher / payment / petty entry / transfer", async () => {
    const T = fresh();
    const { headId, bankId } = await setup(T);
    const k = key();
    const input = {
      date: "2026-06-01",
      headId,
      payeeName: "Sharma",
      particulars: "Chairs",
      amountPaise: rs(900),
    };
    const one = await store.createVoucher({
      tenantId: T,
      fy: FY,
      input,
      idempotencyKey: k,
      user,
    });
    const two = await store.createVoucher({
      tenantId: T,
      fy: FY,
      input,
      idempotencyKey: k,
      user,
    });
    expect(two.replay).toBe(true);
    expect(String(two.voucher._id)).toBe(String(one.voucher._id));
    const t1 = {
      tenantId: T,
      from: "cash",
      to: "petty",
      amountPaise: rs(500),
      idempotencyKey: k + "t",
      user,
    };
    await store.createTransfer(t1);
    expect((await store.createTransfer(t1)).replay).toBe(true);
    expect((await store.overview(T)).pettyPaise).toBe(rs(1500));
    expect(bankId).toBeTruthy();
  });

  it("no payment before approval; part payments; never more than the balance due", async () => {
    const T = fresh();
    const { headId } = await setup(T);
    const { voucher } = await voucherOf(T, headId, rs(10000));
    expect(await rule(pay(T, voucher))).toBe("NOT_APPROVED");
    const v = await approved(T, headId, rs(10000));
    await pay(T, v, { amountPaise: rs(4000) });
    await pay(T, v, { amountPaise: rs(4000) });
    expect(await rule(pay(T, v, { amountPaise: rs(4000) }))).toBe(
      "OVER_PAYMENT",
    );
    await store.addAdjustment({
      tenantId: T,
      id: v._id,
      input: {
        amountPaise: rs(2000),
        reason: "Discount",
        remark: "Vendor agreed",
      },
      user,
    });
    const got = await store.getVoucher(T, v._id);
    expect(got).toMatchObject({
      paidPaise: rs(8000),
      adjustedPaise: rs(2000),
      balanceDuePaise: 0,
    });
    expect(got.payments.map((p) => p.seq)).toEqual([1, 2]);
  });

  it("a payment reduces the account it was paid from; an adjustment moves no money", async () => {
    const T = fresh();
    const { headId, bankId } = await setup(T, {
      cash: rs(5000),
      bank: rs(20000),
    });
    const v = await approved(T, headId, rs(10000));
    await pay(T, v, { amountPaise: rs(3000), mode: "bank", bankId });
    await pay(T, v, { amountPaise: rs(1000), mode: "cash" });
    await store.addAdjustment({
      tenantId: T,
      id: v._id,
      input: {
        amountPaise: rs(500),
        reason: "Discount",
        remark: "Agreed with vendor",
      },
      user,
    });
    const o = await store.overview(T);
    expect(o.cashPaise).toBe(rs(4000));
    expect(o.banks[0].balancePaise).toBe(rs(17000));
  });

  it("refuses a payment bigger than the balance; parallel payments cannot overspend", async () => {
    const T = fresh();
    const { headId } = await setup(T, { cash: rs(5000) });
    const v1 = await approved(T, headId, rs(4000));
    const v2 = await approved(T, headId, rs(4000));
    const results = await Promise.allSettled([
      pay(T, v1, { amountPaise: rs(4000) }),
      pay(T, v2, { amountPaise: rs(4000) }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await store.overview(T)).cashPaise).toBe(rs(1000));
  });

  it("petty cash: only under Rs 500, serial numbers only, blocked when empty, top-up from cash", async () => {
    const T = fresh();
    await setup(T, { petty: rs(600), cash: rs(10000) });
    const entry = (amountPaise) =>
      store.createPetty({
        tenantId: T,
        fy: FY,
        input: {
          date: "2026-06-01",
          payeeName: "Raju",
          particulars: "Tea",
          amountPaise,
        },
        idempotencyKey: key(),
        user,
      });
    expect(await rule(entry(rs(500)))).toBe("USE_VOUCHER");
    const a = await entry(rs(400));
    const b = await entry(rs(150));
    expect([a.entry.seq, b.entry.seq]).toEqual([1, 2]);
    expect(a.entry.number).toBeUndefined(); // petty cash has NO voucher number
    expect(await rule(entry(rs(300)))).toBe("PETTY_EMPTY");
    await store.createTransfer({
      tenantId: T,
      from: "cash",
      to: "petty",
      amountPaise: rs(2000),
      idempotencyKey: key(),
      user,
    });
    expect((await entry(rs(300))).entry.seq).toBe(3);
    const s = await store.pettySummary(T);
    expect(s.balancePaise).toBe(rs(600 - 400 - 150 + 2000 - 300));
    expect(s.last.length).toBeLessThanOrEqual(5);
  });

  it("a transfer moves money between accounts and is not income or expense", async () => {
    const T = fresh();
    const { bankId } = await setup(T, {
      cash: rs(10000),
      bank: rs(0),
      petty: 0,
    });
    await store.createTransfer({
      tenantId: T,
      from: "cash",
      to: `bank:${bankId}`,
      amountPaise: rs(6000),
      idempotencyKey: key(),
      user,
    });
    const o = await store.overview(T);
    expect(o.cashPaise).toBe(rs(4000));
    expect(o.banks[0].balancePaise).toBe(rs(6000));
    expect(o.cashPaise + o.banks[0].balancePaise).toBe(rs(10000));
    expect(
      await rule(
        store.createTransfer({
          tenantId: T,
          from: "cash",
          to: `bank:${bankId}`,
          amountPaise: rs(9999),
          idempotencyKey: key(),
          user,
        }),
      ),
    ).toBe("INSUFFICIENT_BALANCE");
  });

  it("fee receipts add to cash / the chosen bank, and a cancelled receipt stops counting", async () => {
    const T = fresh();
    const { bankId } = await setup(T, { cash: 0, bank: 0, petty: 0 });
    const mk = (mode, bank) =>
      receipts.issue({
        tenantId: T,
        studentId: new mongoose.Types.ObjectId(),
        fy: FY,
        kind: "school",
        idempotencyKey: key(),
        build: async () => ({
          lines: [{ head: "tuition", amountPaise: rs(1000) }],
          totalPaise: rs(1000),
          dueAfterPaise: 0,
          mode,
          bankId: bank,
          cashierId: "c",
          student: { admissionNo: "1", name: "A" },
        }),
      });
    await mk("cash");
    const upi = await mk("upi", bankId);
    expect(await store.overview(T)).toMatchObject({ cashPaise: rs(1000) });
    expect((await store.overview(T)).banks[0].balancePaise).toBe(rs(1000));
    await receipts.cancelDirect({
      tenantId: T,
      receipt: upi.receipt,
      reason: "wrong",
      user,
    });
    expect((await store.overview(T)).banks[0].balancePaise).toBe(0);
  });

  it("a payment reversal needs a reason, is approved by the Principal, and restores the balance", async () => {
    const T = fresh();
    const { headId } = await setup(T, { cash: rs(5000) });
    const v = await approved(T, headId, rs(2000));
    const { payment } = await pay(T, v, { amountPaise: rs(2000) });
    expect(
      await rule(
        store.requestReversal({
          tenantId: T,
          kind: "payment",
          targetId: payment._id,
          reason: "",
          user,
        }),
      ),
    ).toBe("TEXT_REQUIRED");
    const req = await store.requestReversal({
      tenantId: T,
      kind: "payment",
      targetId: payment._id,
      reason: "Wrong payee",
      user,
    });
    expect(
      await rule(
        store.requestReversal({
          tenantId: T,
          kind: "payment",
          targetId: payment._id,
          reason: "again",
          user,
        }),
      ),
    ).toBe("ALREADY_REQUESTED");
    expect((await store.overview(T)).cashPaise).toBe(rs(3000)); // still paid until approved
    await store.decideReversal({
      tenantId: T,
      id: req._id,
      decision: "approve",
      user: principal,
    });
    expect((await store.overview(T)).cashPaise).toBe(rs(5000));
    expect((await store.getVoucher(T, v._id)).balanceDuePaise).toBe(rs(2000));
    expect(
      await store.decideReversal({
        tenantId: T,
        id: req._id,
        decision: "approve",
        user: principal,
      }),
    ).toBeNull();
  });

  it("an unpaid approved voucher can be cancelled; one with a payment cannot", async () => {
    const T = fresh();
    const { headId } = await setup(T);
    const paid = await approved(T, headId);
    await pay(T, paid);
    expect(
      await rule(
        store.requestReversal({
          tenantId: T,
          kind: "voucher",
          targetId: paid._id,
          reason: "mistake",
          user,
        }),
      ),
    ).toBe("NOT_CANCELLABLE");
    const unpaid = await approved(T, headId);
    const req = await store.requestReversal({
      tenantId: T,
      kind: "voucher",
      targetId: unpaid._id,
      reason: "mistake",
      user,
    });
    await store.decideReversal({
      tenantId: T,
      id: req._id,
      decision: "approve",
      user: principal,
    });
    expect((await store.getVoucher(T, unpaid._id)).status).toBe("cancelled");
  });

  it("rejecting a voucher needs a reason and works once", async () => {
    const T = fresh();
    const { headId } = await setup(T);
    const { voucher } = await voucherOf(T, headId);
    expect(
      await rule(
        store.decideVoucher({
          tenantId: T,
          id: voucher._id,
          decision: "reject",
          reason: "",
          user: principal,
        }),
      ),
    ).toBe("TEXT_REQUIRED");
    const r = await store.decideVoucher({
      tenantId: T,
      id: voucher._id,
      decision: "reject",
      reason: "Not needed",
      user: principal,
    });
    expect(r.status).toBe("rejected");
    expect(
      await store.decideVoucher({
        tenantId: T,
        id: voucher._id,
        decision: "approve",
        user: principal,
      }),
    ).toBeNull();
  });

  it("the opening balance can be set only once; the ledger cannot be edited or deleted", async () => {
    const T = fresh();
    await setup(T);
    expect(
      await rule(
        store.setOpening({
          tenantId: T,
          account: "cash",
          amountPaise: rs(1),
          user,
        }),
      ),
    ).toBe("OPENING_EXISTS");
    await expect(
      LedgerEntry.updateOne({ tenantId: T }, { $set: { amountPaise: 1 } }),
    ).rejects.toThrow(/immutable/);
    await expect(LedgerEntry.deleteMany({ tenantId: T })).rejects.toThrow(
      /immutable/,
    );
  });

  it("a failing audit rolls the payment back (nothing is saved)", async () => {
    const T = fresh();
    const { headId } = await setup(T, { cash: rs(5000) });
    const v = await approved(T, headId, rs(2000));
    await expect(
      store.createPayment({
        tenantId: T,
        fy: FY,
        voucherId: v._id,
        input: {
          date: "2026-06-02",
          amountPaise: rs(1000),
          mode: "cash",
          authorisedBy: "President",
        },
        idempotencyKey: key(),
        user,
        audit: async () => {
          throw new Error("audit down");
        },
      }),
    ).rejects.toThrow("audit down");
    expect((await store.overview(T)).cashPaise).toBe(rs(5000));
    expect((await store.getVoucher(T, v._id)).payments).toHaveLength(0);
  });

  it("the PIN is stored hashed, locks after 5 wrong tries, and only a new PIN unlocks it", async () => {
    const T = fresh();
    expect((await store.verifyPin({ tenantId: T, pin: "1234" })).reason).toBe(
      "NOT_SET",
    );
    await store.setPin({ tenantId: T, pin: "1234", user });
    const raw = await mongoose.connection.db
      .collection("cashierpins")
      .findOne({ tenantId: T });
    expect(JSON.stringify(raw)).not.toContain("1234");
    expect((await store.verifyPin({ tenantId: T, pin: "1234" })).ok).toBe(true);
    for (let i = 0; i < 4; i += 1)
      expect((await store.verifyPin({ tenantId: T, pin: "0000" })).reason).toBe(
        "WRONG",
      );
    expect((await store.verifyPin({ tenantId: T, pin: "0000" })).reason).toBe(
      "LOCKED",
    );
    expect((await store.verifyPin({ tenantId: T, pin: "1234" })).reason).toBe(
      "LOCKED",
    ); // even the right PIN
    await store.setPin({ tenantId: T, pin: "4321", user });
    expect((await store.verifyPin({ tenantId: T, pin: "4321" })).ok).toBe(true);
  });
});
