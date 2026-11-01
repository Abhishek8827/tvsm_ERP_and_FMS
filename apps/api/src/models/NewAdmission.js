import mongoose from "mongoose";
import { ADMISSION_STATUSES, CLASS_KEYS, STREAMS } from "@erp/shared";
import { registerGlobalPlugins } from "../db.js";

registerGlobalPlugins();

/**
 * One admission FORM handed in by a family (owner's spec, 2026-11-01). The child is not a student
 * yet: the record lives here until the Admin marks it Admitted, then a student is made and this
 * record keeps a link to it (studentId) so the form number and the fee receipts stay with it.
 * Money paid is never stored here: it is read from the admission receipts, so it cannot drift.
 * The form number (NEW/2026-27/001) is given once and is never reused, even after a cancel.
 */
const admissionSchema = new mongoose.Schema(
  {
    session: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    seq: { type: Number, required: true },
    formNo: { type: String, required: true },
    status: {
      type: String,
      enum: ADMISSION_STATUSES,
      default: "pending",
      required: true,
    },

    // Student details: the same fields the student record already has.
    name: { type: String, required: true, trim: true },
    nameLower: { type: String, required: true },
    fatherName: { type: String, trim: true },
    motherName: { type: String, trim: true },
    classKey: { type: String, enum: CLASS_KEYS, required: true },
    stream: { type: String, enum: [...STREAMS, null] },
    gender: { type: String, enum: ["MALE", "FEMALE", "OTHER"] },
    dateOfBirth: { type: Date },
    contactNo: { type: String, trim: true },
    address: { type: String, trim: true },
    category: { type: String, trim: true },
    nationality: { type: String, trim: true },
    caste: { type: String, trim: true },
    samagraId: { type: String, trim: true },
    pen: { type: String, trim: true },
    aparId: { type: String, trim: true },
    aadhaar: { type: String, trim: true },

    formSubmittedOn: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    }, // IST date
    collectedBy: { type: String, trim: true }, // the campaign member who took the form
    // What the form and the admission cost, copied at entry so later fee-chart edits do not move it.
    formFeePaise: { type: Number, required: true, min: 0 },
    admissionFeePaise: { type: Number, required: true, min: 0 },

    createdBy: { type: String },
    createdByName: { type: String },
    idempotencyKey: { type: String, required: true },

    cancelReason: { type: String },
    // Set when admitted.
    studentId: { type: mongoose.Schema.Types.ObjectId },
    scholarNo: { type: String },
    admittedAt: { type: Date },
    admittedByName: { type: String },
    // Every status change, so nothing is lost when a form goes pending -> cancelled -> pending.
    history: [
      new mongoose.Schema(
        {
          at: { type: Date, default: () => new Date() },
          byName: String,
          from: String,
          to: String,
          reason: String,
        },
        { _id: false, tenantScope: false },
      ),
    ],
  },
  { timestamps: true },
);
admissionSchema.index({ tenantId: 1, session: 1, seq: 1 }, { unique: true });
admissionSchema.index({ tenantId: 1, formNo: 1 }, { unique: true });
admissionSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
admissionSchema.index({ tenantId: 1, session: 1, status: 1, createdAt: -1 });
admissionSchema.index({ tenantId: 1, nameLower: 1 });

export const NewAdmission =
  mongoose.models.NewAdmission ??
  mongoose.model("NewAdmission", admissionSchema);
