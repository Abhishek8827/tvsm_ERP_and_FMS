/**
 * Transport helpers shared by the server and the screen.
 * A student's ADDRESS is the village. Matches it with the fee chart's villages:
 * an exact match (ignoring case/spaces) wins; otherwise a village name contained in the address
 * (or the address contained in a village name) counts only if exactly ONE village fits, so a wrong
 * fee is never guessed. Returns the chart's village object or null.
 */
const clean = (s) =>
  String(s ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
export function matchVillage(address, villages) {
  const a = clean(address);
  if (!a || !Array.isArray(villages)) return null;
  const exact = villages.find((v) => clean(v.name) === a);
  if (exact) return exact;
  const part = villages.filter((v) => {
    const n = clean(v.name);
    return n && (a.includes(n) || n.includes(a));
  });
  return part.length === 1 ? part[0] : null;
}

/** "2026-27" -> ["2026-04", ... "2027-03"] (the months a student can be on the bus). */
export function fyMonths(fy) {
  const start = Number(String(fy).slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;
    const y = m >= 4 ? start : start + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  });
}
/** "2026-09" -> "2026-08" */
export function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
