import mongoose from 'mongoose';
import { registerGlobalPlugins } from '../db.js';
import { CLASS_KEYS } from '@erp/shared';

// The tenantId plugin must be registered BEFORE a model is compiled.
registerGlobalPlugins();

/**
 * The fee chart for ONE financial year (e.g. "2026-27"). Admin edits it; amounts are integer
 * paise (rule 1). Fees of a year already billed do not change when the chart is edited later,
 * because charges copy the amount at the time they are posted.
 */
// Sub-documents live inside the fee chart, so they do not carry their own tenantId
// (only the top-level document does). `tenantScope: false` stops the global plugin adding it.
const classFeeSchema = new mongoose.Schema(
  {
    classKey: { type: String, enum: CLASS_KEYS, required: true },
    monthlyTuitionPaise: { type: Number, required: true, min: 0 },
    admissionPaise: { type: Number, required: true, min: 0 },
  },
  { _id: false, tenantScope: false },
);
const villageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, uppercase: true },
    monthlyPaise: { type: Number, required: true, min: 0 },
  },
  { _id: false, tenantScope: false },
);

const feeStructureSchema = new mongoose.Schema(
  {
    fy: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    classFees: [classFeeSchema],
    formFeePaise: { type: Number, required: true, min: 0 },
    villages: [villageSchema],
    dueDay: { type: Number, default: 15 },
    graceDays: { type: Number, default: 10 },
    lateFeePaise: { type: Number, default: 10000 },
  },
  { timestamps: true },
);

feeStructureSchema.index({ tenantId: 1, fy: 1 }, { unique: true });

export const FeeStructure =
  mongoose.models.FeeStructure ?? mongoose.model('FeeStructure', feeStructureSchema);
