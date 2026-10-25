import mongoose from "mongoose";
import { registerGlobalPlugins } from "../db.js";

registerGlobalPlugins();

/**
 * Opening balances the system cannot know by itself (PRD 4.7.1): the school's fixed assets and its
 * capital / reserve fund. Set by the Admin. Every change keeps the old figures in `history`
 * (with a reason), so the Balance Sheet can always be explained. One document per school.
 */
const historySchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    byName: { type: String },
    reason: { type: String, required: true },
    fixedAssetsPaise: { type: Number, required: true },
    capitalPaise: { type: Number, required: true },
  },
  { _id: false, tenantScope: false },
);

const settingsSchema = new mongoose.Schema(
  {
    fixedAssetsPaise: { type: Number, default: 0, min: 0 },
    capitalPaise: { type: Number, default: 0, min: 0 },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);
settingsSchema.index({ tenantId: 1 }, { unique: true });

export const ReportSettings =
  mongoose.models.ReportSettings ??
  mongoose.model("ReportSettings", settingsSchema);
