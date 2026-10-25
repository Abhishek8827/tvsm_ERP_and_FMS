import { CLASSES, CLASS_KEYS, classLabel } from "./classes.js";

const ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
  'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
]; // prettier-ignore
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
const ORDINAL = [
  '', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth',
  'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth',
  'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth', 'Twenty First', 'Twenty Second',
  'Twenty Third', 'Twenty Fourth', 'Twenty Fifth', 'Twenty Sixth', 'Twenty Seventh',
  'Twenty Eighth', 'Twenty Ninth', 'Thirtieth', 'Thirty First',
]; // prettier-ignore
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December',
]; // prettier-ignore

/** 0..9999 in English words: 2014 -> "Two Thousand Fourteen". */
export function numberInWords(n) {
  if (!Number.isInteger(n) || n < 0 || n > 9999)
    throw new Error("Number out of range");
  if (n < 20) return ONES[n];
  if (n < 100)
    return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
  if (n < 1000)
    return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${numberInWords(n % 100)}` : ""}`;
  return `${ONES[Math.floor(n / 1000)]} Thousand${n % 1000 ? ` ${numberInWords(n % 1000)}` : ""}`;
}

/** "2014-03-14" -> "Fourteenth March Two Thousand Fourteen" (the date part only, no time zones). */
export function dateInWords(dateString) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateString ?? ""));
  if (!m) return "";
  const day = Number(m[3]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return "";
  return `${ORDINAL[day]} ${MONTH_NAMES[month - 1]} ${numberInWords(Number(m[1]))}`;
}

/** "2014-03-14" -> "14/03/2014" (TC date style). */
export function dmy(dateString) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateString ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}
/** "2026-10-13" -> "13 Oct 2026" (Bonafide date style). */
export function dMonY(dateString) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateString ?? ""));
  return m
    ? `${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1].slice(0, 3)} ${m[1]}`
    : "";
}

/** "7" -> "7 (Seventh)"; pre-school classes keep their own names. */
export function classInWords(key) {
  const n = Number(key);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return `${n} (${ORDINAL[n]})`;
  return classLabel(key);
}

/** The class after this one, or null after class 12. */
export function nextClassKey(key) {
  const i = CLASS_KEYS.indexOf(key);
  return i >= 0 && i < CLASS_KEYS.length - 1 ? CLASS_KEYS[i + 1] : null;
}
export const classPlainLabel = (key) =>
  CLASSES.find((c) => c.key === key)?.label ?? key;

/** "2026-09" -> "September 2026". */
export function monthYearLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? ""));
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : "";
}

/**
 * Field 13: the month up to which school dues are paid. Looks at the monthly fees (tuition and
 * bus) in the order of their months: the first month that still has something unpaid ends the
 * run, so the answer is the month before it. When every posted month is paid, it is the last
 * posted month. null = no month is fully paid yet (the TC then prints "Nil").
 * `instalments` is the list from computeDues().
 */
export function duesPaidUpToMonth(instalments) {
  const months = instalments
    .filter((i) => /^\d{4}-\d{2}$/.test(i.period))
    .map((i) => ({
      period: i.period,
      unpaid: i.items
        .filter((x) => x.head === "tuition" || x.head === "transport")
        .reduce((n, x) => n + x.due, 0),
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
  if (months.length === 0) return null;
  const firstUnpaid = months.findIndex((m) => m.unpaid > 0);
  if (firstUnpaid === -1) return months.at(-1).period;
  return firstUnpaid === 0 ? null : months[firstUnpaid - 1].period;
}

// ------------------------------------------------------------------ numbering and choices

/** TC Sl. No. as printed: 143 -> "0143". */
export const tcSlNo = (seq) => String(seq).padStart(4, "0");
/** Bonafide number: BON/FY2026-27/001 (the Admin's format; 3 digits, grows after 999). */
export const bonafideNumber = (fy, seq) =>
  `BON/FY${fy}/${String(seq).padStart(3, "0")}`;

export const TC_CONDUCT = ["Good", "Very Good", "Excellent"];
export const TC_REASONS = ["Parent Request", "Course Completed", "Relocation"];
