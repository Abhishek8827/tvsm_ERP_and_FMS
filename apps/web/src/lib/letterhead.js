import { SCHOOL } from "@erp/shared";

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/** The school's own letterhead colour (red), used for the name and the two rules. */
export const LETTERHEAD_RED = "#d93a3a";

/**
 * CSS for the letterhead. `.lh` = full size (A4 certificates, reports), `.lh.sm` = small, for the
 * half-A4 fee receipt. Plain strings, so it works in the clean print page and in tests.
 */
export const LETTERHEAD_CSS = `
.lh { color: ${LETTERHEAD_RED}; font-family: "Arial Narrow", Arial, sans-serif; margin-bottom: 8px; }
.lh .lh-top { display: flex; align-items: center; gap: 14px; padding-bottom: 6px; }
.lh img { width: 80px; height: 80px; object-fit: contain; flex: none; }
.lh .lh-t { flex: 1; text-align: center; }
.lh .lh-name { display: block; font-size: 22px; font-weight: 900; letter-spacing: -.3px; line-height: 1.1; white-space: nowrap; }
.lh .lh-s { font-size: 14px; color: #c0392b; line-height: 1.3; }
.lh .lh-s.a { font-size: 15px; }
.lh .lh-rule { border-top: 2px solid ${LETTERHEAD_RED}; }
.lh .lh-info { display: flex; justify-content: space-between; gap: 8px; padding: 4px 6px; font-size: 13px; font-weight: 600; }
.lh.sm img { width: 12mm; height: 12mm; }
.lh.sm { margin-bottom: 1mm; }
.lh.sm .lh-top { gap: 2mm; padding-bottom: 1mm; }
.lh.sm .lh-name { font-size: 10pt; letter-spacing: -.2px; }
.lh.sm .lh-s { font-size: 5.8pt; }
.lh.sm .lh-s.a { font-size: 6.2pt; }
.lh.sm .lh-rule { border-top-width: 1px; }
.lh.sm .lh-info { font-size: 5.8pt; padding: .6mm 0; }
`;

const info = () => [
  `DISE CODE - ${SCHOOL.schoolCode}`,
  `E-mail ID - ${SCHOOL.email}`,
  `M.No. - ${SCHOOL.mobiles.join("/ ")}`,
];

/**
 * The letterhead as an HTML string: crest on the left, red school name, society, registration
 * number and address, then a rule, then DISE code, e-mail and mobile numbers, then a second rule.
 * `small` is for the half-A4 receipt.
 */
export function letterheadHtml({ small = false } = {}) {
  return `<div class="lh${small ? " sm" : ""}"><div class="lh-top"><img src="/logo.jpg" alt=""><div class="lh-t"><span class="lh-name">${esc(SCHOOL.name)}</span><div class="lh-s">( ${esc(SCHOOL.societyLine)} )</div><div class="lh-s">Reg. N0. ${esc(SCHOOL.registrationNo)}</div><div class="lh-s a">${esc(SCHOOL.streetLine)}</div></div></div><div class="lh-rule"></div><div class="lh-info">${info()
    .map((t) => `<span>${esc(t)}</span>`)
    .join("")}</div><div class="lh-rule"></div></div>`;
}

/** Same lines for the React receipt (kept next to the HTML version so they never drift apart). */
export const letterheadLines = () => ({
  name: SCHOOL.name,
  society: `( ${SCHOOL.societyLine} )`,
  reg: `Reg. N0. ${SCHOOL.registrationNo}`,
  address: SCHOOL.streetLine,
  info: info(),
});
