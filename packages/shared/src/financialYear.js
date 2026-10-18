/**
 * Financial year helper (Engineering rule 5). ONE implementation used everywhere.
 * Dates are stored in UTC; the FY and "business day" are always computed in IST
 * (Asia/Kolkata, UTC+05:30, no daylight saving). FY runs April to March by default
 * (tenant-configurable start month).
 */
const IST_OFFSET_MINUTES = 5 * 60 + 30;
/** Shift a UTC instant so its UTC fields read as IST wall-clock fields. */
function toIstFields(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}
/** "2026-27" for any instant between 1 Apr 2026 00:00 IST and 31 Mar 2027 23:59 IST. */
export function getFinancialYear(date, startMonth = 4) {
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date');
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new Error('startMonth must be 1-12');
  }
  const { year, month } = toIstFields(date);
  const startYear = month >= startMonth ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}
/** IST business date as "YYYY-MM-DD" (drives Day Close and entryDate). */
export function istDateString(date) {
  const { year, month, day } = toIstFields(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
/** UTC instant of 00:00 IST on the given "YYYY-MM-DD". */
export function istStartOfDay(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) throw new Error(`Invalid date string: ${dateString}`);
  const [, y, m, d] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)) - IST_OFFSET_MINUTES * 60_000);
}
/** First and last instant (UTC) of a financial year such as "2026-27". */
export function financialYearRange(fy, startMonth = 4) {
  const match = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!match) throw new Error(`Invalid financial year: ${fy}`);
  const startYear = Number(match[1]);
  if ((startYear + 1) % 100 !== Number(match[2])) throw new Error(`Invalid financial year: ${fy}`);
  const start = istStartOfDay(`${startYear}-${String(startMonth).padStart(2, '0')}-01`);
  const nextStart = istStartOfDay(`${startYear + 1}-${String(startMonth).padStart(2, '0')}-01`);
  return { start, end: new Date(nextStart.getTime() - 1) };
}

/** "2026-06-15" + 10 days -> "2026-06-25" (pure calendar arithmetic, no time zones involved). */
export function addDaysToDateString(dateString, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) throw new Error(`Invalid date string: ${dateString}`);
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
