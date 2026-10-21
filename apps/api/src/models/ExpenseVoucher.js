import mongoose from 'mongoose';
import { registerGlobalPlugins } from '../db.js';

registerGlobalPlugins();

/**
 * School expense voucher (Rs 500 or more). Amount, head, payee and particulars never change after
 * creation. Only the workflow fields move: status (pending -> approved / rejected, or cancelled
 * by an approved reversal) and the append-only `adjustments` list.
 */
const adjustmentSchema = new mongoose.Schema(
  {
    amountPaise: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true },
    remark: { type: String, required: true },
    by: { type: String },
    byName: { type: String },
    at: { type: Date, default: () => new Date() },
  },
  { _id: false, tenantScope: false },
);
const voucherSchema = new mongoose.Schema(
  {
    fy: { type: String, required: true },
    seq: { type: Number, required: true },
    number: { type: String, required: true },
    date: { type: String, required: true }, // IST date the expense is for, YYYY-MM-DD
    headId: { type: mongoose.Schema.Types.ObjectId, required: true },
    headName: { type: String, required: true },
    payeeName: { type: String, required: true, trim: true },
    particulars: { type: String, required: true, trim: true },
    amountPaise: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
      required: true,
    },
    adjustments: { type: [adjustmentSchema], default: [] },
    idempotencyKey: { type: String, required: true }, // a double click never saves twice
    createdBy: { type: String, required: true },
    createdByName: { type: String },
    decidedBy: { type: String },
    decidedByName: { type: String },
    decidedAt: { type: Date },
    rejectionReason: { type: String },
  },
  { timestamps: true },
);
voucherSchema.index({ tenantId: 1, fy: 1, seq: 1 }, { unique: true });
voucherSchema.index({ tenantId: 1, number: 1 }, { unique: true });
voucherSchema.index({ tenantId: 1, status: 1, date: -1 });
voucherSchema.index({ tenantId: 1, date: -1 });

voucherSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });

export const ExpenseVoucher =
  mongoose.models.ExpenseVoucher ?? mongoose.model('ExpenseVoucher', voucherSchema);
