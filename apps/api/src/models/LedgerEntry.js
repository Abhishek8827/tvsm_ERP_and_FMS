import mongoose from 'mongoose';
import { registerGlobalPlugins } from '../db.js';
import { makeImmutable } from './Immutable.js';

registerGlobalPlugins();

/**
 * The money ledger: one signed entry per movement in ONE account ('cash', 'petty', 'bank:<id>').
 * A balance is the sum of the entries (plus fee receipts that still count). INSERT-ONLY: a
 * mistake is fixed by a reversing entry. A transfer writes two entries with the same transferId,
 * so it moves money without being income or expense.
 */
export const LEDGER_TYPES = [
  'opening',
  'opening_change', // Admin corrects an opening balance (reason in note); old entries stay
  'transfer',
  'petty_entry',
  'petty_reversal',
  'expense_payment',
  'payment_reversal',
];
const ledgerSchema = new mongoose.Schema(
  {
    account: { type: String, required: true },
    amountPaise: { type: Number, required: true }, // signed, never 0
    type: { type: String, enum: LEDGER_TYPES, required: true },
    refId: { type: String }, // voucher / payment / petty entry / transfer id
    transferId: { type: String },
    entryDate: { type: String, required: true }, // IST calendar date, YYYY-MM-DD
    note: { type: String },
    createdBy: { type: String },
    createdByName: { type: String },
    createdAt: { type: Date, default: () => new Date(), required: true },
  },
  { versionKey: false },
);
ledgerSchema.index({ tenantId: 1, account: 1, createdAt: -1 });
ledgerSchema.index({ tenantId: 1, refId: 1 });
// One opening entry per account: the opening balance can be set only once (later fixes are entries).
ledgerSchema.index(
  { tenantId: 1, account: 1 },
  { unique: true, partialFilterExpression: { type: 'opening' } },
);
makeImmutable(ledgerSchema, 'Ledger entries');

export const LedgerEntry =
  mongoose.models.LedgerEntry ?? mongoose.model('LedgerEntry', ledgerSchema);
