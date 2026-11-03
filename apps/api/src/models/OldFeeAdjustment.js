import mongoose from "mongoose";
import { registerGlobalPlugins } from "../db.js";
import { makeImmutable } from "./Immutable.js";

// The tenantId plugin must be registered BEFORE a model is compiled.
registerGlobalPlugins();

/**
 * Admin correction of a student's OLD fee (the balance brought from before this system).
 * INSERT-ONLY: the imported charge and every issued receipt stay exactly as they were. The
 * effective old fee is  charge amount + sum of the deltas  (see services/oldFees.js), so every
 * change is a traceable entry with the previous value, the new value, who did it and why.
 */
const schema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, required: true },
    fy: { type: String, required: true },
    head: { type: String, enum: ["old_fees", "transport_old"], required: true },
    chargeId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // true when the student had no old-fee charge yet: the correction then CREATED it (the new
    // charge carries the amount, so this entry's delta is 0).
    createdCharge: { type: Boolean, default: false },
    previousPaise: { type: Number, required: true, min: 0 },
    newPaise: { type: Number, required: true, min: 0 },
    deltaPaise: { type: Number, required: true }, // added to the charge amount; 0 when createdCharge
    dueDate: { type: String, required: true }, // the charge's due date, so reports can date the delta
    effectiveDate: { type: String, required: true }, // IST YYYY-MM-DD chosen by the Admin
    reason: { type: String, required: true },
    student: { name: String, admissionNo: String },
    createdBy: { type: String },
    createdByName: { type: String },
    createdAt: { type: Date, default: () => new Date(), required: true },
  },
  { versionKey: false },
);
schema.index({ tenantId: 1, studentId: 1, fy: 1, head: 1, createdAt: 1 });
schema.index({ tenantId: 1, createdAt: -1 });
makeImmutable(schema, "Old fee adjustments");

export const OldFeeAdjustment =
  mongoose.models.OldFeeAdjustment ??
  mongoose.model("OldFeeAdjustment", schema);
