import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { createAuthenticate } from './middleware/authenticate.js';
import { authRouter } from './routes/auth.js';
import { feeStructureRouter } from './routes/feeStructure.js';
import { healthRouter } from './routes/health.js';
import { studentImportRouter } from './routes/studentImport.js';
import { studentsRouter } from './routes/students.js';
import { ledgerRouter } from './routes/ledger.js';
import { usersRouter } from './routes/users.js';
/**
 * `auth` = { verifyToken, userStore, auditStore } . When it is missing (Firebase not configured)
 * protected routes answer 503 AUTH_NOT_CONFIGURED instead of pretending to work.
 */
export function createApp(env, logger, auth) {
  const app = express();
  // Railway/Vercel sit behind a proxy; needed so rate limiting sees the real client IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => req.id }));
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        // No Origin header = server-to-server or same-origin tooling; browsers always send one.
        if (!origin || env.CORS_ORIGIN.includes(origin)) return cb(null, true);
        cb(new Error('Origin not allowed'));
      },
      credentials: false,
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    }),
  );
  // Rule 15: request size limits. Razorpay/WhatsApp webhooks (raw body) are mounted before
  // this in the steps that add them.
  app.use(express.json({ limit: '100kb' }));
  // Generous default; strict limiters for login, payment and verify routes are added with those routes.
  app.use(
    '/api',
    rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }),
  );
  app.use('/api', healthRouter());

  if (auth) {
    const deps = { ...auth, logger, tenantId: env.DEFAULT_TENANT_ID };
    const authenticate = createAuthenticate(deps);
    app.use('/api', authRouter(deps, authenticate));
    app.use('/api', usersRouter(deps, authenticate));
    // Import must be mounted first: /students/import-template would otherwise match /students/:id.
    app.use('/api', studentImportRouter(deps, authenticate));
    app.use('/api', studentsRouter(deps, authenticate));
    app.use('/api', feeStructureRouter(deps, authenticate));
    app.use('/api', ledgerRouter(deps, authenticate));
  } else {
    app.use(['/api/auth', '/api/users', '/api/students', '/api/fee-structure'], (req, res) => {
      res.status(503).json({
        error: {
          code: 'AUTH_NOT_CONFIGURED',
          message: 'Sign-in is not configured on the server yet.',
          requestId: req.id,
        },
      });
    });
  }
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger, env.NODE_ENV === 'production'));
  return app;
}
