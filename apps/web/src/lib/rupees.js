import { rupeesToPaise } from "@erp/shared";

/** A typed rupee amount -> { paise } or { error }. Empty is { paise: 0 }. Never uses floats. */
export function parseRupees(text) {
  const v = String(text ?? "").trim();
  if (v === "") return { paise: 0 };
  try {
    const paise = rupeesToPaise(v);
    return paise < 0 ? { error: "Cannot be negative" } : { paise };
  } catch {
    return { error: "Enter a valid amount" };
  }
}

/** "Server said no": the message plus the request reference the Admin can quote. */
export const errorText = (e) =>
  `${e.message}${e.requestId ? ` (ref ${e.requestId})` : ""}`;

export const todayInput = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD

export const accountLabel = (key, banks = []) => {
  if (key === "cash") return "Cash in hand";
  if (key === "petty") return "Petty cash";
  const b = banks.find((x) => `bank:${x.id}` === key);
  return b ? b.name : "Bank";
};
