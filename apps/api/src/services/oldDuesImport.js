import { rupeesToPaise } from '@erp/shared';

/**
 * Old fees = unpaid amounts brought over from before this system started. The school's sheet has
 * one row per student: scholar number, old school fees, old transport fees (rupees).
 * Pure logic, easy to test.
 */
export const OLD_DUES_HEADERS = ['SCH.', 'OLD SCHOOL FEES', 'OLD TRANSPORT FEES'];
const key = (h) =>
  String(h ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
const FIELD = { SCH: 'admissionNo', OLDSCHOOLFEES: 'school', OLDTRANSPORTFEES: 'transport' };

function amount(cell, label, problems) {
  if (cell === null || cell === undefined || String(cell).trim() === '') return 0;
  try {
    const p = rupeesToPaise(typeof cell === 'number' ? cell.toFixed(2) : String(cell));
    if (p < 0) throw new Error('negative');
    return p;
  } catch {
    problems.push(`${label} "${cell}" is not a valid amount`);
    return 0;
  }
}

/** @returns {{ fileError?: string, rows: {row:number, admissionNo:string, schoolPaise:number, transportPaise:number}[], errors: {row:number, message:string}[] }} */
export function parseOldDuesSheet(sheet) {
  if (!Array.isArray(sheet) || sheet.length === 0)
    return { fileError: 'The file is empty.', rows: [], errors: [] };
  const fieldAt = sheet[0].map((h) => FIELD[key(h)]);
  if (
    !fieldAt.includes('admissionNo') ||
    (!fieldAt.includes('school') && !fieldAt.includes('transport'))
  )
    return {
      fileError:
        'Columns SCH. and OLD SCHOOL FEES / OLD TRANSPORT FEES are needed. Use the template.',
      rows: [],
      errors: [],
    };
  const rows = [];
  const errors = [];
  const seen = new Map();
  for (let i = 1; i < sheet.length; i += 1) {
    const cells = sheet[i];
    const rowNo = i + 1;
    if (!cells || cells.every((c) => c === null || c === undefined || String(c).trim() === ''))
      continue;
    const raw = {};
    fieldAt.forEach((f, col) => {
      if (f && raw[f] === undefined) raw[f] = cells[col];
    });
    const problems = [];
    const admissionNo = String(raw.admissionNo ?? '').trim();
    if (!admissionNo) problems.push('SCH. is empty');
    else if (seen.has(admissionNo))
      problems.push(`SCH. ${admissionNo} is repeated (also in row ${seen.get(admissionNo)})`);
    else seen.set(admissionNo, rowNo);
    const schoolPaise = amount(raw.school, 'OLD SCHOOL FEES', problems);
    const transportPaise = amount(raw.transport, 'OLD TRANSPORT FEES', problems);
    if (problems.length === 0 && schoolPaise === 0 && transportPaise === 0)
      problems.push('Both old fee amounts are empty or zero');
    if (problems.length) errors.push({ row: rowNo, message: problems.join('; ') });
    else rows.push({ row: rowNo, admissionNo, schoolPaise, transportPaise });
  }
  return { rows, errors };
}
