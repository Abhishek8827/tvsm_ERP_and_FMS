import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../config/env.js";
import { createLogger } from "../utils/logger.js";

const TENANT = "tvsm";
const env = loadEnv({
  MONGODB_URI: "mongodb://unused",
  NODE_ENV: "test",
  DEFAULT_TENANT_ID: TENANT,
});
const mk = (id, role) => ({
  _id: id, firebaseUid: id, email: `${id}@x.com`, name: id, role, tenantId: TENANT, isActive: true,
}); // prettier-ignore
const users = {
  admin: mk("admin", "admin"),
  principal: mk("principal", "principal"),
  cashier: mk("cashier", "cashier"),
};
const as = (t) => ({ Authorization: `Bearer ${t}` });

function build() {
  const audit = [];
  let saved = null;
  const calls = { income: [], expenses: [] };
  const deps = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: {
      findByFirebaseUid: async (_t, uid) => users[uid],
      touchLogin: async () => {},
    },
    auditStore: { append: async (e) => audit.push(e) },
    moneyStore: { listBanks: async () => [{ _id: "b1", name: "HDFC" }] },
    reportsStore: {
      getSettings: async () => saved,
      saveSettings: async (x) => {
        saved = {
          _id: "s1",
          fixedAssetsPaise: x.fixedAssetsPaise,
          capitalPaise: x.capitalPaise,
          history: [
            {
              at: new Date(),
              byName: "admin",
              reason: x.reason,
              fixedAssetsPaise: x.fixedAssetsPaise,
              capitalPaise: x.capitalPaise,
            },
          ],
        };
        return saved;
      },
      income: async (_t, from, to) => {
        calls.income.push([from, to]);
        return { byHead: { tuition: 100000 }, latePaise: 5000 };
      },
      expenses: async (_t, from, to) => {
        calls.expenses.push([from, to]);
        return [{ head: "Water", paise: 20000 }];
      },
      balances: async () => ({ cash: 50000, petty: 0 }),
      receivable: async () => 123,
      payables: async () => 45,
      dayBookEntries: async () => [
        {
          id: "1",
          at: new Date("2026-10-01T05:00:00Z"),
          type: "Fee receipt",
          ref: "S-1",
          particulars: "Asha (7)",
          account: "Cash",
          inPaise: 100,
          outPaise: 0,
        },
        {
          id: "2",
          at: new Date("2026-10-02T05:00:00Z"),
          type: "Expense paid",
          ref: "EXP/1",
          particulars: "Water",
          account: "Cash",
          inPaise: 0,
          outPaise: 40,
        },
      ],
    },
  };
  return { app: createApp(env, createLogger("silent"), deps), audit, calls };
}

describe("Reports routes", () => {
  it("Admin and Principal can read every report; the Cashier cannot", async () => {
    const { app } = build();
    for (const who of ["admin", "principal"]) {
      for (const p of [
        "income-expenditure",
        "balance-sheet",
        "trial-balance",
        "day-book",
      ]) {
        const r = await request(app)
          .get(`/api/reports/${p}?from=2026-10-01&to=2026-10-10`)
          .set(as(who));
        expect(r.status).toBe(200);
      }
    }
    const no = await request(app)
      .get("/api/reports/income-expenditure")
      .set(as("cashier"));
    expect(no.status).toBe(403);
  });
  it("Income & Expenditure figures come from the store; compare asks for the period just before", async () => {
    const { app, calls } = build();
    const r = await request(app)
      .get(
        "/api/reports/income-expenditure?from=2026-10-11&to=2026-10-20&compare=previous",
      )
      .set(as("principal"));
    expect(r.body).toMatchObject({
      totalIncomePaise: 105000,
      totalExpenditurePaise: 20000,
      surplusPaise: 85000,
    });
    expect(r.body.compare).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-10",
    });
    expect(calls.income).toContainEqual(["2026-10-01", "2026-10-10"]);
  });
  it("refuses a future date, a backwards range and a too-long Day Book", async () => {
    const { app } = build();
    const a = (u) => request(app).get(u).set(as("admin"));
    expect(
      (await a("/api/reports/income-expenditure?to=2999-01-01")).status,
    ).toBe(422);
    expect(
      (await a("/api/reports/income-expenditure?from=2026-10-10&to=2026-10-01"))
        .status,
    ).toBe(422);
    expect(
      (await a("/api/reports/day-book?from=2026-01-01&to=2026-10-01")).status,
    ).toBe(422);
    expect((await a("/api/reports/balance-sheet?asOn=2999-01-01")).status).toBe(
      422,
    );
  });
  it("Day Book totals cover all rows", async () => {
    const { app } = build();
    const r = await request(app)
      .get("/api/reports/day-book?from=2026-10-01&to=2026-10-10")
      .set(as("admin"));
    expect(r.body).toMatchObject({
      total: 2,
      totalInPaise: 100,
      totalOutPaise: 40,
    });
  });
  it("Balance Sheet shows the memo items", async () => {
    const { app } = build();
    const r = await request(app)
      .get("/api/reports/balance-sheet")
      .set(as("admin"));
    expect(r.body.memo).toEqual({ feeReceivablePaise: 123, payablesPaise: 45 });
  });
  it("only the Admin saves the opening balances: reason needed, audited, then visible", async () => {
    const { app, audit } = build();
    const body = {
      fixedAssetsRupees: "10,00,000",
      capitalRupees: "2000000.50",
      reason: "Opening figures",
    };
    expect(
      (
        await request(app)
          .put("/api/reports/settings")
          .set(as("principal"))
          .send(body)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .put("/api/reports/settings")
          .set(as("admin"))
          .send({ ...body, reason: "" })
      ).status,
    ).toBe(400);
    const ok = await request(app)
      .put("/api/reports/settings")
      .set(as("admin"))
      .send({ ...body, fixedAssetsRupees: "1000000" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      fixedAssetsPaise: 100000000,
      capitalPaise: 200000050,
    });
    expect(audit.at(-1)).toMatchObject({
      action: "update",
      entity: "ReportSettings",
      reason: "Opening figures",
    });
    const get = await request(app)
      .get("/api/reports/settings")
      .set(as("principal"));
    expect(get.body).toMatchObject({ set: true, capitalPaise: 200000050 });
  });
  it("every Excel export works and is written to the audit log", async () => {
    const { app, audit } = build();
    for (const type of [
      "income-expenditure",
      "balance-sheet",
      "trial-balance",
      "day-book",
    ]) {
      const r = await request(app)
        .get(`/api/reports/export?type=${type}&from=2026-10-01&to=2026-10-10`)
        .set(as("principal"));
      expect(r.status).toBe(200);
      expect(r.headers["content-type"]).toMatch(/spreadsheetml/);
    }
    expect(
      audit.filter((a) => a.action === "export" && a.entity === "Report"),
    ).toHaveLength(4);
    expect(
      (await request(app).get("/api/reports/export?type=nope").set(as("admin")))
        .status,
    ).toBe(400);
  });
});
