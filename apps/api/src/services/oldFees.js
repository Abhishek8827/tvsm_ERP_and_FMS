import { formatINR } from "@erp/shared";
import { AppError } from "../utils/errors.js";

export const OLD_HEADS = { school: "old_fees", transport: "transport_old" };
export const OLD_HEAD_LIST = Object.values(OLD_HEADS);
export const OLD_HEAD_LABEL = {
  old_fees: "Old school fee",
  transport_old: "Old bus fee",
};

const key = (studentId, head) => `${studentId}|${head}`;

/** Sum of the Admin's corrections per student and old head: Map("studentId|head" -> paise). */
export function deltaMap(adjustments) {
  const m = new Map();
  for (const a of adjustments) {
    const k = key(a.studentId, a.head);
    m.set(k, (m.get(k) ?? 0) + (a.deltaPaise ?? 0));
  }
  return m;
}

/**
 * The charges as the fee engine must see them: an old-fee charge carries the Admin's corrections
 * (the imported amount stays in `importedPaise`). A charge corrected down to 0 is left out.
 * Other charges are returned untouched.
 */
export function applyOldFeeAdjustments(charges, adjustments) {
  if (!adjustments.length) return charges;
  const deltas = deltaMap(adjustments);
  const out = [];
  for (const c of charges) {
    const d = OLD_HEAD_LIST.includes(c.head)
      ? deltas.get(key(c.studentId, c.head))
      : undefined;
    if (d === undefined) {
      out.push(c);
      continue;
    }
    const amountPaise = c.amountPaise + d;
    if (amountPaise > 0)
      out.push({ ...c, amountPaise, importedPaise: c.amountPaise });
  }
  return out;
}

/**
 * Rules for one correction. `currentPaise` is the old fee as it stands now, `creditedPaise` what
 * is already paid (valid receipts) or rebated against it. Money already received is never undone.
 */
export function checkOldFeeChange({ currentPaise, newPaise, creditedPaise }) {
  if (!Number.isInteger(newPaise) || newPaise < 0)
    throw new AppError("BAD_AMOUNT", 400, "Enter a valid amount.", {
      newTotalPaise: "Invalid",
    });
  if (newPaise === currentPaise)
    throw new AppError(
      "NO_CHANGE",
      409,
      `The old fee is already ${formatINR(currentPaise, { hideZeroPaise: true })}. Nothing to change.`,
      { newTotalPaise: "Same as now" },
    );
  if (newPaise < creditedPaise)
    throw new AppError(
      "BELOW_PAID",
      409,
      `${formatINR(creditedPaise, { hideZeroPaise: true })} has already been paid or rebated against this old fee, so it cannot be set lower than that. Cancel the receipt first if it was wrong.`,
      { newTotalPaise: "Lower than already paid" },
    );
}
