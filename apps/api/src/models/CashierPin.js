import mongoose from 'mongoose';
import { registerGlobalPlugins } from '../db.js';

registerGlobalPlugins();

/**
 * The 4-digit PIN that protects the Cashier's "all balances" screen. Only a salted scrypt hash is
 * stored. 5 wrong tries lock it; only the Admin can unlock it (by setting a new PIN).
 */
const pinSchema = new mongoose.Schema(
  {
    hash: { type: String, required: true },
    salt: { type: String, required: true },
    failed: { type: Number, default: 0 },
    locked: { type: Boolean, default: false },
    setBy: { type: String },
    setAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false, tenantIdIndex: false },
);
pinSchema.index({ tenantId: 1 }, { unique: true });

export const CashierPin = mongoose.models.CashierPin ?? mongoose.model('CashierPin', pinSchema);
