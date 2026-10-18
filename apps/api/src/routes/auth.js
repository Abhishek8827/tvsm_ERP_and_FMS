import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { recordAudit } from '../services/audit.js';

const sessionEventSchema = z.object({
  event: z.enum(['login', 'logout', 'idle_logout']),
});

/**
 * Failed passwords happen inside Firebase and never reach this server, so Firebase's own
 * sign-in logs cover those (decision X6). Successful logins and logouts are recorded here.
 */
export function authRouter(deps, authenticate) {
  const router = Router();
  const strict = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });

  router.get('/auth/me', strict, authenticate, (req, res) => {
    const { id, email, name, role, tenantId } = req.user;
    res.json({ user: { id: String(id), email, name, role, tenantId } });
  });

  router.post('/auth/session-event', strict, authenticate, async (req, res, next) => {
    try {
      const { event } = sessionEventSchema.parse(req.body);
      await recordAudit(deps, req, {
        action: event,
        entity: 'session',
        entityId: String(req.user.id),
      });
      if (event === 'login') await deps.userStore.touchLogin(req.user.tenantId, req.user.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
