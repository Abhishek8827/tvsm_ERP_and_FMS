import { dMonY, formatINR } from "@erp/shared";

/**
 * wa.me click-to-chat helpers. Nothing is sent by the server: the person presses a button, WhatsApp
 * opens with the number and text ready, and they press Send themselves.
 */

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

/** The wa.me link, or null when there is no valid mobile number. */
export function waLink(phoneText, message) {
  const to = normalizePhone(phoneText);
  return to ? `https://wa.me/${to}?text=${encodeURIComponent(message)}` : null;
}

export function receiptMessage(r, when) {
  return `TVSM School: fee receipt ${r.number} of ${formatINR(r.totalPaise, { hideZeroPaise: true })} received for ${r.student.name} (Sch. ${r.student.admissionNo}) on ${when}. Thank you.`;
}

export function tcMessage(tc) {
  return `TVSM School: Transfer Certificate No. ${tc.slNo} for ${tc.snapshot?.name} was issued on ${dMonY(tc.entered?.dateOfIssue)}. Please collect the original from the school office.`;
}
