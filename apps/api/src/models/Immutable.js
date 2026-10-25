/**
 * Makes a collection insert-only (rule 9/11 style). Used for the money ledger, transfers and
 * petty entries' history: a wrong entry is fixed by a NEW reversing entry, never by editing.
 */
const BLOCKED = [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "findOneAndReplace",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
];
export function makeImmutable(schema, label) {
  for (const op of BLOCKED)
    schema.pre(op, function () {
      throw new Error(`${label} are immutable: ${op} is not allowed`);
    });
  schema.pre("save", function () {
    if (!this.isNew)
      throw new Error(`${label} are immutable: an entry cannot be saved again`);
  });
  schema.pre("bulkWrite", function (ops) {
    if ((ops ?? []).some((o) => !("insertOne" in o)))
      throw new Error(`${label} are immutable: only inserts are allowed`);
  });
}
