import mongoose from 'mongoose';
import { tenantScopePlugin } from './plugins/tenantScope';

let pluginRegistered = false;

/**
 * Registers the tenant plugin ONCE and BEFORE any model is compiled (plugins added after
 * model creation do not apply). Import this module before any model file.
 */
export function registerGlobalPlugins(): void {
  if (pluginRegistered) return;
  mongoose.plugin(tenantScopePlugin);
  pluginRegistered = true;
}

export async function connectDb(uri: string, dbName: string): Promise<typeof mongoose> {
  registerGlobalPlugins();
  mongoose.set('strictQuery', true);
  return mongoose.connect(uri, { dbName, maxPoolSize: 20, serverSelectionTimeoutMS: 8000 });
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
