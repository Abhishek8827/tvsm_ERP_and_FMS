import mongoose from "mongoose";
import { registerGlobalPlugins } from "../db.js";

registerGlobalPlugins();

/**
 * One record per school day (IST date). Closing locks Collect Fee for that day; the Admin can
 * reopen it with a reason. WHY `history`: a reopen and a second close must never erase what was
 * counted the first time, so every close / reopen is appended and the top-level fields always
 * describe the latest close.
 */
const figures = {
  expectedCashPaise: { type: Number, required: true },
  countedCashPaise: { type: Number, required: true },
  differencePaise: { type: Number, required: true },
  differenceReason: { type: String },
  upiPaise: { type: Number, required: true },
  receiptCount: { type: Number, required: true },
};
const dayCloseSchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // YYYY-MM-DD in IST
    status: { type: String, enum: ["closed", "open"], required: true },
    ...figures,
    closedBy: { type: String },
    closedByName: { type: String },
    closedAt: { type: Date },
    reopenedByName: { type: String },
    reopenedAt: { type: Date },
    reopenReason: { type: String },
    history: [
      {
        _id: false,
        action: { type: String, enum: ["close", "reopen"], required: true },
        at: { type: Date, required: true },
        byName: { type: String },
        reason: { type: String },
        ...figures,
        expectedCashPaise: Number,
        countedCashPaise: Number,
        differencePaise: Number,
        upiPaise: Number,
        receiptCount: Number,
      },
    ],
  },
  { timestamps: true },
);
dayCloseSchema.index({ tenantId: 1, date: 1 }, { unique: true });

export const DayClose =
  mongoose.models.DayClose ?? mongoose.model("DayClose", dayCloseSchema);
