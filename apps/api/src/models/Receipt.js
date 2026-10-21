import mongoose from 'mongoose';
import { registerGlobalPlugins } from '../db.js';

registerGlobalPlugins();

/**
 * A fee receipt. IMMUTABLE (rule 9): once saved it can never be changed or deleted. A mistake is
 * fixed by a separate, approved cancellation record (Step 8), never by editing the receipt.
 * The student's details are copied in ("snapshot") so an old receipt always prints exactly as it
 * was issued, even if the student's class or address changes later.
 */
const lineSchema = new mongoose.Schema(
  {
    head: { type: String, required: true },
    period: { type: String },
    chargeId: { type: mongoose.Schema.Types.ObjectId },
    amountPaise: { type: Number, required: true, min: 0 },
    note: { type: String },
  },
  { _id: false, tenantScope: false },
);

const receiptSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['school', 'transport'], required: true },
    fy: { type: String, required: true },
    seq: { type: Number, required: true },
    number: { type: String, required: true }, // S-FY2026-27/2054  or  T-FY2026-27/0123
    studentId: { type: mongoose.Schema.Types.ObjectId, required: true },
    student: {
      admissionNo: String,
      name: String,
      fatherName: String,
      classKey: String,
      section: String,
      address: String,
      contactNo: String,
      village: String,
    },
    lines: { type: [lineSchema], required: true },
    lateFee: {
      calculatedPaise: Number,
      chargedPaise: Number,
      remark: String,
      periods: [String],
    },
    totalPaise: { type: Number, required: true, min: 1 },
    monthLabel: { type: String, default: '' },
    dueAfterPaise: { type: Number, required: true, min: 0 },
    // Split of dueAfterPaise for the printed receipt (older receipts do not have it).
    dueAfterOldPaise: { type: Number, min: 0 },
    dueAfterNewPaise: { type: Number, min: 0 },
    mode: { type: String, enum: ['cash', 'upi', 'qr'], required: true },
    reference: { type: String },
    // Which bank account a UPI / QR payment went to (Step 6). Cash has none.
    bankId: { type: String },
    bankName: { type: String },
    cashierId: { type: String, required: true },
    cashierName: { type: String },
    idempotencyKey: { type: String, required: true },
    issuedAt: { type: Date, default: () => new Date(), required: true },
  },
  { timestamps: false, versionKey: false },
);

receiptSchema.index({ tenantId: 1, kind: 1, fy: 1, seq: 1 }, { unique: true });
receiptSchema.index({ tenantId: 1, number: 1 }, { unique: true });
receiptSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
receiptSchema.index({ tenantId: 1, studentId: 1, fy: 1 });
receiptSchema.index({ tenantId: 1, issuedAt: -1 });

const BLOCKED = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
];
for (const op of BLOCKED) {
  receiptSchema.pre(op, function () {
    throw new Error(`Receipts are immutable: ${op} is not allowed`);
  });
}
receiptSchema.pre('save', function () {
  if (!this.isNew)
    throw new Error('Receipts are immutable: an issued receipt cannot be saved again');
});
receiptSchema.pre('bulkWrite', function (ops) {
  if ((ops ?? []).some((o) => !('insertOne' in o)))
    throw new Error('Receipts are immutable: only inserts are allowed');
});
receiptSchema.pre('deleteOne', { document: true, query: false }, function () {
  throw new Error('Receipts are immutable: delete is not allowed');
});

export const Receipt = mongoose.models.Receipt ?? mongoose.model('Receipt', receiptSchema);
