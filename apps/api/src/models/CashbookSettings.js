import mongoose from "mongoose";
import { registerGlobalPlugins } from "../db.js";

registerGlobalPlugins();

/**
 * Cashbook settings (one document per school). The TRANSPORT account is the transport vendor's
 * account the school keeps inside the cashbook: it starts with an opening amount on `startDate`,
 * gains the bus-fee receipts and loses the expenses of the chosen expense heads. Every change is
 * appended to `history`, nothing is overwritten silently.
 */
const settingsSchema = new mongoose.Schema(
  {
    transportOpeningPaise: { type: Number, default: 0 },
    transportStartDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    transportHeads: { type: [String], default: [] }, // expense head names that are transport expense
    history: [
      {
        _id: false,
        at: { type: Date, default: () => new Date() },
        byName: String,
        reason: String,
        transportOpeningPaise: Number,
        transportStartDate: String,
        transportHeads: [String],
      },
    ],
  },
  { timestamps: true },
);
settingsSchema.index({ tenantId: 1 }, { unique: true });

export const CashbookSettings =
  mongoose.models.CashbookSettings ??
  mongoose.model("CashbookSettings", settingsSchema);
