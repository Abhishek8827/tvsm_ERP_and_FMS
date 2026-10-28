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
const as = (t) => ({ Authorization: `Bearer ${t}` });
const A = "a".repeat(24);
const B = "b".repeat(24);
const chart = {
  fy: '2026-27', formFeePaise: 10000, dueDay: 15, graceDays: 10, lateFeePaise: 10000,
  classFees: [{ classKey: '7', monthlyTuitionPaise: 70000, admissionPaise: 100000 }],
  villages: [],
}; // prettier-ignore

const full = {
  fatherName: 'Rajesh', motherName: 'Sunita', category: 'General',
  dateOfBirth: new Date('2014-03-14T00:00:00Z'), firstAdmissionDate: new Date('2019-07-04T00:00:00Z'),
  firstAdmissionClass: '1', nationality: 'Indian',
}; // prettier-ignore
const body = (o = {}) => ({
  studentId: A, lastExam: 'Annual 2025-26, Passed', failedInSameClass: 'No',
  subjects: 'English, Hindi', qualifiedForPromotion: 'Yes, to next class', workingDays: 220,
  daysPresent: 198, conduct: 'Good', dateOfApplication: '2026-10-12', dateOfIssue: '2026-10-13',
  reason: 'Parent Request', ...o,
}); // prettier-ignore

function build({ charges = [] } = {}) {
  const audit = [];
  const students = {
    [A]: { _id: A, name: 'Aarav', admissionNo: '412', classKey: '7', section: 'A', status: 'active', gender: 'MALE', ...full },
    [B]: { _id: B, name: 'Bare', admissionNo: '9', classKey: '7', status: 'active' },
    ['c'.repeat(24)]: { _id: 'c'.repeat(24), name: 'Left', admissionNo: '3', classKey: '7', status: 'inactive', ...full },
  }; // prettier-ignore
  const tcs = [];
  const bons = [];
  const reqs = [];
  let sl = 0;
  const settings = { tcBookNo: "7", tcStartSl: 143 };
  const certificateStore = {
    getSettings: async () => settings,
    saveSettings: async ({ tcBookNo, tcStartSl }) => Object.assign(settings, { tcBookNo, tcStartSl }),
    countTcInFy: async () => tcs.length,
    activeTcForStudent: async (_t, id) => tcs.find((t) => t.studentId === id && t.status === 'issued'),
    findTcByKey: async (_t, k) => tcs.find((t) => t.idempotencyKey === k),
    findBonafideByKey: async (_t, k) => bons.find((t) => t.idempotencyKey === k),
    findRequestByKey: async (_t, k) => reqs.find((r) => r.idempotencyKey === k),
    pendingRequestFor: async (_t, studentId, kind) =>
      reqs.find((r) => r.studentId === studentId && r.kind === kind && r.status === 'pending'),
    async createRequest(doc) {
      const r = { ...doc, _id: `${'2'.repeat(23)}${reqs.length + 1}`, status: 'pending', createdAt: new Date() };
      reqs.push(r);
      return { request: r, replay: false };
    },
    listRequests: async ({ kind, status }) => {
      const rows = reqs.filter((r) => (!kind || r.kind === kind) && (!status || r.status === status));
      return { rows, total: rows.length };
    },
    getRequest: async (_t, id) => reqs.find((r) => r._id === id),
    markRequestApproved: async ({ id, certificateId, certificateNumber, user }) => {
      const r = reqs.find((x) => x._id === id && x.status === 'pending');
      if (!r) return null;
      return Object.assign(r, { status: 'approved', certificateId: String(certificateId), certificateNumber, decidedByName: user.name });
    },
    async rejectRequest({ id, reason, user, audit: au }) {
      const r = reqs.find((x) => x._id === id && x.status === 'pending');
      if (!r) return null;
      Object.assign(r, { status: 'rejected', rejectReason: reason, decidedByName: user.name });
      await au(r);
      return r;
    },
    async issueTc({ studentId, fy, startSl, idempotencyKey, user, prepare, audit: au }) {
      const student = students[studentId];
      const { doc, studentPatch } = await prepare(student, tcs.some((t) => t.studentId === studentId && t.status === 'issued'));
      sl = sl === 0 ? startSl : sl + 1;
      const tc = { ...doc, _id: `${'0'.repeat(21)}${sl}`, fy, slNo: sl, studentId, status: 'issued', idempotencyKey, duplicateCount: 0, issuedByName: user.name, originalPrintedAt: null };
      Object.assign(student, studentPatch);
      await au(tc);
      tcs.push(tc);
      return { tc, replay: false };
    },
    listTc: async () => ({ rows: tcs, total: tcs.length }),
    getTc: async (_t, id) => tcs.find((t) => t._id === id),
    printTc: async (_t, id) => {
      const t = tcs.find((x) => x._id === id && x.status === 'issued');
      if (!t) return null;
      if (!t.originalPrintedAt) {
        t.originalPrintedAt = new Date();
        return { cert: t, copyNo: null };
      }
      t.duplicateCount += 1;
      return { cert: t, copyNo: t.duplicateCount };
    },
    async cancelTc({ id, reason, audit: au }) {
      const t = tcs.find((x) => x._id === id && x.status === 'issued');
      if (!t) return null;
      Object.assign(t, { status: 'cancelled', cancelReason: reason });
      Object.assign(students[t.studentId], { status: 'active', inactiveReason: null });
      await au(t);
      return t;
    },
    async issueBonafide({ studentId, fy, idempotencyKey, user, prepare, audit: au }) {
      const { makeNumber, ...doc } = await prepare(students[studentId]);
      const seq = bons.length + 1;
      const b = { ...doc, _id: `${'1'.repeat(23)}${seq}`, fy, seq, number: makeNumber(seq), studentId, status: 'issued', idempotencyKey, issuedByName: user.name, originalPrintedAt: null };
      await au(b);
      bons.push(b);
      return { bonafide: b, replay: false };
    },
    async cancelBonafide({ id, reason, audit: au }) {
      const b = bons.find((x) => x._id === id && x.status === 'issued');
      if (!b) return null;
      Object.assign(b, { status: 'cancelled', cancelReason: reason });
      await au(b);
      return b;
    },
    listBonafide: async () => ({ rows: bons, total: bons.length }),
    getBonafide: async (_t, id) => bons.find((t) => t._id === id),
    printBonafide: async (_t, id) => {
      const b = bons.find((x) => x._id === id && x.status === 'issued');
      if (!b) return null;
      if (!b.originalPrintedAt) {
        b.originalPrintedAt = new Date();
        return { cert: b, copyNo: null };
      }
      b.duplicateCount = (b.duplicateCount ?? 0) + 1;
      return { cert: b, copyNo: b.duplicateCount };
    },
  }; // prettier-ignore
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
      listForStudent: async () =>
        charges.map((c, i) => ({ ...c, _id: `c${i}` })),
    },
    rebateStore: {
      listForStudent: async () => [
        {
          status: "active",
          fy: "2026-27",
          kind: "school",
          category: "bc",
          reason: "Sibling 2",
        },
      ],
    },
    certificateStore,
  };
  return {
    app: createApp(env, createLogger("silent"), auth),
    audit,
    students,
    tcs,
    bons,
    reqs,
    charges,
    settings,
  };
}
const dueCharge = [
  {
    head: "tuition",
    period: "2026-04",
    dueDate: "2026-04-15",
    amountPaise: 70000,
  },
];
// The Admin asks for a TC; the Principal decides.
const ask = (app, key, b, who = "admin") =>
  request(app)
    .post("/api/certificate-requests/tc")
    .set(as(who))
    .set("Idempotency-Key", key)
    .send(b);
const approve = (app, id, who = "principal") =>
  request(app).post(`/api/certificate-requests/${id}/approve`).set(as(who));
const reject = (app, id, reason, who = "principal") =>
  request(app)
    .post(`/api/certificate-requests/${id}/reject`)
    .set(as(who))
    .send({ reason });
/** Asks and approves in one go; returns the TC. */
const issue = async (app, key = "key-12345678", b = body()) => {
  const r = await ask(app, key, b);
  return (await approve(app, r.body.id)).body.certificate;
};

beforeEach(() =>
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-13T06:00:00Z") }),
);
afterEach(() => vi.useRealTimers());

describe("TC request and approval", () => {
  it("Admin asks, Principal decides: nobody else may (403), and the Cashier cannot ask", async () => {
    const { app } = build();
    for (const who of ["principal", "cashier"]) {
      expect((await ask(app, "key-12345678", body(), who)).status).toBe(403);
      expect(
        (await request(app).get(`/api/tc/draft/${A}`).set(as(who))).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post("/api/tc/000000000000000000000001/print")
            .set(as(who))
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post("/api/tc/000000000000000000000001/cancel")
            .set(as(who))
            .send({ reason: "abc" })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .put("/api/certificates/settings")
            .set(as(who))
            .send({ tcBookNo: "1", tcStartSl: 1 })
        ).status,
      ).toBe(403);
    }
    const r = await ask(app, "key-12345678", body());
    for (const who of ["admin", "cashier"]) {
      expect((await approve(app, r.body.id, who)).status).toBe(403);
      expect((await reject(app, r.body.id, "not right", who)).status).toBe(403);
    }
  });

  it("a request is only a request: no number, no TC, the student stays active", async () => {
    const { app, students, tcs, audit } = build();
    const r = await ask(app, "key-12345678", body());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      kind: "tc",
      status: "pending",
      studentName: "Aarav",
    });
    expect(r.body.preview.snapshot).toMatchObject({
      name: "Aarav",
      dob: "2014-03-14",
    });
    expect(tcs).toHaveLength(0);
    expect(students[A].status).toBe("active");
    expect(
      audit.some(
        (a) => a.action === "create" && a.entity === "certificate_request",
      ),
    ).toBe(true);
  });

  it("approval gives the first Sl. No., makes the student inactive and records both people", async () => {
    const { app, students, audit, reqs } = build();
    const r = await ask(app, "key-12345678", body());
    const done = await approve(app, r.body.id);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({
      status: "approved",
      certificateNumber: "0143",
    });
    expect(done.body.certificate).toMatchObject({
      slNo: 143,
      bookNo: "7",
      status: "issued",
      issuedByName: "admin",
      approvedByName: "principal",
      originalPrinted: false,
    });
    expect(done.body.certificate.snapshot).toMatchObject({
      dobInWords: "Fourteenth March Two Thousand Fourteen",
      lastClassInWords: "7 (Seventh)",
      firstAdmissionClass: "1st",
      duesPaidUpto: "Nil",
      feeConcession: "BC (sibling) - Sibling 2",
    });
    expect(students[A]).toMatchObject({
      status: "inactive",
      inactiveReason: "left_with_tc",
    });
    expect(reqs[0].decidedByName).toBe("principal");
    for (const action of ["approve", "issue"])
      expect(audit.some((a) => a.action === action)).toBe(true);
  });

  it("approving twice (double click) returns the same TC and uses no second number", async () => {
    const { app, tcs } = build();
    const r = await ask(app, "key-12345678", body());
    const one = await approve(app, r.body.id);
    const two = await approve(app, r.body.id);
    expect(two.status).toBe(200);
    expect(two.body.certificate.id).toBe(one.body.certificate.id);
    expect(tcs).toHaveLength(1);
  });

  it("a rejected request takes no number; a new request can be made and gets the first number", async () => {
    const { app, tcs, students } = build();
    const r = await ask(app, "key-12345678", body());
    expect((await reject(app, r.body.id, "x")).status).toBe(400); // reason needs 3 letters
    const rej = await reject(app, r.body.id, "Wrong class entered");
    expect(rej.body).toMatchObject({
      status: "rejected",
      rejectReason: "Wrong class entered",
    });
    expect(tcs).toHaveLength(0);
    expect((await approve(app, r.body.id)).status).toBe(409);
    expect((await reject(app, r.body.id, "again again")).status).toBe(409);
    const again = await ask(app, "key-87654321", body());
    expect(again.status).toBe(201);
    expect((await approve(app, again.body.id)).body.certificate.slNo).toBe(143);
    expect(students[A].status).toBe("inactive");
  });

  it("a retry with the same Idempotency-Key returns the same request; the header is required", async () => {
    const { app, reqs } = build();
    const one = await ask(app, "key-12345678", body());
    const two = await ask(app, "key-12345678", body());
    expect(two.status).toBe(200);
    expect(two.body).toMatchObject({ id: one.body.id, replay: true });
    expect(reqs).toHaveLength(1);
    expect(
      (
        await request(app)
          .post("/api/certificate-requests/tc")
          .set(as("admin"))
          .send(body())
      ).status,
    ).toBe(400);
  });

  it("only one waiting request per student, and none once a valid TC exists", async () => {
    const { app } = build();
    await ask(app, "key-12345678", body());
    const second = await ask(app, "key-87654321", body());
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain("REQUEST_PENDING");
    const { app: app2 } = build();
    await issue(app2);
    const after = await ask(app2, "key-87654321", body());
    expect(after.status).toBe(409);
    expect(JSON.stringify(after.body)).toContain("TC_EXISTS");
  });

  it("blocks when fees are due; with a reason the Principal sees it, and approval is audited as an override", async () => {
    const { app, audit } = build({ charges: dueCharge });
    const blocked = await ask(app, "key-12345678", body());
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.body)).toContain("DUES_PENDING");
    expect(
      (await ask(app, "key-22222222", body({ duesOverrideReason: "ok" })))
        .status,
    ).toBe(400);
    const r = await ask(
      app,
      "key-33333333",
      body({ duesOverrideReason: "Principal allowed" }),
    );
    expect(r.status).toBe(201);
    expect(r.body.duesOverride).toMatchObject({ reason: "Principal allowed" });
    expect(r.body.duesOverride.duePaise).toBeGreaterThan(0);
    const done = await approve(app, r.body.id);
    expect(done.body.certificate.duesOverride).toMatchObject({
      reason: "Principal allowed",
    });
    expect(audit.find((a) => a.action === "override")?.reason).toBe(
      "Principal allowed",
    );
  });

  it("dues are checked again at approval: fees that became due since the request block it", async () => {
    const { app, charges, tcs } = build();
    const r = await ask(app, "key-12345678", body());
    charges.push(...dueCharge);
    const done = await approve(app, r.body.id);
    expect(done.status).toBe(409);
    expect(JSON.stringify(done.body)).toContain("DUES_PENDING");
    expect(tcs).toHaveLength(0);
    // the Principal can still reject it
    expect((await reject(app, r.body.id, "Fees pending now")).status).toBe(200);
  });

  it("draft shows pending dues and the defaults; missing fields are listed", async () => {
    const { app } = build({ charges: dueCharge });
    const d = await request(app).get(`/api/tc/draft/${A}`).set(as("admin"));
    expect(d.status).toBe(200);
    expect(d.body.pendingPaise).toBeGreaterThan(0);
    expect(d.body).toMatchObject({ bookNo: "7", nextSl: 143, missing: [] });
    expect(d.body.unpaid).toHaveLength(1);
    expect(d.body.unpaid[0]).toMatchObject({
      period: "2026-04",
      duePaise: 70000,
    });
    expect(d.body.unpaid[0].items).toEqual([
      { head: "tuition", duePaise: 70000 },
    ]);
    expect(d.body.dueNowPaise + d.body.lateFeePaise).toBe(d.body.pendingPaise);
    expect(d.body.defaults.qualifiedForPromotion).toBe("Yes, to next class");
    const bare = await request(app).get(`/api/tc/draft/${B}`).set(as("admin"));
    expect(bare.body.missing.map((m) => m.key)).toEqual(
      expect.arrayContaining([
        "fatherName",
        "motherName",
        "dateOfBirth",
        "category",
        "firstAdmissionDate",
      ]),
    );
  });

  it("refuses while details are missing; what the Admin typed is saved to the student only on approval", async () => {
    const { app, students } = build();
    const miss = await ask(app, "key-12345678", body({ studentId: B }));
    expect(miss.status).toBe(400);
    expect(
      Object.keys(miss.body.error?.fields ?? miss.body.fields ?? {}),
    ).toContain("fatherName");
    const filled = await ask(
      app,
      "key-11111111",
      body({
        studentId: B,
        fatherName: "Ram",
        motherName: "Sita",
        category: "OBC",
        dateOfBirth: "2013-05-01",
        firstAdmissionDate: "2018-07-01",
        firstAdmissionClass: "1",
      }),
    );
    expect(filled.status).toBe(201);
    expect(students[B].fatherName).toBeUndefined(); // nothing saved yet
    const done = await approve(app, filled.body.id);
    expect(done.body.certificate.snapshot).toMatchObject({
      fatherName: "Ram",
      dob: "2013-05-01",
      nationality: "Indian",
    });
    expect(students[B]).toMatchObject({
      fatherName: "Ram",
      category: "OBC",
      status: "inactive",
    });
    const r = await ask(
      app,
      "key-87654321",
      body({ aparId: "1234-5678", pen: "P1" }),
    );
    await approve(app, r.body.id);
    expect(students[A]).toMatchObject({ aparId: "1234-5678", pen: "P1" });
  });

  it("days present cannot be more than working days; compulsory fields are enforced", async () => {
    const { app } = build();
    expect(
      (await ask(app, "key-12345678", body({ daysPresent: 300 }))).status,
    ).toBe(400);
    expect(
      (await ask(app, "key-12345679", body({ lastExam: "" }))).status,
    ).toBe(400);
    expect(
      (await ask(app, "key-12345670", body({ conduct: "Bad" }))).status,
    ).toBe(400);
  });

  it("Principal and Cashier can list requests and TCs; status filter works", async () => {
    const { app } = build();
    const r = await ask(app, "key-12345678", body());
    for (const who of ["principal", "cashier"]) {
      const l = await request(app)
        .get("/api/certificate-requests?status=pending")
        .set(as(who));
      expect(l.status).toBe(200);
      expect(l.body.rows).toHaveLength(1);
      expect(
        (
          await request(app)
            .get(`/api/certificate-requests/${r.body.id}`)
            .set(as(who))
        ).status,
      ).toBe(200);
    }
    await approve(app, r.body.id);
    expect(
      (
        await request(app)
          .get("/api/certificate-requests?status=pending")
          .set(as("admin"))
      ).body.total,
    ).toBe(0);
    for (const who of ["principal", "cashier"]) {
      expect(
        (await request(app).get("/api/tc").set(as(who))).body.rows,
      ).toHaveLength(1);
      expect(
        (
          await request(app)
            .get("/api/tc/000000000000000000000143")
            .set(as(who))
        ).status,
      ).toBe(200);
    }
  });

  it("first print is the original, later prints are duplicates; all audited; cancel reactivates and needs a reason", async () => {
    const { app, students, audit } = build();
    const tc = await issue(app);
    const first = await request(app)
      .post(`/api/tc/${tc.id}/print`)
      .set(as("admin"));
    expect(first.body).toMatchObject({
      copyNo: null,
      originalPrinted: true,
      duplicateCount: 0,
    });
    const dup = await request(app)
      .post(`/api/tc/${tc.id}/print`)
      .set(as("admin"));
    expect(dup.body).toMatchObject({ duplicateCount: 1, copyNo: 1 });
    expect(audit.some((a) => a.action === "reprint")).toBe(true);
    expect(
      (
        await request(app)
          .post(`/api/tc/${tc.id}/cancel`)
          .set(as("admin"))
          .send({ reason: "x" })
      ).status,
    ).toBe(400);
    const c = await request(app)
      .post(`/api/tc/${tc.id}/cancel`)
      .set(as("admin"))
      .send({ reason: "Issued by mistake" });
    expect(c.body).toMatchObject({
      status: "cancelled",
      cancelReason: "Issued by mistake",
    });
    expect(students[A]).toMatchObject({
      status: "active",
      inactiveReason: null,
    });
    expect(
      (await request(app).post(`/api/tc/${tc.id}/print`).set(as("admin")))
        .status,
    ).toBe(404);
  });

  it("an already inactive student may still get a TC", async () => {
    const { app } = build();
    const r = await ask(
      app,
      "key-12345678",
      body({ studentId: "c".repeat(24) }),
    );
    expect(r.status).toBe(201);
    expect((await approve(app, r.body.id)).status).toBe(200);
  });
});

describe("Bonafide request and approval", () => {
  const askBon = (app, who, key, b) =>
    request(app)
      .post("/api/certificate-requests/bonafide")
      .set(as(who))
      .set("Idempotency-Key", key)
      .send(b);
  it("Admin asks even with dues; the Principal approves and the number is BON/FY2026-27/001", async () => {
    const { app, bons } = build({ charges: dueCharge });
    for (const who of ["principal", "cashier"])
      expect(
        (
          await askBon(app, who, "key-12345678", {
            studentId: A,
            purpose: "Passport",
          })
        ).status,
      ).toBe(403);
    const r = await askBon(app, "admin", "key-12345678", {
      studentId: A,
      purpose: "Passport",
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ kind: "bonafide", status: "pending" });
    expect(bons).toHaveLength(0);
    const done = await approve(app, r.body.id);
    expect(done.body.certificate).toMatchObject({
      number: "BON/FY2026-27/001",
      academicYear: "2026-27",
      dateOfIssue: "2026-10-13",
      approvedByName: "principal",
    });
    expect(done.body.certificate.snapshot).toMatchObject({
      name: "Aarav",
      dob: "2014-03-14",
      gender: "MALE",
    });
    const r2 = await askBon(app, "admin", "key-87654321", {
      studentId: A,
      purpose: "Bank",
    });
    expect((await approve(app, r2.body.id)).body.certificate.number).toBe(
      "BON/FY2026-27/002",
    );
  });
  it("rejecting takes no number; the same student cannot have two waiting requests", async () => {
    const { app } = build();
    const r = await askBon(app, "admin", "key-12345678", {
      studentId: A,
      purpose: "Passport",
    });
    expect(
      (
        await askBon(app, "admin", "key-87654321", {
          studentId: A,
          purpose: "Bank",
        })
      ).status,
    ).toBe(409);
    expect((await reject(app, r.body.id, "Not needed")).body.status).toBe(
      "rejected",
    );
    const next = await askBon(app, "admin", "key-11111111", {
      studentId: A,
      purpose: "Bank",
    });
    expect((await approve(app, next.body.id)).body.certificate.number).toBe(
      "BON/FY2026-27/001",
    );
  });
  it("only for active students; a purpose is required", async () => {
    const { app } = build();
    expect(
      (
        await askBon(app, "admin", "key-12345678", {
          studentId: "c".repeat(24),
          purpose: "Passport",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await askBon(app, "admin", "key-12345679", {
          studentId: A,
          purpose: "",
        })
      ).status,
    ).toBe(400);
  });
  it("everyone can list; only the Admin prints: original first, then duplicates", async () => {
    const { app } = build();
    const r = await askBon(app, "admin", "key-12345678", {
      studentId: A,
      purpose: "Passport",
    });
    const b = (await approve(app, r.body.id)).body.certificate;
    expect(
      (await request(app).get("/api/bonafide").set(as("cashier"))).body.total,
    ).toBe(1);
    expect(
      (
        await request(app)
          .post(`/api/bonafide/${b.id}/print`)
          .set(as("principal"))
      ).status,
    ).toBe(403);
    expect(
      (await request(app).post(`/api/bonafide/${b.id}/print`).set(as("admin")))
        .body.copyNo,
    ).toBeNull();
    expect(
      (await request(app).post(`/api/bonafide/${b.id}/print`).set(as("admin")))
        .body.copyNo,
    ).toBe(1);
  });
  it("only the Admin cancels a Bonafide, with a reason; it cannot be printed or cancelled again", async () => {
    const { app, audit } = build();
    const r = await askBon(app, "admin", "key-12345678", {
      studentId: A,
      purpose: "Passport",
    });
    const b = (await approve(app, r.body.id)).body.certificate;
    const url = `/api/bonafide/${b.id}/cancel`;
    for (const who of ["principal", "cashier"])
      expect(
        (
          await request(app)
            .post(url)
            .set(as(who))
            .send({ reason: "Wrong name" })
        ).status,
      ).toBe(403);
    expect(
      (await request(app).post(url).set(as("admin")).send({ reason: "x" }))
        .status,
    ).toBe(400);
    const c = await request(app)
      .post(url)
      .set(as("admin"))
      .send({ reason: "Wrong name" });
    expect(c.body).toMatchObject({
      status: "cancelled",
      cancelReason: "Wrong name",
    });
    expect(
      audit.some(
        (a) => a.action === "cancel" && a.entity === "bonafide_certificate",
      ),
    ).toBe(true);
    expect(
      (await request(app).post(url).set(as("admin")).send({ reason: "Again" }))
        .status,
    ).toBe(404);
    expect(
      (await request(app).post(`/api/bonafide/${b.id}/print`).set(as("admin")))
        .status,
    ).toBe(404);
  });
});

describe("TC settings", () => {
  it("Admin saves Book No. and start Sl. No.; the start is locked once a TC exists", async () => {
    const { app } = build();
    const put = (b) =>
      request(app).put("/api/certificates/settings").set(as("admin")).send(b);
    expect((await put({ tcBookNo: "8", tcStartSl: 200 })).body).toMatchObject({
      tcBookNo: "8",
      tcStartSl: 200,
    });
    await issue(app);
    const locked = await put({ tcBookNo: "8", tcStartSl: 300 });
    expect(locked.status).toBe(409);
    expect((await put({ tcBookNo: "9", tcStartSl: 200 })).status).toBe(200); // Book No. may change
    const g = await request(app)
      .get("/api/certificates/settings")
      .set(as("cashier"));
    expect(g.body.startLocked).toBe(true);
  });
});
