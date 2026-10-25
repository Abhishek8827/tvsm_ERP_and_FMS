import mongoose from "mongoose";
import { registerGlobalPlugins } from "../db.js";

// The tenantId plugin must be registered BEFORE a model is compiled.
registerGlobalPlugins();

/**
 * One amount a student owes (e.g. "tuition for June 2026"). Written once when the fee plan is
 * posted and never edited. Payments, concessions and reversals (Step 4+) are stored as separate
 * entries that point at a charge, so the history can always be explained (rule 9).
 * The unique index makes posting the plan again harmless: nothing is duplicated (rule 5).
 */
const chargeSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, required: true },
    fy: { type: String, required: true },
    head: {
      type: String,
      // old_fees / transport_old: unpaid amounts brought from before this system (Excel import).
      enum: [
        "tuition",
        "transport",
        "admission",
        "form",
        "old_fees",
        "transport_old",
      ],
      required: true,
    },
    period: { type: String, required: true }, // '2026-06', 'once' or 'opening' (old fees)
    dueDate: { type: String, required: true }, // IST date 'YYYY-MM-DD'
    amountPaise: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);

chargeSchema.index(
  { tenantId: 1, studentId: 1, fy: 1, head: 1, period: 1 },
  { unique: true },
);
chargeSchema.index({ tenantId: 1, dueDate: 1 }); // "who is overdue" reports

export const Charge =
  mongoose.models.Charge ?? mongoose.model("Charge", chargeSchema);
