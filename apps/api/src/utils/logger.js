import pino from "pino";
/**
 * Structured logging with redaction (rule 16: never log secrets, tokens or full phone
 * numbers). Redaction paths cover headers and the common body fields.
 */
export function createLogger(level) {
  return pino({
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body.password",
        "req.body.idToken",
        "*.password",
        "*.token",
        "*.accessToken",
        "*.phone",
        "*.whatsappNumber",
        "*.accountNumber",
      ],
      censor: "[REDACTED]",
    },
  });
}
/** Keep only the last 4 digits when a phone number must appear in a log line. */
export function maskPhone(phone) {
  const digits = phone.replace(/\D/g, "");
  return digits.length <= 4
    ? "****"
    : `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}
