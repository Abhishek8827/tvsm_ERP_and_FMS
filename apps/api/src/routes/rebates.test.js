import request from "supertest";
import writeXlsxFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../config/env.js";
import { parseRebateSheet } from "../services/rebates.js";
import { createLogger } from "../utils/logger.js";

const TENANT = "tvsm";
const env = loadEnv({
  MONGODB_URI: "mongodb://unused",
  NODE_ENV: "test",
  DEFAULT_TENANT_ID: TENANT,
});
const mk = (id, role) => ({
  _id: id,
  firebaseUid: id,
  email: `${id}@x.com`,
  name: id,
  role,
  tenantId: TENANT,
  isActive: true,
});
const users = {
  admin: mk("admin", "admin"),
  principal: mk("principal", "principal"),
  cashier: mk("cashier", "cashier"),
};
const as = (t) => ({ Authorization: `Bearer ${t}` });
const ID = "a".repeat(24);

const tuition = (n, due) => ({
  _id: `c${n}`,
  studentId: ID,
  head: "tuition",
  period: `p${n}`,
  dueDate: due,
  amountPaise: 100000,
});
const adm = {
  _id: "cadm",
  studentId: ID,
  head: "admission",
  period: "once",
  dueDate: "2026-06-15",
  amountPaise: 200000,
};

function build({
  charges = [tuition(1, "2026-06-15"), tuition(2, "2026-07-15"), adm],
  chart = null,
} = {}) {
  const audit = [];
  const rebates = [];
  const students = [
    {
      _id: ID,
      admissionNo: "7",
      name: "Asha",
      classKey: "5th",
      section: "A",
      status: "active",
    },
    {
      _id: "b".repeat(24),
      admissionNo: "8",
      name: "Ravi",
      classKey: "2",
      status: "active",
    },
  ];
  const deps = {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: TENANT }),
    userStore: {
      findByFirebaseUid: async (_t, uid) => users[uid],
      touchLogin: async () => {},
    },
    auditStore: { append: async (e) => audit.push(e) },
    studentStore: {
      findById: async (_t, id) => students.find((s) => s._id === id) ?? null,
      findByAdmissionNos: async (_t, nos) =>
        students.filter((s) => nos.includes(s.admissionNo)),
    },
    receiptStore: {
      findForStudentByNumber: async (_t, _s, text) =>
        ["S-FY2026-27/0011", "11"].includes(text)
          ? { number: "S-FY2026-27/0011" }
          : null,
    },
    feeStore: { get: async () => chart },
    chargeStore: {
      listForStudent: async () => charges,
      postMany: async (_t, _s, _fy, list) => {
        let n = 0;
        for (const c of list)
          if (
            !charges.some((x) => x.period === c.period && x.head === c.head)
          ) {
            charges.push({
              ...c,
              _id: `n${charges.length}`,
              studentId: ID,
              amountPaise: c.amount,
            });
            n += 1;
          }
        return n;
      },
    },
    rebateStore: {
      hasSame: async (q) =>
        rebates.some(
          (r) =>
            r.rebateType === q.rebateType &&
            r.totalPaise === q.totalPaise &&
            r.reason === q.reason,
        ),
      create: async ({
        build: b,
        reason,
        kind,
        rebateType,
        adjustOn,
        category,
        sibling,
        receiptNo,
        audit: log,
      }) => {
        const lines = b([]);
        const doc = {
          _id: `r${rebates.length + 1}`,
          lines,
          totalPaise: lines.reduce((n, l) => n + l.amountPaise, 0),
          reason,
          kind,
          rebateType,
          adjustOn,
          category,
          sibling,
          receiptNo,
          status: "active",
          fy: "2026-27",
          studentId: ID,
          student: { name: "Asha", admissionNo: "7", classKey: "5th" },
          createdAt: new Date(),
        };
        rebates.push(doc);
        await log?.(doc); // the real store writes the audit entry in the same transaction
        return doc;
      },
      list: async () => ({
        rows: rebates,
        total: rebates.length,
        active: { paise: 0, count: rebates.length },
      }),
    },
  };
  return {
    app: createApp(env, createLogger("silent"), deps),
    audit,
    rebates,
    charges,
  };
}
const body = (over = {}) => ({
  studentId: ID,
  items: [{ type: "school", amountPaise: 50000 }],
  reason: "BC",
  ...over,
});
const xlsx = (rows) => writeXlsxFile(rows).toBuffer();
const upload = (app, who, buf, commit) =>
  request(app)
    .post(`/api/rebates/import?commit=${commit}`)
    .set(as(who))
    .set("Content-Type", "application/octet-stream")
    .send(buf);

describe("Rebates: who can do what", () => {
  it("Cashier is blocked from everything; Principal can look and export but not give or import", async () => {
    const { app } = build();
    for (const [m, u] of [
      ["get", "/api/rebates"],
      ["get", "/api/rebates/export"],
      ["get", "/api/rebates/template"],
      ["post", "/api/rebates"],
      ["post", "/api/rebates/import"],
    ])
      expect(
        (await request(app)[m](u).set(as("cashier")).send(body())).status,
      ).toBe(403);
    expect(
      (await request(app).get("/api/rebates").set(as("principal"))).status,
    ).toBe(200);
    expect(
      (await request(app).get("/api/rebates/export").set(as("principal")))
        .status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/rebates")
          .set(as("principal"))
          .send(body())
      ).status,
    ).toBe(403);
    expect(
      (await request(app).get("/api/rebates/template").set(as("principal")))
        .status,
    ).toBe(403);
    expect(
      (await upload(app, "principal", Buffer.from("x"), "false")).status,
    ).toBe(403);
  });
});

describe("Give rebate", () => {
  it("ticking school and admission makes two rebates; admission only lowers the admission fee", async () => {
    const { app, rebates, audit } = build();
    const res = await request(app)
      .post("/api/rebates")
      .set(as("admin"))
      .send(
        body({
          items: [
            { type: "school", amountPaise: 50000 },
            { type: "admission", amountPaise: 150000 },
          ],
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.created.map((r) => r.type)).toEqual([
      "school",
      "admission",
    ]);
    expect(rebates[1].lines.map((l) => l.head)).toEqual(["admission"]);
    expect(rebates[0].lines.every((l) => l.head === "tuition")).toBe(true);
    expect(audit.filter((a) => a.entity === "rebate")).toHaveLength(2);
  });
  it("is never more than what is unpaid, and the same rebate is not saved twice", async () => {
    const { app } = build();
    const big = await request(app)
      .post("/api/rebates")
      .set(as("admin"))
      .send(body({ items: [{ type: "admission", amountPaise: 999999 }] }));
    expect(big.status).toBe(422);
    expect(big.body.error.code).toBe("REBATE_TOO_BIG");
    expect(
      (await request(app).post("/api/rebates").set(as("admin")).send(body()))
        .status,
    ).toBe(201);
    const again = await request(app)
      .post("/api/rebates")
      .set(as("admin"))
      .send(body());
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe("DUPLICATE_REBATE");
  });
  it("validates: at least one type, one amount per type, a reason", async () => {
    const { app } = build();
    const post = (b) =>
      request(app).post("/api/rebates").set(as("admin")).send(b);
    expect((await post(body({ items: [] }))).status).toBe(400);
    expect((await post(body({ reason: "x" }))).status).toBe(400);
    expect(
      (await post(body({ items: [{ type: "school", amountPaise: 0 }] })))
        .status,
    ).toBe(400);
    expect(
      (
        await post(
          body({
            items: [
              { type: "school", amountPaise: 100 },
              { type: "school", amountPaise: 200 },
            ],
          }),
        )
      ).status,
    ).toBe(422);
  });
  it('"last month" lowers the newest month first (oldest-first is the default)', async () => {
    const { app, rebates } = build();
    await request(app)
      .post("/api/rebates")
      .set(as("admin"))
      .send(body({ adjustOn: "last", reason: "OTP" }));
    expect(rebates[0].lines[0].chargeId).toBe("c2");
    expect(rebates[0].adjustOn).toBe("last");
    await request(app)
      .post("/api/rebates")
      .set(as("admin"))
      .send(body({ reason: "normal" }));
    expect(rebates[1].lines[0].chargeId).toBe("c1");
  });
  it('"last month" posts only the final month of the year when it is not posted yet', async () => {
    const chart = {
      fy: "2026-27",
      classFees: [
        { classKey: "5th", monthlyTuitionPaise: 100000, admissionPaise: 0 },
      ],
      villages: [],
      formFeePaise: 0,
    };
    const { app, charges, rebates } = build({
      charges: [tuition(1, "2026-06-15")],
      chart,
    });
    const res = await request(app)
      .post("/api/rebates")
      .set(as("admin"))
      .send(body({ adjustOn: "last", reason: "BC" }));
    expect(res.status).toBe(201);
    const added = charges.filter((c) => c._id.startsWith("n"));
    expect(added).toHaveLength(1);
    expect(added[0].dueDate.startsWith("2027-03")).toBe(true);
    expect(rebates[0].lines[0].period).toBe(added[0].period);
  });
});

describe("Rebate Excel import", () => {
  const head = ["SCH. ID", "REBATE TYPE", "AMOUNT (₹)", "REASON"];
  it("checks first (saves nothing), then imports the good rows; a repeat is skipped", async () => {
    const { app, rebates } = build();
    const buf = await xlsx([
      head,
      ["7", "school", 500, "BC"],
      ["99", "school", 100, "BC"],
      ["7", "oops", 100, "BC"],
    ]);
    const check = await upload(app, "admin", buf, "false");
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({
      committed: false,
      ready: 1,
      created: 0,
    });
    expect(check.body.errors.map((e) => e.row).sort()).toEqual([3, 4]);
    expect(rebates).toHaveLength(0);
    const done = await upload(app, "admin", buf, "true");
    expect(done.body).toMatchObject({ committed: true, created: 1 });
    expect(rebates).toHaveLength(1);
    expect(rebates[0].totalPaise).toBe(50000);
    const again = await upload(app, "admin", buf, "true");
    expect(again.body.created).toBe(0);
    expect(again.body.errors.some((e) => /already given/.test(e.message))).toBe(
      true,
    );
  });
  it("a row that is more than what is unpaid fails alone; the others still go in", async () => {
    const { app, rebates } = build();
    const buf = await xlsx([
      head,
      ["7", "transport", 100, "Bus"],
      ["7", "school", 100, "Staff"],
    ]);
    const done = await upload(app, "admin", buf, "true");
    expect(done.body.created).toBe(1);
    expect(done.body.errors).toHaveLength(1);
    expect(rebates).toHaveLength(1);
  });
  it("rejects a file without the needed columns", async () => {
    const { app } = build();
    const res = await upload(
      app,
      "admin",
      await xlsx([
        ["A", "B"],
        ["1", "2"],
      ]),
      "false",
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_TEMPLATE");
  });
});

describe("parseRebateSheet", () => {
  const head = ["Sch. ID", "Rebate type", "Amount", "Reason", "Adjust on"];
  it("understands type words, ADJUST ON, and flags bad or repeated rows", () => {
    const out = parseRebateSheet([
      head,
      ["1", "School Fees", "500", "BC", "last"],
      ["2", "bus", 250.5, "OTP", ""],
      ["3", "admission", 100, "ok", "sideways"],
      ["4", "school", "abc", "BC"],
      ["5", "school", 0, "BC"],
      ["6", "school", 10, ""],
      ["1", "school fees", 500, "bc", "last"],
    ]);
    expect(out.rows).toMatchObject([
      {
        row: 2,
        admissionNo: "1",
        type: "school",
        amountPaise: 50000,
        reason: "BC",
        adjustOn: "last",
      },
      {
        row: 3,
        admissionNo: "2",
        type: "transport",
        amountPaise: 25050,
        reason: "OTP",
        adjustOn: "oldest",
      },
    ]);
    expect(out.errors.map((e) => e.row)).toEqual([4, 5, 6, 7, 8]);
  });
});

describe("Rebate categories", () => {
  const post = (app, b) =>
    request(app).post("/api/rebates").set(as("admin")).send(body(b));
  it("looks a student up by scholar number (Admin only); unknown number is 404", async () => {
    const { app } = build();
    const ok = await request(app).get("/api/rebates/lookup/7").set(as("admin"));
    expect(ok.body).toMatchObject({
      name: "Asha",
      admissionNo: "7",
      classKey: "5th",
    });
    expect(
      (await request(app).get("/api/rebates/lookup/999").set(as("admin")))
        .status,
    ).toBe(404);
    expect(
      (await request(app).get("/api/rebates/lookup/7").set(as("principal")))
        .status,
    ).toBe(403);
  });
  it("BC needs a real sibling (not the same student); name and class are copied in", async () => {
    const { app, rebates } = build();
    expect((await post(app, { category: "bc" })).status).toBe(422);
    expect(
      (await post(app, { category: "bc", siblingNo: "7" })).body.error.code,
    ).toBe("BAD_SIBLING");
    expect(
      (await post(app, { category: "bc", siblingNo: "99" })).body.error.code,
    ).toBe("SIBLING_NOT_FOUND");
    const ok = await post(app, { category: "bc", siblingNo: "8" });
    expect(ok.status).toBe(201);
    expect(rebates[0].sibling).toEqual({
      admissionNo: "8",
      name: "Ravi",
      classKey: "2",
    });
    expect(rebates[0].adjustOn).toBe("last"); // BC lowers the last month
  });
  it("OTP needs this student's receipt number (full number or digits)", async () => {
    const { app, rebates } = build();
    expect((await post(app, { category: "otp" })).body.error.code).toBe(
      "RECEIPT_REQUIRED",
    );
    expect(
      (await post(app, { category: "otp", receiptNo: "55" })).body.error.code,
    ).toBe("RECEIPT_NOT_FOUND");
    expect((await post(app, { category: "otp", receiptNo: "11" })).status).toBe(
      201,
    );
    expect(rebates[0].receiptNo).toBe("S-FY2026-27/0011");
  });
  it("RTE / Management / Scholarship cover the whole year, even months not posted yet", async () => {
    const chart = {
      fy: "2026-27",
      classFees: [
        { classKey: "5th", monthlyTuitionPaise: 100000, admissionPaise: 0 },
      ],
      villages: [],
      formFeePaise: 0,
    };
    const { app, charges, rebates } = build({
      charges: [tuition(1, "2026-06-15")],
      chart,
    });
    // 10 fee months + the posted test month = Rs 11,000: before this fix it said "more than due".
    const res = await post(app, {
      category: "rte",
      reason: "RTE",
      items: [{ type: "school", amountPaise: 1100000 }],
    });
    expect(res.status).toBe(201);
    expect(rebates[0].adjustOn).toBe("all");
    expect(charges.filter((c) => c.head === "tuition")).toHaveLength(11);
    expect(rebates[0].lines).toHaveLength(11);
  });
  it("import reads CATEGORY / SIBLING SCH. ID / RECEIPT NO and rejects a BC row without a sibling", async () => {
    const { app, rebates } = build();
    const buf = await xlsx([
      [
        "SCH. ID",
        "REBATE TYPE",
        "AMOUNT (₹)",
        "REASON",
        "CATEGORY",
        "SIBLING SCH. ID",
        "RECEIPT NO",
      ],
      ["7", "school", 100, "BC", "BC", "8", ""],
      ["7", "school", 200, "OTP", "OTP", "", "11"],
      ["7", "school", 300, "BC again", "BC", "", ""],
    ]);
    const done = await upload(app, "admin", buf, "true");
    expect(done.body.created).toBe(2);
    expect(done.body.errors.map((e) => e.row)).toEqual([4]);
    expect(rebates.map((r) => r.category)).toEqual(["bc", "otp"]);
  });
});
