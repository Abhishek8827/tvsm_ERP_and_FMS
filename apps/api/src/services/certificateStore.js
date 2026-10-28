import mongoose from "mongoose";
import { BonafideCertificate } from "../models/BonafideCertificate.js";
import { CertificateRequest } from "../models/CertificateRequest.js";
import { CertificateSettings } from "../models/CertificateSettings.js";
import { Counter } from "../models/Counter.js";
import { Student } from "../models/Student.js";
import { TransferCertificate } from "../models/TransferCertificate.js";

const isDuplicateKey = (err) => err?.code === 11000;
const isRetryable = (err) =>
  isDuplicateKey(err) || err?.hasErrorLabel?.("TransientTransactionError");
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Runs fn(session) in a transaction; a lost race on the idempotency key returns the winner. */
async function inTxn(fn, replay) {
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result;
    } catch (err) {
      last = err;
      if (isDuplicateKey(err)) {
        const again = await replay();
        if (again) return again;
      }
      if (!isRetryable(err)) throw err;
    } finally {
      await session.endSession();
    }
  }
  throw last;
}

// Takes the student's lock (the same one receipts use) so a TC and a payment queue up.
const lockStudent = (tenantId, studentId, session) =>
  Counter.updateOne(
    { tenantId, key: `lock:${studentId}` },
    { $inc: { seq: 1 } },
    { upsert: true, session },
  );

/** Next number of a series. `first` is the number the series starts from (a new series only). */
async function nextSeq(tenantId, key, first, session) {
  await Counter.updateOne(
    { tenantId, key },
    { $setOnInsert: { seq: first - 1 } },
    { upsert: true, session },
  );
  const c = await Counter.findOneAndUpdate(
    { tenantId, key },
    { $inc: { seq: 1 } },
    { returnDocument: "after", session },
  ).lean();
  return c.seq;
}

function certFilter({ tenantId, q, status }, nameField) {
  const f = { tenantId };
  if (status) f.status = status;
  if (q) {
    const rx = new RegExp(escapeRx(q), "i");
    f.$or = [
      { [`${nameField}.name`]: rx },
      { [`${nameField}.admissionNo`]: rx },
    ];
  }
  return f;
}

/** First print = original (marks the time); later prints = duplicate copies (counted). */
async function printOnce(Model, tenantId, id) {
  const first = await Model.findOneAndUpdate(
    { tenantId, _id: id, status: "issued", originalPrintedAt: null },
    { $set: { originalPrintedAt: new Date() } },
    { new: true },
  ).lean();
  if (first) return { cert: first, copyNo: null };
  const dup = await Model.findOneAndUpdate(
    { tenantId, _id: id, status: "issued" },
    { $inc: { duplicateCount: 1 } },
    { new: true },
  ).lean();
  return dup ? { cert: dup, copyNo: dup.duplicateCount } : null;
}

/** Data access for TC and Bonafide certificates (and the TC settings). */
export function makeCertificateStore() {
  const page = async (Model, filter, page, pageSize) => {
    const [rows, total] = await Promise.all([
      Model.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      Model.countDocuments(filter),
    ]);
    return { rows, total };
  };
  return {
    getSettings: (tenantId) => CertificateSettings.findOne({ tenantId }).lean(),
    saveSettings: ({ tenantId, tcBookNo, tcStartSl, user }) =>
      CertificateSettings.findOneAndUpdate(
        { tenantId },
        {
          $set: { tcBookNo, tcStartSl },
          $push: {
            history: { at: new Date(), byName: user.name, tcBookNo, tcStartSl },
          },
        },
        { upsert: true, new: true },
      ).lean(),
    countTcInFy: (tenantId, fy) =>
      TransferCertificate.countDocuments({ tenantId, fy }),
    // The one TC of this student that is still valid (not cancelled), if any.
    activeTcForStudent: (tenantId, studentId) =>
      TransferCertificate.findOne({
        tenantId,
        studentId,
        status: "issued",
      }).lean(),
    findBonafideByKey: (tenantId, key) =>
      BonafideCertificate.findOne({ tenantId, idempotencyKey: key }).lean(),
    findTcByKey: (tenantId, key) =>
      TransferCertificate.findOne({ tenantId, idempotencyKey: key }).lean(),

    /**
     * Issues a TC in ONE transaction: student lock, gap-free Sl. No., the TC record, the
     * student's new status (and any details the Admin filled in) and the audit entry. The same
     * Idempotency-Key twice returns the first TC. `prepare(student)` checks the rules and returns
     * { doc, studentPatch }; it throws to refuse.
     */
    async issueTc({
      tenantId,
      studentId,
      fy,
      startSl,
      idempotencyKey,
      user,
      prepare,
      audit,
    }) {
      const replay = async () => {
        const t = await TransferCertificate.findOne({
          tenantId,
          idempotencyKey,
        }).lean();
        return t ? { tc: t, replay: true } : null;
      };
      return inTxn(async (session) => {
        const existing = await TransferCertificate.findOne({
          tenantId,
          idempotencyKey,
        })
          .session(session)
          .lean();
        if (existing) return { tc: existing, replay: true };
        await lockStudent(tenantId, studentId, session);
        const student = await Student.findOne({ tenantId, _id: studentId })
          .session(session)
          .lean();
        const already = await TransferCertificate.exists({
          tenantId,
          studentId,
          status: "issued",
        }).session(session);
        const { doc, studentPatch } = await prepare(student, Boolean(already));
        const slNo = await nextSeq(tenantId, `tc:${fy}`, startSl, session);
        const [created] = await TransferCertificate.create(
          [
            {
              ...doc,
              tenantId,
              fy,
              slNo,
              studentId,
              idempotencyKey,
              issuedBy: String(user.id),
              issuedByName: user.name,
            },
          ],
          { session, ordered: true },
        );
        await Student.updateOne(
          { tenantId, _id: studentId },
          { $set: studentPatch },
          { session },
        );
        const tc = created.toObject();
        if (audit) await audit(tc, session);
        return { tc, replay: false };
      }, replay);
    },
    listTc: ({ tenantId, q, status, page: p = 1, pageSize = 25 }) =>
      page(
        TransferCertificate,
        certFilter({ tenantId, q, status }, "snapshot"),
        p,
        pageSize,
      ),
    getTc: (tenantId, id) =>
      TransferCertificate.findOne({ tenantId, _id: id }).lean(),
    // The FIRST print is the original; each print after it is a DUPLICATE copy (counted).
    printTc: (tenantId, id) => printOnce(TransferCertificate, tenantId, id),
    /** Cancels a TC (number stays used) and puts the student back on the active rolls. */
    async cancelTc({ tenantId, id, reason, user, audit }) {
      return inTxn(
        async (session) => {
          const tc = await TransferCertificate.findOneAndUpdate(
            { tenantId, _id: id, status: "issued" },
            {
              $set: {
                status: "cancelled",
                cancelReason: reason,
                cancelledAt: new Date(),
                cancelledByName: user.name,
              },
            },
            { new: true, session },
          ).lean();
          if (!tc) return null;
          await Student.updateOne(
            { tenantId, _id: tc.studentId },
            { $set: { status: "active", inactiveReason: null } },
            { session },
          );
          if (audit) await audit(tc, session);
          return tc;
        },
        async () => null,
      );
    },

    /** Cancels an issued Bonafide. The number stays used. Returns null if it is not 'issued'. */
    async cancelBonafide({ tenantId, id, reason, user, audit }) {
      return inTxn(
        async (session) => {
          const b = await BonafideCertificate.findOneAndUpdate(
            { tenantId, _id: id, status: "issued" },
            {
              $set: {
                status: "cancelled",
                cancelReason: reason,
                cancelledAt: new Date(),
                cancelledByName: user.name,
              },
            },
            { new: true, session },
          ).lean();
          if (!b) return null;
          if (audit) await audit(b, session);
          return b;
        },
        async () => null,
      );
    },

    async issueBonafide({
      tenantId,
      studentId,
      fy,
      idempotencyKey,
      user,
      prepare,
      audit,
    }) {
      const replay = async () => {
        const b = await BonafideCertificate.findOne({
          tenantId,
          idempotencyKey,
        }).lean();
        return b ? { bonafide: b, replay: true } : null;
      };
      return inTxn(async (session) => {
        const existing = await BonafideCertificate.findOne({
          tenantId,
          idempotencyKey,
        })
          .session(session)
          .lean();
        if (existing) return { bonafide: existing, replay: true };
        await lockStudent(tenantId, studentId, session);
        const student = await Student.findOne({ tenantId, _id: studentId })
          .session(session)
          .lean();
        const { makeNumber, ...doc } = await prepare(student);
        const seq = await nextSeq(tenantId, `bonafide:${fy}`, 1, session);
        const [created] = await BonafideCertificate.create(
          [
            {
              ...doc,
              number: makeNumber(seq),
              tenantId,
              fy,
              seq,
              studentId,
              idempotencyKey,
              issuedBy: String(user.id),
              issuedByName: user.name,
            },
          ],
          { session, ordered: true },
        );
        const b = created.toObject();
        if (audit) await audit(b, session);
        return { bonafide: b, replay: false };
      }, replay);
    },
    listBonafide: ({ tenantId, q, status, page: p = 1, pageSize = 25 }) =>
      page(
        BonafideCertificate,
        certFilter({ tenantId, q, status }, "snapshot"),
        p,
        pageSize,
      ),
    getBonafide: (tenantId, id) =>
      BonafideCertificate.findOne({ tenantId, _id: id }).lean(),
    printBonafide: (tenantId, id) =>
      printOnce(BonafideCertificate, tenantId, id),

    // ---------- requests (the Principal approves before a number is given)
    findRequestByKey: (tenantId, idempotencyKey) =>
      CertificateRequest.findOne({ tenantId, idempotencyKey }).lean(),
    pendingRequestFor: (tenantId, studentId, kind) =>
      CertificateRequest.findOne({
        tenantId,
        studentId,
        kind,
        status: "pending",
      }).lean(),
    /** Saves a request. A lost race on the key returns the winner; a second waiting request for the same student and kind is refused. */
    async createRequest(doc) {
      try {
        const [made] = await CertificateRequest.create([doc], {
          ordered: true,
        });
        return { request: made.toObject(), replay: false };
      } catch (err) {
        if (!isDuplicateKey(err)) throw err;
        const same = await CertificateRequest.findOne({
          tenantId: doc.tenantId,
          idempotencyKey: doc.idempotencyKey,
        }).lean();
        if (same) return { request: same, replay: true };
        throw Object.assign(
          new Error("A request is already waiting for this student."),
          {
            code: "REQUEST_PENDING",
          },
        );
      }
    },
    listRequests: ({
      tenantId,
      kind,
      status,
      q,
      page: p = 1,
      pageSize = 25,
    }) => {
      const f = { tenantId };
      if (kind) f.kind = kind;
      if (status) f.status = status;
      if (q) {
        const rx = new RegExp(escapeRx(q), "i");
        f.$or = [{ studentName: rx }, { admissionNo: rx }];
      }
      return page(CertificateRequest, f, p, pageSize);
    },
    getRequest: (tenantId, id) =>
      CertificateRequest.findOne({ tenantId, _id: id }).lean(),
    /** Marks a request approved INSIDE the issuing transaction; null if it is no longer pending. */
    markRequestApproved: ({
      tenantId,
      id,
      certificateId,
      certificateNumber,
      user,
      session,
    }) =>
      CertificateRequest.findOneAndUpdate(
        { tenantId, _id: id, status: "pending" },
        {
          $set: {
            status: "approved",
            certificateId: String(certificateId),
            certificateNumber,
            decidedBy: String(user.id),
            decidedByName: user.name,
            decidedAt: new Date(),
          },
        },
        { new: true, session },
      ).lean(),
    async rejectRequest({ tenantId, id, reason, user, audit }) {
      return inTxn(
        async (session) => {
          const r = await CertificateRequest.findOneAndUpdate(
            { tenantId, _id: id, status: "pending" },
            {
              $set: {
                status: "rejected",
                rejectReason: reason,
                decidedBy: String(user.id),
                decidedByName: user.name,
                decidedAt: new Date(),
              },
            },
            { new: true, session },
          ).lean();
          if (!r) return null;
          if (audit) await audit(r, session);
          return r;
        },
        async () => null,
      );
    },
  };
}
