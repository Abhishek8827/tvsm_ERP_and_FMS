import { AuditLog } from '../models/AuditLog.js';
import { Charge } from '../models/Charge.js';
import { FeeStructure } from '../models/FeeStructure.js';
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
// Deleted students stay in the database (rule 18) but never show up anywhere.
const NOT_DELETED = { isDeleted: { $ne: true } };
// "2" before "10": compare scholar numbers as numbers, not as text.
const NUMERIC = { locale: 'en', numericOrdering: true };

export function makeStudentStore() {
  return {
    // Search: exact admission number, or name starting with the text (uses the nameLower index).
    async list({ tenantId, page, pageSize, q, classKey, section, status, sort, dir }) {
      const base = { tenantId, ...NOT_DELETED };
      if (classKey) base.classKey = classKey;
      if (section) base.section = section;
      if (q) {
        const text = q.trim().toLowerCase();
        base.$or = [
          { admissionNo: q.trim() },
          { nameLower: { $regex: `^${escapeRegex(text)}` } },
          ...(/^\d{10}$/.test(text) ? [{ contactNo: text }] : []),
        ];
      }
      const filter = status ? { ...base, status } : base;
      const way = dir === 'desc' ? -1 : 1;
      const byName = sort === 'name';
      const query = Student.find(filter)
        .sort(byName ? { nameLower: way, admissionNo: 1 } : { admissionNo: way })
        .skip((page - 1) * pageSize)
        .limit(pageSize);
      if (!byName) query.collation(NUMERIC);
      const [rows, total, active, inactive, sections] = await Promise.all([
        query.lean(),
        Student.countDocuments(filter),
        // Totals ignore the Status filter, so the cards always show active + inactive = total.
        Student.countDocuments({ ...base, status: 'active' }),
        Student.countDocuments({ ...base, status: 'inactive' }),
        Student.distinct('section', {
          tenantId,
          ...NOT_DELETED,
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
    findById: (tenantId, id) => Student.findOne({ tenantId, _id: id, ...NOT_DELETED }).lean(),
    findManyByIds: (tenantId, ids) =>
      Student.find({ tenantId, _id: { $in: ids }, ...NOT_DELETED })
        .select('admissionNo name classKey')
        .lean(),
    // WHY soft delete: payments and certificates will point at the student, so a row is hidden, never removed.
    async softDeleteMany(tenantId, ids, { reason, userId }) {
      const res = await Student.updateMany(
        { tenantId, _id: { $in: ids }, ...NOT_DELETED },
        {
          $set: { isDeleted: true, deletedAt: new Date(), deleteReason: reason, deletedBy: userId },
        },
      );
      return res.modifiedCount;
    },
    // Counts deleted students too: a scholar number is never reused.
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
        { tenantId, _id: id, ...NOT_DELETED },
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
    listForStudent: (tenantId, studentId, fy) =>
      Charge.find({ tenantId, studentId, fy }).sort({ dueDate: 1 }).lean(),
    // Adds only the charges that do not exist yet; returns how many were new.
    async postMany(tenantId, studentId, fy, charges) {
      const result = await Charge.bulkWrite(
        charges.map((c) => ({
          updateOne: {
            filter: { tenantId, studentId, fy, head: c.head, period: c.period },
            update: {
              $setOnInsert: { tenantId, studentId, fy, ...c, amountPaise: c.amount },
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
