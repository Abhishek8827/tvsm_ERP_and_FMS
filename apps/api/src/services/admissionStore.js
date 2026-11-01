import mongoose from "mongoose";
import { ADMISSION_STUDENT_FIELDS, formNumber } from "@erp/shared";
import { AdmissionSettings } from "../models/AdmissionSettings.js";
import { Counter } from "../models/Counter.js";
import { NewAdmission } from "../models/NewAdmission.js";
import { Receipt } from "../models/Receipt.js";
import { ReceiptCancellation } from "../models/ReceiptCancellation.js";
import { Student } from "../models/Student.js";
import { AppError, notFound } from "../utils/errors.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isDuplicateKey = (e) => e?.code === 11000;
const transient = (e) =>
  e?.hasErrorLabel?.("TransientTransactionError") ||
  e?.hasErrorLabel?.("UnknownTransactionCommitResult");

/** Receipts of these forms that still count (a cancelled receipt carries no money). */
async function liveReceipts(tenantId, ids, session = null) {
  if (!ids.length) return [];
  const gone = (
    await ReceiptCancellation.find({ tenantId, status: "cancelled" })
      .select("receiptId")
      .session(session)
      .lean()
  ).map((r) => r.receiptId);
  return Receipt.find({
    tenantId,
    kind: "admission",
    studentId: { $in: ids },
    _id: { $nin: gone },
  })
    .sort({ issuedAt: 1 })
    .session(session)
    .lean();
}

/**
 * The next free scholar number: one more than the highest number-only admission number among the
 * students, or than the highest ever handed out (so deleting a student never lets a number be
 * reused). Always read inside the admit transaction too; this is never trusted from the screen.
 */
export async function nextScholarNo(tenantId, session = null) {
  const [top] = await Student.aggregate([
    { $match: { tenantId, admissionNo: { $regex: "^[0-9]{1,15}$" } } },
    { $group: { _id: null, max: { $max: { $toLong: "$admissionNo" } } } },
  ]).session(session);
  const mark = await Counter.findOne({ tenantId, key: "scholar:max" })
    .session(session)
    .lean();
  return Math.max(top?.max ?? 0, mark?.seq ?? 0) + 1;
}

export function makeAdmissionStore() {
  return {
    getSettings: (tenantId) => AdmissionSettings.findOne({ tenantId }).lean(),
    saveSettings: (tenantId, session, user) =>
      AdmissionSettings.findOneAndUpdate(
        { tenantId },
        { $set: { session, updatedByName: user.name } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean(),

    /**
     * Makes the form and its gap-free number in one transaction. The same Idempotency-Key again
     * returns the form already made, so a double click never makes a second form.
     */
    async create({ tenantId, session, data, idempotencyKey, user }) {
      let last;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const s = await mongoose.startSession();
        try {
          let result;
          await s.withTransaction(async () => {
            const existing = await NewAdmission.findOne({
              tenantId,
              idempotencyKey,
            })
              .session(s)
              .lean();
            if (existing) {
              result = { admission: existing, replay: true };
              return;
            }
            const counter = await Counter.findOneAndUpdate(
              { tenantId, key: `admission:${session}` },
              { $inc: { seq: 1 } },
              { upsert: true, returnDocument: "after", session: s },
            ).lean();
            const [doc] = await NewAdmission.create(
              [
                {
                  ...data,
                  tenantId,
                  session,
                  seq: counter.seq,
                  formNo: formNumber(session, counter.seq),
                  nameLower: data.name.toLowerCase(),
                  status: "pending",
                  createdBy: String(user.id),
                  createdByName: user.name,
                  idempotencyKey,
                },
              ],
              { session: s },
            );
            result = { admission: doc.toObject(), replay: false };
          });
          return result;
        } catch (err) {
          last = err;
          if (isDuplicateKey(err)) {
            const existing = await NewAdmission.findOne({
              tenantId,
              idempotencyKey,
            }).lean();
            if (existing) return { admission: existing, replay: true };
          }
          if (!transient(err)) throw err;
        } finally {
          await s.endSession();
        }
      }
      throw last;
    },

    findById: (tenantId, id) =>
      NewAdmission.findOne({ tenantId, _id: id }).lean(),

    async list({ tenantId, session, status, q, page, pageSize }) {
      const match = { tenantId };
      if (session) match.session = session;
      if (status) match.status = status;
      if (q?.trim()) {
        const words = q.trim().toLowerCase().split(/\s+/).slice(0, 5);
        match.$and = words.map((w) => {
          const rx = { $regex: escapeRegex(w), $options: "i" };
          return {
            $or: [
              { nameLower: { $regex: escapeRegex(w) } },
              { fatherName: rx },
              { formNo: rx },
              { contactNo: rx },
              { scholarNo: rx },
            ],
          };
        });
      }
      const [rows, total] = await Promise.all([
        NewAdmission.find(match)
          .sort({ seq: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
        NewAdmission.countDocuments(match),
      ]);
      return { rows, total };
    },

    /** Live (not cancelled) admission receipts, for one form or many. */
    receiptsFor: (tenantId, ids) => liveReceipts(tenantId, ids),

    update: (tenantId, id, data) =>
      NewAdmission.findOneAndUpdate(
        { tenantId, _id: id, status: { $ne: "admitted" } },
        {
          $set: {
            ...data,
            ...(data.name ? { nameLower: data.name.toLowerCase() } : {}),
          },
        },
        { new: true, runValidators: true },
      ).lean(),

    /** Pending <-> Cancelled. (Admitted only happens through `admit`.) */
    setStatus: ({ tenantId, id, from, to, reason, user }) =>
      NewAdmission.findOneAndUpdate(
        { tenantId, _id: id, status: from },
        {
          $set: {
            status: to,
            cancelReason: to === "cancelled" ? reason : null,
          },
          $push: {
            history: { at: new Date(), byName: user.name, from, to, reason },
          },
        },
        { new: true },
      ).lean(),

    /** Students and other forms that look like this child (warning only, never blocks). */
    async findSimilar(tenantId, { name, fatherName, dateOfBirth }) {
      const nameLower = name.trim().toLowerCase();
      const sameName = { tenantId, nameLower };
      const orClauses = [];
      if (fatherName?.trim())
        orClauses.push({
          fatherName: {
            $regex: `^${escapeRegex(fatherName.trim())}$`,
            $options: "i",
          },
        });
      if (dateOfBirth)
        orClauses.push({
          dateOfBirth: new Date(`${dateOfBirth}T00:00:00.000Z`),
        });
      if (!orClauses.length) return { students: [], admissions: [] };
      const where = { ...sameName, $or: orClauses };
      const [students, admissions] = await Promise.all([
        Student.find(where)
          .select("admissionNo name fatherName classKey section status")
          .limit(5)
          .lean(),
        NewAdmission.find(where)
          .select("formNo name fatherName classKey status")
          .limit(5)
          .lean(),
      ]);
      return { students, admissions };
    },

    nextScholarNo: (tenantId) => nextScholarNo(tenantId),

    /**
     * Admits the child: ONE transaction that re-reads the next scholar number, makes the student
     * with it (the unique index on the admission number is the final guard) and marks the form
     * Admitted. Either all of it happens or none: a failure leaves no half-admitted student.
     * The number the Admin confirmed must still be the next free one; if another admission took
     * it, nothing is saved and the answer carries the new number to confirm again (409).
     */
    async admit({ tenantId, id, scholarNo, user }) {
      const want = String(scholarNo);
      let last;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const s = await mongoose.startSession();
        try {
          let result;
          await s.withTransaction(async () => {
            // One admit at a time per school: a second Admin's click waits here.
            await Counter.updateOne(
              { tenantId, key: "lock:scholar" },
              { $inc: { seq: 1 } },
              { upsert: true, session: s },
            );
            const adm = await NewAdmission.findOne({ tenantId, _id: id })
              .session(s)
              .lean();
            if (!adm) throw notFound("Admission form");
            if (adm.status === "admitted") {
              result = { admission: adm, replay: true };
              return;
            }
            const next = String(await nextScholarNo(tenantId, s));
            if (want !== next)
              throw new AppError(
                "SCHOLAR_NO_CHANGED",
                409,
                `Scholar number ${want} is no longer the next free number. The next free number is ${next}. Please check it and confirm again.`,
                { scholarNo: next },
              );
            const fields = {};
            for (const f of ADMISSION_STUDENT_FIELDS)
              if (adm[f] != null) fields[f] = adm[f];
            const [student] = await Student.create(
              [
                {
                  ...fields,
                  tenantId,
                  admissionNo: want,
                  nameLower: adm.nameLower,
                  formNo: adm.formNo,
                  isNewAdmission: false, // its fees were handled on the admission form
                  firstAdmissionDate: new Date(),
                  firstAdmissionClass: adm.classKey,
                  status: "active",
                },
              ],
              { session: s },
            );
            await Counter.updateOne(
              { tenantId, key: "scholar:max" },
              { $max: { seq: Number(want) } },
              { upsert: true, session: s },
            );
            const done = await NewAdmission.findOneAndUpdate(
              { tenantId, _id: id, status: { $ne: "admitted" } },
              {
                $set: {
                  status: "admitted",
                  studentId: student._id,
                  scholarNo: want,
                  admittedAt: new Date(),
                  admittedByName: user.name,
                },
                $push: {
                  history: {
                    at: new Date(),
                    byName: user.name,
                    from: adm.status,
                    to: "admitted",
                  },
                },
              },
              { new: true, session: s },
            ).lean();
            if (!done)
              throw new AppError(
                "ALREADY_ADMITTED",
                409,
                "This child is already admitted.",
              );
            result = { admission: done, replay: false, studentId: student._id };
          });
          return result;
        } catch (err) {
          last = err;
          if (isDuplicateKey(err))
            throw new AppError(
              "SCHOLAR_NO_CHANGED",
              409,
              "Another admission took that scholar number a moment ago. Open Admit again to see the new number.",
              { scholarNo: String(await nextScholarNo(tenantId)) },
            );
          if (!transient(err)) throw err;
        } finally {
          await s.endSession();
        }
      }
      throw last;
    },
  };
}
