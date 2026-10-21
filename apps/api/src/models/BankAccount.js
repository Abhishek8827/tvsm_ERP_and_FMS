import mongoose from 'mongoose';
import { registerGlobalPlugins } from '../db.js';

registerGlobalPlugins();

/**
 * A school bank account (IDFC, Kotak ... more can be added any time). The opening balance is NOT
 * stored here: it is the first entry of the money ledger, so every rupee has one audit trail.
 * `defaultForModes` = receipt modes (upi / qr) that pre-select this bank on Collect Fee.
 */
const bankSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nameLower: { type: String, required: true },
    last4: { type: String, match: /^\d{4}$/ },
    active: { type: Boolean, default: true },
    defaultForModes: { type: [String], enum: ['upi', 'qr'], default: [] },
    createdBy: { type: String },
  },
  { timestamps: true },
);
bankSchema.index({ tenantId: 1, nameLower: 1 }, { unique: true });

export const BankAccount = mongoose.models.BankAccount ?? mongoose.model('BankAccount', bankSchema);
