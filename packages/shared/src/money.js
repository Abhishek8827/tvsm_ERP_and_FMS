/**
 * Money rules (Engineering rule 4): every amount is an INTEGER number of paise
 * (Rs 1 = 100 paise). No floating-point arithmetic on money anywhere. Conversion
 * to rupees happens only at display/input edges via the helpers below.
 */
export function assertPaise(value, label = "amount") {
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `${label} must be an integer number of paise, got ${value}`,
    );
  }
}
/** Parse a rupee string such as "1,250.50" into paise, without floating-point maths. */
export function rupeesToPaise(input) {
  const text = String(input).trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) {
    throw new Error(`Invalid rupee amount: "${input}"`);
  }
  const negative = text.startsWith("-");
  const [whole = "0", frac = ""] = text.replace("-", "").split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  assertPaise(paise);
  return negative ? -paise : paise;
}
/** Plain "1250.50" style string for forms. */
export function paiseToRupeesString(paise) {
  assertPaise(paise);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}
/** Indian digit grouping, e.g. 12450000 paise -> "₹1,24,500.00" (PRD 4.14). */
export function formatINR(paise, opts = {}) {
  assertPaise(paise);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const frac = abs % 100;
  const digits = String(rupees);
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest
    ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`
    : last3;
  const fracText =
    opts.hideZeroPaise && frac === 0 ? "" : `.${String(frac).padStart(2, "0")}`;
  return `${negative ? "-" : ""}₹${grouped}${fracText}`;
}
const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];
function below1000(n) {
  const parts = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ""));
  } else if (n > 0) {
    parts.push(ONES[n] ?? "");
  }
  return parts.join(" ");
}
/** Amount in words using the Indian system (crore, lakh, thousand) - PRD 4.14. */
export function rupeesInWords(paise) {
  assertPaise(paise);
  if (paise < 0) throw new Error("Cannot write a negative amount in words");
  let rupees = Math.floor(paise / 100);
  const pp = paise % 100;
  if (rupees === 0 && pp === 0) return "Rupees Zero only";
  const segments = [];
  const crore = Math.floor(rupees / 10_000_000);
  rupees %= 10_000_000;
  const lakh = Math.floor(rupees / 100_000);
  rupees %= 100_000;
  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;
  if (crore) segments.push(`${below1000(crore)} Crore`);
  if (lakh) segments.push(`${below1000(lakh)} Lakh`);
  if (thousand) segments.push(`${below1000(thousand)} Thousand`);
  if (rupees) segments.push(below1000(rupees));
  let text = segments.length ? `Rupees ${segments.join(" ")}` : "Rupees Zero";
  if (pp) text += ` and ${below1000(pp)} Paise`;
  return `${text} only`;
}
/**
 * Split a total across weights in whole paise with no rounding loss
 * (largest-remainder). Used later for allocation of payments and concessions.
 */
export function allocateProportionally(total, weights) {
  assertPaise(total);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error("Weights must sum to a positive number");
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    remainder -= 1;
  }
  return floors;
}
