import { z } from "zod";
import { AppError } from "../utils/errors.js";

/**
 * Split payments: one receipt can be paid with more than one mode (e.g. Rs 2,000 cash + Rs 1,500
 * UPI). New receipts always carry `payments[]`; older receipts only have the single top-level
 * mode / bank, so EVERY reader must go through `splitsOf` (or SPLIT_STAGES in an aggregation).
 */
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
export const MAX_SPLITS = 4;

export const paymentFields = {
  // Legacy single-mode input (still accepted: the whole receipt total is paid in that one mode).
  mode: z.enum(["cash", "upi"]).optional(),
  reference: z.string().trim().max(60).optional(),
  bankId: objectId.optional(),
  // Split input: every entry has its own amount; the amounts must add up to the receipt total.
  payments: z
    .array(
      z.object({
        mode: z.enum(["cash", "upi"]),
        amountPaise: z.number().int().min(1).max(100_000_000),
        reference: z.string().trim().max(60).optional(),
        bankId: objectId.optional(),
      }),
    )
    .min(1)
    .max(MAX_SPLITS)
    .optional(),
};

/** The payments of a receipt, with the legacy single-mode fallback. */
export const splitsOf = (r) =>
  r.payments?.length
    ? r.payments
    : [
        {
          mode: r.mode,
          amountPaise: r.totalPaise,
          reference: r.reference,
          bankId: r.bankId,
          bankName: r.bankName,
        },
      ];

/** Money account a payment went to: 'cash', 'bank:<id>' or 'online:unassigned' (old receipts). */
export const accountOfSplit = (s) =>
  s.mode === "cash"
    ? "cash"
    : s.bankId
      ? `bank:${s.bankId}`
      : "online:unassigned";

/** Aggregation stages: one row per payment (field `pay`), `payIdx` is 0 for the first. */
export const SPLIT_STAGES = [
  {
    $addFields: {
      pay: {
        $cond: [
          { $gt: [{ $size: { $ifNull: ["$payments", []] } }, 0] },
          "$payments",
          [
            {
              mode: "$mode",
              amountPaise: "$totalPaise",
              bankId: "$bankId",
              bankName: "$bankName",
            },
          ],
        ],
      },
    },
  },
  { $unwind: { path: "$pay", includeArrayIndex: "payIdx" } },
];

/** Sum of a receipt's payments that went to one mode ('cash' or 'upi'). */
export const paidIn = (r, mode) =>
  splitsOf(r)
    .filter((s) => (mode === "cash" ? s.mode === "cash" : s.mode !== "cash"))
    .reduce((n, s) => n + s.amountPaise, 0);

/**
 * Checks the payment part of a request BEFORE the receipt is planned: shape, UPI reference, and
 * that every UPI bank is active. Returns a draft; `finishPayments` adds the amounts once the
 * server has worked out the receipt total (the client's total is never trusted).
 */
export async function resolvePayments({ body, tenantId, findBank }) {
  const given = body.payments?.length
    ? body.payments
    : body.mode
      ? [{ mode: body.mode, reference: body.reference, bankId: body.bankId }]
      : null;
  if (!given)
    throw new AppError(
      "PAYMENT_REQUIRED",
      422,
      "Choose how the fee is paid (cash or UPI / QR).",
      {
        mode: "Choose a payment mode",
      },
    );
  const split = !!body.payments?.length;
  if (given.filter((p) => p.mode === "cash").length > 1)
    throw new AppError(
      "DUPLICATE_CASH",
      422,
      "Add cash only once; put the whole cash amount in it.",
    );
  const draft = [];
  for (const p of given) {
    if (p.mode === "cash") {
      draft.push({ mode: "cash", amountPaise: p.amountPaise });
      continue;
    }
    if ((p.reference ?? "").length < 4)
      throw new AppError(
        "REFERENCE_REQUIRED",
        422,
        "Enter the UPI / QR reference number.",
        {
          reference: "Reference number is required",
        },
      );
    const bank = p.bankId ? await findBank(tenantId, p.bankId) : null;
    if (!bank)
      throw new AppError(
        "BANK_REQUIRED",
        422,
        "Choose the bank account that received the money.",
        {
          bankId: "Choose the bank account",
        },
      );
    draft.push({
      mode: "upi",
      amountPaise: p.amountPaise,
      reference: p.reference,
      bankId: String(bank._id),
      bankName: bank.name,
    });
  }
  return { draft, split };
}

/**
 * Final payments for the receipt document: amounts must add up to the server's total exactly.
 * One payment keeps the old top-level mode / reference / bank (so every old reader still works);
 * more than one makes the receipt mode 'split'.
 */
export function finishPayments({ draft, split }, totalPaise) {
  const payments = split
    ? draft
    : draft.map((p) => ({ ...p, amountPaise: totalPaise }));
  const sum = payments.reduce((n, p) => n + p.amountPaise, 0);
  if (sum !== totalPaise)
    throw new AppError(
      "SPLIT_MISMATCH",
      422,
      `The payments add up to Rs ${(sum / 100).toFixed(2)} but the receipt total is Rs ${(totalPaise / 100).toFixed(2)}.`,
      { payments: "Payments must add up to the receipt total" },
    );
  if (payments.length === 1) {
    const [p] = payments;
    return {
      payments,
      mode: p.mode,
      reference: p.mode === "cash" ? undefined : p.reference,
      bankId: p.bankId,
      bankName: p.bankName,
    };
  }
  return {
    payments,
    mode: "split",
    reference: undefined,
    bankId: undefined,
    bankName: undefined,
  };
}
