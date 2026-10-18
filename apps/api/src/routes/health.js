import { Router } from 'express';
import mongoose from 'mongoose';
/** Public, returns no business data (TDD section 8). Used for uptime checks and Railway health. */
export function healthRouter() {
  const router = Router();
  router.get('/health', (_req, res) => {
    // readyState 1 = connected
    const dbUp = mongoose.connection.readyState === 1;
    res
      .status(dbUp ? 200 : 503)
      .json({ status: dbUp ? 'ok' : 'degraded', db: dbUp ? 'up' : 'down' });
  });
  return router;
}
