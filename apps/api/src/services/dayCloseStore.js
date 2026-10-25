import { addDaysToDateString, expectedCash, istStartOfDay } from "@erp/shared";
import { DayClose } from "../models/DayClose.js";
import { Receipt } from "../models/Receipt.js";
import { ReceiptCancellation } from "../models/ReceiptCancellation.js";

const dup = (e) => e?.code === 11000;

/**
 * Live figures for one IST day, straight from the receipts. A receipt cancelled on a LATER day
 * is still in this day's total (it comes out on the day it was cancelled).
 */
async function dayTotals(tenantId, date) {
  const from = istStartOfDay(date);
  const to = istStartOfDay(addDaysToDateString(date, 1));
  const [issued, cancelledRows] = await Promise.all([
    Receipt.aggregate([
      { $match: { tenantId, issuedAt: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: "$mode",
          paise: { $sum: "$totalPaise" },
          count: { $sum: 1 },
        },
      },
    ]),
    ReceiptCancellation.find({
      tenantId,
      status: "cancelled",
      decidedAt: { $gte: from, $lt: to },
    })
      .select("receiptId")
      .lean(),
  ]);
  const cancelledReceipts = cancelledRows.length
    ? await Receipt.find({
        tenantId,
        _id: { $in: cancelledRows.map((r) => r.receiptId) },
      })
        .select("mode totalPaise")
        .lean()
    : [];
  const by = (mode) =>
    issued.find((x) => x._id === mode) ?? { paise: 0, count: 0 };
  const cancelled = (mode) =>
    cancelledReceipts
      .filter((r) => r.mode === mode)
      .reduce((n, r) => n + r.totalPaise, 0);
  const cashReceiptPaise = by("cash").paise;
  const cashCancelledPaise = cancelled("cash");
  return {
    date,
    cashReceiptPaise,
    cashCancelledPaise,
    expectedCashPaise: expectedCash({ cashReceiptPaise, cashCancelledPaise }),
    upiPaise: by("upi").paise - cancelled("upi"),
    qrPaise: by("qr").paise - cancelled("qr"),
    receiptCount: issued.reduce((n, x) => n + x.count, 0),
    cancelledCount: cancelledReceipts.length,
  };
}

export function makeDayCloseStore() {
  return {
    dayTotals,
    get: (tenantId, date) => DayClose.findOne({ tenantId, date }).lean(),
    /** True when Collect Fee must be blocked for this date. */
    async isClosed(tenantId, date) {
      return !!(await DayClose.exists({ tenantId, date, status: "closed" }));
    },
    async list({ tenantId, page, pageSize }) {
      const [rows, total] = await Promise.all([
        DayClose.find({ tenantId })
          .sort({ date: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .select("-history")
          .lean(),
        DayClose.countDocuments({ tenantId }),
      ]);
      return { rows, total };
    },
    /**
     * Closes the day. Returns null when it is already closed (the caller says 409). A day that
     * was reopened is closed again in place, with the new count appended to the history.
     */
    async close({ tenantId, date, figures, user }) {
      const now = new Date();
      const entry = { action: "close", at: now, byName: user.name, ...figures };
      const set = {
        status: "closed",
        ...figures,
        closedBy: String(user.id),
        closedByName: user.name,
        closedAt: now,
      };
      try {
        const existing = await DayClose.findOne({ tenantId, date }).lean();
        if (!existing) {
          const doc = await DayClose.create({
            tenantId,
            date,
            ...set,
            history: [entry],
          });
          return doc.toObject();
        }
        // The status filter makes a double click or a second cashier a no-op (returns null).
        return await DayClose.findOneAndUpdate(
          { tenantId, date, status: "open" },
          { $set: set, $push: { history: entry } },
          { new: true },
        ).lean();
      } catch (err) {
        if (dup(err)) return null; // someone closed the same day at the same moment
        throw err;
      }
    },
    reopen: ({ tenantId, date, reason, user }) =>
      DayClose.findOneAndUpdate(
        { tenantId, date, status: "closed" },
        {
          $set: {
            status: "open",
            reopenedByName: user.name,
            reopenedAt: new Date(),
            reopenReason: reason,
          },
          $push: {
            history: {
              action: "reopen",
              at: new Date(),
              byName: user.name,
              reason,
            },
          },
        },
        { new: true },
      ).lean(),
  };
}
