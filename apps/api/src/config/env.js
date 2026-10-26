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
  if (env.NODE_ENV === "production" && env.ALLOW_SEED) {
    throw new Error(
      "ALLOW_SEED must be false in production (synthetic data is dev/staging only).",
    );
  }
  return env;
}
