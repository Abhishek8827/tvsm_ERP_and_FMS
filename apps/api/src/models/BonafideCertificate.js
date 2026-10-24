import mongoose from 'mongoose';
import { registerGlobalPlugins } from '../db.js';

registerGlobalPlugins();

/**
 * An issued Bonafide Certificate (immutable snapshot of what was printed). Number series BON/FY.../001
 * from its own gap-free counter. Only the duplicate-copy counter and a cancel can change later.
 */
const bonafideSchema = new mongoose.Schema(
  {
    fy: { type: String, required: true, immutable: true },
    seq: { type: Number, required: true, immutable: true },
    number: { type: String, required: true, immutable: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
    snapshot: {
      type: new mongoose.Schema(
        {
          admissionNo: String,
          name: String,
          fatherName: String,
          gender: String,
          classKey: String,
          section: String,
          dob: String, // YYYY-MM-DD
        },
        { _id: false },
      ),
      required: true,
      immutable: true,
    },
    academicYear: { type: String, required: true, immutable: true },
    purpose: { type: String, required: true, immutable: true },
    dateOfIssue: { type: String, required: true, immutable: true }, // YYYY-MM-DD
    status: { type: String, enum: ['issued', 'cancelled'], default: 'issued' },
    cancelReason: String,
    cancelledAt: Date,
    cancelledByName: String,
    duplicateCount: { type: Number, default: 0 },
    idempotencyKey: { type: String, required: true, immutable: true },
    issuedBy: { type: String, immutable: true },
    issuedByName: { type: String, immutable: true },
  },
  { timestamps: true },
);
bonafideSchema.index({ tenantId: 1, fy: 1, seq: 1 }, { unique: true });
bonafideSchema.index({ tenantId: 1, number: 1 }, { unique: true });
bonafideSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
bonafideSchema.index({ tenantId: 1, studentId: 1 });
bonafideSchema.index({ tenantId: 1, createdAt: -1 });

export const BonafideCertificate =
  mongoose.models.BonafideCertificate ?? mongoose.model('BonafideCertificate', bonafideSchema);
