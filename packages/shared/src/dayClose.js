import { assertPaise } from "./money.js";

/** A Day Close rule was broken (the route turns it into a 422 with this code). */
export class DayCloseRuleError extends Error {
  constructor(code, message, field) {
    super(message);
    this.name = "DayCloseRuleError";
    this.code = code;
    this.field = field;
  }
}

/**
 * Cash the drawer should hold for the day = cash receipts of the day minus cash receipts
 * cancelled ON that day (a receipt cancelled later counts on the later day, not here).
 * Only cash is checked; UPI / QR are shown as totals because they go to the bank.
 */
export function expectedCash({ cashReceiptPaise, cashCancelledPaise }) {
  return cashReceiptPaise - cashCancelledPaise;
}

/**
 * Checks the counted cash. A difference is allowed but needs a written reason; it is only
 * recorded (no money moves). Returns the signed difference (counted - expected).
 */
export function checkClose({ expectedPaise, countedPaise, reason }) {
  try {
    assertPaise(countedPaise, "countedPaise");
  } catch {
    throw new DayCloseRuleError(
      "BAD_AMOUNT",
      "Cash counted must be whole paise.",
      "countedPaise",
    );
  }
  if (countedPaise < 0)
    throw new DayCloseRuleError(
      "BAD_AMOUNT",
      "Cash counted cannot be negative.",
      "countedPaise",
    );
  const differencePaise = countedPaise - expectedPaise;
  if (differencePaise !== 0 && (reason ?? "").trim().length < 3)
    throw new DayCloseRuleError(
      "REASON_REQUIRED",
      "The counted cash is different from the expected cash. Write the reason.",
      "reason",
    );
  return { differencePaise };
}
