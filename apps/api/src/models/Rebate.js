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
    kind: { type: String, enum: ['school', 'transport'], required: true },
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

export const Rebate = mongoose.models.Rebate ?? mongoose.model('Rebate', rebateSchema);
