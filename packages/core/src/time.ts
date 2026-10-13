/**
 * Calendar helpers. Budget periods are calendar months in UTC so that the
 * server, the Lambda guardian and every browser agree on period boundaries.
 */
export type Period = `${number}-${string}`;

export const DAY_MS = 86_400_000;

export function periodOf(date: Date): Period {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}` as Period;
}

export function periodStart(period: Period): Date {
  const [year, month] = parsePeriod(period);
  return new Date(Date.UTC(year, month - 1, 1));
}

export function periodEnd(period: Period): Date {
  const [year, month] = parsePeriod(period);
  return new Date(Date.UTC(year, month, 1));
}

export function shiftPeriod(period: Period, months: number): Period {
  const [year, month] = parsePeriod(period);
  return periodOf(new Date(Date.UTC(year, month - 1 + months, 1)));
}

export function daysInPeriod(period: Period): number {
  return Math.round((periodEnd(period).getTime() - periodStart(period).getTime()) / DAY_MS);
}

/** Fraction of the period that has elapsed at `now`, clamped to [0, 1]. */
export function elapsedFraction(period: Period, now: Date): number {
  const start = periodStart(period).getTime();
  const end = periodEnd(period).getTime();
  const fraction = (now.getTime() - start) / (end - start);
  return Math.min(1, Math.max(0, fraction));
}

export function isWithin(iso: string, from: Date, to: Date): boolean {
  const time = Date.parse(iso);
  return time >= from.getTime() && time < to.getTime();
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function periodLabel(period: Period): string {
  const [year, month] = parsePeriod(period);
  return `${monthNames[month - 1]} ${year}`;
}

/** "March 14" style, used in speech. */
export function speakDate(date: Date): string {
  return `${monthNames[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function parsePeriod(period: Period): [number, number] {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) throw new RangeError(`Invalid period: ${period}`);
  return [Number(match[1]), Number(match[2])];
}
