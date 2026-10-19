import mongoose from 'mongoose';
import { registerGlobalPlugins } from '../db.js';
import { CLASS_KEYS, STREAMS } from '@erp/shared';

// The tenantId plugin must be registered BEFORE a model is compiled.
registerGlobalPlugins();

/**
 * One student. Admission number ("SCH." / "UNIQ. no" in the school Excel) is the unique ID.
 * AGE is NOT stored: it is calculated from dateOfBirth so it never goes stale.
 * A leaver becomes status "inactive" with a reason. Only the Admin can delete a student for good (bulk delete); every delete is written to the audit log first.
 */
const studentSchema = new mongoose.Schema(
  {
    admissionNo: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    // Lower-case copy of the name so searching stays fast with an index.
    nameLower: { type: String, required: true },
    fatherName: { type: String, trim: true },
    motherName: { type: String, trim: true },
    classKey: { type: String, enum: CLASS_KEYS, required: true },
    stream: { type: String, enum: [...STREAMS, null] }, // only for 11th / 12th
    section: { type: String, trim: true, uppercase: true },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER'] },
    dateOfBirth: { type: Date },
    contactNo: { type: String, trim: true },
    address: { type: String, trim: true },
    category: { type: String, trim: true }, // GEN / OBC / SC / ST
    caste: { type: String, trim: true },
    samagraId: { type: String, trim: true },
    aadhaar: { type: String, trim: true }, // full number stored; API only returns last 4 (Admin/Principal)
    bankAccount: { type: String, trim: true }, // Admin only
    ifsc: { type: String, trim: true, uppercase: true }, // Admin only
    formNo: { type: String, trim: true },
    isNewAdmission: { type: Boolean, default: false }, // admission fee is charged only if true
    isRTE: { type: Boolean, default: false }, // Excel REMARK = "RTE" means true
    usesTransport: { type: Boolean, default: false },
    village: { type: String, trim: true }, // decides the bus fee
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    // Only when inactive: did the student take a Transfer Certificate?
    inactiveReason: {
      type: String,
      enum: ['left_with_tc', 'left_without_tc', null],
      default: null,
    },
  },
  { timestamps: true },
);

studentSchema.index({ tenantId: 1, admissionNo: 1 }, { unique: true });
studentSchema.index({ tenantId: 1, nameLower: 1 });
studentSchema.index({ tenantId: 1, classKey: 1, section: 1, status: 1 });
studentSchema.index({ tenantId: 1, contactNo: 1 });
studentSchema.index({ tenantId: 1, status: 1 });
// Same "numbers as numbers" ordering the list uses, so the default order is served by an index.
studentSchema.index(
  { tenantId: 1, admissionNo: 1 },
  { name: 'tenant_admissionNo_numeric', collation: { locale: 'en', numericOrdering: true } },
);

export const Student = mongoose.models.Student ?? mongoose.model('Student', studentSchema);
