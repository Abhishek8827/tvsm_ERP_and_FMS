import mongoose from 'mongoose';
import { registerGlobalPlugins } from '../db.js';

registerGlobalPlugins();

/**
 * TC settings (one document per school): the Book No. printed on every TC (the Admin can still
 * change it on the form) and the Sl. No. the FIRST TC of a financial year starts from (so the
 * numbers can continue the school's paper register). Changes are kept in `history`.
 */
const settingsSchema = new mongoose.Schema(
  {
    tcBookNo: { type: String, default: '' },
    tcStartSl: { type: Number, default: 1, min: 1 },
    history: [
      new mongoose.Schema(
        {
          at: { type: Date, default: () => new Date() },
          byName: String,
          tcBookNo: String,
          tcStartSl: Number,
        },
        { _id: false, tenantScope: false },
      ),
    ],
  },
  { timestamps: true },
);
settingsSchema.index({ tenantId: 1 }, { unique: true });

export const CertificateSettings =
  mongoose.models.CertificateSettings ?? mongoose.model('CertificateSettings', settingsSchema);
