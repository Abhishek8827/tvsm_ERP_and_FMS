import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

/**
 * Firebase Admin SDK setup. Two ways to run:
 *  - Production / real project: FIREBASE_ADMIN_SA_JSON_B64 = base64 of the service-account JSON
 *    (kept only in environment variables, never in git or chat).
 *  - Local emulator: FIREBASE_AUTH_EMULATOR_HOST (e.g. localhost:9099) + FIREBASE_PROJECT_ID.
 * If neither is configured this returns null and the API reports "auth not configured" instead
 * of pretending to work (no fake logins).
 */
export function initFirebaseAuth(env) {
  if (getApps().length === 0) {
    if (env.FIREBASE_AUTH_EMULATOR_HOST) {
      // The Admin SDK reads this variable by itself to talk to the emulator.
      process.env.FIREBASE_AUTH_EMULATOR_HOST = env.FIREBASE_AUTH_EMULATOR_HOST;
      initializeApp({
        projectId: env.FIREBASE_PROJECT_ID ?? "demo-school-erp",
      });
    } else if (env.FIREBASE_ADMIN_SA_JSON_B64) {
      const json = JSON.parse(
        Buffer.from(env.FIREBASE_ADMIN_SA_JSON_B64, "base64").toString("utf8"),
      );
      initializeApp({
        credential: cert(json),
        projectId: env.FIREBASE_PROJECT_ID ?? json.project_id,
      });
    } else if (env.FIREBASE_PROJECT_ID) {
      initializeApp({
        credential: applicationDefault(),
        projectId: env.FIREBASE_PROJECT_ID,
      });
    } else {
      return null;
    }
  }
  return getAuth();
}
