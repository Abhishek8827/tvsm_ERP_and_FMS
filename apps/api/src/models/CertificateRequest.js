import mongoose from "mongoose";
import { registerGlobalPlugins } from "../db.js";

registerGlobalPlugins();

/**
 * A request for a Transfer Certificate or a Bonafide certificate. The Admin makes the request,
 * the Principal approves or rejects it online, and only on approval is the certificate (and its
 * gap-free number) created. A rejected request never takes a number.
 *
 * `payload` is what the Admin entered (re-checked at approval, because dues can change in
 * between). `preview` is what was worked out when the request was made, so the Principal can
 * read the certificate before deciding.
 */
const requestSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["tc", "bonafide"],
      required: true,
      immutable: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      immutable: true,
    },
    fy: { type: String, required: true, immutable: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    preview: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      immutable: true,
    },
    // For the list: who, and (TC) the dues the Admin wants to override.
    studentName: { type: String, required: true, immutable: true },
    admissionNo: { type: String, required: true, immutable: true },
    duesOverride: { type: mongoose.Schema.Types.Mixed, immutable: true },
    idempotencyKey: { type: String, required: true, immutable: true },
    requestedBy: { type: String, immutable: true },
    requestedByName: { type: String, immutable: true },
    decidedBy: String,
    decidedByName: String,
    decidedAt: Date,
    rejectReason: String,
    certificateId: String,
    certificateNumber: String, // "0143" or "BON/FY2026-27/001"
  },
  { timestamps: true },
);
requestSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
requestSchema.index({ tenantId: 1, kind: 1, status: 1, createdAt: -1 });
requestSchema.index({ tenantId: 1, admissionNo: 1 });
// One waiting request per student and kind: a double click or a second Admin cannot stack them.
requestSchema.index(
  { tenantId: 1, studentId: 1, kind: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } },
);

export const CertificateRequest =
  mongoose.models.CertificateRequest ??
  mongoose.model("CertificateRequest", requestSchema);
