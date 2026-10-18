import mongoose from 'mongoose';
import { registerGlobalPlugins } from '../db.js';
import { ROLES } from '@erp/shared';

// The tenantId plugin must be registered BEFORE a model is compiled.
registerGlobalPlugins();

/**
 * Application user. The DATABASE role is the source of truth; the Firebase custom claim is only
 * a hint that must match it (see middleware/authenticate.js). One role per account (decision).
 * Soft delete only (rule 18): a leaver is deactivated, never removed.
 */
const userSchema = new mongoose.Schema(
  {
    firebaseUid: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ROLES, required: true },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.index({ tenantId: 1, firebaseUid: 1 }, { unique: true });
userSchema.index({ tenantId: 1, email: 1 }, { unique: true });
userSchema.index({ tenantId: 1, role: 1, isActive: 1 });

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
