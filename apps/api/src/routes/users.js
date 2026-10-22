import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '@erp/shared';
import { requireRole } from '../middleware/requireRole.js';
import { recordAudit } from '../services/audit.js';
import { AppError, notFound } from '../utils/errors.js';

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const password = z.string().min(8, 'Password must be at least 8 characters').max(128);
const createBody = z.object({
  name: z.string().trim().min(2, 'Enter the name').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  role: z.enum(ROLES),
  password,
});
const patchBody = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
const resetBody = z.object({ password });

const shape = (u) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  isActive: u.isActive,
  lastLoginAt: u.lastLoginAt ?? null,
});

/**
 * Admin Users module. Accounts live in Firebase (the password and the sign-in) AND in our
 * database (role and active flag, which is what the server trusts).
 * WHY the rules: a school must never lock itself out, so the Admin cannot demote or
 * deactivate their own account, nor remove the last active Admin. Passwords are never logged,
 * never audited and never returned. Changing role / deactivating also revokes the person's
 * existing sessions so the change applies at once.
 */
export function usersRouter(deps, authenticate) {
  const router = Router();
  const admin = [authenticate, requireRole('admin')];
  const fb = () => {
    if (!deps.firebaseAuth)
      throw new AppError('AUTH_NOT_CONFIGURED', 503, 'Sign-in service is not configured.');
    return deps.firebaseAuth;
  };

  router.get('/users', ...admin, async (req, res, next) => {
    try {
      const { page, pageSize } = listQuery.parse(req.query);
      const { rows, total } = await deps.userStore.list({
        tenantId: req.user.tenantId,
        page,
        pageSize,
      });
      res.json({ page, pageSize, total, rows: rows.map(shape) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/users', ...admin, async (req, res, next) => {
    try {
      const body = createBody.parse(req.body);
      const tenantId = req.user.tenantId;
      const auth = fb();
      if (await deps.userStore.findByEmail(tenantId, body.email))
        throw new AppError('DUPLICATE', 409, 'An account with this email already exists.', {
          email: 'Already used',
        });
      let fbUser;
      try {
        fbUser = await auth.createUser({
          email: body.email,
          password: body.password,
          displayName: body.name,
        });
      } catch (err) {
        if (err?.code === 'auth/email-already-exists')
          throw new AppError('DUPLICATE', 409, 'This email already has a sign-in account.', {
            email: 'Already used',
          });
        throw err;
      }
      try {
        await auth.setCustomUserClaims(fbUser.uid, { role: body.role, tenantId });
        const created = await deps.userStore.create(tenantId, {
          firebaseUid: fbUser.uid,
          email: body.email,
          name: body.name,
          role: body.role,
          isActive: true,
        });
        await recordAudit(deps, req, {
          action: 'create',
          entity: 'user',
          entityId: String(created._id),
          newValue: { email: body.email, name: body.name, role: body.role },
        });
        res.status(201).json(shape(created));
      } catch (err) {
        // Do not leave a sign-in account behind that has no school account.
        await auth.deleteUser(fbUser.uid).catch(() => {});
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  router.patch('/users/:id', ...admin, async (req, res, next) => {
    try {
      const body = patchBody.parse(req.body);
      const tenantId = req.user.tenantId;
      const before = await deps.userStore.findById(tenantId, req.params.id);
      if (!before) throw notFound('User');
      const isSelf = String(before._id) === String(req.user.id);
      const losesAdmin =
        before.role === 'admin' &&
        before.isActive &&
        ((body.role && body.role !== 'admin') || body.isActive === false);
      if (isSelf && losesAdmin)
        throw new AppError(
          'SELF_LOCKOUT',
          409,
          'You cannot remove your own Admin access. Ask another Admin.',
        );
      if (losesAdmin && (await deps.userStore.countActiveAdmins(tenantId)) <= 1)
        throw new AppError('LAST_ADMIN', 409, 'At least one active Admin must remain.');
      const auth = fb();
      const updated = await deps.userStore.update(tenantId, req.params.id, body);
      // Keep Firebase in step with our database (claims are only a hint, the DB wins).
      await auth.setCustomUserClaims(before.firebaseUid, {
        role: updated.role,
        tenantId,
      });
      if (body.isActive !== undefined)
        await auth.updateUser(before.firebaseUid, { disabled: !updated.isActive });
      if (body.role || body.isActive === false) await auth.revokeRefreshTokens(before.firebaseUid);
      await recordAudit(deps, req, {
        action: 'update',
        entity: 'user',
        entityId: req.params.id,
        oldValue: Object.fromEntries(Object.keys(body).map((k) => [k, before[k] ?? null])),
        newValue: body,
      });
      res.json(shape(updated));
    } catch (err) {
      next(err);
    }
  });

  router.post('/users/:id/reset-password', ...admin, async (req, res, next) => {
    try {
      const { password: next1 } = resetBody.parse(req.body);
      const tenantId = req.user.tenantId;
      const target = await deps.userStore.findById(tenantId, req.params.id);
      if (!target) throw notFound('User');
      const auth = fb();
      await auth.updateUser(target.firebaseUid, { password: next1 });
      await auth.revokeRefreshTokens(target.firebaseUid); // old sessions must not survive
      // The audit entry records THAT a reset happened, never the password.
      await recordAudit(deps, req, {
        action: 'update',
        entity: 'user_password',
        entityId: req.params.id,
        reason: 'Password reset by Admin',
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
