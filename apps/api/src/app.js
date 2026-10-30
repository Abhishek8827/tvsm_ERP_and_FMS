import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import {
  createErrorHandler,
  notFoundHandler,
} from "./middleware/errorHandler.js";
import { requestId } from "./middleware/requestId.js";
import { createAuthenticate } from "./middleware/authenticate.js";
import { AppError } from "./utils/errors.js";
import { adminDashboardRouter } from "./routes/adminDashboard.js";
import { auditLogRouter } from "./routes/auditLog.js";
import { authRouter } from "./routes/auth.js";
import { cancellationsRouter } from "./routes/cancellations.js";
import { cashbookRouter } from "./routes/cashbook.js";
import { certificatesRouter } from "./routes/certificates.js";
import { dayCloseRouter } from "./routes/dayClose.js";
import { feeStructureRouter } from "./routes/feeStructure.js";
import { feesDatabaseRouter } from "./routes/feesDatabase.js";
import { healthRouter } from "./routes/health.js";
import { ledgerRouter } from "./routes/ledger.js";
import { moneyRouter } from "./routes/money.js";
import { oldDuesImportRouter } from "./routes/oldDuesImport.js";
import { rebatesRouter } from "./routes/rebates.js";
import { receiptsRouter } from "./routes/receipts.js";
import { reportsRouter } from "./routes/reports.js";
import { studentImportRouter } from "./routes/studentImport.js";
import { studentsRouter } from "./routes/students.js";
import { transportRouter } from "./routes/transport.js";
import { usersRouter } from "./routes/users.js";
import { whatsappRouter } from "./routes/whatsapp.js";

// Every protected area. Used for the 503 answer when sign-in is not configured.
const PROTECTED_PREFIXES = [
  "/api/audit-log",
  "/api/auth",
  "/api/banks",
  "/api/bonafide",
  "/api/cashbook",
  "/api/certificate-requests",
  "/api/certificates",
  "/api/dashboard",
  "/api/day-close",
  "/api/expense-heads",
  "/api/expense-payments",
  "/api/expense-reversals",
  "/api/fee-plan",
  "/api/fee-structure",
  "/api/fees-database",
  "/api/money",
  "/api/old-dues",
  "/api/petty",
  "/api/rebates",
  "/api/receipt-cancellations",
  "/api/receipts",
  "/api/reports",
  "/api/students",
  "/api/tc",
  "/api/transfers",
  "/api/transport",
  "/api/users",
  "/api/vouchers",
  "/api/whatsapp",
];

/**
 * `auth` = { verifyToken, userStore, auditStore, ...stores }. When it is missing (Firebase not
 * configured) protected routes answer 503 AUTH_NOT_CONFIGURED instead of pretending to work.
 */
export function createApp(env, logger, auth) {
  const app = express();
  // Railway/Vercel sit behind a proxy; needed so rate limiting sees the real client IP.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => req.id }));
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        // No Origin header = server-to-server or same-origin tooling; browsers always send one.
        if (!origin || env.CORS_ORIGIN.includes(origin)) return cb(null, true);
        cb(
          new AppError(
            "ORIGIN_NOT_ALLOWED",
            403,
            "This web address is not allowed to use the school system.",
          ),
        );
      },
      credentials: false,
      allowedHeaders: [
        "Authorization",
        "Content-Type",
        "Idempotency-Key",
        "X-Request-Id",
      ],
    }),
  );
  // Request size limit (Rule 15).
  app.use(express.json({ limit: "100kb" }));
  // Generous default; strict limiters for login and money routes live with those routes.
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );
  app.use("/api", healthRouter());

  if (auth) {
    const deps = { ...auth, logger, tenantId: env.DEFAULT_TENANT_ID };
    const authenticate = createAuthenticate(deps);
    const routers = [
      authRouter,
      usersRouter,
      studentImportRouter, // before studentsRouter: /students/import-template must not match /students/:id
      studentsRouter,
      feeStructureRouter,
      transportRouter,
      ledgerRouter,
      receiptsRouter,
      cancellationsRouter,
      rebatesRouter,
      oldDuesImportRouter,
      feesDatabaseRouter,
      certificatesRouter,
      dayCloseRouter,
      cashbookRouter,
      adminDashboardRouter,
      moneyRouter,
      reportsRouter,
      auditLogRouter,
      whatsappRouter,
    ];
    for (const make of routers) app.use("/api", make(deps, authenticate));
  } else {
    app.use(PROTECTED_PREFIXES, (req, res) => {
      res.status(503).json({
        error: {
          code: "AUTH_NOT_CONFIGURED",
          message: "Sign-in is not configured on the server yet.",
          requestId: req.id,
        },
      });
    });
  }
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger, env.NODE_ENV === "production"));
  return app;
}
