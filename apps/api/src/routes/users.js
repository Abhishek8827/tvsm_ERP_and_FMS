import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/requireRole.js';

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Admin-only user list. Creating/editing users from the screen arrives with the Admin step. */
export function usersRouter(deps, authenticate) {
  const router = Router();

  router.get('/users', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const { page, pageSize } = listQuery.parse(req.query);
      const { rows, total } = await deps.userStore.list({
        tenantId: req.user.tenantId,
        page,
        pageSize,
      });
      res.json({
        page,
        pageSize,
        total,
        rows: rows.map((u) => ({
          id: String(u._id),
          name: u.name,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          lastLoginAt: u.lastLoginAt ?? null,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
