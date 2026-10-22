import mongoose from 'mongoose';
import { tenantScopePlugin } from './plugins/tenantScope.js';
let pluginRegistered = false;
/**
 * Registers the tenant plugin ONCE and BEFORE any model is compiled (plugins added after
 * model creation do not apply). Import this module before any model file.
 */
export function registerGlobalPlugins() {
  if (pluginRegistered) return;
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

/**
 * Creates every collection and index up front. WHY: Mongoose builds indexes lazily; inside a
 * transaction the first write to a missing collection can fail ("first try error, second
 * try works"). Creating them at start-up removes that race.
 */
export async function ensureModels() {
  for (const model of Object.values(mongoose.models)) {
    await model.createCollection().catch(() => {});
    await model.init();
  }
}
