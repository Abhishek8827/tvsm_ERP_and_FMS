import mongoose from "mongoose";
import { registerGlobalPlugins } from "../db.js";

registerGlobalPlugins();

/**
 * A request to undo a payment or cancel an unpaid voucher. The Admin asks (reason compulsory),
 * the Principal approves or rejects. Approval writes the reversing ledger entry; nothing is edited.
 * Only one open request per target.
 */
const reversalSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["payment", "voucher"], required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    voucherId: { type: mongoose.Schema.Types.ObjectId, required: true },
    voucherNumber: { type: String, required: true },
    amountPaise: { type: Number, required: true },
    status: {
      type: String,
      enum: ["requested", "approved", "rejected"],
      required: true,
    },
    reason: { type: String, required: true },
    requestedBy: { type: String, required: true },
    requestedByName: { type: String },
    decidedBy: { type: String },
    decidedByName: { type: String },
    decidedAt: { type: Date },
    decisionNote: { type: String },
  },
  { timestamps: true },
);
reversalSchema.index(
  { tenantId: 1, kind: 1, targetId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["requested", "approved"] } },
  },
);
reversalSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

export const ExpenseReversal =
  mongoose.models.ExpenseReversal ??
  mongoose.model("ExpenseReversal", reversalSchema);
