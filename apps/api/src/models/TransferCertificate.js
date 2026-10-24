import mongoose from 'mongoose';
import { registerGlobalPlugins } from '../db.js';

registerGlobalPlugins();

/**
 * An issued Transfer Certificate. Everything printed on it is stored here (snapshot), so a later
 * change to the student record can never change an issued TC. The printed values are `immutable`;
 * only the status (cancelled, with reason) and the duplicate-copy counter ever change, and the
 * record is never deleted. The Sl. No. comes from a gap-free counter inside the same transaction.
 */
const tcSchema = new mongoose.Schema(
  {
    fy: { type: String, required: true, immutable: true },
    slNo: { type: Number, required: true, immutable: true },
    bookNo: { type: String, required: true, immutable: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
    // Fields 1-8, 13, 14 as printed (copied from the student record / fee records at issue time).
    snapshot: {
      type: new mongoose.Schema(
        {
          admissionNo: String,
          name: String,
          motherName: String,
          fatherName: String,
          dob: String, // YYYY-MM-DD
          dobInWords: String,
          nationality: String,
          category: String,
          firstAdmissionDate: String, // YYYY-MM-DD
          firstAdmissionClass: String, // label, e.g. "1st"
          lastClass: String, // key
          lastClassInWords: String,
          section: String,
          duesPaidUpto: String, // "September 2026" or "Nil"
          feeConcession: String,
        },
        { _id: false },
      ),
      required: true,
      immutable: true,
    },
    // Fields 9-12, 15-23: entered by the Admin while issuing.
    entered: {
      type: new mongoose.Schema(
        {
          lastExam: String, // 9
          failedInSameClass: String, // 10
          subjects: String, // 11
          qualifiedForPromotion: String, // 12
          workingDays: Number, // 15
          daysPresent: Number, // 16
          ncc: String, // 17
          games: String, // 18
          conduct: String, // 19
          dateOfApplication: String, // 20 (YYYY-MM-DD)
          dateOfIssue: String, // 21 (YYYY-MM-DD)
          reason: String, // 22
          remarks: String, // 23
        },
        { _id: false },
      ),
      required: true,
      immutable: true,
    },
    // The Admin let a TC through although dues were pending (reason is compulsory).
    duesOverride: {
      type: new mongoose.Schema(
        { reason: String, byName: String, duePaise: Number },
        { _id: false },
      ),
      immutable: true,
    },
    status: { type: String, enum: ['issued', 'cancelled'], default: 'issued' },
    cancelReason: String,
    cancelledAt: Date,
    cancelledByName: String,
    // How many DUPLICATE copies were printed after the original.
    duplicateCount: { type: Number, default: 0 },
    idempotencyKey: { type: String, required: true, immutable: true },
    issuedBy: { type: String, immutable: true },
    issuedByName: { type: String, immutable: true },
  },
  { timestamps: true },
);
tcSchema.index({ tenantId: 1, fy: 1, slNo: 1 }, { unique: true });
tcSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
tcSchema.index({ tenantId: 1, studentId: 1, status: 1 });
tcSchema.index({ tenantId: 1, createdAt: -1 });
tcSchema.index({ tenantId: 1, 'snapshot.admissionNo': 1 });

export const TransferCertificate =
  mongoose.models.TransferCertificate ?? mongoose.model('TransferCertificate', tcSchema);
