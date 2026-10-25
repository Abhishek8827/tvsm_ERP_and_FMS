import { addDaysToDateString, istStartOfDay } from "@erp/shared";
import { CashbookSettings } from "../models/CashbookSettings.js";
import { DayClose } from "../models/DayClose.js";
import { ExpensePayment } from "../models/ExpensePayment.js";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { Receipt } from "../models/Receipt.js";
import { ReceiptCancellation } from "../models/ReceiptCancellation.js";

const EXPENSE_TYPES = ["expense_payment", "payment_reversal"];

/** Cancelled receipts never counted as money (same rule as the bank / cash balances). */
const cancelledIds = async (tenantId) =>
  (
    await ReceiptCancellation.find({ tenantId, status: "cancelled" })
      .select("receiptId")
      .lean()
  ).map((r) => r.receiptId);
const accountOf = (r) =>
  r.mode === "cash"
    ? "cash"
    : r.bankId
      ? `bank:${r.bankId}`
      : "online:unassigned";

/** Data access for the Cashbook (read-only, apart from the settings). */
export function makeCashbookStore() {
  return {
    getSettings: (tenantId) => CashbookSettings.findOne({ tenantId }).lean(),
    async saveSettings({
      tenantId,
      openingPaise,
      startDate,
      heads,
      reason,
      user,
    }) {
      return CashbookSettings.findOneAndUpdate(
        { tenantId },
        {
          $set: {
            transportOpeningPaise: openingPaise,
            transportStartDate: startDate,
            transportHeads: heads,
          },
          $push: {
            history: {
              at: new Date(),
              byName: user.name,
              reason,
              transportOpeningPaise: openingPaise,
              transportStartDate: startDate,
              transportHeads: heads,
            },
          },
        },
        { upsert: true, new: true },
      ).lean();
    },
    /**
     * Everything one day's cashbook needs. The day is an IST calendar day. Opening balance of an
     * account = everything before the day starts (ledger entries by their entryDate + fee
     * receipts that still count), so  closing = opening + the day's movements  always holds.
     */
    async gather(tenantId, date, settings) {
      const from = istStartOfDay(date);
      const to = istStartOfDay(addDaysToDateString(date, 1));
      const gone = await cancelledIds(tenantId);
      const live = { tenantId, _id: { $nin: gone } };
      const [
        receipts,
        ledgerDay,
        ledgerBefore,
        receiptsBefore,
        dayClose,
        cancelledToday,
      ] = await Promise.all([
        Receipt.find({ ...live, issuedAt: { $gte: from, $lt: to } })
          .sort({ issuedAt: 1 })
          .lean(),
        LedgerEntry.find({ tenantId, entryDate: date })
          .sort({ createdAt: 1 })
          .lean(),
        LedgerEntry.aggregate([
          { $match: { tenantId, entryDate: { $lt: date } } },
          { $group: { _id: "$account", paise: { $sum: "$amountPaise" } } },
        ]),
        Receipt.aggregate([
          { $match: { ...live, issuedAt: { $lt: from } } },
          {
            $group: {
              _id: { mode: "$mode", bankId: "$bankId" },
              paise: { $sum: "$totalPaise" },
            },
          },
        ]),
        DayClose.findOne({ tenantId, date })
          .select("status closedByName closedAt")
          .lean(),
        ReceiptCancellation.countDocuments({
          tenantId,
          status: "cancelled",
          decidedAt: { $gte: from, $lt: to },
        }),
      ]);
      const opening = {};
      for (const e of ledgerBefore)
        opening[e._id] = (opening[e._id] ?? 0) + e.paise;
      for (const r of receiptsBefore) {
        const key = accountOf({ mode: r._id.mode, bankId: r._id.bankId });
        opening[key] = (opening[key] ?? 0) + r.paise;
      }
      const refIds = ledgerDay
        .filter((e) => EXPENSE_TYPES.includes(e.type))
        .map((e) => e.refId);
      const payments = refIds.length
        ? await ExpensePayment.find({ tenantId, _id: { $in: refIds } }).lean()
        : [];

      // Transport vendor account: opening = set amount + income - expense since its start date.
      let transportBefore = null;
      const start = settings?.transportStartDate;
      if (start && start < date) {
        const heads = settings.transportHeads ?? [];
        const [income, headPayments] = await Promise.all([
          Receipt.aggregate([
            {
              $match: {
                ...live,
                kind: "transport",
                issuedAt: { $gte: istStartOfDay(start), $lt: from },
              },
            },
            { $group: { _id: null, paise: { $sum: "$totalPaise" } } },
          ]),
          heads.length
            ? ExpensePayment.find({ tenantId, headName: { $in: heads } })
                .select("_id")
                .lean()
            : [],
        ]);
        const spent = headPayments.length
          ? await LedgerEntry.aggregate([
              {
                $match: {
                  tenantId,
                  type: { $in: EXPENSE_TYPES },
                  refId: { $in: headPayments.map((p) => String(p._id)) },
                  entryDate: { $gte: start, $lt: date },
                },
              },
              { $group: { _id: null, paise: { $sum: "$amountPaise" } } },
            ])
          : [];
        // Ledger amounts are signed (expense negative), so adding them subtracts the expense.
        transportBefore =
          (settings.transportOpeningPaise ?? 0) +
          (income[0]?.paise ?? 0) +
          (spent[0]?.paise ?? 0);
      }
      return {
        receipts,
        ledgerDay,
        opening,
        payments,
        dayClose,
        cancelledToday,
        transportBefore,
      };
    },
  };
}
