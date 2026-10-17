import { describe, expect, it } from 'vitest';
import {
  financialYearRange,
  getFinancialYear,
  istDateString,
  istStartOfDay,
} from './financialYear';

describe('getFinancialYear (April-March, IST)', () => {
  it('rolls over at 00:00 IST on 1 April, not at UTC midnight', () => {
    // 31 Mar 2027 18:29 UTC = 31 Mar 23:59 IST -> still FY 2026-27
    expect(getFinancialYear(new Date('2027-03-31T18:29:00Z'))).toBe('2026-27');
    // 31 Mar 2027 18:30 UTC = 1 Apr 00:00 IST -> FY 2027-28
    expect(getFinancialYear(new Date('2027-03-31T18:30:00Z'))).toBe('2027-28');
  });
  it('handles mid-year and January dates', () => {
    expect(getFinancialYear(new Date('2026-10-18T05:00:00Z'))).toBe('2026-27');
    expect(getFinancialYear(new Date('2027-01-10T05:00:00Z'))).toBe('2026-27');
    expect(getFinancialYear(new Date('2026-04-01T00:00:00+05:30'))).toBe('2026-27');
  });
  it('handles century boundary formatting', () => {
    expect(getFinancialYear(new Date('2099-06-01T00:00:00Z'))).toBe('2099-00');
  });
  it('rejects bad input', () => {
    expect(() => getFinancialYear(new Date('nope'))).toThrow();
    expect(() => getFinancialYear(new Date(), 13)).toThrow();
  });
});

describe('IST day helpers', () => {
  it('istDateString uses the IST calendar day', () => {
    expect(istDateString(new Date('2026-10-17T19:00:00Z'))).toBe('2026-10-18'); // 00:30 IST next day
    expect(istDateString(new Date('2026-10-17T18:29:00Z'))).toBe('2026-10-17');
  });
  it('istStartOfDay is 00:00 IST in UTC', () => {
    expect(istStartOfDay('2026-10-18').toISOString()).toBe('2026-10-17T18:30:00.000Z');
  });
  it('financialYearRange covers exactly April to March', () => {
    const { start, end } = financialYearRange('2026-27');
    expect(start.toISOString()).toBe('2026-03-31T18:30:00.000Z');
    expect(end.toISOString()).toBe('2027-03-31T18:29:59.999Z');
    expect(() => financialYearRange('2026-28')).toThrow();
  });
});
