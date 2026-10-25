import mongoose from 'mongoose';
import { tenantScopePlugin } from './plugins/tenantScope.js';
let pluginRegistered = false;
/**
 * Registers the tenant plugin ONCE and BEFORE any model is compiled (plugins added after
 * model creation do not apply). Import this module before any model file.
 */
export function registerGlobalPlugins() {
  if (pluginRegistered) return;
  // tenantId belongs on the top-level document only. Without this, the plugin also added a
  // REQUIRED tenantId to every sub-document (e.g. a TC's snapshot), and saving failed with
  // "snapshot.tenantId: Path `tenantId` is required" (a 500) on a real database.
  mongoose.set('applyPluginsToChildSchemas', false);
  mongoose.plugin(tenantScopePlugin);
  pluginRegistered = true;
}
export async function connectDb(uri, dbName) {
  registerGlobalPlugins();
  mongoose.set('strictQuery', true);
  return mongoose.connect(uri, { dbName, maxPoolSize: 20, serverSelectionTimeoutMS: 8000 });
}
export async function disconnectDb() {
  await mongoose.disconnect();
}

// Mongo error codes for "an index with this name/key already exists but with other options".
const INDEX_CONFLICT = [85, 86];

/**
 * Builds the model's indexes. If an OLD index with the same name but other options is in the way
 * (e.g. a plain tenantId index made by an earlier version, now meant to be unique), that one old
 * index is dropped and the right one is built. WHY: otherwise the server refuses to start after
 * an upgrade. Only the index named in Mongo's own error is touched.
 */
export async function ensureIndexes(model) {
  try {
    await model.init();
  } catch (err) {
    if (!INDEX_CONFLICT.includes(err?.code)) throw err;
    const name = /existing index:.*?name: "([^"]+)"/.exec(String(err.message))?.[1];
    if (!name) throw err;
    await model.collection.dropIndex(name);
    await model.createIndexes();
  }
}

/**
 * Creates every collection and index up front. WHY: Mongoose builds indexes lazily; inside a
 * transaction the first write to a missing collection can fail ("first try error, second
 * try works"). Creating them at start-up removes that race.
 */
export async function ensureModels() {
  for (const model of Object.values(mongoose.models)) {
    await model.createCollection().catch(() => {});
    await ensureIndexes(model);
  }
}
