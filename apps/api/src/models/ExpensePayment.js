import mongoose from "mongoose";
import { registerGlobalPlugins } from "../db.js";

registerGlobalPlugins();

/**
 * One payment against an approved voucher (a voucher can be paid in parts). Only `status` can
 * move (active -> reversed) and only through an approved reversal.
 */
const paymentSchema = new mongoose.Schema(
  {
    fy: { type: String, required: true },
    seq: { type: Number, required: true }, // S.NO of the Payments register
    voucherId: { type: mongoose.Schema.Types.ObjectId, required: true },
    voucherNumber: { type: String, required: true },
    date: { type: String, required: true },
    headName: { type: String, required: true },
    payeeName: { type: String, required: true },
    details: { type: String, default: "" }, // PARTICULARS / PAYMENT DETAILS
    mode: { type: String, enum: ["cash", "bank"], required: true },
    bankId: { type: String },
    bankName: { type: String },
    amountPaise: { type: Number, required: true, min: 1 },
    authorisedBy: {
      type: String,
      enum: ["President", "Vice President"],
      required: true,
    },
    approvedByName: { type: String }, // the Principal who approved the voucher
    remark: { type: String, default: "" },
    status: {
      type: String,
      enum: ["active", "reversed"],
      default: "active",
      required: true,
    },
    idempotencyKey: { type: String, required: true }, // a double click never saves twice
    createdBy: { type: String, required: true },
    createdByName: { type: String },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
paymentSchema.index({ tenantId: 1, fy: 1, seq: 1 }, { unique: true });
paymentSchema.index({ tenantId: 1, voucherId: 1 });
paymentSchema.index({ tenantId: 1, date: -1 });

paymentSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });

export const ExpensePayment =
  mongoose.models.ExpensePayment ??
  mongoose.model("ExpensePayment", paymentSchema);
