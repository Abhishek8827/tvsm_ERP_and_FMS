import mongoose from "mongoose";
import { registerGlobalPlugins } from "../db.js";

registerGlobalPlugins();

/** The session new admission forms are being collected for (one document per school). */
const schema = new mongoose.Schema(
  {
    session: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    updatedByName: { type: String },
  },
  { timestamps: true },
);
schema.index({ tenantId: 1 }, { unique: true });

export const AdmissionSettings =
  mongoose.models.AdmissionSettings ??
  mongoose.model("AdmissionSettings", schema);
