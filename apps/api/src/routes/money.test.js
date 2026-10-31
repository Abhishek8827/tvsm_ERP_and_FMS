import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExpenseRuleError } from "@erp/shared";
import { createApp } from "../app.js";
import { loadEnv } from "../config/env.js";
import { createLogger } from "../utils/logger.js";

const TENANT = "tvsm";
const env = loadEnv({
  MONGODB_URI: "mongodb://unused",
  NODE_ENV: "test",
  DEFAULT_TENANT_ID: TENANT,
});
const users = Object.fromEntries(
  ["admin", "principal", "cashier"].map((r) => [
    r,
    {
      _id: r,
      firebaseUid: r,
      email: `${r}@x.com`,
      name: r,
      role: r,
      tenantId: TENANT,
      isActive: true,
    },
  ]),
);
const ID = "a".repeat(24);
const ID2 = "c".repeat(24);
const doc = {
  _id: ID,
  number: "EXP-FY2026-27/0001",
  voucherNumber: "EXP-FY2026-27/0001",
  payments: [],
  reversals: [],
  adjustments: [],
  status: "pending",
  voucherId: ID,
  targetId: ID,
  kind: "payment",
};

/** Fake store: these tests are about WHO may call what and how input is checked. The money rules
 * themselves are unit-tested in packages/shared and exercised on a real database in moneyStore.db.test.js. */
function makeStore() {
  const list = async () => ({ rows: [], total: 0, totals: {} });
  return {
    overview: vi.fn(async () => ({
      cashPaise: 100,
      pettyPaise: 50,
      banks: [],
      unassignedReceiptsPaise: 0,
    })),
    pendingCounts: async () => ({ vouchers: 0, reversals: 0 }),
    setOpening: async () => doc,
    listBanks: async () => [
      { _id: ID, name: "IDFC", last4: "1234", defaultForModes: ["upi"] },
    ],
    createBank: async () => doc,
    updateBank: async () => doc,
    listHeads: async () => [{ _id: ID, name: "Stationery", active: true }],
    createHead: async () => ({ _id: ID, name: "Stationery", active: true }),
    updateHead: async () => ({ _id: ID, name: "Stationery", active: false }),
    listVouchers: list,
    getVoucher: async () => doc,
    createVoucher: vi.fn(async () => ({ voucher: doc, replay: false })),
    decideVoucher: vi.fn(async () => doc),
    addAdjustment: async () => doc,
    createPayment: vi.fn(async () => ({
      payment: { ...doc, seq: 1 },
      replay: false,
    })),
    listPayments: list,
    listReversals: async () => [],
    requestReversal: async () => doc,
    decideReversal: async () => doc,
    pettySummary: async () => ({ balancePaise: 4200, last: [] }),
    listPetty: list,
    createPetty: vi.fn(async () => ({
      entry: { ...doc, seq: 1 },
      replay: false,
    })),
    reversePetty: async () => ({ ...doc, seq: 1 }),
    listTransfers: list,
    createTransfer: async () => ({ transferId: "k".repeat(10), replay: false }),
  };
}
function build() {
  const audit = [];
  const moneyStore = makeStore();
  const auth = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: {
      findByFirebaseUid: async (_t, uid) => users[uid],
      touchLogin: async () => {},
    },
    auditStore: { append: async (e) => audit.push(e) },
    moneyStore,
  };
  return {
    app: createApp(env, createLogger("silent"), auth),
    moneyStore,
    audit,
  };
}
const as = (t) => ({ Authorization: `Bearer ${t}` });
const send = (app, method, path, who, body, withKey = true) => {
  let r = request(app)[method](`/api${path}`).set(as(who));
  if (withKey)
    r = r.set(
      "Idempotency-Key",
      `key-${Math.random().toString(36).slice(2)}-abcdef`,
    );
  return body ? r.send(body) : r;
};

const voucher = {
  date: "2026-06-01",
  headId: ID,
  payeeName: "Sharma Stores",
  particulars: "Chairs",
  amountPaise: 90000,
};
const payment = {
  date: "2026-06-01",
  amountPaise: 50000,
  mode: "bank",
  bankId: ID,
  authorisedBy: "President",
};
const petty = {
  date: "2026-06-01",
  payeeName: "Raju",
  particulars: "Tea",
  amountPaise: 20000,
};
// [method, path, body, who is allowed]
const MATRIX = [
  ["get", "/money/overview", null, ["admin", "principal"]],
  ["get", "/money/pending", null, ["admin", "principal"]],
  [
    "post",
    "/money/opening",
    { account: "cash", amountPaise: 100000 },
    ["admin"],
  ],
  ["get", "/banks/options", null, ["admin", "principal", "cashier"]],
  ["post", "/banks", { name: "IDFC", openingPaise: 100000 }, ["admin"]],
  ["patch", `/banks/${ID}`, { active: false }, ["admin"]],
  ["get", "/expense-heads", null, ["admin", "principal"]],
  ["post", "/expense-heads", { name: "Stationery" }, ["admin"]],
  ["patch", `/expense-heads/${ID}`, { active: false }, ["admin"]],
  ["get", "/vouchers", null, ["admin", "principal"]],
  ["get", `/vouchers/${ID}`, null, ["admin", "principal"]],
  ["post", "/vouchers", voucher, ["admin"]],
  ["post", `/vouchers/${ID}/approve`, {}, ["admin"]],
  ["post", `/vouchers/${ID}/reject`, { reason: "Not needed" }, ["admin"]],
  [
    "post",
    `/vouchers/${ID}/adjustments`,
    { amountPaise: 100, reason: "Discount", remark: "Vendor agreed" },
    ["admin"],
  ],
  ["post", `/vouchers/${ID}/payments`, payment, ["admin"]],
  ["get", "/expense-payments", null, ["admin", "principal"]],
  ["get", "/expense-reversals", null, ["admin", "principal"]],
  [
    "post",
    "/expense-reversals",
    { kind: "payment", targetId: ID, reason: "Wrong payee" },
    ["admin"],
  ],
  ["post", `/expense-reversals/${ID}/approve`, {}, ["admin"]],
  [
    "post",
    `/expense-reversals/${ID}/reject`,
    { reason: "Not valid" },
    ["admin"],
  ],
  ["get", "/petty/summary", null, ["admin", "principal"]],
  ["get", "/petty", null, ["admin", "principal"]],
  ["post", "/petty", petty, ["admin"]],
  ["post", `/petty/${ID}/reverse`, { reason: "Entered twice" }, ["admin"]],
  ["get", "/transfers", null, ["admin", "principal"]],
  [
    "post",
    "/transfers",
    { from: "cash", to: "petty", amountPaise: 100000 },
    ["admin"],
  ],
];

describe("server-side permissions for expenses, petty cash and balances", () => {
  it.each(MATRIX)(
    "%s %s is allowed only for %j roles",
    async (method, path, body, allowed) => {
      const { app } = build();
      for (const who of ["admin", "principal", "cashier"]) {
        const r = await send(app, method, path, who, body);
        if (allowed.includes(who))
          expect([200, 201], `${who} should be allowed`).toContain(r.status);
        else expect(r.status, `${who} must get 403`).toBe(403);
      }
      expect(
        (await send(app, method, path, "nobody-token-without-user", body))
          .status,
      ).not.toBe(200);
    },
  );

  it("nothing is open without signing in", async () => {
    const { app } = build();
    for (const [method, path] of MATRIX)
      expect((await request(app)[method](`/api${path}`)).status).toBe(401);
  });
});

describe("what the Cashier can and cannot see", () => {
  it("the Cashier has no petty cash, no balances and no PIN: every such door is 403 or gone", async () => {
    const { app } = build();
    for (const [method, path] of [
      ["get", "/petty/summary"],
      ["get", "/petty"],
      ["get", "/money/overview"],
      ["get", "/money/pending"],
      ["get", "/transfers"],
    ])
      expect((await send(app, method, path, "cashier")).status, path).toBe(403);
    // The PIN feature was removed completely: these routes no longer exist.
    expect(
      (
        await send(app, "post", "/money/cashier-view", "cashier", {
          pin: "1234",
        })
      ).status,
    ).toBe(404);
    expect((await send(app, "get", "/cashier-pin", "admin")).status).toBe(404);
    expect(
      (await send(app, "put", "/cashier-pin", "admin", { pin: "1234" })).status,
    ).toBe(404);
  });

  it("the Cashier can still see bank NAMES (and nothing else) to choose the bank on Collect Fee", async () => {
    const { app } = build();
    const r = await send(app, "get", "/banks/options", "cashier");
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toMatch(/balance|opening/i);
  });
});

describe("input checks", () => {
  let ctx;
  beforeEach(() => {
    ctx = build();
  });

  it("money-creating calls need an Idempotency-Key", async () => {
    for (const [path, body] of [
      ["/vouchers", voucher],
      [`/vouchers/${ID}/payments`, payment],
      ["/petty", petty],
      ["/transfers", { from: "cash", to: "petty", amountPaise: 100 }],
    ])
      expect(
        (await send(ctx.app, "post", path, "admin", body, false)).status,
      ).toBe(400);
  });

  it("rejects bad amounts, future dates, bad ids, unknown authoriser and unknown account", async () => {
    const bad = (path, body) => send(ctx.app, "post", path, "admin", body);
    expect(
      (await bad("/vouchers", { ...voucher, amountPaise: 12.5 })).status,
    ).toBe(400);
    expect(
      (await bad("/vouchers", { ...voucher, amountPaise: -5 })).status,
    ).toBe(400);
    expect(
      (await bad("/vouchers", { ...voucher, date: "2999-01-01" })).status,
    ).toBe(422);
    expect(
      (await bad("/vouchers", { ...voucher, headId: "nope" })).status,
    ).toBe(400);
    expect(
      (
        await bad(`/vouchers/${ID}/payments`, {
          ...payment,
          authorisedBy: "Peon",
        })
      ).status,
    ).toBe(400);
    expect(
      (await bad("/transfers", { from: "vault", to: "cash", amountPaise: 100 }))
        .status,
    ).toBe(400);
    expect(ctx.moneyStore.createVoucher).not.toHaveBeenCalled();
  });

  it("rejecting needs a reason", async () => {
    expect(
      (await send(ctx.app, "post", `/vouchers/${ID}/reject`, "admin", {}))
        .status,
    ).toBe(400);
    expect(
      (
        await send(ctx.app, "post", `/vouchers/${ID}/reject`, "admin", {
          reason: "",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send(
          ctx.app,
          "post",
          `/expense-reversals/${ID}/reject`,
          "admin",
          {},
        )
      ).status,
    ).toBe(400);
  });

  it("a rule refusal from the store becomes a 422 with the field; replay returns 200", async () => {
    ctx.moneyStore.createPayment.mockRejectedValueOnce(
      new ExpenseRuleError(
        "INSUFFICIENT_BALANCE",
        "The bank balance is not enough.",
        "amountPaise",
      ),
    );
    const r = await send(
      ctx.app,
      "post",
      `/vouchers/${ID}/payments`,
      "admin",
      payment,
    );
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({
      code: "INSUFFICIENT_BALANCE",
      fields: { amountPaise: "The bank balance is not enough." },
    });
    ctx.moneyStore.createPetty.mockResolvedValueOnce({
      entry: { ...doc, seq: 1 },
      replay: true,
    });
    expect((await send(ctx.app, "post", "/petty", "admin", petty)).status).toBe(
      200,
    );
  });

  it("approving a voucher that is not pending is a 409", async () => {
    ctx.moneyStore.decideVoucher.mockResolvedValueOnce(null);
    expect(
      (await send(ctx.app, "post", `/vouchers/${ID2}/approve`, "admin", {}))
        .status,
    ).toBe(409);
  });

  it("approvals and creations are audited with who and what", async () => {
    await send(ctx.app, "post", `/vouchers/${ID}/approve`, "admin", {});
    // The fake store does not call the audit callback, so we only check that routes pass one.
    expect(ctx.moneyStore.decideVoucher.mock.calls[0][0].audit).toBeTypeOf(
      "function",
    );
    expect(ctx.moneyStore.decideVoucher.mock.calls[0][0].decision).toBe(
      "approve",
    );
  });
});
