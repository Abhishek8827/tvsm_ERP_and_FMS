import { describe, expect, it } from 'vitest';
import {
  allocateProportionally,
  formatINR,
  paiseToRupeesString,
  rupeesInWords,
  rupeesToPaise,
} from './money.js';
describe('rupeesToPaise', () => {
  it('parses whole, decimal and comma-grouped amounts without float error', () => {
    expect(rupeesToPaise('1000')).toBe(100000);
    expect(rupeesToPaise('1,250.5')).toBe(125050);
    expect(rupeesToPaise('0.10')).toBe(10);
    expect(rupeesToPaise('19.99')).toBe(1999);
    expect(rupeesToPaise(100)).toBe(10000);
  });
  it('rejects junk and more than 2 decimals', () => {
    expect(() => rupeesToPaise('abc')).toThrow();
    expect(() => rupeesToPaise('1.234')).toThrow();
    expect(() => rupeesToPaise('')).toThrow();
  });
  it('round-trips', () => {
    expect(paiseToRupeesString(rupeesToPaise('1234.05'))).toBe('1234.05');
  });
});
describe('formatINR (Indian grouping)', () => {
  it('groups lakh and crore correctly', () => {
    expect(formatINR(12450000)).toBe('₹1,24,500.00');
    expect(formatINR(41250000000)).toBe('₹41,25,00,000.00');
    expect(formatINR(70000, { hideZeroPaise: true })).toBe('₹700');
    expect(formatINR(0)).toBe('₹0.00');
    expect(formatINR(-150000)).toBe('-₹1,500.00');
  });
});
describe('rupeesInWords (Indian system)', () => {
  it('writes the sample receipt total from the Figma frame', () => {
    // Rs 10,150 -> "Fifty" (the Figma frame prints the same wording).
    expect(rupeesInWords(1015000)).toBe('Rupees Ten Thousand One Hundred Fifty only');
  });
  it('handles lakh and crore', () => {
    expect(rupeesInWords(12450000)).toBe('Rupees One Lakh Twenty Four Thousand Five Hundred only');
    expect(rupeesInWords(100_00_00_000)).toBe('Rupees One Crore only');
  });
  it('handles paise and zero', () => {
    expect(rupeesInWords(10050)).toBe('Rupees One Hundred and Fifty Paise only');
    expect(rupeesInWords(0)).toBe('Rupees Zero only');
  });
});
describe('allocateProportionally', () => {
  it('never loses or invents a paisa', () => {
    const parts = allocateProportionally(10000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(parts).toEqual([3334, 3333, 3333]);
  });
});
