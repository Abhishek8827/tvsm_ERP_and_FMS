import mongoose from "mongoose";
import { registerGlobalPlugins } from "../db.js";

registerGlobalPlugins();

/**
 * Petty cash entry (under Rs 500): a serial number only (no voucher number), no approval.
 * `status` moves active -> reversed only through the Admin's reversal (reason compulsory).
 */
const pettySchema = new mongoose.Schema(
  {
    fy: { type: String, required: true },
    seq: { type: Number, required: true }, // serial no., gap-free per financial year
    date: { type: String, required: true },
    headId: { type: mongoose.Schema.Types.ObjectId },
    headName: { type: String },
    payeeName: { type: String, required: true, trim: true },
    particulars: { type: String, required: true, trim: true },
    amountPaise: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ["active", "reversed"],
      default: "active",
      required: true,
    },
    reversalReason: { type: String },
    reversedBy: { type: String },
    reversedByName: { type: String },
    reversedAt: { type: Date },
    idempotencyKey: { type: String, required: true }, // a double click never saves twice
    createdBy: { type: String, required: true },
    createdByName: { type: String },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
pettySchema.index({ tenantId: 1, fy: 1, seq: 1 }, { unique: true });
pettySchema.index({ tenantId: 1, createdAt: -1 });

pettySchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });

export const PettyEntry =
  mongoose.models.PettyEntry ?? mongoose.model("PettyEntry", pettySchema);
