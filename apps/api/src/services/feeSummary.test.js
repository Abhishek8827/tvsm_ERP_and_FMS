import { describe, expect, it } from "vitest";
import { summarizeByClass } from "./feeSummary.js";

const t = (o) => ({
  oldPaise: 0,
  receivablePaise: 0,
  paidPaise: 0,
  rebatePaise: 0,
  hasAny: true,
  ...o,
});
const row = (classKey, section, school, bus) => ({
  classKey,
  section,
  till: { school: t(school), bus: t({ ...bus, hasAny: !!bus }) },
});

describe("Dashboard fee summary", () => {
  it("follows the school's sheet: Dues = Old + Receivable - Paid - Rebate, Due % = Dues / (Old + Receivable)", () => {
    // LKG A from the school's own Excel: old 2,000, receivable 223,300, paid 68,000, rebate 50,820
    const rows = [
      row("LKG", "A", {
        oldPaise: 200000,
        receivablePaise: 22330000,
        paidPaise: 6800000,
        rebatePaise: 5082000,
      }),
    ];
    const { rows: out, total } = summarizeByClass(rows, "school");
    expect(out[0]).toMatchObject({
      classKey: "LKG",
      section: "A",
      students: 1,
      duesPaise: 10648000,
      duePct: 47.26,
    });
    expect(total.duesPaise).toBe(10648000);
  });
  it("groups by class + section in class order and adds a total", () => {
    const rows = [
      row("2", "B", { receivablePaise: 100 }),
      row("NURSERY", "A", { receivablePaise: 300, paidPaise: 100 }),
      row("NURSERY", "A", { receivablePaise: 300 }),
      row("2", "A", { receivablePaise: 100 }),
    ];
    const { rows: out, total } = summarizeByClass(rows, "school");
    expect(out.map((r) => `${r.classKey}${r.section}:${r.students}`)).toEqual([
      "NURSERYA:2",
      "2A:1",
      "2B:1",
    ]);
    expect(total).toMatchObject({
      students: 4,
      receivablePaise: 800,
      paidPaise: 100,
      duesPaise: 700,
    });
  });
  it("the bus table counts only students who have a transport charge; zero billed gives no percentage", () => {
    const rows = [
      row("1", "A", { receivablePaise: 100 }, { receivablePaise: 50 }),
      row("1", "A", { receivablePaise: 100 }, null),
    ];
    const bus = summarizeByClass(rows, "bus");
    expect(bus.rows[0].students).toBe(1);
    expect(summarizeByClass([], "bus").total.duePct).toBeNull();
  });
});
