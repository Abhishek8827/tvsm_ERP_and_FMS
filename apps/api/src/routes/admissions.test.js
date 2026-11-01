import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const T = "tvsm";
const env = loadEnv({
  MONGODB_URI: "mongodb://unused",
  NODE_ENV: "test",
  DEFAULT_TENANT_ID: T,
});
const mk = (id, role) => ({
  _id: id,
  firebaseUid: id,
  email: `${id}@x.com`,
  name: id,
  role,
  tenantId: T,
  isActive: true,
});
const users = {
  admin: mk("admin", "admin"),
  principal: mk("principal", "principal"),
  cashier: mk("cashier", "cashier"),
};
const as = (t) => ({ Authorization: `Bearer ${t}` });
const hex = (n) => n.toString(16).padStart(24, "0");
const key = (() => {
  let i = 0;
  return () => `key-${(i += 1)}-abcdefgh`;
})();

let forms;
let receipts;
let audit;
let dayClosed;
let nextNo;
let app;
beforeEach(() => {
  forms = [];
  receipts = [];
  audit = [];
  dayClosed = false;
  nextNo = 1251;
  const store = {
    getSettings: async () => ({ session: "2026-27" }),
    saveSettings: async (_t, session) => ({ session }),
    create: async ({ session, data, idempotencyKey }) => {
      const old = forms.find((f) => f.idempotencyKey === idempotencyKey);
      if (old) return { admission: old, replay: true };
      const seq = forms.length + 1;
      const doc = {
        ...data,
        _id: hex(seq),
        session,
        seq,
        formNo: `NEW/${session}/${String(seq).padStart(3, "0")}`,
        status: "pending",
        idempotencyKey,
      };
      forms.push(doc);
      return { admission: doc, replay: false };
    },
    findById: async (_t, id) => forms.find((f) => f._id === id) ?? null,
    list: async () => ({ rows: forms, total: forms.length }),
    receiptsFor: async (_t, ids) =>
      receipts.filter((r) => ids.includes(r.studentId)),
    update: async (_t, id, data) =>
      Object.assign(
        forms.find((f) => f._id === id),
        data,
      ),
    setStatus: async ({ id, from, to, reason }) => {
      const f = forms.find((x) => x._id === id && x.status === from);
      return f ? Object.assign(f, { status: to, cancelReason: reason }) : null;
    },
    findSimilar: async () => ({
      students: [
        {
          _id: hex(900),
          admissionNo: "1100",
          name: "Asha",
          classKey: "3",
          status: "active",
        },
      ],
      admissions: [],
    }),
    nextScholarNo: async () => nextNo,
    admit: async ({ id, scholarNo }) => {
      const f = forms.find((x) => x._id === id);
      if (f.status === "admitted") return { admission: f, replay: true };
      if (String(scholarNo) !== String(nextNo))
        throw new AppError(
          "SCHOLAR_NO_CHANGED",
          409,
          `Next free number is ${nextNo}.`,
          {
            scholarNo: String(nextNo),
          },
        );
      nextNo += 1;
      Object.assign(f, {
        status: "admitted",
        scholarNo: String(scholarNo),
        studentId: hex(500),
      });
      return { admission: f, replay: false, studentId: hex(500) };
    },
  };
  const receiptStore = {
    issue: async ({
      studentId,
      idempotencyKey,
      kind,
      allYears,
      build,
      audit: au,
    }) => {
      const old = receipts.find((r) => r.idempotencyKey === idempotencyKey);
      if (old) return { receipt: old, replay: true };
      expect(kind).toBe("admission");
      expect(allYears).toBe(true);
      const doc = await build(
        receipts.filter((r) => r.studentId === studentId),
      );
      const saved = {
        ...doc,
        _id: hex(1000 + receipts.length),
        studentId,
        kind,
        idempotencyKey,
        number: `A-FY2026-27/${String(receipts.length + 1).padStart(4, "0")}`,
        issuedAt: new Date(),
      };
      receipts.push(saved);
      await au(saved, null);
      return { receipt: saved, replay: false };
    },
  };
  app = createApp(env, createLogger("silent"), {
    verifyToken: async (t) => ({ uid: t, role: t, tenantId: T }),
    userStore: {
      findByFirebaseUid: async (_t, uid) => users[uid],
      touchLogin: async () => {},
    },
    auditStore: { append: async (e) => audit.push(e) },
    admissionStore: store,
    receiptStore,
    feeStore: {
      get: async () => ({
        classFees: [
          { classKey: "1", admissionPaise: 500000 },
          { classKey: "2", admissionPaise: 600000 },
        ],
      }),
    },
    moneyStore: {
      findActiveBank: async (_t, id) =>
        id === hex(7) ? { _id: id, name: "SBI" } : null,
    },
    dayCloseStore: { isClosed: async () => dayClosed },
  });
});

const newForm = (who = "cashier", extra = {}) =>
  request(app)
    .post("/api/admissions")
    .set(as(who))
    .set("Idempotency-Key", key())
    .send({
      name: "Riya Sharma",
      fatherName: "Mohan Sharma",
      classKey: "1",
      ...extra,
    });
const pay = (id, body, who = "cashier", k = key()) =>
  request(app)
    .post(`/api/admissions/${id}/receipts`)
    .set(as(who))
    .set("Idempotency-Key", k)
    .send(body);

describe("New Admissions: who can do what", () => {
  it("Cashier and Admin enter forms; the Principal can only look", async () => {
    expect((await newForm("cashier")).status).toBe(201);
    expect((await newForm("admin")).status).toBe(201);
    expect((await newForm("principal")).status).toBe(403);
    expect(
      (await request(app).get("/api/admissions").set(as("principal"))).status,
    ).toBe(200);
  });
  it("only the Admin edits, sets status, admits and changes the session", async () => {
    const id = (await newForm()).body.id;
    for (const [m, url, body] of [
      ["patch", `/api/admissions/${id}`, { name: "X Y" }],
      ["post", `/api/admissions/${id}/status`, { status: "cancelled" }],
      ["post", `/api/admissions/${id}/admit`, { scholarNo: 1251 }],
      ["put", "/api/admissions/settings", { session: "2027-28" }],
      ["get", "/api/admissions/next-scholar-no", undefined],
    ])
      for (const who of ["cashier", "principal"])
        expect(
          (await request(app)[m](url).set(as(who)).send(body)).status,
        ).toBe(403);
  });
});

describe("creating a form", () => {
  it("gives the number, Rs 100 form fee, and the class admission fee from the Fee Structure", async () => {
    const r = await newForm("cashier", { classKey: "2" });
    expect(r.body).toMatchObject({
      formNo: "NEW/2026-27/001",
      status: "pending",
      formFeePaise: 10000,
      admissionFeePaise: 600000,
    });
    expect(r.body.dues.outstandingPaise).toBe(610000);
    expect(r.body.collectedBy).toBe("cashier"); // defaults to the logged-in user
    expect(audit.some((a) => a.entity === "admission_form")).toBe(true);
  });
  it("the same Idempotency-Key never makes a second form", async () => {
    const k = key();
    const send = () =>
      request(app)
        .post("/api/admissions")
        .set(as("cashier"))
        .set("Idempotency-Key", k)
        .send({ name: "Riya", classKey: "1" });
    const a = await send();
    const b = await send();
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(forms).toHaveLength(1);
  });
  it("needs a name, a class, a header key, and a Fee Structure for that class", async () => {
    expect((await newForm("cashier", { name: "" })).status).toBe(400);
    expect((await newForm("cashier", { classKey: "nope" })).status).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/admissions")
          .set(as("cashier"))
          .send({ name: "Ab", classKey: "1" })
      ).status,
    ).toBe(400);
    const none = await newForm("cashier", { classKey: "PG" });
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe("NO_CLASS_FEE");
  });
  it("a possible duplicate only warns: the form is still saved", async () => {
    const warn = await request(app)
      .get("/api/admissions/similar?name=Asha&fatherName=Raj")
      .set(as("cashier"));
    expect(warn.body.students[0].admissionNo).toBe("1100");
    expect((await newForm("admin", { name: "Asha" })).status).toBe(201);
  });
});

describe("fee payments (real receipts)", () => {
  it("part-pays, shows Partial, refuses more than pending, and replays on the same key", async () => {
    const id = (await newForm()).body.id;
    const k = key();
    const ok = await pay(
      id,
      { input: { formPaise: 10000, admissionPaise: 200000 }, mode: "cash" },
      "cashier",
      k,
    );
    expect(ok.status).toBe(201);
    expect(ok.body.receipt.number).toBe("A-FY2026-27/0001");
    expect(ok.body.admission.dues.form.status).toBe("paid");
    expect(ok.body.admission.dues.admission.status).toBe("partial");
    expect(ok.body.admission.dues.outstandingPaise).toBe(300000);
    const again = await pay(
      id,
      { input: { formPaise: 10000, admissionPaise: 200000 }, mode: "cash" },
      "cashier",
      k,
    );
    expect(again.status).toBe(200);
    expect(receipts).toHaveLength(1);
    const over = await pay(id, {
      input: { admissionPaise: 400000 },
      mode: "cash",
    });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe("MORE_THAN_DUE");
    expect((await pay(id, { input: {}, mode: "cash" })).status).toBe(422);
  });
  it("UPI needs a reference and a bank; a closed day and a cancelled form refuse money", async () => {
    const id = (await newForm()).body.id;
    const body = { input: { formPaise: 10000 }, mode: "upi" };
    expect((await pay(id, body)).body.error.code).toBe("REFERENCE_REQUIRED");
    expect(
      (await pay(id, { ...body, reference: "UTR12345" })).body.error.code,
    ).toBe("BANK_REQUIRED");
    expect(
      (await pay(id, { ...body, reference: "UTR12345", bankId: hex(7) }))
        .status,
    ).toBe(201);
    dayClosed = true;
    expect(
      (await pay(id, { input: { admissionPaise: 100 }, mode: "cash" })).body
        .error.code,
    ).toBe("DAY_CLOSED");
    dayClosed = false;
    await request(app)
      .post(`/api/admissions/${id}/status`)
      .set(as("admin"))
      .send({ status: "cancelled", reason: "Not coming" });
    expect(
      (await pay(id, { input: { admissionPaise: 100 }, mode: "cash" })).body
        .error.code,
    ).toBe("ADMISSION_CANCELLED");
  });
  it("the class cannot change once admission fee is collected", async () => {
    const id = (await newForm()).body.id;
    expect(
      (
        await request(app)
          .patch(`/api/admissions/${id}`)
          .set(as("admin"))
          .send({ classKey: "2" })
      ).body.admissionFeePaise,
    ).toBe(600000);
    await pay(id, { input: { admissionPaise: 1000 }, mode: "cash" });
    const locked = await request(app)
      .patch(`/api/admissions/${id}`)
      .set(as("admin"))
      .send({ classKey: "1" });
    expect(locked.body.error.code).toBe("CLASS_LOCKED");
  });
});

describe("status and admitting", () => {
  it("Pending <-> Cancelled stays in the list; the reason is audited", async () => {
    const id = (await newForm()).body.id;
    const c = await request(app)
      .post(`/api/admissions/${id}/status`)
      .set(as("admin"))
      .send({ status: "cancelled", reason: "Joined elsewhere" });
    expect(c.body.status).toBe("cancelled");
    expect(audit.find((a) => a.action === "cancel").reason).toBe(
      "Joined elsewhere",
    );
    const back = await request(app)
      .post(`/api/admissions/${id}/status`)
      .set(as("admin"))
      .send({ status: "pending" });
    expect(back.body.status).toBe("pending");
    expect(
      (await request(app).get("/api/admissions").set(as("cashier"))).body.rows,
    ).toHaveLength(1);
  });
  it("shows the next scholar number; admitting needs exactly that number", async () => {
    const id = (await newForm()).body.id;
    expect(
      (
        await request(app)
          .get("/api/admissions/next-scholar-no")
          .set(as("admin"))
      ).body.scholarNo,
    ).toBe("1251");
    const stale = await request(app)
      .post(`/api/admissions/${id}/admit`)
      .set(as("admin"))
      .send({ scholarNo: 1250 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.fields.scholarNo).toBe("1251"); // the new number to confirm
    const ok = await request(app)
      .post(`/api/admissions/${id}/admit`)
      .set(as("admin"))
      .send({ scholarNo: 1251 });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ status: "admitted", scholarNo: "1251" });
    expect(
      audit.some(
        (a) => a.entity === "student" && a.newValue.scholarNo === "1251",
      ),
    ).toBe(true);
    // second click: no second student, no second number
    const again = await request(app)
      .post(`/api/admissions/${id}/admit`)
      .set(as("admin"))
      .send({ scholarNo: 1251 });
    expect(again.status).toBe(200);
    expect(again.body.replay).toBe(true);
    expect(
      (
        await request(app)
          .get("/api/admissions/next-scholar-no")
          .set(as("admin"))
      ).body.scholarNo,
    ).toBe("1252");
  });
  it("an admitted child cannot be edited or moved back", async () => {
    const id = (await newForm()).body.id;
    await request(app)
      .post(`/api/admissions/${id}/admit`)
      .set(as("admin"))
      .send({ scholarNo: 1251 });
    expect(
      (
        await request(app)
          .patch(`/api/admissions/${id}`)
          .set(as("admin"))
          .send({ name: "New Name" })
      ).body.error.code,
    ).toBe("ALREADY_ADMITTED");
    expect(
      (
        await request(app)
          .post(`/api/admissions/${id}/status`)
          .set(as("admin"))
          .send({ status: "pending" })
      ).body.error.code,
    ).toBe("ALREADY_ADMITTED");
  });
  it("the scholar number must be digits", async () => {
    const id = (await newForm()).body.id;
    expect(
      (
        await request(app)
          .post(`/api/admissions/${id}/admit`)
          .set(as("admin"))
          .send({ scholarNo: "12A" })
      ).status,
    ).toBe(422);
  });
});
