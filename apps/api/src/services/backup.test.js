import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { PLAN } from "./dataReset.js";
import {
  BACKUP_FORMAT,
  BackupFileError,
  buildBackup,
  parseBackup,
  restoreBackup,
} from "./backup.js";

const { ObjectId } = mongoose.Types;

/** A tiny in-memory collection: find by tenantId or by _id list, insertMany with a unique `number`. */
function fakeCollection(rows = []) {
  const data = [...rows];
  return {
    data,
    find: (filter) => ({
      toArray: async () =>
        data.filter((d) => {
          if (filter.tenantId !== undefined && d.tenantId !== filter.tenantId)
            return false;
          if (filter._id?.$in)
            return filter._id.$in.some((id) => String(id) === String(d._id));
          return true;
        }),
    }),
    insertMany: async (docs) => {
      const writeErrors = [];
      let insertedCount = 0;
      docs.forEach((d, index) => {
        if (d.number && data.some((x) => x.number === d.number))
          writeErrors.push({ code: 11000, index });
        else {
          data.push(d);
          insertedCount += 1;
        }
      });
      if (writeErrors.length)
        throw Object.assign(new Error("dup"), {
          writeErrors,
          result: { insertedCount },
        });
      return { insertedCount };
    },
  };
}
const planWith = (receipts, students) => [
  { name: "Receipt", model: { collection: receipts } },
  { name: "Student", model: { collection: students } },
];
const T = "tvsm";
const rid = () => new ObjectId();

describe("backup file", () => {
  it("holds every collection in the data-cleaner plan (so none is forgotten)", async () => {
    const empty = PLAN.map((p) => ({
      ...p,
      model: { collection: fakeCollection() },
    }));
    const file = await buildBackup(T, { plan: empty });
    expect(Object.keys(file.collections).sort()).toEqual(
      PLAN.map((p) => p.name).sort(),
    );
    expect(file.format).toBe(BACKUP_FORMAT);
  });

  it("round-trips ids and dates, and only takes this school", async () => {
    const id = rid();
    const at = new Date("2026-10-01T05:00:00Z");
    const receipts = fakeCollection([
      { _id: id, tenantId: T, number: "S/1", totalPaise: 5000, issuedAt: at },
      { _id: rid(), tenantId: "other", number: "X/1" },
    ]);
    const file = await buildBackup(T, {
      plan: planWith(receipts, fakeCollection()),
    });
    expect(file.counts.Receipt).toBe(1);
    const back = parseBackup(Buffer.from(JSON.stringify(file)), T);
    const target = fakeCollection();
    await restoreBackup(back, T, { plan: planWith(target, fakeCollection()) });
    expect(target.data[0]._id.equals(id)).toBe(true);
    expect(target.data[0].issuedAt.getTime()).toBe(at.getTime());
  });

  it("refuses a file that is not a backup, or belongs to another school", () => {
    expect(() => parseBackup(Buffer.from("nonsense"), T)).toThrow(
      BackupFileError,
    );
    expect(() => parseBackup(Buffer.from('{"a":1}'), T)).toThrow(
      /not a TVSM ERP backup/,
    );
    const other = JSON.stringify({
      format: BACKUP_FORMAT,
      version: 1,
      tenantId: "x",
      collections: {},
    });
    expect(() => parseBackup(Buffer.from(other), T)).toThrow(
      /different school/,
    );
  });
});

describe("restore adds only what is missing", () => {
  it("leaves matched records unchanged, skips clashing numbers, and a second run adds nothing", async () => {
    const same = rid();
    const added = rid();
    const clash = rid();
    const source = fakeCollection([
      { _id: same, tenantId: T, number: "S/1", totalPaise: 5000 },
      { _id: added, tenantId: T, number: "S/2", totalPaise: 7000 },
      { _id: clash, tenantId: T, number: "S/3", totalPaise: 1 },
    ]);
    const file = JSON.parse(
      JSON.stringify(
        await buildBackup(T, { plan: planWith(source, fakeCollection()) }),
      ),
    );
    const live = fakeCollection([
      { _id: same, tenantId: T, number: "S/1", totalPaise: 9999 }, // edited since the backup
      { _id: rid(), tenantId: T, number: "S/3", totalPaise: 123 }, // different record, same number
    ]);
    const plan = planWith(live, fakeCollection());
    const out = await restoreBackup(file, T, { plan });
    expect(out.collections.Receipt).toEqual({
      inFile: 3,
      added: 1,
      skipped: 2,
    });
    expect(live.data.find((d) => d._id.equals(same)).totalPaise).toBe(9999);
    expect(live.data.some((d) => d._id.equals(added))).toBe(true);
    expect(live.data.some((d) => d._id.equals(clash))).toBe(false);
    const again = await restoreBackup(file, T, { plan });
    expect(again.totals.added).toBe(0);
  });

  it("never inserts a record that belongs to another school, and reports unknown collections", async () => {
    const live = fakeCollection();
    const file = {
      collections: {
        Receipt: [
          { _id: { $oid: String(rid()) }, tenantId: "other", number: "Z/1" },
          { _id: { $oid: String(rid()) }, tenantId: T, number: "S/9" },
        ],
        Mystery: [],
      },
    };
    const out = await restoreBackup(file, T, {
      plan: planWith(live, fakeCollection()),
    });
    expect(live.data).toHaveLength(1);
    expect(out.unknown).toEqual(["Mystery"]);
  });
});
