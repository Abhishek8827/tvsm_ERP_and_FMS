import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { Env } from './config/env';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { healthRouter } from './routes/health';

export function createApp(env: Env, logger: Logger): Express {
  const app = express();
  // Railway/Vercel sit behind a proxy; needed so rate limiting sees the real client IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).id }));
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
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger, env.NODE_ENV === 'production'));
  return app;
}
