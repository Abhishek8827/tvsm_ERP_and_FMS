import mongoose from 'mongoose';
import { registerGlobalPlugins } from '../db.js';

registerGlobalPlugins();

/**
 * A rebate (concession) the Admin gives a student. It is NOT money received, so it is kept apart
 * from receipts and the money ledger; the fee engine reads it as a "concession" credit on the
 * charges listed in `lines`. Mistakes are undone by marking it reversed (reason compulsory) -
 * the record itself is never deleted or edited.
 */
const rebateSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, required: true },
    fy: { type: String, required: true },
    // 'late_fee' = a late-fee waiver (no lines; `periods` are the months whose late fee is waived)
    kind: { type: String, enum: ['school', 'transport', 'late_fee'], required: true },
    periods: [String],
    // What the Admin chose in the Rebates screen: school | transport | admission. `kind` stays
    // the fee MODULE (admission belongs to the school module) so the fee engine is unchanged.
    rebateType: { type: String, enum: ['school', 'transport', 'admission', null], default: null },
    // 'oldest' = lowers the oldest unpaid fee first; 'last' = lowers the LAST month's fee first
    // (BC / OTP); 'all' = lowers every month of the year (RTE / Management / Scholarship).
    adjustOn: { type: String, enum: ['oldest', 'last', 'all'], default: 'oldest' },
    // Why it was given (bc | otp | rte | management | scholarship | other). Older rows have none.
    category: {
      type: String,
      enum: ['bc', 'otp', 'rte', 'management', 'scholarship', 'other', null],
    },
    // BC: the sibling whose fee the rebate is for. OTP: the receipt of the one-time payment.
    sibling: { _id: false, admissionNo: String, name: String, classKey: String },
    receiptNo: { type: String },
    totalPaise: { type: Number, required: true },
    lines: [
      {
        _id: false,
        chargeId: { type: mongoose.Schema.Types.ObjectId, required: true },
        head: String,
        period: String,
        amountPaise: { type: Number, required: true },
      },
    ],
    reason: { type: String, required: true },
    status: { type: String, enum: ['active', 'reversed'], default: 'active' },
    reversedReason: String,
    reversedAt: Date,
    reversedByName: String,
    createdBy: { type: String },
    createdByName: { type: String },
    student: { name: String, admissionNo: String, classKey: String }, // snapshot for listings
  },
  { timestamps: true },
);
rebateSchema.index({ tenantId: 1, studentId: 1, fy: 1, status: 1 });
rebateSchema.index({ tenantId: 1, createdAt: -1 });
rebateSchema.index({ tenantId: 1, 'student.admissionNo': 1, status: 1 });

export const Rebate = mongoose.models.Rebate ?? mongoose.model('Rebate', rebateSchema);
