import type { Cents } from '../money.js';
import { sumCents } from '../money.js';
import type { Period } from '../time.js';
import { daysInPeriod, elapsedFraction, isWithin, periodEnd, periodOf, periodStart, shiftPeriod } from '../time.js';
import type { BudgetTransfer, Category, LedgerSnapshot, Transaction } from '../types.js';

export type CategoryHealth = 'healthy' | 'watch' | 'at-risk' | 'over';

export interface CategoryStatus {
  categoryId: string;
  name: string;
  kind: Category['kind'];
  tone: Category['tone'];
  period: Period;
  plannedCents: Cents;
  transfersInCents: Cents;
  transfersOutCents: Cents;
  /** Effective limit for the period: plan plus transfers in minus transfers out. */
  limitCents: Cents;
  spentCents: Cents;
  remainingCents: Cents;
  /** Expected spend at period end from a blend of this month's pace and recent history. */
  projectedCents: Cents;
  utilization: number;
  projectedUtilization: number;
  health: CategoryHealth;
  transactionCount: number;
  alertThreshold: number;
}

export interface BudgetTotals {
  period: Period;
  plannedCents: Cents;
  limitCents: Cents;
  spentCents: Cents;
  projectedCents: Cents;
  elapsedFraction: number;
  daysRemaining: number;
}

export function expensesIn(transactions: Transaction[], from: Date, to: Date, categoryId?: string): Transaction[] {
  return transactions.filter(
    (tx) => tx.direction === 'expense' && (!categoryId || tx.categoryId === categoryId) && isWithin(tx.occurredAt, from, to),
  );
}

export function transfersFor(transfers: BudgetTransfer[], period: Period): BudgetTransfer[] {
  return transfers.filter((transfer) => transfer.period === period);
}

export interface SeasonalProfile {
  /** Average spend before the same point of the month in recent months. */
  toDateCents: number;
  /** Average spend after the same point of the month in recent months. */
  remainderCents: number;
  months: number;
}

/**
 * How a category usually spends across a month. Cloud invoices land in the
 * first days, contractor invoices mid month, so "the rest of the month" is
 * estimated from what actually happened after the same point in recent months
 * rather than from a straight line.
 */
export function seasonalProfile(transactions: Transaction[], categoryId: string, period: Period, fraction: number, lookbackMonths = 3): SeasonalProfile | undefined {
  let toDate = 0;
  let remainder = 0;
  let months = 0;
  for (let offset = 1; offset <= lookbackMonths; offset += 1) {
    const past = shiftPeriod(period, -offset);
    const start = periodStart(past);
    const end = periodEnd(past);
    if (!transactions.some((tx) => isWithin(tx.occurredAt, start, end))) continue;
    const boundary = new Date(start.getTime() + fraction * (end.getTime() - start.getTime()));
    toDate += sumCents(expensesIn(transactions, start, boundary, categoryId).map((tx) => tx.amountCents));
    remainder += sumCents(expensesIn(transactions, boundary, end, categoryId).map((tx) => tx.amountCents));
    months += 1;
  }
  if (months === 0) return undefined;
  return { toDateCents: toDate / months, remainderCents: remainder / months, months };
}

/**
 * Expected spend at period end. With history: spent so far plus the usual
 * remainder, scaled by half of the current pace deviation (clamped) so a hot
 * month projects hotter without letting one spike double the forecast.
 * Without history: a straight line from the current pace.
 */
export function projectSpend(spentCents: number, fraction: number, daysInMonth: number, profile: SeasonalProfile | undefined): number {
  if (fraction >= 1) return spentCents;
  if (!profile) {
    const daysElapsed = Math.max(fraction * daysInMonth, 1);
    return Math.round(spentCents + (spentCents / daysElapsed) * (daysInMonth - fraction * daysInMonth));
  }
  const ratio = profile.toDateCents > 0 ? spentCents / profile.toDateCents : 1;
  const paceFactor = Math.min(1.35, Math.max(0.85, 1 + 0.5 * (ratio - 1)));
  return Math.round(spentCents + profile.remainderCents * paceFactor);
}

export function categoryStatus(snapshot: LedgerSnapshot, category: Category, now: Date, period: Period = periodOf(now)): CategoryStatus {
  const start = periodStart(period);
  const end = periodEnd(period);
  const cutoff = new Date(Math.min(now.getTime() + 1, end.getTime()));
  const periodTransfers = transfersFor(snapshot.transfers, period);
  const transfersInCents = sumCents(periodTransfers.filter((t) => t.toCategoryId === category.id).map((t) => t.amountCents));
  const transfersOutCents = sumCents(periodTransfers.filter((t) => t.fromCategoryId === category.id).map((t) => t.amountCents));
  const limitCents = category.monthlyLimitCents + transfersInCents - transfersOutCents;

  const expenses = expensesIn(snapshot.transactions, start, cutoff, category.id);
  const spentCents = sumCents(expenses.map((tx) => tx.amountCents));

  const fraction = elapsedFraction(period, now);
  // Reserves hold money for the unplanned, so they have no run rate to project.
  const projectedCents =
    category.kind === 'operating'
      ? projectSpend(spentCents, fraction, daysInPeriod(period), seasonalProfile(snapshot.transactions, category.id, period, fraction))
      : spentCents;

  const utilization = limitCents > 0 ? spentCents / limitCents : spentCents > 0 ? Number.POSITIVE_INFINITY : 0;
  const projectedUtilization = limitCents > 0 ? projectedCents / limitCents : projectedCents > 0 ? Number.POSITIVE_INFINITY : 0;

  return {
    categoryId: category.id,
    name: category.name,
    kind: category.kind,
    tone: category.tone,
    period,
    plannedCents: category.monthlyLimitCents,
    transfersInCents,
    transfersOutCents,
    limitCents,
    spentCents,
    remainingCents: limitCents - spentCents,
    projectedCents,
    utilization,
    projectedUtilization,
    health: healthOf(utilization, projectedUtilization, category, snapshot.workspace.policy.rebalanceTrigger),
    transactionCount: expenses.length,
    alertThreshold: category.alertThreshold,
  };
}

export function healthOf(utilization: number, projectedUtilization: number, category: Category, trigger = 1): CategoryHealth {
  if (utilization > 1) return 'over';
  if (category.kind === 'operating' && projectedUtilization > trigger) return 'at-risk';
  if (utilization >= category.alertThreshold || (category.kind === 'operating' && projectedUtilization >= 0.92)) return 'watch';
  return 'healthy';
}

export function allCategoryStatuses(snapshot: LedgerSnapshot, now: Date, period: Period = periodOf(now)): CategoryStatus[] {
  return snapshot.workspace.categories.map((category) => categoryStatus(snapshot, category, now, period));
}

export function budgetTotals(statuses: CategoryStatus[], now: Date, period: Period): BudgetTotals {
  const days = daysInPeriod(period);
  const fraction = elapsedFraction(period, now);
  return {
    period,
    plannedCents: sumCents(statuses.map((s) => s.plannedCents)),
    limitCents: sumCents(statuses.map((s) => s.limitCents)),
    spentCents: sumCents(statuses.map((s) => s.spentCents)),
    projectedCents: sumCents(statuses.map((s) => s.projectedCents)),
    elapsedFraction: fraction,
    daysRemaining: Math.max(0, Math.ceil(days - fraction * days)),
  };
}

const healthRank: Record<CategoryHealth, number> = { over: 3, 'at-risk': 2, watch: 1, healthy: 0 };

export function sortByConcern(statuses: CategoryStatus[]): CategoryStatus[] {
  return [...statuses].sort(
    (a, b) => healthRank[b.health] - healthRank[a.health] || b.projectedUtilization - a.projectedUtilization,
  );
}
