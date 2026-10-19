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

export function makeStudentStore() {
  return {
    // Search: exact admission number, or name starting with the text (uses the nameLower index).
    async list({ tenantId, page, pageSize, q, classKey, status }) {
      const filter = { tenantId };
      if (classKey) filter.classKey = classKey;
      if (status) filter.status = status;
      if (q) {
        const text = q.trim().toLowerCase();
        filter.$or = [
          { admissionNo: q.trim() },
          { nameLower: { $regex: `^${escapeRegex(text)}` } },
          ...(/^\d{10}$/.test(text) ? [{ contactNo: text }] : []),
        ];
      }
      const [rows, total] = await Promise.all([
        Student.find(filter)
          .sort({ classKey: 1, nameLower: 1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
        Student.countDocuments(filter),
      ]);
      return { rows, total };
    },
    findById: (tenantId, id) => Student.findOne({ tenantId, _id: id }).lean(),
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
