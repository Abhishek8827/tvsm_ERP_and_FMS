import mongoose from 'mongoose';
import { Counter } from '../models/Counter.js';
import { Rebate } from '../models/Rebate.js';
import { Receipt } from '../models/Receipt.js';
import { ReceiptCancellation } from '../models/ReceiptCancellation.js';

/**
 * Data access for rebates (concessions) and late-fee waivers. Kept in its own file so the
 * Rebates screen (list, import, export) does not grow the big stores file.
 */

// Active rebates as ONE pseudo receipt that carries only concession lines. WHY: the fee engine
// reads `receipts`; a rebate lowers what a charge asks for but is not a payment, so it has no
// receipt `lines` (no money) - only `concessionLines`.
async function rebateCredits(tenantId, studentId, fy, session = null) {
  const rows = await Rebate.find({ tenantId, studentId, fy, status: 'active' })
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
async function cancelledReceiptIds(tenantId, studentId, session = null) {
  const rows = await ReceiptCancellation.find({ tenantId, studentId, status: 'cancelled' })
    .session(session)
    .select('receiptId')
    .lean();
  return rows.map((r) => r.receiptId);
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function rebateFilter({ tenantId, q, type, status }) {
  const f = { tenantId };
  if (status) f.status = status;
  if (type === 'late_fee') f.kind = 'late_fee';
  else if (type) f.rebateType = type;
  if (q) {
    const rx = new RegExp(escapeRx(q), 'i');
    f.$or = [{ 'student.name': rx }, { 'student.admissionNo': rx }];
  }
  return f;
}

export function makeRebateStore() {
  return {
    activeForStudents: (tenantId, studentIds, fy) =>
      Rebate.find({ tenantId, fy, studentId: { $in: studentIds }, status: 'active' })
        .select('studentId kind rebateType lines periods totalPaise')
        .lean(),
    /**
     * Saves a rebate inside a transaction under the student's lock, after `build` has worked
     * out the lines from the freshly read receipts + rebates (so two Admins cannot both
     * rebate the same unpaid amount).
     */
    async create({
      tenantId,
      studentId,
      fy,
      kind,
      reason,
      student,
      user,
      build,
      audit,
      rebateType = null,
      adjustOn = 'oldest',
    }) {
      const session = await mongoose.startSession();
      try {
        let saved;
        await session.withTransaction(async () => {
          await Counter.updateOne(
            { tenantId, key: `lock:${studentId}` },
            { $inc: { seq: 1 } },
            { upsert: true, session },
          );
          const gone = await cancelledReceiptIds(tenantId, studentId, session);
          const prior = [
            ...(await Receipt.find({ tenantId, studentId, fy, _id: { $nin: gone } })
              .session(session)
              .lean()),
            ...(await rebateCredits(tenantId, studentId, fy, session)),
          ];
          const built = build(prior);
          // A rebate returns its lines; a late-fee waiver returns { lines: [], periods, totalPaise }.
          const lines = Array.isArray(built) ? built : built.lines;
          const periods = Array.isArray(built) ? [] : built.periods;
          const totalPaise = Array.isArray(built)
            ? lines.reduce((n, l) => n + l.amountPaise, 0)
            : built.totalPaise;
          const [doc] = await Rebate.create(
            [
              {
                tenantId,
                studentId,
                fy,
                kind,
                rebateType,
                adjustOn,
                reason,
                lines,
                periods,
                totalPaise,
                student,
                createdBy: String(user.id),
                createdByName: user.name,
              },
            ],
            { session, ordered: true },
          );
          saved = doc.toObject();
          if (audit) await audit(saved, session);
        });
        return saved;
      } finally {
        await session.endSession();
      }
    },
    listForStudent: (tenantId, studentId) =>
      Rebate.find({ tenantId, studentId }).sort({ createdAt: -1 }).limit(100).lean(),
    findById: (tenantId, id) => Rebate.findOne({ tenantId, _id: id }).lean(),
    /**
     * The Rebates screen list. Late-fee waivers are listed too (type "late_fee") so every
     * concession the Admin gave is in one place. `q` matches the student's name or SCH. no.
     * `all: true` returns every row (for the Excel export).
     */
    async list({ tenantId, page = 1, pageSize = 25, q, type, status, all = false }) {
      const filter = rebateFilter({ tenantId, q, type, status });
      const cursor = Rebate.find(filter).sort({ createdAt: -1 });
      if (!all) cursor.skip((page - 1) * pageSize).limit(pageSize);
      const [rows, total, sums] = await Promise.all([
        cursor.lean(),
        Rebate.countDocuments(filter),
        Rebate.aggregate([
          { $match: { ...filter, status: 'active' } },
          { $group: { _id: null, paise: { $sum: '$totalPaise' }, count: { $sum: 1 } } },
        ]),
      ]);
      return { rows, total, active: sums[0] ?? { paise: 0, count: 0 } };
    },
    // Same student + type + amount + reason already given (and not reversed): an import repeat.
    async hasSame({ tenantId, studentId, fy, rebateType, totalPaise, reason }) {
      return !!(await Rebate.exists({
        tenantId,
        studentId,
        fy,
        rebateType,
        totalPaise,
        reason,
        status: 'active',
      }));
    },
    // Reversing is allowed once; the record stays, it just stops counting.
    reverse: ({ tenantId, id, reason, user }) =>
      Rebate.findOneAndUpdate(
        { tenantId, _id: id, status: 'active' },
        {
          $set: {
            status: 'reversed',
            reversedReason: reason,
            reversedAt: new Date(),
            reversedByName: user.name,
          },
        },
        { new: true },
      ).lean(),
  };
}
