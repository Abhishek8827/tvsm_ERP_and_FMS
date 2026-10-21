import { describe, expect, it } from 'vitest';
import {
  ExpenseRuleError,
  balancesFrom,
  checkAdjustment,
  checkPayment,
  checkPettyEntry,
  checkTransfer,
  checkVoucherInput,
  voucherFigures,
  voucherNumber,
} from './expenses.js';

const rs = (n) => n * 100;
const code = (fn) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ExpenseRuleError ? e.code : `other:${e.message}`;
  }
  return null;
};
const voucher = { status: 'approved', amountPaise: rs(10000), adjustments: [] };

describe('voucher and petty limits', () => {
  it('exactly Rs 500 is a voucher, Rs 499.99 is petty cash', () => {
    expect(code(() => checkVoucherInput({ amountPaise: 49999, payeeName: 'Raj', particulars: 'Pens' }))).toBe('USE_PETTY_CASH');
    expect(code(() => checkVoucherInput({ amountPaise: 50000, payeeName: 'Raj', particulars: 'Pens' }))).toBe(null);
    expect(code(() => checkPettyEntry({ amountPaise: 50000, payeeName: 'Raj', particulars: 'Pens', pettyBalance: rs(900) }))).toBe('USE_VOUCHER');
    expect(code(() => checkPettyEntry({ amountPaise: 49999, payeeName: 'Raj', particulars: 'Pens', pettyBalance: rs(900) }))).toBe(null);
  }); // prettier-ignore

  it('petty cash is refused when the balance is not enough', () => {
    expect(code(() => checkPettyEntry({ amountPaise: rs(300), payeeName: 'Raj', particulars: 'Tea', pettyBalance: rs(200) }))).toBe('PETTY_EMPTY');
  }); // prettier-ignore

  it('needs payee and particulars; amounts must be whole paise', () => {
    expect(code(() => checkVoucherInput({ amountPaise: rs(900), payeeName: '', particulars: 'x y z' }))).toBe('TEXT_REQUIRED');
    expect(code(() => checkVoucherInput({ amountPaise: 900.5, payeeName: 'Raj', particulars: 'abc' }))).toBe('BAD_AMOUNT');
  }); // prettier-ignore
});

describe('payments, part payments and adjustments', () => {
  const ok = { amountPaise: rs(4000), mode: 'bank', bankId: 'b1', authorisedBy: 'President' };
  const balances = { 'bank:b1': rs(50000), cash: rs(100) };

  it('balance due = amount - payments - adjustments; reversed payments do not count', () => {
    const f = voucherFigures({
      voucher: { ...voucher, adjustments: [{ amountPaise: rs(500) }] },
      payments: [{ amountPaise: rs(3000) }, { amountPaise: rs(2000), status: 'reversed' }],
    });
    expect(f).toEqual({ paidPaise: rs(3000), adjustedPaise: rs(500), balanceDuePaise: rs(6500) });
  });

  it('allows part payments but not more than the balance due', () => {
    expect(code(() => checkPayment({ voucher, payments: [], input: ok, balances }))).toBe(null);
    expect(code(() => checkPayment({ voucher, payments: [{ amountPaise: rs(7000) }], input: ok, balances }))).toBe('OVER_PAYMENT');
  }); // prettier-ignore

  it('no payment before approval, and authoriser + bank are compulsory', () => {
    expect(code(() => checkPayment({ voucher: { ...voucher, status: 'pending' }, payments: [], input: ok, balances }))).toBe('NOT_APPROVED');
    expect(code(() => checkPayment({ voucher, payments: [], input: { ...ok, authorisedBy: 'Peon' }, balances }))).toBe('AUTHORISER_REQUIRED');
    expect(code(() => checkPayment({ voucher, payments: [], input: { ...ok, bankId: undefined }, balances }))).toBe('BANK_REQUIRED');
    expect(code(() => checkPayment({ voucher, payments: [], input: { ...ok, mode: 'cash' }, balances }))).toBe('BAD_MODE');
  }); // prettier-ignore

  it('refuses a payment when the account balance is not enough', () => {
    expect(code(() => checkPayment({ voucher, payments: [], input: { ...ok, mode: 'cash', bankId: undefined }, balances }))).toBe('INSUFFICIENT_BALANCE');
  }); // prettier-ignore

  it('adjustment needs reason AND remark and cannot exceed the balance due', () => {
    const base = { voucher, payments: [], input: { amountPaise: rs(100), reason: 'Discount', remark: 'Vendor agreed' } };
    expect(code(() => checkAdjustment(base))).toBe(null);
    expect(code(() => checkAdjustment({ ...base, input: { ...base.input, remark: '' } }))).toBe('TEXT_REQUIRED');
    expect(code(() => checkAdjustment({ ...base, input: { ...base.input, amountPaise: rs(20000) } }))).toBe('OVER_ADJUSTMENT');
  }); // prettier-ignore
});

describe('transfers and balances', () => {
  it('a transfer needs two different accounts and enough money', () => {
    const balances = { cash: rs(1000) };
    expect(code(() => checkTransfer({ from: 'cash', to: 'cash', amountPaise: 100, balances }))).toBe('SAME_ACCOUNT');
    expect(code(() => checkTransfer({ from: 'cash', to: 'petty', amountPaise: rs(2000), balances }))).toBe('INSUFFICIENT_BALANCE');
    expect(code(() => checkTransfer({ from: 'cash', to: 'petty', amountPaise: rs(500), balances }))).toBe(null);
  }); // prettier-ignore

  it('a transfer moves money between accounts and the total stays the same', () => {
    const entries = [
      { account: 'cash', amountPaise: rs(1000) },
      { account: 'cash', amountPaise: -rs(400) },
      { account: 'petty', amountPaise: rs(400) },
    ];
    const b = balancesFrom({ entries, receiptTotals: { cash: rs(50), 'bank:b1': rs(70) } });
    expect(b).toEqual({ cash: rs(650), petty: rs(400), 'bank:b1': rs(70) });
  });

  it('voucher numbers look like EXP-FY2026-27/0001', () => {
    expect(voucherNumber('2026-27', 1)).toBe('EXP-FY2026-27/0001');
  });
});
