import { assertPaise } from "./money.js";

/**
 * Rules for school expenses, petty cash, bank/cash balances (Step 6). Pure functions: the API
 * calls them inside its transactions, and they are unit-tested without a database.
 *
 * Confirmed by the school:
 *  - under Rs 500 -> Petty Cash module (serial number only, no voucher, no approval);
 *  - Rs 500 or more -> School Expense voucher, paid only after Principal approval,
 *    from one of the bank accounts or from cash in hand;
 *  - when petty cash runs out, the Admin tops it up from cash in hand (a transfer);
 *  - a transfer between accounts is neither income nor expense; an adjustment is not a payment.
 */
export const PETTY_LIMIT_PAISE = 500 * 100; // petty entries must be STRICTLY below this
export const AUTHORISERS = ["President", "Vice President"];
export const PAY_MODES = ["cash", "bank"];

export class ExpenseRuleError extends Error {
  constructor(code, message, field) {
    super(message);
    this.code = code;
    this.field = field;
  }
}
const fail = (code, message, field) => {
  throw new ExpenseRuleError(code, message, field);
};

/** Account keys used by the ledger: 'cash', 'petty' or 'bank:<bankId>'. */
export const accountKey = (a) =>
  a.kind === "bank" ? `bank:${a.bankId}` : a.kind;
export const parseAccountKey = (key) =>
  key.startsWith("bank:")
    ? { kind: "bank", bankId: key.slice(5) }
    : { kind: key };

function positivePaise(value, field, label = "Amount") {
  try {
    assertPaise(value, field);
  } catch {
    fail("BAD_AMOUNT", `${label} must be a whole amount in paise.`, field);
  }
  if (value <= 0) fail("BAD_AMOUNT", `${label} must be more than zero.`, field);
}
const needText = (value, field, message, min = 3) => {
  if (String(value ?? "").trim().length < min)
    fail("TEXT_REQUIRED", message, field);
};

/** Balances = opening/ledger entries + (cash/UPI/QR receipts that still count). */
export function balancesFrom({ entries, receiptTotals = {} }) {
  const out = {};
  for (const [key, paise] of Object.entries(receiptTotals))
    out[key] = (out[key] ?? 0) + paise;
  for (const e of entries)
    out[e.account] = (out[e.account] ?? 0) + e.amountPaise;
  return out;
}

/** Which module an amount belongs to. */
export const moduleForAmount = (paise) =>
  paise < PETTY_LIMIT_PAISE ? "petty" : "school";

export function checkVoucherInput({ amountPaise, payeeName, particulars }) {
  positivePaise(amountPaise, "amountPaise");
  if (amountPaise < PETTY_LIMIT_PAISE)
    fail(
      "USE_PETTY_CASH",
      "Expenses under ₹500 go to Petty Cash, not to a school expense voucher.",
      "amountPaise",
    );
  needText(payeeName, "payeeName", "Write the payee name.", 2);
  needText(particulars, "particulars", "Write what the expense is for.");
}

/** Voucher amount minus payments that still count minus adjustments. */
export function voucherFigures({ voucher, payments }) {
  const paid = payments
    .filter((p) => p.status !== "reversed")
    .reduce((s, p) => s + p.amountPaise, 0);
  const adjusted = (voucher.adjustments ?? []).reduce(
    (s, a) => s + a.amountPaise,
    0,
  );
  return {
    paidPaise: paid,
    adjustedPaise: adjusted,
    balanceDuePaise: voucher.amountPaise - paid - adjusted,
  };
}

export function checkPayment({ voucher, payments, input, balances }) {
  const { amountPaise, mode, bankId, authorisedBy } = input;
  if (voucher.status !== "approved")
    fail(
      "NOT_APPROVED",
      "No payment can be made before the Principal approves the voucher.",
    );
  positivePaise(amountPaise, "amountPaise");
  if (!PAY_MODES.includes(mode))
    fail("BAD_MODE", "Choose Cash or Bank.", "mode");
  if (mode === "bank" && !bankId)
    fail("BANK_REQUIRED", "Choose the bank account.", "bankId");
  if (mode === "cash" && bankId)
    fail("BAD_MODE", "A cash payment has no bank account.", "bankId");
  if (!AUTHORISERS.includes(authorisedBy))
    fail(
      "AUTHORISER_REQUIRED",
      "Choose President or Vice President.",
      "authorisedBy",
    );
  const { balanceDuePaise } = voucherFigures({ voucher, payments });
  if (amountPaise > balanceDuePaise)
    fail(
      "OVER_PAYMENT",
      "The payment is more than the balance due on this voucher.",
      "amountPaise",
    );
  const account = mode === "bank" ? `bank:${bankId}` : "cash";
  if ((balances[account] ?? 0) < amountPaise)
    fail(
      "INSUFFICIENT_BALANCE",
      mode === "bank"
        ? "The bank balance is not enough."
        : "Cash in hand is not enough.",
      "amountPaise",
    );
  return { account };
}

export function checkAdjustment({ voucher, payments, input }) {
  if (voucher.status !== "approved")
    fail("NOT_APPROVED", "Only an approved voucher can be adjusted.");
  positivePaise(input.amountPaise, "amountPaise", "Adjustment");
  needText(input.reason, "reason", "Write the reason for the adjustment.");
  needText(
    input.remark,
    "remark",
    "Write the supporting remark for the adjustment.",
  );
  const { balanceDuePaise } = voucherFigures({ voucher, payments });
  if (input.amountPaise > balanceDuePaise)
    fail(
      "OVER_ADJUSTMENT",
      "The adjustment is more than the balance due.",
      "amountPaise",
    );
}

export function checkPettyEntry({
  amountPaise,
  payeeName,
  particulars,
  pettyBalance,
}) {
  positivePaise(amountPaise, "amountPaise");
  if (amountPaise >= PETTY_LIMIT_PAISE)
    fail(
      "USE_VOUCHER",
      "Petty Cash is only for expenses under ₹500. Make a school expense voucher.",
      "amountPaise",
    );
  needText(payeeName, "payeeName", "Write the payee name.", 2);
  needText(particulars, "particulars", "Write what the expense is for.");
  if (pettyBalance < amountPaise)
    fail(
      "PETTY_EMPTY",
      "Petty cash balance is not enough. Top it up from cash in hand first.",
      "amountPaise",
    );
}

export function checkTransfer({ from, to, amountPaise, balances }) {
  positivePaise(amountPaise, "amountPaise");
  if (from === to) fail("SAME_ACCOUNT", "Choose two different accounts.", "to");
  if ((balances[from] ?? 0) < amountPaise)
    fail(
      "INSUFFICIENT_BALANCE",
      'The balance in the "from" account is not enough.',
      "amountPaise",
    );
}

export function checkReason(reason, message = "A reason is required.") {
  needText(reason, "reason", message);
}

/** Voucher number: EXP-FY2026-27/0001 */
export const voucherNumber = (fy, seq) =>
  `EXP-FY${fy}/${String(seq).padStart(4, "0")}`;
