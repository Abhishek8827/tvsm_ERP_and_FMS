import { classLabel, dMonY, formatINR } from "@erp/shared";

/**
 * Pure helpers for WhatsApp messages (no network, no database), so every rule can be tested.
 * Only approved TEMPLATES are sent (Meta rule for messages the school starts).
 */

/** The text the school submits to Meta for approval. {{n}} are filled by the params below. */
export const TEMPLATE_TEXT = {
  receipt:
    "Fee receipt {{3}} dated {{4}} from Thakur Virendra Singh Memorial School, Nepanagar. Student: {{1}} ({{2}}). Amount received: {{5}} by {{6}}. Balance due after this receipt: {{7}}. Thank you.",
  tc: "Transfer Certificate No. {{2}} for {{1}} was issued on {{3}} by Thakur Virendra Singh Memorial School, Nepanagar. Please collect the original from the school office.",
};

/**
 * Parent's mobile -> "91XXXXXXXXXX", or null when it is not a valid Indian mobile number.
 * Accepts "98260 12340", "+91 98260-12340", "09826012340" and "98260 12340 / 98250 11111"
 * (the first valid number is used).
 */
export function normalizePhone(text) {
  const one = (t) => {
    // "0731-2345678" is a landline with an STD code, not a mobile with a leading 0.
    if (/^\s*0\d{2,4}\s*[-–]/.test(String(t ?? ""))) return null;
    let d = String(t ?? "").replace(/\D/g, "");
    if (d.length === 13 && d.startsWith("091")) d = d.slice(1);
    if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
    if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}`;
    if (d.length === 12 && d.startsWith("91") && /^[6-9]/.test(d[2])) return d;
    return null;
  };
  const whole = one(text);
  if (whole) return whole;
  for (const part of String(text ?? "").split(/[/,;]/)) {
    const n = one(part);
    if (n) return n;
  }
  return null;
}

/** 91XXXXXXXXXX -> "+91 98XXX XXX10" style mask for screens (never the full number). */
export const maskPhone = (to) =>
  to ? `+91 ${to.slice(2, 4)}XXX XXX${to.slice(-2)}` : null;

/** Meta refuses empty values, new lines and long runs of spaces in a template value. */
const clean = (v) => {
  const t = String(v ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, 100);
  return t === "" ? "-" : t;
};
const rupees = (paise) =>
  formatINR(paise ?? 0, { hideZeroPaise: true }).replace("₹", "Rs ");
const MODE = { cash: "Cash", upi: "UPI / QR" };
const istDate = (d) =>
  dMonY(new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));

/** Values for the receipt template, in order {{1}}..{{7}}. */
export function receiptParams(r) {
  const s = r.student ?? {};
  const cls = s.classKey
    ? `${classLabel(s.classKey)}${s.section ? ` - ${s.section}` : ""}`
    : "-";
  return [
    s.name,
    cls,
    r.number,
    istDate(r.issuedAt),
    rupees(r.totalPaise),
    MODE[r.mode] ?? r.mode,
    rupees(r.dueAfterPaise),
  ].map(clean);
}

/** Values for the TC template, in order {{1}}..{{3}}. */
export function tcParams(tc) {
  return [
    tc.snapshot?.name,
    String(tc.slNo),
    dMonY(tc.entered?.dateOfIssue),
  ].map(clean);
}

/** The body of the Graph API call that sends one template message with text values. */
export function templatePayload({ to, template, lang, params }) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template,
      language: { code: lang },
      components: [
        {
          type: "body",
          parameters: params.map((text) => ({ type: "text", text })),
        },
      ],
    },
  };
}
