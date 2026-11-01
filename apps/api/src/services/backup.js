import mongoose from "mongoose";
import { PLAN } from "./dataReset.js";

/**
 * Backup & Restore (owner's decisions, 2026-11-01):
 *  - a backup holds EVERY collection of this school (users, students, receipts, audit log, counters,
 *    settings ...), so a lost database can be rebuilt from the file alone;
 *  - restore only ADDS what is missing. A record that is already there (same _id) is left exactly
 *    as it is, and a record that would clash with a unique number (a receipt number, a day) is
 *    skipped, never overwritten. Running the same restore twice changes nothing the second time.
 * The list of collections is the same PLAN the data cleaner uses, which a test forces to contain
 * every model, so a collection added later cannot be forgotten by the backup.
 * The file is not encrypted or password-protected (owner's decision); keep it somewhere safe.
 */
export const BACKUP_FORMAT = "tvsm-erp-backup";
export const BACKUP_VERSION = 1;
export const RESTORE_PHRASE = "RESTORE BACKUP";
const CHUNK = 500;

const ejson = () => mongoose.mongo.BSON.EJSON;

export class BackupFileError extends Error {
  constructor(message) {
    super(message);
    this.name = "BackupFileError";
  }
}

/** Reads every collection of this school into one plain object (Extended JSON keeps ids and dates). */
export async function buildBackup(
  tenantId,
  { plan = PLAN, now = new Date() } = {},
) {
  const collections = {};
  const counts = {};
  for (const entry of plan) {
    const docs = await entry.model.collection.find({ tenantId }).toArray();
    collections[entry.name] = ejson().serialize(docs, { relaxed: false });
    counts[entry.name] = docs.length;
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    tenantId,
    createdAt: now.toISOString(),
    counts,
    collections,
  };
}

/** Parses and checks an uploaded file. Throws BackupFileError with a plain message. */
export function parseBackup(buffer, tenantId) {
  let file;
  try {
    file = JSON.parse(Buffer.from(buffer).toString("utf8"));
  } catch {
    throw new BackupFileError(
      "This is not a backup file (it could not be read).",
    );
  }
  if (
    file?.format !== BACKUP_FORMAT ||
    !file.collections ||
    typeof file.collections !== "object"
  )
    throw new BackupFileError("This is not a TVSM ERP backup file.");
  if (file.version !== BACKUP_VERSION)
    throw new BackupFileError(`Unsupported backup version (${file.version}).`);
  if (file.tenantId !== tenantId)
    throw new BackupFileError(
      "This backup belongs to a different school and cannot be restored.",
    );
  return file;
}

const isDuplicate = (e) => e?.code === 11000;

/** Adds the records the database does not have. Returns what happened, per collection. */
export async function restoreBackup(file, tenantId, { plan = PLAN } = {}) {
  const result = {};
  const known = new Set(plan.map((p) => p.name));
  const unknown = Object.keys(file.collections).filter((n) => !known.has(n));
  for (const entry of plan) {
    const raw = file.collections[entry.name];
    if (!Array.isArray(raw)) continue;
    const docs = ejson()
      .deserialize(raw, { relaxed: false })
      .filter((d) => d && d._id !== undefined && d.tenantId === tenantId);
    const col = entry.model.collection;
    let added = 0;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const chunk = docs.slice(i, i + CHUNK);
      const have = new Set(
        (
          await col
            .find(
              { _id: { $in: chunk.map((d) => d._id) } },
              { projection: { _id: 1 } },
            )
            .toArray()
        ).map((d) => String(d._id)),
      );
      const missing = chunk.filter((d) => !have.has(String(d._id)));
      if (!missing.length) continue;
      try {
        const res = await col.insertMany(missing, { ordered: false });
        added += res.insertedCount ?? missing.length;
      } catch (err) {
        // A record that clashes with a unique number is skipped; anything else is a real failure.
        const errors = err?.writeErrors ?? [];
        if (
          !errors.length ||
          !errors.every((w) => isDuplicate(w) || isDuplicate(w?.err))
        )
          throw err;
        added +=
          err.result?.insertedCount ??
          err.insertedCount ??
          missing.length - errors.length;
      }
    }
    result[entry.name] = {
      inFile: docs.length,
      added,
      skipped: docs.length - added,
    };
  }
  const totals = Object.values(result).reduce(
    (t, r) => ({
      inFile: t.inFile + r.inFile,
      added: t.added + r.added,
      skipped: t.skipped + r.skipped,
    }),
    { inFile: 0, added: 0, skipped: 0 },
  );
  return { collections: result, totals, unknown };
}
