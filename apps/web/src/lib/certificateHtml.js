import { SCHOOL, classLabel, dMonY, dmy } from '@erp/shared';

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

// No signature or seal IMAGE is ever printed: the school signs and stamps the paper by hand.
export const CERT_CSS = `
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { font: 12px/1.35 Arial, sans-serif; color: #111; margin: 0; }
.page { position: relative; padding: 4mm 2mm; }
.head { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #111; padding-bottom: 8px; }
.head img { width: 64px; height: 64px; object-fit: contain; }
.head .t { flex: 1; text-align: center; }
.head strong { font-size: 18px; letter-spacing: .3px; }
.head div { font-size: 12px; }
.title { text-align: center; font-size: 20px; font-weight: bold; letter-spacing: 2px; margin: 10px 0 2px; }
.note { text-align: center; font-size: 11px; color: #444; margin-bottom: 10px; }
.mark { text-align: center; margin: 4px 0 8px; }
.mark span { display: inline-block; border: 2px solid #111; padding: 2px 12px; font-weight: bold; letter-spacing: 2px; }
.ref { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; border: 1px solid #111; padding: 6px 10px; margin-bottom: 8px; }
table { width: 100%; border-collapse: collapse; }
td { border: 1px solid #888; padding: 3px 8px; vertical-align: top; }
td.n { width: 52%; }
tr:nth-child(even) td { background: #f2f2f2; }
tr { break-inside: avoid; }
.decl { margin: 12px 0 0; font-size: 12px; }
.sign { display: flex; justify-content: space-between; margin-top: 44px; text-align: center; font-size: 12px; }
.sign div { width: 20%; border-top: 1px solid #111; padding-top: 4px; }
.foot { margin-top: 18px; text-align: center; font-size: 10px; color: #555; border-top: 1px solid #bbb; padding-top: 4px; }
.body { font-size: 15px; line-height: 2; margin: 22px 4px; text-align: justify; }
`;

function letterhead() {
  return `<div class="head"><img src="/logo.jpg" alt=""><div class="t"><strong>${esc(SCHOOL.name)}</strong><div>${esc(SCHOOL.addressLine)}</div><div>Affiliation No. ${esc(SCHOOL.affiliationNo)}${SCHOOL.schoolCode ? ` · School Code ${esc(SCHOOL.schoolCode)}` : ''}</div></div></div>`;
}

// DUPLICATE COPY n for a reprint; PENDING APPROVAL for a request the Principal has not approved yet.
const markHtml = (copyNo, pending) =>
  pending
    ? '<div class="mark"><span>PENDING APPROVAL - NOT VALID</span></div>'
    : copyNo
      ? `<div class="mark"><span>DUPLICATE COPY ${esc(copyNo)}</span></div>`
      : '';

/** The 23 numbered fields of a TC, in the order of the school's form. */
export function tcFields(tc) {
  const s = tc.snapshot;
  const e = tc.entered;
  return [
    ['Name of the pupil', String(s.name ?? '').toUpperCase()],
    ["Mother's name", s.motherName],
    ["Father's / Guardian's name", s.fatherName],
    ['Date of birth (in figures and words)', `${dmy(s.dob)} · ${s.dobInWords}`],
    ['Nationality', s.nationality],
    ['Whether SC / ST / OBC', s.category],
    [
      'Date of first admission with class',
      `${dmy(s.firstAdmissionDate)} · Class ${s.firstAdmissionClass}`,
    ],
    ['Class in which last studied (in figures and words)', s.lastClassInWords],
    ['School or Board annual exam last taken, with result', e.lastExam],
    ['Whether failed, if so once or twice in same class', e.failedInSameClass],
    ['Subjects studied', e.subjects],
    ['Whether qualified for promotion to higher class', e.qualifiedForPromotion],
    ['Month up to which school dues are paid', s.duesPaidUpto],
    ['Any fee concession availed, with nature', s.feeConcession],
    ['Total number of working days in the session', e.workingDays],
    ['Total number of days present', e.daysPresent],
    ['Whether NCC Cadet / Boy Scout / Girl Guide', e.ncc],
    ['Games played or extra curricular activities', e.games],
    ['General conduct', e.conduct],
    ['Date of application for the certificate', dmy(e.dateOfApplication)],
    ['Date of issue of the certificate', dmy(e.dateOfIssue)],
    ['Reason for leaving the school', e.reason],
    ['Any other remarks', e.remarks],
  ];
}

const signLines = (labels) =>
  `<div class="sign">${labels.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;

/**
 * A4 Transfer Certificate. `copyNo` (1, 2 ...) prints a DUPLICATE mark; leave it out for the
 * original. When a TC was let through with dues pending, the "fee dues cleared" sentence is NOT
 * printed (it would not be true).
 */
export function tcHtml(tc, { copyNo } = {}) {
  const rows = tcFields(tc)
    .map(([k, v], i) => `<tr><td class="n">${i + 1}. ${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join('');
  const cleared = tc.duesOverride ? '' : ' Fee dues were checked and cleared before issue.';
  return `<div class="page">${letterhead()}
<div class="title">TRANSFER CERTIFICATE</div>
<div class="note">(Issued under the rules of the Board. No corrections allowed.)</div>
${markHtml(copyNo, tc.slNo == null)}
<div class="ref"><span>Sl. No.: <b>${tc.slNo == null ? 'On approval' : esc(String(tc.slNo).padStart(4, '0'))}</b></span><span>Book No.: <b>${esc(tc.bookNo)}</b></span><span>Admission No.: <b>${esc(tc.snapshot.admissionNo)}</b></span><span>Date of issue: <b>${esc(dmy(tc.entered.dateOfIssue))}</b></span></div>
<table><tbody>${rows}</tbody></table>
<p class="decl">Certified that the above information is in accordance with the school records.${cleared}</p>
${signLines(['Class Teacher', 'Checked by', 'Principal', 'School seal'])}
<div class="foot">Computer generated from TVSM School ERP · Verify at school office · ${copyNo ? `Duplicate copy ${esc(copyNo)}` : 'Original copy'}</div></div>`;
}

const relation = (g) =>
  g === 'MALE' ? 'son of' : g === 'FEMALE' ? 'daughter of' : 'son / daughter of';

/** A4 Bonafide certificate (wording from the Figma design). */
export function bonafideHtml(b, { copyNo } = {}) {
  const s = b.snapshot;
  const cls = `${classLabel(s.classKey)}${s.section ? `-${s.section}` : ''}`;
  return `<div class="page">${letterhead()}
<div class="ref"><span>No. <b>${b.number ? esc(b.number) : 'On approval'}</b></span><span>Date: <b>${esc(dMonY(b.dateOfIssue))}</b></span></div>
<div class="title">BONAFIDE CERTIFICATE</div>
${markHtml(copyNo, !b.number)}
<p class="body">This is to certify that <b>${esc(s.name)}</b>, ${relation(s.gender)} <b>${esc(s.fatherName)}</b>, Admission No. <b>${esc(s.admissionNo)}</b>, born on <b>${esc(dMonY(s.dob))}</b>, is a bonafide student of this school, studying in Class <b>${esc(cls)}</b> during the academic year <b>${esc(b.academicYear)}</b>.<br>This certificate is issued on request for <b>${esc(b.purpose)}</b>.</p>
<div class="sign" style="margin-top:90px"><div>School seal</div><div>Principal</div></div>
<div class="foot">Computer generated from TVSM School ERP · Verify at school office${copyNo ? ` · Duplicate copy ${esc(copyNo)}` : ''}</div></div>`;
}
