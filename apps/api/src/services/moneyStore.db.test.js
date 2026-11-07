import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExpenseRuleError } from "@erp/shared";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { makeMoneyStore } from "./moneyStore.js";
import { makeReceiptStore } from "./stores.js";

/**
 * Real-database tests of the money code: balances, vouchers, part payments, petty cash, transfers,
 * reversals. They need an in-memory MongoDB replica set (transactions). Where no
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
// Petty cash is filled only by paying a voucher under the locked "Petty Cash" head.
const topUpPetty = async (T, amountPaise) => {
  const head = (await store.listHeads(T)).find(
    (h) => h.nameLower === "petty cash",
  );
  const v = await approved(T, String(head._id), amountPaise);
  return pay(T, v, { amountPaise });
};

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
      to: `bank:${bankId}`,
      amountPaise: rs(500),
      idempotencyKey: k + "t",
      user,
    };
    await store.createTransfer(t1);
    expect((await store.createTransfer(t1)).replay).toBe(true);
    expect((await store.overview(T)).banks[0].balancePaise).toBe(rs(200500));
  });

  it('petty cash entries have their own serial numbers (no voucher number), are refused when petty is empty, and a "Petty Cash" voucher fills it', async () => {
    const T = fresh();
    await setup(T, { petty: rs(600) });
    const entry = (amountPaise) =>
      store.createPetty({
        tenantId: T,
        fy: FY,
        input: {
          date: "2026-06-03",
          payeeName: "Tea stall",
          particulars: "Tea",
          amountPaise,
        },
        idempotencyKey: key(),
        user,
      });
    const a = await entry(rs(400));
    const b = await entry(rs(150));
    expect([a.entry.seq, b.entry.seq]).toEqual([1, 2]);
    expect(a.entry.number).toBeUndefined(); // petty cash has NO voucher number
    expect(await rule(entry(rs(300)))).toBe("PETTY_EMPTY");
    await topUpPetty(T, rs(2000));
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

  it("the transfers list can be filtered by account and by date", async () => {
    const T = fresh();
    const { bankId } = await setup(T, {
      cash: rs(10000),
      bank: rs(1000),
      petty: 0,
    });
    const mk = (from, to, amount) =>
      store.createTransfer({ tenantId: T, from, to, amountPaise: rs(amount), idempotencyKey: key(), user }); // prettier-ignore
    await mk("cash", `bank:${bankId}`, 3000);
    await mk(`bank:${bankId}`, "cash", 500);
    const page = { tenantId: T, page: 1, pageSize: 25 };
    expect((await store.listTransfers(page)).total).toBe(2);
    expect(
      (await store.listTransfers({ ...page, account: "cash" })).total,
    ).toBe(2);
    expect(
      (await store.listTransfers({ ...page, account: `bank:${bankId}` })).total,
    ).toBe(2);
    expect(
      (await store.listTransfers({ ...page, from: "2999-01-01" })).total,
    ).toBe(0);
  });

  it('petty cash cannot be a transfer target any more; the "Petty Cash" head is made by the system and locked', async () => {
    const T = fresh();
    await setup(T, { cash: rs(10000), bank: 0, petty: 0 });
    expect(
      await rule(
        store.createTransfer({ tenantId: T, from: 'cash', to: 'petty', amountPaise: rs(500), idempotencyKey: key(), user }), // prettier-ignore
      ),
    ).toBe("PETTY_NOT_TRANSFER");
    const heads = await store.listHeads(T);
    const petty = heads.find((h) => h.nameLower === "petty cash");
    expect(petty).toMatchObject({
      name: "Petty Cash",
      system: true,
      active: true,
    });
    expect(heads.filter((h) => h.nameLower === "petty cash")).toHaveLength(1); // listing twice does not duplicate
    expect(
      (await store.listHeads(T)).filter((h) => h.nameLower === "petty cash"),
    ).toHaveLength(1);
    expect(
      await rule(store.createHead({ tenantId: T, name: " PETTY cash ", user })),
    ).toBe("HEAD_EXISTS");
    expect(await rule(store.updateHead({ tenantId: T, id: petty._id, patch: { active: false } }))).toBe('HEAD_LOCKED'); // prettier-ignore
    expect(await rule(store.updateHead({ tenantId: T, id: petty._id, patch: { name: 'X' } }))).toBe('HEAD_LOCKED'); // prettier-ignore
  });

  it('paying a voucher under "Petty Cash" is an expense for the school and fills the petty fund; reversing it takes it back', async () => {
    const T = fresh();
    await setup(T, { cash: rs(10000), bank: 0, petty: 0 });
    const before = await store.overview(T);
    expect([before.cashPaise, before.pettyPaise]).toEqual([rs(10000), 0]);
    await topUpPetty(T, rs(2000));
    const after = await store.overview(T);
    expect(after.cashPaise).toBe(rs(8000)); // left the school cash (an expense) ...
    expect(after.pettyPaise).toBe(rs(2000)); // ... and landed in petty
    // The Petty page can spend it.
    await store.createPetty({
      tenantId: T,
      fy: FY,
      input: { date: '2026-06-03', payeeName: 'Tea stall', particulars: 'Tea', amountPaise: rs(300) },
      idempotencyKey: key(),
      user,
    }); // prettier-ignore
    // Reverse the top-up: petty may go below zero when it was already spent (the Principal's rule).
    const payment = (
      await store.listPayments({ tenantId: T, page: 1, pageSize: 5 })
    ).rows[0];
    const req = await store.requestReversal({ tenantId: T, kind: 'payment', targetId: payment._id, reason: 'Wrong head', user }); // prettier-ignore
    await store.decideReversal({
      tenantId: T,
      id: req._id,
      decision: "approve",
      user: principal,
    });
    const end = await store.overview(T);
    expect(end.cashPaise).toBe(rs(10000));
    expect(end.pettyPaise).toBe(rs(2000) - rs(300) - rs(2000));
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
});
