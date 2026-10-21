/**
 * Tenant isolation (TDD 4.1, rule: tenantId on every document, never skippable).
 *
 * WHY: one forgotten `{ tenantId }` in a query would leak another school's data once this
 * system is reused. The plugin makes that mistake a loud runtime error instead of a silent
 * leak. It guards every read, update, delete, count, aggregate, insertMany and bulkWrite -
 * not only find* (the V1.0 TDD gap).
 *
 * Escape hatch: `{ _skipTenantCheck: true }` query option, allowed ONLY in scripts and the
 * future Super Admin module, never in request handlers. Schemas that are not tenant-owned
 * (the Tenant registry itself) opt out with `new Schema(def, { tenantScope: false })`.
 */
const QUERY_OPS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'countDocuments',
  'distinct',
];
const UPDATE_OPS = ['findOneAndUpdate', 'updateOne', 'updateMany'];
function hasTenantId(filter) {
  if (!filter || typeof filter !== 'object') return false;
  const value = filter.tenantId;
  // A bare string is the only accepted form. Objects like { $ne: ... } or { $exists: true }
  // would not actually scope the query to one school.
  return typeof value === 'string' && value.length > 0;
}
function touchesTenantId(update) {
  if (!update || typeof update !== 'object') return false;
  const u = update;
  if ('tenantId' in u) return true;
  for (const key of ['$set', '$setOnInsert', '$unset', '$rename']) {
    const inner = u[key];
    if (inner && typeof inner === 'object' && 'tenantId' in inner) return true;
  }
  return false;
}
export function tenantScopePlugin(schema) {
  if (schema.options.tenantScope === false) return;
  schema.add({
    tenantId: {
      type: String,
      required: true,
      index: schema.options.tenantIdIndex !== false,
    },
  });
  for (const op of QUERY_OPS) {
    schema.pre(op, function () {
      if (this.getOptions()._skipTenantCheck === true) return;
      if (!hasTenantId(this.getFilter())) {
        throw new Error(`Query missing tenantId scope: ${op} on ${this.model.modelName}`);
      }
    });
  }
  // WHY: re-assigning a document to another school through an update is as bad as a leak.
  for (const op of UPDATE_OPS) {
    schema.pre(op, function () {
      if (this.getOptions()._skipTenantCheck === true) return;
      if (touchesTenantId(this.getUpdate())) {
        throw new Error(`tenantId cannot be modified: ${op} on ${this.model.modelName}`);
      }
    });
  }
  schema.pre('aggregate', function () {
    if (this.options._skipTenantCheck === true) return;
    const first = this.pipeline()[0];
    if (!first?.$match || !hasTenantId(first.$match)) {
      throw new Error('Aggregate must start with a $match on tenantId');
    }
  });
  schema.pre('insertMany', function (docs) {
    const list = Array.isArray(docs) ? docs : [docs];
    if (list.some((d) => !hasTenantId(d))) {
      throw new Error('insertMany document missing tenantId');
    }
  });
  schema.pre('bulkWrite', function (ops) {
    const list = Array.isArray(ops) ? ops : [];
    const bad = list.some((entry) => {
      const [kind] = Object.keys(entry);
      const body = entry[kind ?? ''] ?? {};
      if (kind === 'insertOne') return !hasTenantId(body.document);
      if (
        kind === 'replaceOne' ||
        kind === 'updateOne' ||
        kind === 'updateMany' ||
        kind === 'deleteOne' ||
        kind === 'deleteMany'
      ) {
        return !hasTenantId(body.filter) || touchesTenantId(body.update);
      }
      return true; // unknown operation kind: refuse rather than guess
    });
    if (bad) throw new Error('bulkWrite contains an operation without tenantId scope');
  });
}
