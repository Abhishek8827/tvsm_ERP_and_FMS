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
import { makeOldFeeStore } from "./services/oldFeeStore.js";
import { makeRebateStore } from "./services/rebateStore.js";
import { makeAdmissionStore } from "./services/admissionStore.js";
import { startAuditRetentionJob } from "./services/auditRetention.js";
import { startDayAutoLockJob } from "./services/dayAutoLock.js";
import { startMonthlyPlanJob } from "./services/monthlyPlan.js";
import { makeDayCloseStore } from "./services/dayCloseStore.js";
import { makeCashbookStore } from "./services/cashbookStore.js";
import { makeReportsStore } from "./services/reportsStore.js";
import { makeCertificateStore } from "./services/certificateStore.js";
import { makeMoneyStore } from "./services/moneyStore.js";
import { makeWhatsappClient } from "./services/whatsappClient.js";
import { makeWhatsappService } from "./services/whatsappService.js";
import { makeWhatsappStore } from "./services/whatsappStore.js";
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
  const studentStore = makeStudentStore();
  const receiptStore = makeReceiptStore();
  const certificateStore = makeCertificateStore();
  const whatsapp = makeWhatsappService({
    store: makeWhatsappStore(),
    client: makeWhatsappClient(env),
    env,
    studentStore,
    receiptStore,
    certificateStore,
    logger,
  });
  if (!whatsapp.configured)
    logger.info("WhatsApp is not set up: no messages will be sent.");
  const auth = firebaseAuth
    ? {
        whatsapp,
        verifyToken: createTokenVerifier(firebaseAuth),
        firebaseAuth, // used by the Admin Users screen to create accounts and reset passwords
        userStore: makeUserStore(),
        studentStore,
        feeStore: makeFeeStore(),
        chargeStore: makeChargeStore(),
        receiptStore,
        moneyStore: makeMoneyStore(),
        rebateStore: makeRebateStore(),
        oldFeeStore: makeOldFeeStore(),
        dayCloseStore: makeDayCloseStore(),
        cashbookStore: makeCashbookStore(),
        reportsStore: makeReportsStore(),
        certificateStore,
        auditStore: makeAuditStore(),
        admissionStore: makeAdmissionStore(),
        hardReset: {
          enabled: env.HARD_RESET_ENABLED === "yes",
          key: env.HARD_RESET_KEY,
          question: env.HARD_RESET_QUESTION,
          answer: env.HARD_RESET_ANSWER,
          webApiKey: env.FIREBASE_WEB_API_KEY,
        },
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
  const stopAuditJob = auth
    ? startAuditRetentionJob({ tenantId: env.DEFAULT_TENANT_ID, logger })
    : () => {};
  const stopDayLockJob = auth
    ? startDayAutoLockJob({
        deps: auth,
        tenantId: env.DEFAULT_TENANT_ID,
        logger,
      })
    : () => {};
  const shutdown = (signal) => {
    stopMonthlyJob();
    stopDayLockJob();
    stopAuditJob();
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
