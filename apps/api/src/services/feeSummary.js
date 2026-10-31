import { CLASS_KEYS } from "@erp/shared";

const emptyLine = () => ({
  students: 0,
  oldPaise: 0,
  receivablePaise: 0,
  paidPaise: 0,
  rebatePaise: 0,
  duesPaise: 0,
});
const finish = (l) => ({
  ...l,
  // The school's own sheet: Dues = Old + Receivable - Paid - Rebate; Due % = Dues / (Old + Receivable).
  duesPaise: l.oldPaise + l.receivablePaise - l.paidPaise - l.rebatePaise,
  duePct:
    l.oldPaise + l.receivablePaise > 0
      ? Math.round(
          ((l.oldPaise + l.receivablePaise - l.paidPaise - l.rebatePaise) /
            (l.oldPaise + l.receivablePaise)) *
            10000,
        ) / 100
      : null,
});

/**
 * Dashboard "School fees" and "Bus fees" tables: one row per class + section and a total.
 * Built from the same per-student numbers as Collect Fee (rows from buildFeeRows), so the
 * Dashboard can never disagree with the cashier. `kind` is 'school' or 'bus'.
 */
export function summarizeByClass(rows, kind) {
  const by = new Map();
  for (const r of rows) {
    const t = r.till[kind];
    if (!t.hasAny) continue; // a student not on the bus is not counted in the bus table
    const key = `${r.classKey}|${r.section ?? ""}`;
    const l = by.get(key) ?? {
      classKey: r.classKey,
      section: r.section ?? "",
      ...emptyLine(),
    };
    l.students += 1;
    l.oldPaise += t.oldPaise;
    l.receivablePaise += t.receivablePaise;
    l.paidPaise += t.paidPaise;
    l.rebatePaise += t.rebatePaise;
    by.set(key, l);
  }
  const lines = [...by.values()].sort(
    (a, b) =>
      CLASS_KEYS.indexOf(a.classKey) - CLASS_KEYS.indexOf(b.classKey) ||
      a.section.localeCompare(b.section),
  );
  const total = { ...emptyLine() };
  for (const l of lines) for (const k of Object.keys(total)) total[k] += l[k];
  return { rows: lines.map(finish), total: finish(total) };
}
