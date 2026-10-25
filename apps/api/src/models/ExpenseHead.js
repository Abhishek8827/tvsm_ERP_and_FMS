import mongoose from "mongoose";
import { registerGlobalPlugins } from "../db.js";

registerGlobalPlugins();

/** Expense heads are made by the Admin on screen. A deactivated head stays on old records. */
const headSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameLower: { type: String, required: true },
    active: { type: Boolean, default: true },
    createdBy: { type: String },
  },
  { timestamps: true },
);
headSchema.index({ tenantId: 1, nameLower: 1 }, { unique: true });

export const ExpenseHead =
  mongoose.models.ExpenseHead ?? mongoose.model("ExpenseHead", headSchema);
