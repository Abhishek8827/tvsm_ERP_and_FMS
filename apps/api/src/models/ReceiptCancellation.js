import mongoose from "mongoose";
import { registerGlobalPlugins } from "../db.js";

registerGlobalPlugins();

/**
 * Cancelling a receipt NEVER edits the receipt (rule 9). It is a separate record that points at
 * the receipt:
 *   requested  the Cashier asked for it (waits for approval, Step 8)
 *   cancelled  approved, or cancelled directly by the Admin. The receipt's payments stop counting.
 *   rejected   the request was refused
 * Only one live (requested / cancelled) record can exist per receipt.
 */
const cancellationSchema = new mongoose.Schema(
  {
    receiptId: { type: mongoose.Schema.Types.ObjectId, required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, required: true },
    receiptNumber: { type: String, required: true },
    status: {
      type: String,
      enum: ["requested", "cancelled", "rejected"],
      required: true,
    },
    reason: { type: String, required: true },
    requestedBy: { type: String },
    requestedByName: { type: String },
    requestedAt: { type: Date },
    decidedBy: { type: String },
    decidedByName: { type: String },
    decidedAt: { type: Date },
    decisionNote: { type: String },
  },
  { timestamps: true },
);

cancellationSchema.index(
  { tenantId: 1, receiptId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["requested", "cancelled"] } },
  },
);
cancellationSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
cancellationSchema.index({ tenantId: 1, studentId: 1, status: 1 });

export const ReceiptCancellation =
  mongoose.models.ReceiptCancellation ??
  mongoose.model("ReceiptCancellation", cancellationSchema);
