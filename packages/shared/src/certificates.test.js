import { describe, expect, it } from 'vitest';
import {
  bonafideNumber,
  classInWords,
  dateInWords,
  dMonY,
  dmy,
  duesPaidUpToMonth,
  monthYearLabel,
  nextClassKey,
  numberInWords,
  tcSlNo,
} from './certificates.js';

describe('words', () => {
  it('numbers', () => {
    expect(numberInWords(2014)).toBe('Two Thousand Fourteen');
    expect(numberInWords(1999)).toBe('One Thousand Nine Hundred Ninety Nine');
    expect(numberInWords(2000)).toBe('Two Thousand');
    expect(() => numberInWords(10000)).toThrow();
  });
  it('dates, as on the TC', () => {
    expect(dateInWords('2014-03-14')).toBe('Fourteenth March Two Thousand Fourteen');
    expect(dateInWords('2012-01-01')).toBe('First January Two Thousand Twelve');
    expect(dateInWords('2012-12-31')).toBe('Thirty First December Two Thousand Twelve');
    expect(dateInWords('')).toBe('');
    expect(dateInWords('2012-13-01')).toBe('');
    expect(dmy('2014-03-14')).toBe('14/03/2014');
    expect(dMonY('2026-10-13')).toBe('13 Oct 2026');
  });
  it('class in figures and words', () => {
    expect(classInWords('7')).toBe('7 (Seventh)');
    expect(classInWords('12')).toBe('12 (Twelfth)');
    expect(classInWords('LKG')).toBe('LKG');
    expect(classInWords('NURSERY')).toBe('Nursery');
  });
  it('next class', () => {
    expect(nextClassKey('7')).toBe('8');
    expect(nextClassKey('UKG')).toBe('1');
    expect(nextClassKey('12')).toBe(null);
  });
});

describe('numbers printed on certificates', () => {
  it('TC Sl. No. and Bonafide number', () => {
    expect(tcSlNo(143)).toBe('0143');
    expect(tcSlNo(7)).toBe('0007');
    expect(bonafideNumber('2026-27', 1)).toBe('BON/FY2026-27/001');
    expect(bonafideNumber('2026-27', 1234)).toBe('BON/FY2026-27/1234');
  });
});

const inst = (period, due, head = 'tuition') => ({ period, items: [{ head, due }] });
describe('field 13: month up to which dues are paid', () => {
  it('is the month before the first unpaid month', () => {
    const list = [inst('2026-04', 0), inst('2026-05', 0), inst('2026-06', 500), inst('2026-07', 0)];
    expect(duesPaidUpToMonth(list)).toBe('2026-05');
  });
  it('is the last posted month when everything is paid (advance paid counts)', () => {
    expect(duesPaidUpToMonth([inst('2026-04', 0), inst('2026-05', 0)])).toBe('2026-05');
  });
  it('a bus month that is unpaid also stops the run', () => {
    const list = [
      {
        period: '2026-04',
        items: [
          { head: 'tuition', due: 0 },
          { head: 'transport', due: 0 },
        ],
      },
      {
        period: '2026-05',
        items: [
          { head: 'tuition', due: 0 },
          { head: 'transport', due: 300 },
        ],
      },
    ];
    expect(duesPaidUpToMonth(list)).toBe('2026-04');
  });
  it('is null when the first month is unpaid or nothing is posted; one-time fees are ignored', () => {
    expect(duesPaidUpToMonth([inst('2026-04', 100)])).toBe(null);
    expect(duesPaidUpToMonth([])).toBe(null);
    expect(duesPaidUpToMonth([inst('once', 900, 'admission'), inst('2026-04', 0)])).toBe('2026-04');
  });
  it('month label', () => {
    expect(monthYearLabel('2026-09')).toBe('September 2026');
    expect(monthYearLabel('')).toBe('');
  });
});
