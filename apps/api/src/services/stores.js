import { CLASS_KEYS } from '@erp/shared';
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
