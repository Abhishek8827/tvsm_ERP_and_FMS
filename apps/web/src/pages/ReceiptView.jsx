import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { SCHOOL, classLabel, formatINR, rupeesInWords } from '@erp/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button, ErrorState, Spinner, useToast } from '../components/ui';

const TITLE = { school: 'SCHOOL FEES RECEIPT', transport: 'TRANSPORT FEES RECEIPT' };
// Rows printed on the receipt, in the order of the school's paper receipt book.
const ROWS = {
  school: [
    ['admission_form', 'Form Fees', ['form']],
    ['admission', 'Admission Fees', ['admission']],
    ['tuition', 'Tuition Fees', ['tuition']],
    ['old', 'Old Fees', ['old_fees']],
    ['late', 'Late Fees', ['late']],
    ['tc', 'T.C.', ['tc']],
    ['other', 'Other', ['other']],
  ],
  transport: [
    ['transport', 'Transport Fees (New)', ['transport']],
    ['old', 'Old Fees', ['transport_old']],
    ['late', 'Late Fees', ['late']],
  ],
};
const MODE_LABEL = { cash: 'Cash', upi: 'UPI', qr: 'QR' };
const when = (iso) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** One quarter-A4 copy (Student copy or Office copy). */
function Copy({ r, copyName, duplicate }) {
  const rows = ROWS[r.kind];
  const amountOf = (heads) => {
    const lines = r.lines.filter((l) => heads.includes(l.head));
    return lines.length ? lines.reduce((s, l) => s + l.amountPaise, 0) : null;
  };
  const otherLabel = r.lines.find((l) => l.head === 'other')?.label;
  const s = r.student;
  return (
    <div className="copy">
      <div className="head">
        <img src="/logo.jpg" alt="" />
        <div>
          <strong>{SCHOOL.name}</strong>
          <div>{SCHOOL.addressLine}</div>
          <div>
            Affiliation No. {SCHOOL.affiliationNo}
            {SCHOOL.schoolCode ? ` · School Code ${SCHOOL.schoolCode}` : ''}
          </div>
        </div>
      </div>
      <div className="title">{TITLE[r.kind]}</div>
      <div className="tags">
        <span>{copyName}</span>
        {duplicate && <span className="dup">DUPLICATE</span>}
      </div>
      <div className="line">
        <span>
          No. <b>{r.number}</b>
        </span>
        <span>Date: {when(r.issuedAt)}</span>
      </div>
      <div className="line">
        <span>
          Student: <b>{s.name}</b>
        </span>
        <span>
          Sch. <b>{s.admissionNo}</b>
        </span>
      </div>
      <div className="line">
        <span>
          Class: {classLabel(s.classKey)}
          {s.section ? `-${s.section}` : ''}
        </span>
        <span>Session: {r.fy}</span>
      </div>
      {s.fatherName && <div className="line">Father: {s.fatherName}</div>}
      {r.kind === 'transport' ? (
        <div className="line">Village: {s.village ?? '-'}</div>
      ) : (
        <div className="line">
          <span>Add.: {s.address ?? ''}</span>
          <span>Mob.: {s.contactNo ?? ''}</span>
        </div>
      )}
      <div className="line">Month: {r.monthLabel || '-'}</div>
      <table>
        <thead>
          <tr>
            <th style={{ width: '9%' }}>S.No</th>
            <th>Particulars</th>
            <th style={{ width: '28%' }}>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, label, heads], i) => {
            const amount = amountOf(heads);
            return (
              <tr key={key}>
                <td>{i + 1}</td>
                <td>{key === 'other' && otherLabel ? `Other: ${otherLabel}` : label}</td>
                <td className="num">
                  {amount === null
                    ? ''
                    : formatINR(amount, { hideZeroPaise: true }).replace('₹', '')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="total">
        <span>Total Fees Paid</span>
        <b>{formatINR(r.totalPaise, { hideZeroPaise: true })}</b>
      </div>
      <div className="words">{rupeesInWords(r.totalPaise)}</div>
      <div className="line">
        <span>Fees Due: {formatINR(r.dueAfterPaise, { hideZeroPaise: true })}</span>
        <span>
          Mode: {MODE_LABEL[r.mode]}
          {r.reference ? ` · Ref: ${r.reference}` : ''}
        </span>
      </div>
      <div className="note">Note: Fees once paid are non-refundable.</div>
      <div className="signs">
        <span>Depositor&apos;s Sign</span>
        <span>
          Authorised Sign
          {r.cashierName ? <small> ({r.cashierName})</small> : null}
        </span>
      </div>
    </div>
  );
}

const PRINT_CSS = `
.sheet{display:flex;width:210mm;height:148.5mm;background:#fff;color:#000;font-size:8.5pt;line-height:1.25}
.copy{width:105mm;height:148.5mm;padding:5mm;box-sizing:border-box;border-right:1px dashed #666;display:flex;flex-direction:column;gap:1.4mm}
.copy:last-child{border-right:0}
.head{display:flex;gap:2mm;align-items:center;font-size:7.5pt;text-align:left}
.head img{height:11mm;width:auto}
.head strong{font-size:9pt}
.title{text-align:center;font-weight:700;font-size:10pt;border:1px solid #000;padding:1mm 0;letter-spacing:.3px}
.tags{display:flex;justify-content:space-between;font-size:7.5pt;font-weight:700}
.dup{border:1.5px solid #b00;color:#b00;padding:0 2mm;transform:rotate(-4deg)}
.line{display:flex;justify-content:space-between;gap:2mm}
table{width:100%;border-collapse:collapse;font-size:8pt}
th,td{border:1px solid #000;padding:.7mm 1.2mm}
th{text-align:left}
.num{text-align:right}
.total{display:flex;justify-content:space-between;border:1px solid #000;padding:1mm 1.5mm;font-size:9.5pt}
.words{font-size:7.5pt;font-style:italic}
.note{font-size:7pt}
.signs{margin-top:auto;display:flex;justify-content:space-between;font-size:7.5pt;padding-top:7mm}
@media print{
  @page{size:A4 portrait;margin:0}
  html,body{background:#fff!important}
  body *{visibility:hidden}
  .sheet,.sheet *{visibility:visible}
  .sheet{position:absolute;left:0;top:0}
  .no-print{display:none!important}
}
`;

/**
 * Shows one receipt and prints it on the TOP HALF of an A4 sheet: Student copy on the left,
 * Office copy on the right. The first print right after collecting is the original; every later
 * print is stamped DUPLICATE (same number) and is written to the audit log.
 */
export function ReceiptView() {
  const { id } = useParams();
  const location = useLocation();
  const { role } = useAuth();
  const { notify } = useToast();
  const [printedOnce, setPrintedOnce] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const fresh = Boolean(location.state?.fresh);

  const receipt = useQuery({
    queryKey: ['receipt', id],
    queryFn: () => api(`/api/receipts/${id}`),
  });
  const reprint = useMutation({
    mutationFn: () => api(`/api/receipts/${id}/reprint`, { method: 'POST' }),
    onSuccess: () => {
      setDuplicate(true);
      // Let the DUPLICATE stamp render before the print dialog opens.
      setTimeout(() => window.print(), 50);
    },
    onError: (e) => notify(`${e.message}${e.requestId ? ` (ref ${e.requestId})` : ''}`, 'error'),
  });

  if (receipt.isPending) return <Spinner label="Loading receipt" />;
  if (receipt.isError)
    return <ErrorState message={receipt.error.message} onRetry={() => receipt.refetch()} />;
  const r = receipt.data;

  const original = fresh && !printedOnce;
  const canReprint = role === 'cashier' || role === 'admin';
  const phone = r.student.contactNo ? `91${r.student.contactNo}` : null;
  const message = `TVSM School: fee receipt ${r.number} of ${formatINR(r.totalPaise, { hideZeroPaise: true })} received for ${r.student.name} (Sch. ${r.student.admissionNo}) on ${when(r.issuedAt)}. Thank you.`;

  return (
    <div className="flex flex-col gap-4">
      <style>{PRINT_CSS}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink">Receipt {r.number}</h1>
        <div className="flex flex-wrap gap-2">
          {original ? (
            <Button
              onClick={() => {
                window.print();
                setPrintedOnce(true);
              }}
            >
              Print receipt
            </Button>
          ) : (
            canReprint && (
              <Button loading={reprint.isPending} onClick={() => reprint.mutate()}>
                Print duplicate
              </Button>
            )
          )}
          {phone ? (
            <a
              className="inline-flex min-h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-app"
              href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
            >
              Send on WhatsApp
            </a>
          ) : (
            <Button variant="secondary" disabled title="No mobile number saved for this student">
              Send on WhatsApp
            </Button>
          )}
          {role === 'cashier' && (
            <Link
              to="/collect-fee"
              className="inline-flex min-h-10 items-center rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-app"
            >
              New collection
            </Link>
          )}
        </div>
      </div>
      <p className="no-print text-sm text-ink-muted">
        {original
          ? 'Print once now: this is the original receipt. Any later print is marked DUPLICATE.'
          : 'This receipt has been issued. Printing again marks it DUPLICATE and is recorded.'}{' '}
        Choose A4 paper, margins None, scale 100%.
      </p>
      <div className="overflow-x-auto">
        <div className="sheet border border-line">
          <Copy r={r} copyName="STUDENT COPY" duplicate={duplicate} />
          <Copy r={r} copyName="OFFICE COPY" duplicate={duplicate} />
        </div>
      </div>
    </div>
  );
}
