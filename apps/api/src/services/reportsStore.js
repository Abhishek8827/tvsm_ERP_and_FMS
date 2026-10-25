import { addDaysToDateString, istStartOfDay } from "@erp/shared";
import { Charge } from "../models/Charge.js";
import { ExpensePayment } from "../models/ExpensePayment.js";
import { ExpenseVoucher } from "../models/ExpenseVoucher.js";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { PettyEntry } from "../models/PettyEntry.js";
import { Rebate } from "../models/Rebate.js";
import { Receipt } from "../models/Receipt.js";
import { ReceiptCancellation } from "../models/ReceiptCancellation.js";
import { ReportSettings } from "../models/ReportSettings.js";

const EXPENSE_TYPES = ["expense_payment", "payment_reversal"];
const BEGINNING = "2000-01-01";
const accountOf = (r) =>
  r.mode === "cash"
    ? "cash"
    : r.bankId
      ? `bank:${r.bankId}`
      : "online:unassigned";

/** Cancelled receipts never counted as money (same rule as the Cashbook and bank balances). */
async function liveFilter(tenantId) {
  const gone = (
    await ReceiptCancellation.find({ tenantId, status: "cancelled" })
      .select("receiptId")
      .lean()
  ).map((r) => r.receiptId);
  return { tenantId, _id: { $nin: gone } };
}
const range = (from, to) => ({
  $gte: istStartOfDay(from),
  $lt: istStartOfDay(addDaysToDateString(to, 1)),
});

/** Data access for the Reports screen. Read-only, apart from the opening-balance settings. */
export function makeReportsStore() {
  return {
    getSettings: (tenantId) => ReportSettings.findOne({ tenantId }).lean(),
    saveSettings({ tenantId, fixedAssetsPaise, capitalPaise, reason, user }) {
      return ReportSettings.findOneAndUpdate(
        { tenantId },
        {
          $set: { fixedAssetsPaise, capitalPaise },
          $push: {
            history: {
              at: new Date(),
              byName: user.name,
              reason,
              fixedAssetsPaise,
              capitalPaise,
            },
          },
        },
        { upsert: true, new: true },
      ).lean();
    },

    /** Fee money received between two IST dates, by receipt head, plus late fees charged. */
    async income(tenantId, from, to) {
      const match = {
        ...(await liveFilter(tenantId)),
        issuedAt: range(from, to),
      };
      const [heads, late] = await Promise.all([
        Receipt.aggregate([
          { $match: match },
          { $unwind: "$lines" },
          {
            $group: {
              _id: "$lines.head",
              paise: { $sum: "$lines.amountPaise" },
            },
          },
        ]),
        Receipt.aggregate([
          { $match: match },
          {
            $group: {
              _id: null,
              paise: { $sum: { $ifNull: ["$lateFee.chargedPaise", 0] } },
            },
          },
        ]),
      ]);
      return {
        byHead: Object.fromEntries(heads.map((h) => [h._id, h.paise])),
        latePaise: late[0]?.paise ?? 0,
      };
    },

    /** Money paid out between two IST dates, by expense head: vouchers (net of reversals) + petty cash. */
    async expenses(tenantId, from, to) {
      const [paid, petty] = await Promise.all([
        LedgerEntry.aggregate([
          {
            $match: {
              tenantId,
              type: { $in: EXPENSE_TYPES },
              entryDate: { $gte: from, $lte: to },
            },
          },
          { $group: { _id: "$refId", paise: { $sum: "$amountPaise" } } },
        ]),
        PettyEntry.aggregate([
          {
            $match: {
              tenantId,
              status: "active",
              date: { $gte: from, $lte: to },
            },
          },
          { $group: { _id: "$headName", paise: { $sum: "$amountPaise" } } },
        ]),
      ]);
      const ids = paid.map((p) => p._id).filter(Boolean);
      const payments = ids.length
        ? await ExpensePayment.find({ tenantId, _id: { $in: ids } })
            .select("headName")
            .lean()
        : [];
      const headOf = new Map(payments.map((p) => [String(p._id), p.headName]));
      return [
        // Ledger amounts are signed (a payment is negative), so the spend is the negative sum.
        ...paid.map((p) => ({
          head: headOf.get(String(p._id)) ?? "",
          paise: -p.paise,
        })),
        ...petty.map((p) => ({ head: p._id ?? "", paise: p.paise })),
      ];
    },

    /** Money held in each account on the end of `asOn`. */
    async balances(tenantId, asOn) {
      const live = await liveFilter(tenantId);
      const [ledger, receipts] = await Promise.all([
        LedgerEntry.aggregate([
          { $match: { tenantId, entryDate: { $lte: asOn } } },
          { $group: { _id: "$account", paise: { $sum: "$amountPaise" } } },
        ]),
        Receipt.aggregate([
          {
            $match: {
              ...live,
              issuedAt: { $lt: istStartOfDay(addDaysToDateString(asOn, 1)) },
            },
          },
          {
            $group: {
              _id: { mode: "$mode", bankId: "$bankId" },
              paise: { $sum: "$totalPaise" },
            },
          },
        ]),
      ]);
      const out = { cash: 0, petty: 0 };
      for (const e of ledger) out[e._id] = (out[e._id] ?? 0) + e.paise;
      for (const r of receipts) {
        const k = accountOf(r._id);
        out[k] = (out[k] ?? 0) + r.paise;
      }
      return out;
    },

    /** Memo: fee dues still unpaid on `asOn` (charges due by then - paid - rebates). Late fee excluded. */
    async receivable(tenantId, asOn) {
      const live = await liveFilter(tenantId);
      const end = istStartOfDay(addDaysToDateString(asOn, 1));
      const chargeColl = Charge.collection.name;
      const viaCharge = (lines) => [
        {
          $lookup: {
            from: chargeColl,
            localField: `${lines}.chargeId`,
            foreignField: "_id",
            as: "c",
          },
        },
        { $unwind: "$c" },
        { $match: { "c.dueDate": { $lte: asOn } } },
        { $group: { _id: null, paise: { $sum: `$${lines}.amountPaise` } } },
      ];
      const [billed, paid, rebated] = await Promise.all([
        Charge.aggregate([
          { $match: { tenantId, dueDate: { $lte: asOn } } },
          { $group: { _id: null, paise: { $sum: "$amountPaise" } } },
        ]),
        Receipt.aggregate([
          { $match: { ...live, issuedAt: { $lt: end } } },
          { $unwind: "$lines" },
          { $match: { "lines.chargeId": { $exists: true } } },
          ...viaCharge("lines"),
        ]),
        Rebate.aggregate([
          { $match: { tenantId, status: "active", createdAt: { $lt: end } } },
          { $unwind: "$lines" },
          ...viaCharge("lines"),
        ]),
      ]);
      return Math.max(
        0,
        (billed[0]?.paise ?? 0) -
          (paid[0]?.paise ?? 0) -
          (rebated[0]?.paise ?? 0),
      );
    },

    /** Memo: approved vouchers not yet paid, on `asOn`. */
    async payables(tenantId, asOn) {
      const approved = await ExpenseVoucher.find({
        tenantId,
        status: "approved",
        date: { $lte: asOn },
      })
        .select("_id amountPaise")
        .lean();
      const approvedTotal = approved.reduce(
        (sum, row) => sum + (row.amountPaise ?? 0),
        0,
      );
      if (approved.length === 0) return 0;
      const paid = await ExpensePayment.find({
        tenantId,
        status: "active",
        date: { $lte: asOn },
        voucherId: { $in: approved.map((row) => row._id) },
      })
        .select("voucherId amountPaise")
        .lean();
      const paidTotal = paid.reduce(
        (sum, row) => sum + (row.amountPaise ?? 0),
        0,
      );
      return Math.max(0, approvedTotal - paidTotal);
    },

    /** Every money movement of the range as Day Book entries (receipts + the money ledger). */
    async dayBookEntries(tenantId, from, to, banks) {
      const live = await liveFilter(tenantId);
      const bankName = new Map(banks.map((b) => [String(b._id), b.name]));
      const label = (a) =>
        a === "cash"
          ? "Cash"
          : a === "petty"
            ? "Petty cash"
            : (bankName.get(a.replace("bank:", "")) ?? "Bank");
      const [receipts, ledger] = await Promise.all([
        Receipt.find({ ...live, issuedAt: range(from, to) }).lean(),
        LedgerEntry.find({
          tenantId,
          entryDate: { $gte: from, $lte: to },
        }).lean(),
      ]);
      const refs = ledger.map((e) => e.refId).filter(Boolean);
      const [payments, petty] = refs.length
        ? await Promise.all([
            ExpensePayment.find({
              tenantId,
              _id: { $in: refs.filter((r) => /^[a-f0-9]{24}$/i.test(r)) },
            })
              .select("headName payeeName voucherNumber")
              .lean(),
            PettyEntry.find({
              tenantId,
              _id: { $in: refs.filter((r) => /^[a-f0-9]{24}$/i.test(r)) },
            })
              .select("headName payeeName seq")
              .lean(),
          ])
        : [[], []];
      const pay = new Map(payments.map((p) => [String(p._id), p]));
      const pet = new Map(petty.map((p) => [String(p._id), p]));
      const TYPE = {
        opening: "Opening balance",
        opening_change: "Opening balance change",
        transfer: "Transfer",
        petty_entry: "Petty cash spent",
        petty_reversal: "Petty cash reversed",
        expense_payment: "Expense paid",
        payment_reversal: "Expense payment reversed",
      };
      return [
        ...receipts.map((r) => ({
          id: String(r._id),
          at: r.issuedAt,
          date: undefined,
          type: "Fee receipt",
          ref: r.number,
          particulars:
            `${r.student?.name ?? ""} (${r.student?.admissionNo ?? ""})`.trim(),
          account:
            r.mode === "cash"
              ? "Cash"
              : (r.bankName ?? "Online (no bank chosen)"),
          inPaise: r.totalPaise,
          outPaise: 0,
        })),
        ...ledger.map((e) => {
          const p = pay.get(String(e.refId));
          const q = pet.get(String(e.refId));
          const who = p
            ? `${p.headName} - ${p.payeeName}`
            : q
              ? `${q.headName ?? ""} - ${q.payeeName}`
              : (e.note ?? "");
          return {
            id: String(e._id),
            at: e.createdAt,
            type: TYPE[e.type] ?? e.type,
            ref: p?.voucherNumber ?? (q ? `Petty #${q.seq}` : (e.note ?? "")),
            particulars: who,
            account: label(e.account),
            inPaise: e.amountPaise > 0 ? e.amountPaise : 0,
            outPaise: e.amountPaise < 0 ? -e.amountPaise : 0,
          };
        }),
      ];
    },
  };
}
export const REPORT_BEGINNING = BEGINNING;
