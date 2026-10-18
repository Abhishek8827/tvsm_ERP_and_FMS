import mongoose from 'mongoose';
import { registerGlobalPlugins } from '../db.js';

// The tenantId plugin must be registered BEFORE a model is compiled.
registerGlobalPlugins();

/**
 * Append-only audit trail (rule 11). WHY it is enforced in the model and not only by habit:
 * once real money flows, "who changed what and why" must be impossible to rewrite. Every
 * update, replace, delete and re-save of an existing entry throws. There is also no route that
 * could edit or delete an entry. (A person with direct database access can still bypass this;
 * production database users should be given insert-only rights on this collection.)
 */
export const AUDIT_ACTIONS = [
  'login',
  'logout',
  'idle_logout',
  'login_blocked',
  'create',
  'update',
  'cancel',
  'approve',
  'reject',
  'override',
  'reprint',
  'issue',
  'export',
  'role_change',
  'deactivate',
];

const auditSchema = new mongoose.Schema(
  {
    at: { type: Date, default: () => new Date(), required: true },
    userId: { type: String },
    userRole: { type: String },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    entity: { type: String, required: true },
    entityId: { type: String },
    oldValue: { type: mongoose.Schema.Types.Mixed },
    newValue: { type: mongoose.Schema.Types.Mixed },
    reason: { type: String },
    requestId: { type: String },
    ip: { type: String },
  },
  { timestamps: false, versionKey: false },
);

auditSchema.index({ tenantId: 1, entity: 1, entityId: 1, at: -1 });
auditSchema.index({ tenantId: 1, userId: 1, at: -1 });
auditSchema.index({ tenantId: 1, action: 1, at: -1 });

const BLOCKED = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
];
for (const op of BLOCKED) {
  auditSchema.pre(op, function () {
    throw new Error(`Audit log is append-only: ${op} is not allowed`);
  });
}
auditSchema.pre('save', function () {
  if (!this.isNew)
    throw new Error('Audit log is append-only: existing entries cannot be saved again');
});
auditSchema.pre('bulkWrite', function (ops) {
  const bad = (ops ?? []).some((o) => !('insertOne' in o));
  if (bad) throw new Error('Audit log is append-only: only inserts are allowed');
});
auditSchema.pre('deleteOne', { document: true, query: false }, function () {
  throw new Error('Audit log is append-only: delete is not allowed');
});

export const AuditLog = mongoose.models.AuditLog ?? mongoose.model('AuditLog', auditSchema);
