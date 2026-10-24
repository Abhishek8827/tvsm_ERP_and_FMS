import { classLabel, formatINR } from '@erp/shared';

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
const money = (p) => formatINR(p ?? 0, { hideZeroPaise: true });
const cell = (v, right) => `<td${right ? ' class="r"' : ''}>${esc(v)}</td>`;
const classOf = (r) =>
  r.classKey ? `${classLabel(r.classKey)}${r.section ? ` - ${r.section}` : ''}` : '';

export const CASHBOOK_CSS = `
@page { size: A4; margin: 10mm; }
* { box-sizing: border-box; }
body { font: 11px/1.35 Arial, sans-serif; color: #111; margin: 0; }
h1 { font-size: 16px; margin: 0 0 2px; } h2 { font-size: 12px; margin: 12px 0 4px; }
.sub { color: #555; margin-bottom: 6px; } .tag { border: 1px solid #111; padding: 1px 6px; margin-left: 8px; font-size: 10px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
th, td { border: 1px solid #999; padding: 2px 5px; text-align: left; vertical-align: top; }
th { background: #eee; } .r { text-align: right; } tfoot td { font-weight: bold; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
tr { break-inside: avoid; }
`;

function receipts(title, s) {
  const rows = s.rows
    .map(
      (r) =>
        `<tr>${cell(r.number)}${cell(r.admissionNo)}${cell(classOf(r))}${cell(r.name)}${cell(r.cashPaise ? money(r.cashPaise) : '', true)}${cell(r.onlinePaise ? money(r.onlinePaise) : '', true)}${cell(money(r.duePaise), true)}</tr>`,
    )
    .join('');
  return `<h2>${esc(title)}</h2><table><thead><tr><th>Receipt</th><th>Scholar</th><th>Class</th><th>Student name</th><th class="r">Cash</th><th class="r">Online</th><th class="r">Due</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No receipts</td></tr>'}</tbody><tfoot><tr><td colspan="4">Total</td>${cell(money(s.cashPaise), true)}${cell(money(s.onlinePaise), true)}<td></td></tr></tfoot></table>`;
}
function block(title, b) {
  return `<table><thead><tr><th colspan="2">${esc(title)}</th></tr></thead><tbody>
<tr><td>Opening balance</td>${cell(money(b.openingPaise), true)}</tr>
<tr><td>Add: today's receipts</td>${cell(money(b.receiptsPaise), true)}</tr>
${b.otherPaise ? `<tr><td>Add / less: transfers and other</td>${cell(money(b.otherPaise), true)}</tr>` : ''}
<tr><td>Less: today's expense</td>${cell(money(b.expensePaise), true)}</tr></tbody>
<tfoot><tr><td>Closing balance</td>${cell(money(b.closingPaise), true)}</tr></tfoot></table>`;
}

/** The whole day as one printable A4 page (same sections as the screen and the notebook). */
export function cashbookHtml(c) {
  const exp = c.expenses.rows
    .map(
      (e) =>
        `<tr>${cell(e.voucherNo + (e.reversal ? ' (reversal)' : ''))}${cell(e.head)}${cell(e.payee)}${cell(e.mode)}${cell(money(e.amountPaise), true)}${cell(e.by)}</tr>`,
    )
    .join('');
  const t = c.transport;
  const transport = !t.configured
    ? '<p>Transport account is not set up yet.</p>'
    : `<table><tbody>
<tr><td>Opening balance</td>${cell(money(t.openingPaise), true)}</tr>
<tr><td>Income: cash</td>${cell(money(t.incomeCashPaise), true)}</tr>
<tr><td>Income: online</td>${cell(money(t.incomeOnlinePaise), true)}</tr>
<tr><td>Less: expense</td>${cell(money(t.expensePaise), true)}</tr></tbody>
<tfoot><tr><td>Closing balance</td>${cell(money(t.closingPaise), true)}</tr></tfoot></table>`;
  return `<h1>TVSM School - Cashbook<span class="tag">${c.closed ? 'Day closed' : 'Day open'}</span></h1>
<div class="sub">Date: ${esc(c.date)}</div>
${receipts('1. School fees receipts', c.school)}
${receipts('2. Bus fees receipts', c.bus)}
<h2>3. Expense summary</h2><table><thead><tr><th>Voucher no</th><th>Head</th><th>Payee</th><th>Paid from</th><th class="r">Amount</th><th>By</th></tr></thead><tbody>${exp || '<tr><td colspan="6">No expense</td></tr>'}</tbody><tfoot><tr><td colspan="4">Total</td>${cell(money(c.expenses.totalPaise), true)}<td></td></tr></tfoot></table>
<div class="two"><div><h2>4. Cash balance</h2>${block('Cash', c.cash)}</div>
<div><h2>5. Online balance</h2>${c.online.banks.map((b) => block(b.name, b)).join('')}</div></div>
<h2>6. Transport account</h2>${transport}`;
}
