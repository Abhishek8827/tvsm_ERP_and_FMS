import { timingSafeEqual } from "node:crypto";
import { PLAN } from "./dataReset.js";

/**
 * HARD RESET from the Admin screen. Dangerous on purpose, so it has many locks:
 *  - switched OFF unless the server has HARD_RESET_ENABLED=yes (and the key, question, answer and
 *    Firebase web key set);
 *  - the Admin's own PASSWORD is checked again, and the secret KEY and the free-text ANSWER to the
 *    security question must match what is in the server settings;
 *  - the exact phrase and a written reason are needed;
 *  - a BACKUP must have been downloaded in the last 15 minutes (checked on the server).
 * It uses the same list as the data cleaner (what is kept, wiped, reset), except that the AUDIT
 * LOG IS KEPT: it is append-only, and this reset writes its own entry into it.
 */
export const HARD_RESET_PHRASE = "ERASE ALL DATA";
export const BACKUP_MAX_AGE_MS = 15 * 60 * 1000;
export const HARD_RESET_PLAN = PLAN.map((step) =>
  step.name === "AuditLog"
    ? {
        ...step,
        action: "keep",
        why: "the audit trail is never erased from the screen",
      }
    : step,
);

const norm = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
/** Constant-time comparison, so the time taken does not hint how much of a secret was right. */
export function sameSecret(given, expected) {
  const a = Buffer.from(norm(given));
  const b = Buffer.from(norm(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}
/** The key is compared exactly (case counts); only the answer is relaxed. */
export function sameKey(given, expected) {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(String(expected ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Asks Firebase whether this email + password is right (it signs nobody in here). */
export async function verifyPasswordWithFirebase(
  { email, password, apiKey },
  fetchFn = fetch,
) {
  const res = await fetchFn(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    },
  );
  return res.ok;
}
