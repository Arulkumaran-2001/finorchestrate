import type { Cents } from '../money.js';
import { sumCents } from '../money.js';
import type { Period } from '../time.js';
import { DAY_MS, addDays, daysInPeriod, elapsedFraction, isWithin, periodEnd, periodOf, periodStart, shiftPeriod } from '../time.js';
import type { LedgerSnapshot, Transaction } from '../types.js';

export const AVERAGE_MONTH_DAYS = 30.436875;

export function cashOnHand(snapshot: LedgerSnapshot, now: Date): Cents {
  let cash = snapshot.workspace.openingBalanceCents;
  const opening = Date.parse(snapshot.workspace.openingBalanceAt);
  for (const tx of snapshot.transactions) {
    const time = Date.parse(tx.occurredAt);
    if (time < opening || time > now.getTime()) continue;
    cash += tx.direction === 'income' ? tx.amountCents : -tx.amountCents;
  }
  return cash;
}

export interface MonthlyFlow {
  period: Period;
  incomeCents: Cents;
  expenseCents: Cents;
  /** Expenses minus income. Positive means the team spent more than it earned. */
  netBurnCents: Cents;
  complete: boolean;
}

export function monthlyFlows(snapshot: LedgerSnapshot, now: Date, months = 6): MonthlyFlow[] {
  const current = periodOf(now);
  const flows: MonthlyFlow[] = [];
  const opening = new Date(snapshot.workspace.openingBalanceAt);
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const period = shiftPeriod(current, -offset);
    const start = periodStart(period);
    const end = periodEnd(period);
    if (end.getTime() <= opening.getTime()) continue;
    const cutoff = new Date(Math.min(end.getTime(), now.getTime() + 1));
    const inPeriod = snapshot.transactions.filter((tx) => isWithin(tx.occurredAt, start, cutoff));
    const incomeCents = sumCents(inPeriod.filter((tx) => tx.direction === 'income').map((tx) => tx.amountCents));
    const expenseCents = sumCents(inPeriod.filter((tx) => tx.direction === 'expense').map((tx) => tx.amountCents));
    flows.push({
      period,
      incomeCents,
      expenseCents,
      netBurnCents: expenseCents - incomeCents,
      complete: offset > 0 && start.getTime() >= opening.getTime() - DAY_MS,
    });
  }
  return flows;
}

export interface BurnProfile {
  averageExpenseCents: Cents;
  averageIncomeCents: Cents;
  averageNetBurnCents: Cents;
  /** How many months fed the averages, and whether the current month had to be extrapolated. */
  sampleMonths: number;
  extrapolated: boolean;
  monthlyNetBurns: Cents[];
}

/**
 * Burn uses up to three complete months. When the ledger is younger than
 * that, the current month is extrapolated to a full month instead.
 */
export function burnProfile(snapshot: LedgerSnapshot, now: Date, lookback = 3): BurnProfile {
  const flows = monthlyFlows(snapshot, now, lookback + 1);
  const complete = flows.filter((flow) => flow.complete).slice(-lookback);
  if (complete.length > 0) {
    const averageExpenseCents = Math.round(sumCents(complete.map((f) => f.expenseCents)) / complete.length);
    const averageIncomeCents = Math.round(sumCents(complete.map((f) => f.incomeCents)) / complete.length);
    return {
      averageExpenseCents,
      averageIncomeCents,
      averageNetBurnCents: averageExpenseCents - averageIncomeCents,
      sampleMonths: complete.length,
      extrapolated: false,
      monthlyNetBurns: complete.map((f) => f.netBurnCents),
    };
  }
  const current = flows.at(-1);
  const period = periodOf(now);
  const scale = 1 / Math.max(elapsedFraction(period, now), 1 / daysInPeriod(period));
  const averageExpenseCents = Math.round((current?.expenseCents ?? 0) * scale);
  const averageIncomeCents = Math.round((current?.incomeCents ?? 0) * scale);
  return {
    averageExpenseCents,
    averageIncomeCents,
    averageNetBurnCents: averageExpenseCents - averageIncomeCents,
    sampleMonths: current ? 1 : 0,
    extrapolated: true,
    monthlyNetBurns: current ? [averageExpenseCents - averageIncomeCents] : [],
  };
}

export interface Runway {
  cashCents: Cents;
  stressPercent: number;
  monthlyExpenseCents: Cents;
  monthlyIncomeCents: Cents;
  monthlyNetBurnCents: Cents;
  /** Infinity when income covers spending. */
  months: number;
  days: number;
  zeroCashDate: string | null;
  cashFlowPositive: boolean;
  /** Runway if all income stopped today. The worst plausible case. */
  grossMonths: number;
  basis: { sampleMonths: number; extrapolated: boolean };
}

export function computeRunway(snapshot: LedgerSnapshot, now: Date, stressPercent = 0): Runway {
  const cashCents = cashOnHand(snapshot, now);
  const burn = burnProfile(snapshot, now);
  const stress = 1 + Math.max(-90, stressPercent) / 100;
  const monthlyExpenseCents = Math.round(burn.averageExpenseCents * stress);
  const monthlyIncomeCents = burn.averageIncomeCents;
  const monthlyNetBurnCents = monthlyExpenseCents - monthlyIncomeCents;
  const cashFlowPositive = monthlyNetBurnCents <= 0;
  const months = cashFlowPositive ? Number.POSITIVE_INFINITY : Math.max(0, cashCents / monthlyNetBurnCents);
  const days = Number.isFinite(months) ? Math.floor(months * AVERAGE_MONTH_DAYS) : Number.POSITIVE_INFINITY;
  const grossMonths = monthlyExpenseCents > 0 ? Math.max(0, cashCents / monthlyExpenseCents) : Number.POSITIVE_INFINITY;
  return {
    cashCents,
    stressPercent,
    monthlyExpenseCents,
    monthlyIncomeCents,
    monthlyNetBurnCents,
    months,
    days,
    zeroCashDate: Number.isFinite(days) ? addDays(now, days).toISOString() : null,
    cashFlowPositive,
    grossMonths,
    basis: { sampleMonths: burn.sampleMonths, extrapolated: burn.extrapolated },
  };
}

export interface CashPoint {
  date: string;
  cashCents: Cents;
}

/** End of day cash balance for the last `days` days, for sparklines and the cash chart. */
export function cashHistory(snapshot: LedgerSnapshot, now: Date, days = 90): CashPoint[] {
  const sorted: Transaction[] = [...snapshot.transactions].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const startDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * DAY_MS;
  const opening = Date.parse(snapshot.workspace.openingBalanceAt);
  let cash = snapshot.workspace.openingBalanceCents;
  let index = 0;
  const points: CashPoint[] = [];
  for (let day = 0; day < days; day += 1) {
    const endOfDay = Math.min(startDay + (day + 1) * DAY_MS, now.getTime() + 1);
    while (index < sorted.length && Date.parse(sorted[index]!.occurredAt) < endOfDay) {
      const tx = sorted[index]!;
      if (Date.parse(tx.occurredAt) >= opening) cash += tx.direction === 'income' ? tx.amountCents : -tx.amountCents;
      index += 1;
    }
    const dayStart = startDay + day * DAY_MS;
    if (dayStart + DAY_MS <= opening) continue;
    points.push({ date: new Date(dayStart).toISOString().slice(0, 10), cashCents: cash });
  }
  return points;
}
