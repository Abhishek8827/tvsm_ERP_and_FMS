import { normalizeClass } from '@erp/shared';

/**
 * Turns the rows of the school's student Excel into students (pure logic, easy to test).
 * Column names follow the school's own sheet (SCH., STUDENT'S NAME, ...). AGE is ignored on
 * purpose: age is calculated from the date of birth.
 */
export const TEMPLATE_HEADERS = [
  'SCH.',
  "STUDENT'S NAME",
  'FATHER NAME',
  'MOTHER NAME',
  'CLASS',
  'SEC',
  'ADDRESS',
  'GENDER',
  'D.O.B',
  'CONTACT NO.',
  'CATEGOURY',
  'CAST',
  'SAMAGRA ID',
  'AADHAAR NO.',
  'BANK AC.',
  'IFSC',
  'FORM NO.',
  'STATUS',
  'TRANSPORT',
  'REMARK',
  'INACTIVE STATUS',
];

// Header text -> field. Headers are compared without spaces, dots or apostrophes.
const COLUMN = {
  SCH: 'admissionNo',
  UNIQ: 'admissionNo',
  UNIQID: 'admissionNo',
  STUDENTSNAME: 'name',
  FATHERNAME: 'fatherName',
  MOTHERNAME: 'motherName',
  CLASS: 'class',
  SEC: 'section',
  ADDRESS: 'address',
  GENDER: 'gender',
  DOB: 'dob',
  CONTACTNO: 'contactNo',
  CATEGOURY: 'category',
  CATEGORY: 'category',
  CAST: 'caste',
  CASTE: 'caste',
  SAMAGRAID: 'samagraId',
  AADHAARNO: 'aadhaar',
  AADHARNO: 'aadhaar',
  BANKAC: 'bankAccount',
  IFSC: 'ifsc',
  FORMNO: 'formNo',
  STATUS: 'status',
  TRANSPORT: 'transport',
  REMARK: 'remark',
  INACTIVESTATUS: 'inactiveStatus',
};
const REQUIRED_COLUMNS = ['admissionNo', 'name', 'class'];
const COLUMN_LABEL = { admissionNo: 'SCH.', name: "STUDENT'S NAME", class: 'CLASS' };

const headerKey = (h) =>
  String(h ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
function text(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return '';
  return String(v).trim();
}
function parseDob(v) {
  if (v === null || v === undefined || v === '') return { value: undefined };
  if (v instanceof Date && !Number.isNaN(v.getTime())) return { value: v };
  const m = String(v)
    .trim()
    .match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m.map(Number);
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCMonth() === mo - 1 && date.getUTCDate() === d) return { value: date };
  }
  return { error: 'Date of birth is not a valid date' };
}

/**
 * @param sheet array of rows; the first row is the header
 * @returns {{ fileError?: string, students: {row:number, data:object}[], errors: {row:number, message:string}[] }}
 */
export function parseStudentSheet(sheet) {
  if (!Array.isArray(sheet) || sheet.length === 0)
    return { fileError: 'The file is empty.', students: [], errors: [] };
  const fieldAt = sheet[0].map((h) => COLUMN[headerKey(h)]);
  const missing = REQUIRED_COLUMNS.filter((f) => !fieldAt.includes(f));
  if (missing.length)
    return {
      fileError: `Required column missing: ${missing.map((f) => COLUMN_LABEL[f]).join(', ')}. Use the template.`,
      students: [],
      errors: [],
    };

  const students = [];
  const errors = [];
  const seen = new Map();
  for (let i = 1; i < sheet.length; i += 1) {
    const rowNo = i + 1; // the row number the user sees in Excel
    const cells = sheet[i];
    if (!cells || cells.every((c) => c === null || c === undefined || String(c).trim() === ''))
      continue;
    const raw = {};
    fieldAt.forEach((field, col) => {
      if (field && raw[field] === undefined) raw[field] = cells[col];
    });
    const problems = [];
    const t = (f) => text(raw[f]);

    const admissionNo = t('admissionNo');
    if (!admissionNo) problems.push('SCH. (admission no) is empty');
    else if (seen.has(admissionNo))
      problems.push(`SCH. ${admissionNo} is repeated (also in row ${seen.get(admissionNo)})`);
    else seen.set(admissionNo, rowNo);

    const name = t('name');
    if (!name) problems.push("STUDENT'S NAME is empty");
    const classKey = normalizeClass(raw.class);
    if (!classKey) problems.push(`CLASS "${t('class')}" is not recognised`);

    let gender;
    if (t('gender')) {
      const g = t('gender').toUpperCase();
      gender = { MALE: 'MALE', M: 'MALE', FEMALE: 'FEMALE', F: 'FEMALE', OTHER: 'OTHER' }[g];
      if (!gender) problems.push(`GENDER "${t('gender')}" is not MALE or FEMALE`);
    }
    const dob = parseDob(raw.dob);
    if (dob.error) problems.push(dob.error);
    const contactNo = t('contactNo');
    if (contactNo && !/^\d{10}$/.test(contactNo)) problems.push('CONTACT NO. must be 10 digits');
    const aadhaar = t('aadhaar');
    if (aadhaar && !/^\d{12}$/.test(aadhaar)) problems.push('AADHAAR NO. must be 12 digits');

    const usesTransport = /^(YES|Y|TRUE)$/i.test(t('transport'));
    // WHY: the school's sheet has no separate village column; the ADDRESS is the village/locality.
    const village = usesTransport ? t('address').toUpperCase() : undefined;
    if (usesTransport && !village) problems.push('TRANSPORT is YES but ADDRESS (village) is empty');

    let status = 'active';
    let inactiveReason;
    if (/^INACTIVE$/i.test(t('status'))) {
      status = 'inactive';
      const why = t('inactiveStatus').toUpperCase();
      if (/WITHOUT/.test(why)) inactiveReason = 'left_without_tc';
      else if (/TC|WITH/.test(why)) inactiveReason = 'left_with_tc';
      else problems.push('STATUS is INACTIVE but INACTIVE STATUS is not "with TC" or "without TC"');
    } else if (t('status') && !/^ACTIVE$/i.test(t('status'))) {
      problems.push(`STATUS "${t('status')}" is not ACTIVE or INACTIVE`);
    }

    if (problems.length) {
      errors.push({ row: rowNo, message: problems.join('; ') });
      continue;
    }
    const data = {
      admissionNo,
      name,
      classKey,
      status,
      usesTransport,
      isRTE: /\bRTE\b/i.test(t('remark')),
      isNewAdmission: false, // Admin ticks this on the student screen (decision)
    };
    const optional = {
      fatherName: t('fatherName'),
      motherName: t('motherName'),
      section: t('section'),
      address: t('address'),
      gender,
      dateOfBirth: dob.value,
      contactNo,
      category: t('category'),
      caste: t('caste'),
      samagraId: t('samagraId'),
      aadhaar,
      bankAccount: t('bankAccount'),
      ifsc: t('ifsc'),
      formNo: t('formNo'),
      village,
      inactiveReason,
    };
    for (const [k, v] of Object.entries(optional)) if (v !== undefined && v !== '') data[k] = v;
    students.push({ row: rowNo, data });
  }
  return { students, errors };
}
