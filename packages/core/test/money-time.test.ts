import { describe, expect, it } from 'vitest';
import { addMonths, elapsedFraction, formatMoney, periodOf, roundUpCents, shiftPeriod, speakMoney, toCents } from '../src/index.js';

describe('money', () => {
  it('converts dollars to integer cents without float drift', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(19.99)).toBe(1999);
    expect(() => toCents(Number.NaN)).toThrow(RangeError);
  });

  it('formats for display', () => {
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(120000)).toBe('$1,200');
    expect(formatMoney(123456, { style: 'whole' })).toBe('$1,235');
    expect(formatMoney(1250000, { style: 'compact' })).toBe('$12.5K');
    expect(formatMoney(5000, { signed: true })).toBe('+$50');
  });

  it('speaks estimates in whole dollars and confirmations exactly', () => {
    expect(speakMoney(58271)).toBe('$583');
    expect(speakMoney(4250)).toBe('$42.50');
    expect(speakMoney(4250, { exact: true })).toBe('$42.50');
    expect(speakMoney(3288, { approx: true })).toBe('$33');
    expect(speakMoney(-12000)).toBe('minus $120');
  });

  it('rounds shortfalls up to the next ten dollars', () => {
    expect(roundUpCents(16318)).toBe(17000);
    expect(roundUpCents(17000)).toBe(17000);
    expect(roundUpCents(-5)).toBe(0);
  });
});

describe('time', () => {
  it('works in UTC calendar months', () => {
    expect(periodOf(new Date('2026-10-31T23:59:59Z'))).toBe('2026-10');
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
  });

  it('reports elapsed fraction of a month', () => {
    expect(elapsedFraction('2026-10', new Date('2026-10-01T00:00:00Z'))).toBe(0);
    expect(elapsedFraction('2026-10', new Date('2026-11-05T00:00:00Z'))).toBe(1);
    expect(elapsedFraction('2026-10', new Date('2026-10-16T12:00:00Z'))).toBeCloseTo(0.5, 2);
  });

  it('clamps month arithmetic to the last day', () => {
    expect(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
  });
});
