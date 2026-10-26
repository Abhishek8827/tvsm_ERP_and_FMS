import mongoose from "mongoose";
import { registerGlobalPlugins } from "../db.js";

registerGlobalPlugins();

/**
 * One WhatsApp message per document (a fee receipt, or a Transfer Certificate). It records whether
 * the message was handed to WhatsApp, so the screens can say "sent" or "failed" and offer Retry.
 * "sent" means WhatsApp accepted it; delivery / read receipts are not tracked.
 * The phone number is kept only as the digits sent to (needed for Retry); screens show it masked.
 */
export const WA_KINDS = ["receipt", "tc"];
export const WA_STATUSES = ["queued", "sent", "failed", "skipped"];

const waSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: WA_KINDS, required: true },
    refId: { type: String, required: true }, // receipt id or TC id
    refNumber: { type: String }, // receipt number / TC Sl. No., for lists
    to: { type: String }, // 91XXXXXXXXXX, empty when the student has no valid number
    status: { type: String, enum: WA_STATUSES, required: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
    providerMessageId: { type: String },
    sentAt: { type: Date },
    lastAttemptAt: { type: Date },
    createdBy: { type: String },
    createdByName: { type: String },
  },
  { timestamps: true },
);
waSchema.index({ tenantId: 1, kind: 1, refId: 1 }, { unique: true });
waSchema.index({ tenantId: 1, status: 1, updatedAt: -1 });

export const WhatsappMessage =
  mongoose.models.WhatsappMessage ??
  mongoose.model("WhatsappMessage", waSchema);
