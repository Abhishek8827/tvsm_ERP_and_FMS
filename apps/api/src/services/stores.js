import mongoose from "mongoose";
import {
  CLASS_KEYS,
  addDaysToDateString,
  istStartOfDay,
  receiptNumber,
} from "@erp/shared";
import { AuditLog } from "../models/AuditLog.js";
import { Charge } from "../models/Charge.js";
import { Counter } from "../models/Counter.js";
import { FeeStructure } from "../models/FeeStructure.js";
import { Rebate } from "../models/Rebate.js";
import { Receipt } from "../models/Receipt.js";
import { ReceiptCancellation } from "../models/ReceiptCancellation.js";
import { Student } from "../models/Student.js";
import { User } from "../models/User.js";

/**
 * Thin data-access layer. Routes and middleware depend on these small objects (not on Mongoose
 * directly) so tests can swap in simple fakes and the database code stays in one place.
 */
export function makeUserStore() {
  return {
    findByFirebaseUid: (tenantId, firebaseUid) =>
      User.findOne({ tenantId, firebaseUid }).lean(),
    touchLogin: (tenantId, id) =>
      User.updateOne(
        { tenantId, _id: id },
        { $set: { lastLoginAt: new Date() } },
      ),
    findById: (tenantId, id) => User.findOne({ tenantId, _id: id }).lean(),
    findByEmail: (tenantId, email) => User.findOne({ tenantId, email }).lean(),
    async create(tenantId, data) {
      const doc = await User.create({ ...data, tenantId });
      return doc.toObject();
    },
    update: (tenantId, id, data) =>
      User.findOneAndUpdate(
        { tenantId, _id: id },
        { $set: data },
        { new: true },
      ).lean(),
    countActiveAdmins: (tenantId) =>
      User.countDocuments({ tenantId, role: "admin", isActive: true }),
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
    /** Filtered, newest first. Read-only. Adds the user's name (entries only keep the id). */
    async list({ tenantId, filters = {}, page = 1, pageSize = 50 }) {
      const match = { tenantId };
      if (filters.userId) match.userId = filters.userId;
      if (filters.action) match.action = filters.action;
      if (filters.entity) match.entity = filters.entity;
      if (filters.from || filters.to) {
        match.at = {};
        if (filters.from) match.at.$gte = istStartOfDay(filters.from);
        if (filters.to)
          match.at.$lt = istStartOfDay(addDaysToDateString(filters.to, 1));
      }
      if (filters.q) {
        const rx = { $regex: escapeRegex(filters.q), $options: "i" };
        match.$or = [{ reason: rx }, { entityId: rx }];
      }
      const [rows, total] = await Promise.all([
        AuditLog.find(match)
          .sort({ at: -1, _id: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
        AuditLog.countDocuments(match),
      ]);
      const ids = [
        ...new Set(
          rows
            .map((r) => String(r.userId))
            .filter(Boolean)
            .filter((id) => /^[a-f0-9]{24}$/i.test(id)),
        ),
      ];
      const users = ids.length
        ? await User.find({ tenantId, _id: { $in: ids } })
            .select("name")
            .lean()
        : [];
      const nameOf = new Map(users.map((u) => [String(u._id), u.name]));
      return {
        total,
        rows: rows.map((r) => ({
          ...r,
          userName: nameOf.get(String(r.userId)) ?? null,
        })),
      };
    },
    /** What the filter drop-downs offer: people and record types that really appear in the log. */
    async options(tenantId) {
      const [userIds, entities] = await Promise.all([
        AuditLog.distinct("userId", { tenantId }),
        AuditLog.distinct("entity", { tenantId }),
      ]);
      const ids = (userIds ?? [])
        .filter(Boolean)
        .map((id) => String(id))
        .filter((id) => /^[a-f0-9]{24}$/i.test(id));
      const users = await User.find({
        tenantId,
        _id: { $in: ids },
      })
        .select("name role")
        .sort({ name: 1 })
        .lean();
      return {
        users: users.map((u) => ({
          id: String(u._id),
          name: u.name,
          role: u.role,
        })),
        entities: entities.filter(Boolean).sort(),
      };
    },
  };
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "2" before "10": compare scholar numbers as numbers, not as text.
const NUMERIC = { locale: "en", numericOrdering: true };

// Every word typed must match somewhere (AND), and a word can match ANY part of the name,
// father's name, mother's name, admission number, mobile number, address or village (so "sha",
// "rajesh", "9876", "siwal" all work). Tenant + index narrow the scan first.
function addTextSearch(base, q) {
  if (!q || !q.trim()) return;
  const words = q.trim().toLowerCase().split(/\s+/).slice(0, 5);
  base.$and = words.map((w) => {
    const rx = { $regex: escapeRegex(w), $options: "i" };
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

export function makeStudentStore() {
  return {
    // Search: exact admission number, or name starting with the text (uses the nameLower index).
    async list({
      tenantId,
      page,
      pageSize,
      q,
      classKey,
      section,
      status,
      sort,
      dir,
    }) {
      const base = { tenantId };
      if (classKey) base.classKey = classKey;
      if (section) base.section = section;
      addTextSearch(base, q);
      const filter = status ? { ...base, status } : base;
      const way = dir === "desc" ? -1 : 1;
      // Every sort ends with the scholar number so the order is stable between pages.
      const SORTS = {
        admissionNo: { admissionNo: way },
        name: { nameLower: way, admissionNo: 1 },
        section: { section: way, admissionNo: 1 },
        address: { address: way, admissionNo: 1 },
        status: { status: way, admissionNo: 1 },
      };
      let rowsPromise;
      if (sort === "class") {
        // Class order is the school order (PG, Nursery, LKG ... 12th), not alphabetical, so we
        // rank each row by its position in CLASS_KEYS before sorting.
        rowsPromise = Student.aggregate([
          { $match: filter },
          {
            $addFields: {
              classRank: { $indexOfArray: [CLASS_KEYS, "$classKey"] },
            },
          },
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
        Student.countDocuments({ ...base, status: "active" }),
        Student.countDocuments({ ...base, status: "inactive" }),
        Student.distinct("section", {
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
        .select("admissionNo")
        .lean();
      return new Map(rows.map((r) => [r.admissionNo, r._id]));
    },
    findById: (tenantId, id) => Student.findOne({ tenantId, _id: id }).lean(),
    findManyByIds: (tenantId, ids) =>
      Student.find({ tenantId, _id: { $in: ids } })
        .select("admissionNo name classKey")
        .lean(),
    // Permanent delete (Admin decision): the row is removed and its scholar number is free again.
    // The audit log keeps who deleted it, when, why, and the student's number and name.
    async deleteMany(tenantId, ids) {
      const res = await Student.deleteMany({ tenantId, _id: { $in: ids } });
      return res.deletedCount;
    },
    async existingAdmissionNos(tenantId, list) {
      const found = await Student.find({ tenantId, admissionNo: { $in: list } })
        .select("admissionNo")
        .lean();
      return new Set(found.map((s) => s.admissionNo));
    },
    // Students for the Fees Database (filters narrow the set before fees are worked out).
    async forFees(tenantId, f = {}) {
      const base = { tenantId };
      for (const k of [
        "classKey",
        "section",
        "village",
        "category",
        "gender",
        "status",
      ])
        if (f[k]) base[k] = f[k];
      if (f.transport !== undefined) base.usesTransport = f.transport;
      if (f.newAdmission !== undefined) base.isNewAdmission = f.newAdmission;
      if (f.rte !== undefined) base.isRTE = f.rte;
      addTextSearch(base, f.q);
      return Student.find(base)
        .select(
          "admissionNo name fatherName classKey section contactNo address village usesTransport isNewAdmission isRTE status category gender",
        )
        .collation(NUMERIC)
        .sort({ admissionNo: 1 })
        .lean();
    },
    // Active students for fee-plan posting: optional class and/or explicit ids.
    activeForPlan: (tenantId, { classKey, ids } = {}) =>
      Student.find({
        tenantId,
        status: "active",
        ...(classKey ? { classKey } : {}),
        ...(ids ? { _id: { $in: ids } } : {}),
      }).lean(),
    findByAdmissionNos: (tenantId, list) =>
      Student.find({ tenantId, admissionNo: { $in: list } }).lean(),
    /**
     * The Transport module list. state: 'on' (on the bus now), 'stopped' (was on the bus),
     * 'pending' (flagged as bus student in the old Excel but not entered in the module yet),
     * or none = all three. Numbers sort as numbers.
     */
    async listTransport(
      tenantId,
      { q, state, page = 1, pageSize = 25, all = false } = {},
    ) {
      const f = { tenantId, status: "active" };
      const states = {
        on: {
          usesTransport: true,
          transportFrom: { $exists: true, $ne: null },
        },
        stopped: {
          usesTransport: false,
          transportFrom: { $exists: true, $ne: null },
        },
        pending: {
          usesTransport: true,
          $or: [{ transportFrom: { $exists: false } }, { transportFrom: null }],
        },
      };
      // addTextSearch fills f.$and, so the text filter goes first and "any transport" joins it.
      addTextSearch(f, q);
      if (state) Object.assign(f, states[state]);
      else
        f.$and = [
          ...(f.$and ?? []),
          {
            $or: [
              { usesTransport: true },
              { transportFrom: { $exists: true, $ne: null } },
            ],
          },
        ];
      const cursor = Student.find(f)
        .select(
          "admissionNo name fatherName classKey section contactNo address village usesTransport transportFrom transportUntil",
        )
        .collation(NUMERIC)
        .sort({ admissionNo: 1 });
      if (!all) cursor.skip((page - 1) * pageSize).limit(pageSize);
      const [rows, total] = await Promise.all([
        cursor.lean(),
        Student.countDocuments(f),
      ]);
      return { rows, total };
    },
    async createMany(tenantId, docs) {
      const made = await Student.insertMany(
        docs.map((d) => ({ ...d, tenantId, nameLower: d.name.toLowerCase() })),
        { ordered: false },
      );
      return made.length;
    },
    async create(tenantId, data) {
      const doc = await Student.create({
        ...data,
        tenantId,
        nameLower: data.name.toLowerCase(),
      });
      return doc.toObject();
    },
    update: (tenantId, id, data) =>
      Student.findOneAndUpdate(
        { tenantId, _id: id },
        {
          $set: {
            ...data,
            ...(data.name ? { nameLower: data.name.toLowerCase() } : {}),
          },
        },
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
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        },
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
        head: { $in: ["old_fees", "transport_old"] },
      })
        .select("studentId head")
        .lean();
      return new Set(rows.map((r) => `${r.studentId}|${r.head}`));
    },
    // Used when a student leaves the bus: unpaid, unreferenced transport months are removed.
    deleteByIds: (tenantId, ids) =>
      Charge.deleteMany({ tenantId, _id: { $in: ids } }),
    // Adds many single charges at once; existing ones (same student/head/period) are left alone.
    async postBatch(tenantId, fy, items) {
      if (items.length === 0) return 0;
      const result = await Charge.bulkWrite(
        items.map((c) => ({
          updateOne: {
            filter: {
              tenantId,
              studentId: c.studentId,
              fy,
              head: c.head,
              period: c.period,
            },
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
    listForStudents: (tenantId, studentIds, fy) =>
      Charge.find({ tenantId, fy, studentId: { $in: studentIds } })
        .select("studentId head period dueDate amountPaise")
        .lean(),
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

// (The rebate store itself lives in rebateStore.js.)
// Active rebates as ONE pseudo receipt that carries only concession lines. WHY: the fee engine
// reads `receipts`; a rebate lowers what a charge asks for but is not a payment, so it has no
// receipt `lines` (no money) - only `concessionLines`.
async function rebateCredits(tenantId, studentId, fy, session = null) {
  const rows = await Rebate.find({ tenantId, studentId, fy, status: "active" })
    .session(session)
    .lean();
  const concessionLines = rows.flatMap((r) => r.lines);
  // A waived month counts as "late fee already dealt with", exactly like one settled on a receipt.
  const periods = rows.flatMap((r) => r.periods ?? []);
  return concessionLines.length || periods.length
    ? [{ lines: [], concessionLines, lateFee: { periods } }]
    : [];
}

// Receipts that were cancelled no longer count as payments (their money is not "paid").
async function cancelledReceiptIds(tenantId, extra = {}, session = null) {
  const rows = await ReceiptCancellation.find({
    tenantId,
    status: "cancelled",
    ...extra,
  })
    .select("receiptId")
    .session(session)
    .lean();
  return rows.map((r) => r.receiptId);
}

/** The latest REJECTED cancellation request per receipt (what the Cashier must be able to see). */
async function latestRejections(tenantId, receiptIds) {
  if (receiptIds.length === 0) return new Map();
  const rows = await ReceiptCancellation.find({
    tenantId,
    receiptId: { $in: receiptIds },
    status: "rejected",
  })
    .sort({ decidedAt: 1 })
    .lean();
  // Sorted oldest first, so the last one written into the map is the newest.
  return new Map(rows.map((r) => [String(r.receiptId), r]));
}

const isDuplicateKey = (err) => err?.code === 11000;
const isRetryable = (err) =>
  isDuplicateKey(err) || err?.hasErrorLabel?.("TransientTransactionError");

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
    async issue({
      tenantId,
      studentId,
      fy,
      kind,
      idempotencyKey,
      build,
      audit,
    }) {
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
            // WHY cancelled ones are left out: a cancelled receipt's money was never kept, so it
            // must not count as paid when the next receipt is checked.
            const gone = await cancelledReceiptIds(
              tenantId,
              { studentId },
              session,
            );
            const prior = [
              ...(await Receipt.find({
                tenantId,
                studentId,
                fy,
                _id: { $nin: gone },
              })
                .session(session)
                .lean()),
              ...(await rebateCredits(tenantId, studentId, fy, session)),
            ];
            const doc = await build(prior);
            const counter = await Counter.findOneAndUpdate(
              { tenantId, key: `receipt:${kind}:${fy}` },
              { $inc: { seq: 1 } },
              { upsert: true, returnDocument: "after", session },
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
    // A receipt of this student by its full number ("S-FY2026-27/2054") or just the digits
    // ("2054"). Cancelled receipts are not returned (they carry no money).
    async findForStudentByNumber(tenantId, studentId, text) {
      const t = String(text).trim();
      const or = [{ number: t }];
      if (/^\d{1,9}$/.test(t)) or.push({ seq: Number(t) });
      const rows = await Receipt.find({ tenantId, studentId, $or: or }).lean();
      const gone = new Set(
        (await cancelledReceiptIds(tenantId, { studentId })).map(String),
      );
      return rows.find((r) => !gone.has(String(r._id))) ?? null;
    },
    async findById(tenantId, id) {
      const receipt = await Receipt.findOne({ tenantId, _id: id }).lean();
      if (!receipt) return null;
      const c = await ReceiptCancellation.findOne({
        tenantId,
        receiptId: id,
        status: { $in: ["requested", "cancelled"] },
      }).lean();
      const rejection = c
        ? null
        : ((await latestRejections(tenantId, [receipt._id])).get(String(id)) ??
          null);
      return { ...receipt, cancellation: c ?? null, rejection };
    },
    // Only receipts that still count (cancelled ones are left out), used for dues and ledgers.
    async listForStudent(tenantId, studentId, fy) {
      const gone = await cancelledReceiptIds(tenantId, { studentId });
      const rows = await Receipt.find({
        tenantId,
        studentId,
        fy,
        _id: { $nin: gone },
      })
        .sort({ issuedAt: 1 })
        .lean();
      return [...rows, ...(await rebateCredits(tenantId, studentId, fy))];
    },
    // Fees Database: payment lines of every receipt that still counts, for many students at once.
    async linesForStudents(tenantId, studentIds, fy) {
      const gone = await cancelledReceiptIds(tenantId);
      return Receipt.find({
        tenantId,
        fy,
        studentId: { $in: studentIds },
        _id: { $nin: gone },
      })
        .select("studentId kind lines lateFee.periods issuedAt")
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
        const rx = { $regex: escapeRegex(q.trim()), $options: "i" };
        match.$or = [
          { number: rx },
          { "student.name": rx },
          { "student.admissionNo": rx },
        ];
      }
      const cancelled = await cancelledReceiptIds(tenantId);
      const pendingRows = await ReceiptCancellation.find({
        tenantId,
        status: "requested",
      })
        .select("receiptId")
        .lean();
      const rowMatch = { ...match };
      if (status === "cancelled") rowMatch._id = { $in: cancelled };
      else if (status === "valid") rowMatch._id = { $nin: cancelled };
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
              _id: { kind: "$kind", mode: "$mode" },
              paise: { $sum: "$totalPaise" },
              count: { $sum: 1 },
            },
          },
        ]),
      ]);
      const cancelledSet = new Set(cancelled.map(String));
      const pendingSet = new Set(pendingRows.map((r) => String(r.receiptId)));
      const rejections = await latestRejections(
        tenantId,
        rows
          .map((r) => r._id)
          .filter(
            (id) =>
              !cancelledSet.has(String(id)) && !pendingSet.has(String(id)),
          ),
      );
      return {
        rows: rows.map((r) => ({
          ...r,
          rejection: rejections.get(String(r._id)) ?? null,
          status: cancelledSet.has(String(r._id))
            ? "cancelled"
            : pendingSet.has(String(r._id))
              ? "cancel_requested"
              : "valid",
        })),
        total,
        groups: groups.map((g) => ({
          ...g._id,
          paise: g.paise,
          count: g.count,
        })),
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
            status: { $in: ["requested", "cancelled"] },
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
                status: "requested",
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
    /** Cancellation requests with the receipt's facts, newest first (Approvals screen). */
    async listCancellations({ tenantId, status, page, pageSize }) {
      const match = { tenantId, ...(status ? { status } : {}) };
      const [rows, total] = await Promise.all([
        ReceiptCancellation.find(match)
          .sort({ createdAt: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
        ReceiptCancellation.countDocuments(match),
      ]);
      const receipts = rows.length
        ? await Receipt.find({
            tenantId,
            _id: { $in: rows.map((r) => r.receiptId) },
          })
            .select("number kind mode totalPaise issuedAt student cashierName")
            .lean()
        : [];
      const byId = new Map(receipts.map((r) => [String(r._id), r]));
      return {
        rows: rows.map((c) => ({
          ...c,
          receipt: byId.get(String(c.receiptId)) ?? null,
        })),
        total,
      };
    },
    countPendingCancellations: (tenantId) =>
      ReceiptCancellation.countDocuments({ tenantId, status: "requested" }),
    /**
     * The Principal decides a request. Only a still-"requested" record can be decided, so a
     * double click or two tabs cannot decide it twice (returns null then).
     */
    async decideCancellation({ tenantId, id, decision, note, user, audit }) {
      const session = await mongoose.startSession();
      try {
        let result = null;
        await session.withTransaction(async () => {
          const saved = await ReceiptCancellation.findOneAndUpdate(
            { tenantId, _id: id, status: "requested" },
            {
              $set: {
                status: decision === "approve" ? "cancelled" : "rejected",
                decidedBy: String(user.id),
                decidedByName: user.name,
                decidedAt: new Date(),
                ...(note ? { decisionNote: note } : {}),
              },
            },
            { returnDocument: "after", session },
          ).lean();
          if (!saved) return;
          if (audit) await audit(saved, session);
          result = saved;
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
            status: { $in: ["requested", "cancelled"] },
          })
            .session(session)
            .lean();
          if (live?.status === "cancelled") {
            result = null;
            return;
          }
          const decided = {
            status: "cancelled",
            decidedBy: user.id,
            decidedByName: user.name,
            decidedAt: new Date(),
          };
          let saved;
          if (live) {
            saved = await ReceiptCancellation.findOneAndUpdate(
              { tenantId, _id: live._id },
              { $set: { ...decided, decisionNote: reason } },
              { returnDocument: "after", session },
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
