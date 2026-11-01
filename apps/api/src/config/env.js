import { z } from "zod";
/**
 * Environment validation (Step 1 requirement): the API refuses to start on bad config.
 * Secrets live only in environment variables (rule 16). Firebase/WhatsApp/Razorpay keys
 * are optional for now: they are required from the step that uses them, and that step
 * will tighten this schema. Nothing is faked when a key is missing.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:5173")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB_NAME: z.string().min(1).default("school_erp"),
  DEFAULT_TENANT_ID: z.string().min(1).default("tvsm"),
  // Seed data may never be loaded in production (decision X7).
  ALLOW_SEED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_ADMIN_SA_JSON_B64: z.string().optional(),
  FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
  // HARD RESET (Admin screen that erases all data). OFF unless HARD_RESET_ENABLED=yes. When it is
  // on, ALL of the following must be set, so it can never run half-guarded. Secrets: env only.
  HARD_RESET_ENABLED: z.enum(["yes", "no"]).default("no"),
  HARD_RESET_KEY: z.string().optional(),
  HARD_RESET_QUESTION: z.string().optional(),
  HARD_RESET_ANSWER: z.string().optional(),
  // The Firebase web API key (the same public key the web app uses) to re-check the Admin's password.
  FIREBASE_WEB_API_KEY: z.string().optional(),
  // WhatsApp Cloud API (Meta). Both the id and the token must be set, or nothing is sent and the
  // screens say "WhatsApp is not set up". The token is a secret: environment only, never logged.
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, "like v21.0")
    .default("v21.0"),
  WHATSAPP_TEMPLATE_RECEIPT: z.string().min(1).default("fee_receipt_text"),
  WHATSAPP_TEMPLATE_TC: z.string().min(1).default("tc_issued"),
  WHATSAPP_TEMPLATE_LANG: z.string().min(2).default("en"),
});
export function loadEnv(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  const env = parsed.data;
  if (env.HARD_RESET_ENABLED === "yes") {
    const missing = [
      "HARD_RESET_KEY",
      "HARD_RESET_QUESTION",
      "HARD_RESET_ANSWER",
      "FIREBASE_WEB_API_KEY",
    ].filter((k) => !env[k]);
    if (missing.length)
      throw new Error(
        `HARD_RESET_ENABLED=yes needs these set too: ${missing.join(", ")}`,
      );
  }
  if (env.NODE_ENV === "production" && env.ALLOW_SEED) {
    throw new Error(
      "ALLOW_SEED must be false in production (synthetic data is dev/staging only).",
    );
  }
  return env;
}
