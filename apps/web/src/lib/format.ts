import { formatMoney } from '@finorchestrate/core';

export { formatMoney };

export const money = (cents: number) => formatMoney(cents, { style: Math.abs(cents) >= 100000 ? 'whole' : 'auto' });
export const whole = (cents: number) => formatMoney(cents, { style: 'whole' });
export const compact = (cents: number) => formatMoney(cents, { style: 'compact' });

export function months(value: number | null): string {
  return value === null ? 'Cash positive' : `${value.toFixed(1)}`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const relative = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return seconds <= 0 ? 'just now' : 'in a moment';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86_400 * 30) return relative.format(Math.round(seconds / 86_400), 'day');
  return shortDate(iso);
}

/** Parse what someone typed into a money field. Accepts "1,240.50", "$90", "1.2k". */
export function parseMoneyInput(text: string): number | null {
  const cleaned = text.trim().replace(/[$,\s]/g, '').toLowerCase();
  if (!cleaned) return null;
  const match = /^(\d+(?:\.\d{0,2})?)(k)?$/.exec(cleaned);
  if (!match) return null;
  const value = Number(match[1]) * (match[2] ? 1000 : 1);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
