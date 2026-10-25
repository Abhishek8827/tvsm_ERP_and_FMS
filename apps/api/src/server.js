import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { initFirebaseAuth } from "./auth/firebase.js";
import { createTokenVerifier } from "./auth/tokenVerifier.js";
import { connectDb, disconnectDb, ensureModels } from "./db.js";
import {
  makeAuditStore,
  makeChargeStore,
  makeFeeStore,
  makeReceiptStore,
  makeStudentStore,
  makeUserStore,
} from "./services/stores.js";
import { makeRebateStore } from "./services/rebateStore.js";
import { startMonthlyPlanJob } from "./services/monthlyPlan.js";
import { makeDayCloseStore } from "./services/dayCloseStore.js";
import { makeCashbookStore } from "./services/cashbookStore.js";
import { makeCertificateStore } from "./services/certificateStore.js";
import { makeMoneyStore } from "./services/moneyStore.js";
import { createLogger } from "./utils/logger.js";
async function main() {
  const env = loadEnv(); // throws with a readable list if config is bad
  const logger = createLogger(env.LOG_LEVEL);
  await connectDb(env.MONGODB_URI, env.MONGODB_DB_NAME);
  await ensureModels();
  logger.info("MongoDB connected");
  const firebaseAuth = initFirebaseAuth(env);
  if (!firebaseAuth) {
    logger.warn(
      "Firebase is not configured: sign-in endpoints answer 503 until it is.",
    );
  }
  const auth = firebaseAuth
    ? {
        verifyToken: createTokenVerifier(firebaseAuth),
        firebaseAuth, // used by the Admin Users screen to create accounts and reset passwords
        userStore: makeUserStore(),
        studentStore: makeStudentStore(),
        feeStore: makeFeeStore(),
        chargeStore: makeChargeStore(),
        receiptStore: makeReceiptStore(),
        moneyStore: makeMoneyStore(),
        rebateStore: makeRebateStore(),
        dayCloseStore: makeDayCloseStore(),
        cashbookStore: makeCashbookStore(),
        certificateStore: makeCertificateStore(),
        auditStore: makeAuditStore(),
      }
    : undefined;

  const app = createApp(env, logger, auth);
  const server = app.listen(env.PORT, () =>
    logger.info(`API listening on port ${env.PORT}`),
  );
  // Fees are posted month by month: this posts the current month for everyone, automatically.
  const stopMonthlyJob = auth
    ? startMonthlyPlanJob({
        deps: auth,
        tenantId: env.DEFAULT_TENANT_ID,
        logger,
      })
    : () => {};
  const shutdown = (signal) => {
    stopMonthlyJob();
    logger.info(`${signal} received, shutting down`);
    server.close(() => {
      void disconnectDb().finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
