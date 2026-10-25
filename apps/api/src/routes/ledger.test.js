import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const chart = {
  fy: "2026-27",
  formFeePaise: 10000,
  dueDay: 15,
  graceDays: 10,
  lateFeePaise: 10000,
  classFees: [
    { classKey: "NURSERY", monthlyTuitionPaise: 70000, admissionPaise: 100000 },
  ],
  villages: [{ name: "SIWAL", monthlyPaise: 70000 }],
};
const students = {
  s1: {
    _id: "s1",
    name: "Old Student",
    admissionNo: "1",
    classKey: "NURSERY",
    status: "active",
    isNewAdmission: false,
  },
  s2: {
    _id: "s2",
    name: "New Student",
    admissionNo: "2",
    classKey: "NURSERY",
    status: "active",
    isNewAdmission: true,
  },
  s3: {
    _id: "s3",
    name: "Bus Student",
    admissionNo: "3",
    classKey: "NURSERY",
    status: "active",
    usesTransport: true,
    transportFrom: "2026-04",
    village: "Siwal",
  },
  s4: {
    _id: "s4",
    name: "Left",
    admissionNo: "4",
    classKey: "NURSERY",
    status: "inactive",
  },
};

function build() {
  const rows = [];
  const audit = [];
  const auth = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: {
      findByFirebaseUid: async (_t, uid) => users[uid],
      touchLogin: async () => {},
    },
    auditStore: { append: async (e) => audit.push(e) },
    studentStore: { findById: async (_t, id) => students[id] ?? null },
    feeStore: { get: async () => chart },
    receiptStore: { listForStudent: async () => [] },
    chargeStore: {
      listForStudent: async (_t, id) =>
        rows
          .filter((r) => r.studentId === id)
          .map((r, i) => ({ ...r, _id: `c${i}`, amountPaise: r.amount })),
      // Same behaviour as the real store: only new charges are added.
      postMany: async (_t, id, fy, charges) => {
        let added = 0;
        for (const c of charges)
          if (
            !rows.some(
              (r) =>
                r.studentId === id &&
                r.head === c.head &&
                r.period === c.period,
            )
          ) {
            rows.push({ studentId: id, ...c });
            added += 1;
          }
        return added;
      },
    },
  };
  return { app: createApp(env, createLogger("silent"), auth), audit };
}
const as = (t) => ({ Authorization: `Bearer ${t}` });
const post = (app, id, who = "admin") =>
  request(app)
    .post(`/api/students/${id}/fee-plan`)
    .set(as(who))
    .send({ fy: "2026-27" });
const ledger = (app, id, asOf) =>
  request(app)
    .get(`/api/students/${id}/ledger?fy=2026-27&asOf=${asOf}`)
    .set(as("cashier"));

describe("fee plan and ledger", () => {
  // Fees are posted month by month. March 2027 = the last month, so every month is posted here.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-15T06:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("403 when Cashier or Principal posts a fee plan", async () => {
    const { app } = build();
    for (const r of ["cashier", "principal"])
      expect((await post(app, "s1", r)).status).toBe(403);
  });
  it("old student: 10 tuition instalments, no admission/form fee", async () => {
    const { app, audit } = build();
    expect((await post(app, "s1")).body.charges).toBe(10);
    expect(audit.at(-1)).toMatchObject({ entity: "fee_plan" });
    expect((await ledger(app, "s1", "2027-03-31")).body.totals.billed).toBe(
      700000,
    );
  });
  it("new admission also gets admission + form fee (once)", async () => {
    const { app } = build();
    await post(app, "s2");
    expect((await ledger(app, "s2", "2027-03-31")).body.totals.billed).toBe(
      810000,
    );
  });
  it("bus student: transport charged from the village fee", async () => {
    const { app } = build();
    await post(app, "s3");
    expect((await ledger(app, "s3", "2027-03-31")).body.totals.billed).toBe(
      1400000,
    );
  });
  it("posting twice never duplicates (idempotent)", async () => {
    const { app } = build();
    await post(app, "s1");
    const again = await post(app, "s1");
    expect(again.status).toBe(200);
    expect(again.body.newlyAdded).toBe(0);
    expect((await ledger(app, "s1", "2027-03-31")).body.totals.billed).toBe(
      700000,
    );
  });
  it("late fee: Rs 100 once for an overdue month, shown separately", async () => {
    const { app } = build();
    await post(app, "s1");
    const before = await ledger(app, "s1", "2026-06-25"); // inside the 10-day grace
    expect(before.body.totals.lateFee).toBe(0);
    const after = await ledger(app, "s1", "2026-07-01");
    expect(after.body.totals.lateFee).toBe(10000);
    expect(after.body.totals.overdue).toBe(70000);
  });
  it("inactive students cannot get a fee plan", async () => {
    const { app } = build();
    expect((await post(app, "s4")).status).toBe(409);
  });

  it("only months up to the current month are posted, and the next month is added later", async () => {
    const { app } = build();
    vi.setSystemTime(new Date("2026-08-10T06:00:00Z")); // June, July, August
    const first = await post(app, "s1");
    expect(first.body.charges).toBe(3);
    expect((await ledger(app, "s1", "2027-03-31")).body.totals.billed).toBe(
      210000,
    );
    vi.setSystemTime(new Date("2026-09-02T06:00:00Z")); // September begins
    const next = await post(app, "s1");
    expect(next.body.newlyAdded).toBe(1);
    expect((await ledger(app, "s1", "2027-03-31")).body.totals.billed).toBe(
      280000,
    );
  });
  it("before June nothing monthly is posted yet; a new admission still gets admission + form", async () => {
    const { app } = build();
    vi.setSystemTime(new Date("2026-05-10T06:00:00Z"));
    expect((await post(app, "s1")).body.charges).toBe(0);
    expect((await post(app, "s2")).body.charges).toBe(2);
  });
});
