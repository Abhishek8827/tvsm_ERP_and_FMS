import mongoose from 'mongoose';
import { CLASS_KEYS, addDaysToDateString, istStartOfDay, receiptNumber } from '@erp/shared';
import { AuditLog } from '../models/AuditLog.js';
import { Charge } from '../models/Charge.js';
import { Counter } from '../models/Counter.js';
import { FeeStructure } from '../models/FeeStructure.js';
import { Receipt } from '../models/Receipt.js';
import { ReceiptCancellation } from '../models/ReceiptCancellation.js';
import { Student } from '../models/Student.js';
import { User } from '../models/User.js';

/**
 * Thin data-access layer. Routes and middleware depend on these small objects (not on Mongoose
 * directly) so tests can swap in simple fakes and the database code stays in one place.
 */
export function makeUserStore() {
  return {
    findByFirebaseUid: (tenantId, firebaseUid) => User.findOne({ tenantId, firebaseUid }).lean(),
    touchLogin: (tenantId, id) =>
      User.updateOne({ tenantId, _id: id }, { $set: { lastLoginAt: new Date() } }),
    async list({ tenantId, page, pageSize }) {
      const filter = { tenantId };
      const [rows, total] = await Promise.all([
        User.find(filter)
          .sort({ role: 1, name: 1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
        User.countDocuments(filter),
      ]);
      return { rows, total };
    },
  };
}

export function makeAuditStore() {
  return {
    async append(entry, { session } = {}) {
      await AuditLog.create([entry], session ? { session } : undefined);
    },
  };
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "2" before "10": compare scholar numbers as numbers, not as text.
const NUMERIC = { locale: 'en', numericOrdering: true };

export function makeStudentStore() {
  return {
    // Search: exact admission number, or name starting with the text (uses the nameLower index).
    async list({ tenantId, page, pageSize, q, classKey, section, status, sort, dir }) {
      const base = { tenantId };
      if (classKey) base.classKey = classKey;
      if (section) base.section = section;
      if (q && q.trim()) {
        // Every word typed must match somewhere (AND), and a word can match ANY part of the
        // name, father's name, mother's name, admission number, mobile number, address or
        // village (so "sha", "rajesh", "9876", "siwal" all work). Tenant + index narrow the
        // scan first, and one school has a few thousand students at most.
        const words = q.trim().toLowerCase().split(/\s+/).slice(0, 5);
        base.$and = words.map((w) => {
          const rx = { $regex: escapeRegex(w), $options: 'i' };
          return {
            $or: [
              { nameLower: { $regex: escapeRegex(w) } },
              { fatherName: rx },
              { motherName: rx },
              { admissionNo: rx },
              { contactNo: rx },
              { address: rx },
              { village: rx },
            ],
          };
        });
      }
      const filter = status ? { ...base, status } : base;
      const way = dir === 'desc' ? -1 : 1;
      // Every sort ends with the scholar number so the order is stable between pages.
      const SORTS = {
        admissionNo: { admissionNo: way },
        name: { nameLower: way, admissionNo: 1 },
        section: { section: way, admissionNo: 1 },
        address: { address: way, admissionNo: 1 },
        status: { status: way, admissionNo: 1 },
      };
      let rowsPromise;
      if (sort === 'class') {
        // Class order is the school order (PG, Nursery, LKG ... 12th), not alphabetical, so we
        // rank each row by its position in CLASS_KEYS before sorting.
        rowsPromise = Student.aggregate([
          { $match: filter },
          { $addFields: { classRank: { $indexOfArray: [CLASS_KEYS, '$classKey'] } } },
          { $sort: { classRank: way, section: 1, admissionNo: 1 } },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
        ]).collation(NUMERIC);
      } else {
        rowsPromise = Student.find(filter)
          .sort(SORTS[sort] ?? SORTS.admissionNo)
          .collation(NUMERIC)
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean();
      }
      const [rows, total, active, inactive, sections] = await Promise.all([
        rowsPromise,
        Student.countDocuments(filter),
        // Totals ignore the Status filter, so the cards always show active + inactive = total.
        Student.countDocuments({ ...base, status: 'active' }),
        Student.countDocuments({ ...base, status: 'inactive' }),
        Student.distinct('section', {
          tenantId,
          ...(classKey ? { classKey } : {}),
        }),
      ]);
      return {
        rows,
        total,
        counts: { active, inactive, total: active + inactive },
        sections: sections.filter(Boolean).sort(),
      };
    },
    // admission number -> student id, for importing old fees against existing students
    async idsByAdmissionNo(tenantId, nos) {
      const rows = await Student.find({ tenantId, admissionNo: { $in: nos } })
        .select('admissionNo')
        .lean();
      return new Map(rows.map((r) => [r.admissionNo, r._id]));
    },
    findById: (tenantId, id) => Student.findOne({ tenantId, _id: id }).lean(),
    findManyByIds: (tenantId, ids) =>
      Student.find({ tenantId, _id: { $in: ids } })
        .select('admissionNo name classKey')
        .lean(),
    // Permanent delete (Admin decision): the row is removed and its scholar number is free again.
    // The audit log keeps who deleted it, when, why, and the student's number and name.
    async deleteMany(tenantId, ids) {
      const res = await Student.deleteMany({ tenantId, _id: { $in: ids } });
      return res.deletedCount;
    },
    async existingAdmissionNos(tenantId, list) {
      const found = await Student.find({ tenantId, admissionNo: { $in: list } })
        .select('admissionNo')
        .lean();
      return new Set(found.map((s) => s.admissionNo));
    },
    async createMany(tenantId, docs) {
      const made = await Student.insertMany(
        docs.map((d) => ({ ...d, tenantId, nameLower: d.name.toLowerCase() })),
        { ordered: false },
      );
      return made.length;
    },
    async create(tenantId, data) {
      const doc = await Student.create({ ...data, tenantId, nameLower: data.name.toLowerCase() });
      return doc.toObject();
    },
    update: (tenantId, id, data) =>
      Student.findOneAndUpdate(
        { tenantId, _id: id },
        { $set: { ...data, ...(data.name ? { nameLower: data.name.toLowerCase() } : {}) } },
        { new: true, runValidators: true },
      ).lean(),
  };
}

export function makeFeeStore() {
  return {
    get: (tenantId, fy) => FeeStructure.findOne({ tenantId, fy }).lean(),
    save: (tenantId, fy, data) =>
      FeeStructure.findOneAndUpdate(
        { tenantId, fy },
        { $set: { ...data, fy } },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      ).lean(),
  };
}

export function makeChargeStore() {
  return {
    // Used only when students are permanently deleted: their unpaid fee plan goes with them.
    deleteForStudents: (tenantId, studentIds) =>
      Charge.deleteMany({ tenantId, studentId: { $in: studentIds } }),
    // Old (opening) fees already imported: Set of "studentId|head"
    async openingKeys(tenantId, fy, studentIds) {
      const rows = await Charge.find({
        tenantId,
        fy,
        studentId: { $in: studentIds },
        head: { $in: ['old_fees', 'transport_old'] },
      })
        .select('studentId head')
        .lean();
      return new Set(rows.map((r) => `${r.studentId}|${r.head}`));
    },
    // Adds many single charges at once; existing ones (same student/head/period) are left alone.
    async postBatch(tenantId, fy, items) {
      if (items.length === 0) return 0;
      const result = await Charge.bulkWrite(
        items.map((c) => ({
          updateOne: {
            filter: { tenantId, studentId: c.studentId, fy, head: c.head, period: c.period },
            update: {
              // WHY only these: the filter's equality fields are copied into the new document by
              // Mongo itself; repeating them here is a path conflict.
              $setOnInsert: { dueDate: c.dueDate, amountPaise: c.amountPaise },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      return result.upsertedCount;
    },
    listForStudent: (tenantId, studentId, fy) =>
      Charge.find({ tenantId, studentId, fy }).sort({ dueDate: 1 }).lean(),
    // Adds only the charges that do not exist yet; returns how many were new.
    async postMany(tenantId, studentId, fy, charges) {
      const result = await Charge.bulkWrite(
        charges.map((c) => ({
          updateOne: {
            filter: { tenantId, studentId, fy, head: c.head, period: c.period },
            update: {
              $setOnInsert: (({ head: _h, period: _p, amount, ...rest }) => ({
                ...rest,
                amountPaise: amount,
              }))(c),
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      return result.upsertedCount;
    },
  };
}

// Receipts that were cancelled no longer count as payments (their money is not "paid").
async function cancelledReceiptIds(tenantId, extra = {}, session = null) {
  const rows = await ReceiptCancellation.find({ tenantId, status: 'cancelled', ...extra })
    .select('receiptId')
    .session(session)
    .lean();
  return rows.map((r) => r.receiptId);
}

const isDuplicateKey = (err) => err?.code === 11000;
const isRetryable = (err) =>
  isDuplicateKey(err) || err?.hasErrorLabel?.('TransientTransactionError');

/**
 * Receipts. `issue` is the ONE place a receipt is created, and it does everything in a single
 * database transaction (rules 4, 5, 9):
 *   1. same Idempotency-Key again  -> returns the receipt already made (no second receipt, no
 *      second number), so a double click or a network retry is harmless;
 *   2. locks the student (two cashiers paying for one student queue up);
 *   3. re-reads the student's earlier receipts and re-checks the rules (`build`), so the amount
 *      is validated against the TRUE current state, not what the screen showed;
 *   4. takes the next gap-free number and saves the receipt (and its audit entry) together.
 * If any step fails, nothing is saved and the number is not used up.
 */
export function makeReceiptStore() {
  return {
    async issue({ tenantId, studentId, fy, kind, idempotencyKey, build, audit }) {
      const find = (session) =>
        Receipt.findOne({ tenantId, idempotencyKey })
          .session(session ?? null)
          .lean();
      let lastError;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const session = await mongoose.startSession();
        try {
          let result;
          await session.withTransaction(async () => {
            const existing = await find(session);
            if (existing) {
              result = { receipt: existing, replay: true };
              return;
            }
            await Counter.updateOne(
              { tenantId, key: `lock:${studentId}` },
              { $inc: { seq: 1 } },
              { upsert: true, session },
            );
            const prior = await Receipt.find({ tenantId, studentId, fy }).session(session).lean();
            const doc = await build(prior);
            const counter = await Counter.findOneAndUpdate(
              { tenantId, key: `receipt:${kind}:${fy}` },
              { $inc: { seq: 1 } },
              { upsert: true, returnDocument: 'after', session },
            ).lean();
            const [created] = await Receipt.create(
              [
                {
                  ...doc,
                  tenantId,
                  kind,
                  fy,
                  studentId,
                  idempotencyKey,
                  seq: counter.seq,
                  number: receiptNumber(kind, fy, counter.seq),
                },
              ],
              { session },
            );
            const saved = created.toObject();
            if (audit) await audit(saved, session);
            result = { receipt: saved, replay: false };
          });
          return result;
        } catch (err) {
          lastError = err;
          if (isDuplicateKey(err)) {
            // Lost a race with the same Idempotency-Key: the winner's receipt is the answer.
            const existing = await find(null);
            if (existing) return { receipt: existing, replay: true };
          }
          if (!isRetryable(err)) throw err;
        } finally {
          await session.endSession();
        }
      }
      throw lastError;
    },
    async findById(tenantId, id) {
      const receipt = await Receipt.findOne({ tenantId, _id: id }).lean();
      if (!receipt) return null;
      const c = await ReceiptCancellation.findOne({
        tenantId,
        receiptId: id,
        status: { $in: ['requested', 'cancelled'] },
      }).lean();
      return { ...receipt, cancellation: c ?? null };
    },
    // Only receipts that still count (cancelled ones are left out), used for dues and ledgers.
    async listForStudent(tenantId, studentId, fy) {
      const gone = await cancelledReceiptIds(tenantId, { studentId });
      return Receipt.find({ tenantId, studentId, fy, _id: { $nin: gone } })
        .sort({ issuedAt: 1 })
        .lean();
    },
    /** Filtered, paginated list for the Receipts screens, plus totals of the receipts that count. */
    async list({ tenantId, from, to, kind, mode, q, status, page, pageSize }) {
      const match = { tenantId };
      if (from || to) {
        match.issuedAt = {};
        if (from) match.issuedAt.$gte = istStartOfDay(from);
        if (to) match.issuedAt.$lt = istStartOfDay(addDaysToDateString(to, 1));
      }
      if (kind) match.kind = kind;
      if (mode) match.mode = mode;
      if (q?.trim()) {
        const rx = { $regex: escapeRegex(q.trim()), $options: 'i' };
        match.$or = [{ number: rx }, { 'student.name': rx }, { 'student.admissionNo': rx }];
      }
      const cancelled = await cancelledReceiptIds(tenantId);
      const pendingRows = await ReceiptCancellation.find({ tenantId, status: 'requested' })
        .select('receiptId')
        .lean();
      const rowMatch = { ...match };
      if (status === 'cancelled') rowMatch._id = { $in: cancelled };
      else if (status === 'valid') rowMatch._id = { $nin: cancelled };
      const [rows, total, groups] = await Promise.all([
        Receipt.find(rowMatch)
          .sort({ issuedAt: -1, seq: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
        Receipt.countDocuments(rowMatch),
        Receipt.aggregate([
          { $match: { ...match, _id: { $nin: cancelled } } },
          {
            $group: {
              _id: { kind: '$kind', mode: '$mode' },
              paise: { $sum: '$totalPaise' },
              count: { $sum: 1 },
            },
          },
        ]),
      ]);
      const cancelledSet = new Set(cancelled.map(String));
      const pendingSet = new Set(pendingRows.map((r) => String(r.receiptId)));
      return {
        rows: rows.map((r) => ({
          ...r,
          status: cancelledSet.has(String(r._id))
            ? 'cancelled'
            : pendingSet.has(String(r._id))
              ? 'cancel_requested'
              : 'valid',
        })),
        total,
        groups: groups.map((g) => ({ ...g._id, paise: g.paise, count: g.count })),
      };
    },
    /** All rows for the Excel export (same filters, newest first), capped by the caller. */
    async listAll({ tenantId, from, to, kind, mode, q, status, limit }) {
      const out = await this.list({
        tenantId,
        from,
        to,
        kind,
        mode,
        q,
        status,
        page: 1,
        pageSize: limit,
      });
      return out.rows;
    },
    /**
     * A Cashier asks for a receipt to be cancelled (waits for approval, built in Step 8).
     * Returns null when the receipt is already cancelled or already has an open request.
     */
    async requestCancel({ tenantId, receipt, reason, user, audit }) {
      const session = await mongoose.startSession();
      try {
        let result = null;
        await session.withTransaction(async () => {
          const live = await ReceiptCancellation.findOne({
            tenantId,
            receiptId: receipt._id,
            status: { $in: ['requested', 'cancelled'] },
          })
            .session(session)
            .lean();
          if (live) {
            result = null;
            return;
          }
          const [created] = await ReceiptCancellation.create(
            [
              {
                tenantId,
                receiptId: receipt._id,
                studentId: receipt.studentId,
                receiptNumber: receipt.number,
                status: 'requested',
                reason,
                requestedBy: user.id,
                requestedByName: user.name,
                requestedAt: new Date(),
              },
            ],
            { session },
          );
          if (audit) await audit(created.toObject(), session);
          result = created.toObject();
        });
        return result;
      } finally {
        await session.endSession();
      }
    },
    /**
     * The Admin cancels directly (no Principal approval). If the Cashier had already asked, that
     * request is the one that becomes "cancelled". Returns null if it is already cancelled.
     */
    async cancelDirect({ tenantId, receipt, reason, user, audit }) {
      const session = await mongoose.startSession();
      try {
        let result = null;
        await session.withTransaction(async () => {
          const live = await ReceiptCancellation.findOne({
            tenantId,
            receiptId: receipt._id,
            status: { $in: ['requested', 'cancelled'] },
          })
            .session(session)
            .lean();
          if (live?.status === 'cancelled') {
            result = null;
            return;
          }
          const decided = {
            status: 'cancelled',
            decidedBy: user.id,
            decidedByName: user.name,
            decidedAt: new Date(),
          };
          let saved;
          if (live) {
            saved = await ReceiptCancellation.findOneAndUpdate(
              { tenantId, _id: live._id },
              { $set: { ...decided, decisionNote: reason } },
              { returnDocument: 'after', session },
            ).lean();
          } else {
            const [created] = await ReceiptCancellation.create(
              [
                {
                  tenantId,
                  receiptId: receipt._id,
                  studentId: receipt.studentId,
                  receiptNumber: receipt.number,
                  reason,
                  ...decided,
                },
              ],
              { session },
            );
            saved = created.toObject();
          }
          if (audit) await audit(saved, session);
          result = saved;
        });
        return result;
      } finally {
        await session.endSession();
      }
    },
  };
}
