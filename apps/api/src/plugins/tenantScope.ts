import type { Schema } from 'mongoose';

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
] as const;

const UPDATE_OPS = ['findOneAndUpdate', 'updateOne', 'updateMany'] as const;

function hasTenantId(filter: unknown): boolean {
  if (!filter || typeof filter !== 'object') return false;
  const value = (filter as Record<string, unknown>).tenantId;
  // A bare string is the only accepted form. Objects like { $ne: ... } or { $exists: true }
  // would not actually scope the query to one school.
  return typeof value === 'string' && value.length > 0;
}

function touchesTenantId(update: unknown): boolean {
  if (!update || typeof update !== 'object') return false;
  const u = update as Record<string, unknown>;
  if ('tenantId' in u) return true;
  for (const key of ['$set', '$setOnInsert', '$unset', '$rename']) {
    const inner = u[key];
    if (inner && typeof inner === 'object' && 'tenantId' in (inner as object)) return true;
  }
  return false;
}

export function tenantScopePlugin(schema: Schema): void {
  if ((schema.options as Record<string, unknown>).tenantScope === false) return;

  schema.add({ tenantId: { type: String, required: true, index: true } });

  for (const op of QUERY_OPS) {
    schema.pre(op, function (next) {
      if (this.getOptions()._skipTenantCheck === true) return next();
      if (!hasTenantId(this.getFilter())) {
        return next(new Error(`Query missing tenantId scope: ${op} on ${this.model.modelName}`));
      }
      next();
    });
  }

  // WHY: re-assigning a document to another school through an update is as bad as a leak.
  for (const op of UPDATE_OPS) {
    schema.pre(op, function (next) {
      if (this.getOptions()._skipTenantCheck === true) return next();
      if (touchesTenantId(this.getUpdate())) {
        return next(new Error(`tenantId cannot be modified: ${op} on ${this.model.modelName}`));
      }
      next();
    });
  }

  schema.pre('aggregate', function (next) {
    if (this.options._skipTenantCheck === true) return next();
    const first = this.pipeline()[0] as { $match?: Record<string, unknown> } | undefined;
    if (!first?.$match || !hasTenantId(first.$match)) {
      return next(new Error('Aggregate must start with a $match on tenantId'));
    }
    next();
  });

  schema.pre('insertMany', function (next, docs: unknown) {
    const list = Array.isArray(docs) ? docs : [docs];
    if (list.some((d) => !hasTenantId(d))) {
      return next(new Error('insertMany document missing tenantId'));
    }
    next();
  });

  schema.pre('bulkWrite', function (next, ops: unknown) {
    const list = Array.isArray(ops) ? ops : [];
    const bad = list.some((entry) => {
      const [kind] = Object.keys(entry as object);
      const body = (entry as Record<string, Record<string, unknown>>)[kind ?? ''] ?? {};
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
    if (bad) return next(new Error('bulkWrite contains an operation without tenantId scope'));
    next();
  });
}
