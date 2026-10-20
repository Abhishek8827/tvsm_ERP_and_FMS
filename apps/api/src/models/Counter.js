import mongoose from 'mongoose';
import { registerGlobalPlugins } from '../db.js';

registerGlobalPlugins();

/**
 * Gap-free counters (rule 4). A receipt number is taken by incrementing one of these INSIDE the
 * same database transaction that saves the receipt, so if saving fails the number is rolled back
 * too and no number is ever skipped or used twice.
 * Keys: "receipt:school:2026-27", "receipt:transport:2026-27" (the April reset comes from the
 * financial year in the key) and "lock:<studentId>" (makes two payments for ONE student queue up).
 */
const counterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);
counterSchema.index({ tenantId: 1, key: 1 }, { unique: true });

export const Counter = mongoose.models.Counter ?? mongoose.model('Counter', counterSchema);
