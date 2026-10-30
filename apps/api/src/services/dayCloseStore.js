import mongoose from "mongoose";
import { addDaysToDateString, expectedCash, istStartOfDay } from "@erp/shared";
import { Counter } from "../models/Counter.js";
import { DayClose } from "../models/DayClose.js";
import { Receipt } from "../models/Receipt.js";
import { ReceiptCancellation } from "../models/ReceiptCancellation.js";

const dup = (e) => e?.code === 11000;
const transient = (e) =>
  e?.hasErrorLabel?.("TransientTransactionError") ||
  e?.hasErrorLabel?.("UnknownTransactionCommitResult");

/**
 * The one lock of a school day. Issuing a receipt and closing the day both write it inside their
 * transactions, so the database makes them queue: a receipt can never slip in between "count the
 * day" and "mark it closed", and a closed day can never take a receipt.
 */
export const dayLockKey = (date) => `lock:day:${date}`;
export const lockDay = (tenantId, date, session) =>
  Counter.updateOne(
    { tenantId, key: dayLockKey(date) },
    { $inc: { seq: 1 } },
    { upsert: true, session },
  );

/**
 * Live figures for one IST day, straight from the receipts. A receipt cancelled on a LATER day
 * is still in this day's total (it comes out on the day it was cancelled).
 */
async function dayTotals(tenantId, date, session) {
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
    ]).session(session ?? null),
    ReceiptCancellation.find({
      tenantId,
      status: "cancelled",
      decidedAt: { $gte: from, $lt: to },
    })
      .select("receiptId")
      .session(session ?? null)
      .lean(),
  ]);
  const cancelledReceipts = cancelledRows.length
    ? await Receipt.find({
        tenantId,
        _id: { $in: cancelledRows.map((r) => r.receiptId) },
      })
        .select("mode totalPaise")
        .session(session ?? null)
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
     * Closes the day. Returns null when it is already closed (the caller says 409), and
     * { stale: true } when receipts or cancellations changed the day's figures after the caller
     * worked them out (the caller asks the cashier to count again). A day that was reopened is
     * closed again in place, with the new count appended to the history.
     * WHY a transaction: the day lock makes this wait for, or fail against, any receipt being
     * issued at the same moment, and the figures are checked again inside it.
     */
    async close({ tenantId, date, figures, user, totals }) {
      const now = new Date();
      const entry = { action: "close", at: now, byName: user.name, ...figures };
      const set = {
        status: "closed",
        ...figures,
        closedBy: String(user.id),
        closedByName: user.name,
        closedAt: now,
      };
      let last;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const session = await mongoose.startSession();
        try {
          let result;
          await session.withTransaction(async () => {
            await lockDay(tenantId, date, session);
            if (totals) {
              const fresh = await dayTotals(tenantId, date, session);
              const same =
                fresh.expectedCashPaise === totals.expectedCashPaise &&
                fresh.upiPaise === totals.upiPaise &&
                fresh.receiptCount === totals.receiptCount;
              if (!same) {
                result = { stale: true };
                return;
              }
            }
            const existing = await DayClose.findOne({ tenantId, date })
              .session(session)
              .lean();
            if (!existing) {
              const [doc] = await DayClose.create(
                [{ tenantId, date, ...set, history: [entry] }],
                {
                  session,
                },
              );
              result = doc.toObject();
              return;
            }
            // The status filter makes a double click or a second cashier a no-op (returns null).
            result = await DayClose.findOneAndUpdate(
              { tenantId, date, status: "open" },
              { $set: set, $push: { history: entry } },
              { new: true, session },
            ).lean();
          });
          return result;
        } catch (err) {
          if (dup(err)) return null; // someone closed the same day at the same moment
          last = err;
          if (!transient(err)) throw err;
        } finally {
          await session.endSession();
        }
      }
      throw last;
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
