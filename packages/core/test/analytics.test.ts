import { describe, expect, it } from 'vitest';
import {
  assessTransaction,
  computeRunway,
  createDemoLedger,
  createEmptyLedger,
  forecastCash,
  modifiedZScore,
  projectSpend,
  allCategoryStatuses,
  type LedgerSnapshot,
  type Transaction,
} from '../src/index.js';

const NOW = new Date('2026-10-13T08:30:00Z');

function expense(id: string, merchant: string, amount: number, occurredAt: string, categoryId = 'cloud'): Transaction {
  return {
    id,
    occurredAt,
    createdAt: occurredAt,
    description: merchant,
    merchant,
    amountCents: Math.round(amount * 100),
    direction: 'expense',
    categoryId,
    source: 'import',
    status: 'cleared',
  };
}

describe('statistics', () => {
  it('scores outliers robustly', () => {
    const history = [100, 104, 98, 101, 97, 103];
    expect(modifiedZScore(101, history)).toBeLessThan(1);
    expect(modifiedZScore(300, history)).toBeGreaterThan(20);
  });

  it('handles perfectly regular history without dividing by zero', () => {
    expect(modifiedZScore(60, [60, 60, 60, 60])).toBe(0);
    expect(modifiedZScore(90, [60, 60, 60, 60])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('projection', () => {
  it('adds the usual remainder of the month instead of a straight line', () => {
    // Front loaded category: 900 of a typical 1000 lands early in the month.
    const profile = { toDateCents: 90000, remainderCents: 10000, months: 3 };
    expect(projectSpend(90000, 0.4, 31, profile)).toBe(100000);
  });

  it('passes through half of an unusual pace, within limits', () => {
    const profile = { toDateCents: 50000, remainderCents: 50000, months: 3 };
    expect(projectSpend(75000, 0.5, 31, profile)).toBe(75000 + 62500);
    expect(projectSpend(500000, 0.5, 31, profile)).toBe(500000 + 67500);
  });

  it('falls back to the current pace without history', () => {
    expect(projectSpend(31000, 0.5, 31, undefined)).toBe(62000);
  });
});

describe('demo ledger', () => {
  const ledger = createDemoLedger(NOW);
  const statuses = allCategoryStatuses(ledger, NOW);
  const byId = Object.fromEntries(statuses.map((status) => [status.categoryId, status]));

  it('tells the intended story', () => {
    expect(byId.cloud!.projectedCents).toBeGreaterThan(byId.cloud!.limitCents + 25000);
    expect(byId.tooling!.projectedCents).toBeGreaterThan(byId.tooling!.limitCents);
    expect(byId.tooling!.projectedCents - byId.tooling!.limitCents).toBeLessThan(25000);
    expect(byId.contractors!.health).toBe('healthy');
    expect(byId.marketing!.health).toBe('healthy');
    expect(byId.reserve!.spentCents).toBe(0);
  });

  it('is deterministic for a given moment', () => {
    expect(createDemoLedger(NOW)).toEqual(ledger);
  });

  it('never contains future transactions', () => {
    expect(ledger.transactions.every((tx) => Date.parse(tx.occurredAt) <= NOW.getTime())).toBe(true);
  });

  it('keeps the story on the first day of a month', () => {
    const early = new Date('2026-11-01T06:00:00Z');
    const snapshot = createDemoLedger(early);
    const cloud = allCategoryStatuses(snapshot, early).find((status) => status.categoryId === 'cloud')!;
    expect(cloud.projectedCents).toBeGreaterThan(cloud.limitCents);
  });
});

describe('runway and forecast', () => {
  const ledger = createDemoLedger(NOW);

  it('derives runway from complete months', () => {
    const runway = computeRunway(ledger, NOW);
    expect(runway.basis.sampleMonths).toBe(3);
    expect(runway.cashFlowPositive).toBe(false);
    expect(runway.months).toBeGreaterThan(12);
    expect(runway.months).toBeLessThan(24);
    expect(runway.grossMonths).toBeLessThan(runway.months);
  });

  it('shortens runway under stress', () => {
    const base = computeRunway(ledger, NOW);
    const stressed = computeRunway(ledger, NOW, 25);
    expect(stressed.months).toBeLessThan(base.months);
    expect(stressed.monthlyExpenseCents).toBe(Math.round(base.monthlyExpenseCents * 1.25));
  });

  it('reports infinite runway when income covers spending', () => {
    const snapshot: LedgerSnapshot = createEmptyLedger(new Date('2026-01-01T00:00:00Z'), 100000);
    snapshot.transactions.push({ ...expense('a', 'Client', 5000, '2026-01-10T00:00:00Z'), direction: 'income', categoryId: 'income' });
    snapshot.transactions.push(expense('b', 'AWS', 1000, '2026-01-12T00:00:00Z'));
    const runway = computeRunway(snapshot, new Date('2026-01-20T00:00:00Z'));
    expect(runway.cashFlowPositive).toBe(true);
    expect(runway.months).toBe(Number.POSITIVE_INFINITY);
    expect(runway.zeroCashDate).toBeNull();
  });

  it('widens the forecast band over time', () => {
    const forecast = forecastCash(ledger, NOW, 6);
    expect(forecast.points).toHaveLength(7);
    const spread = forecast.points.map((point) => point.p90Cents - point.p10Cents);
    expect(spread[0]).toBe(0);
    for (let index = 1; index < spread.length; index += 1) expect(spread[index]!).toBeGreaterThan(spread[index - 1]!);
    expect(forecast.points[6]!.p50Cents).toBeLessThan(forecast.startingCashCents);
    expect(forecast.shortfallProbability).toBeLessThan(0.01);
  });
});

describe('anomaly detection', () => {
  const ledger = createDemoLedger(NOW);
  const categories = ledger.workspace.categories;

  it('catches the planted duplicate and the egress spike, and nothing else', () => {
    const findings = ledger.transactions
      .map((tx) => ({ tx, finding: assessTransaction(tx, ledger.transactions, categories, { sensitivity: 3.5 }) }))
      .filter((entry) => entry.finding);
    const kinds = findings.map((entry) => `${entry.tx.merchant}:${entry.finding!.kind}`).sort();
    expect(kinds).toEqual(['AWS S3:merchant-outlier', 'Datadog:duplicate']);
  });

  it('flags a first charge from a new merchant that dwarfs the category', () => {
    const history = [
      expense('1', 'Bench', 220, '2026-06-01T10:00:00Z', 'operations'),
      expense('2', 'Hatch', 380, '2026-06-01T11:00:00Z', 'operations'),
      expense('3', 'Bench', 220, '2026-07-01T10:00:00Z', 'operations'),
      expense('4', 'Hatch', 380, '2026-07-01T11:00:00Z', 'operations'),
      expense('5', 'Bench', 220, '2026-08-01T10:00:00Z', 'operations'),
      expense('6', 'Hatch', 380, '2026-08-01T11:00:00Z', 'operations'),
      expense('7', 'Stripe', 20, '2026-08-28T11:00:00Z', 'operations'),
    ];
    const spike = expense('8', 'Lex Partners', 4800, '2026-09-03T11:00:00Z', 'operations');
    const finding = assessTransaction(spike, [...history, spike], categories, { sensitivity: 3.5 });
    expect(finding?.kind).toBe('new-merchant');
  });

  it('treats an identical pair with the same timestamp as one duplicate', () => {
    const at = '2026-10-02T09:00:00Z';
    const first = expense('tx_a', 'Datadog', 186.4, at, 'tooling');
    const second = expense('tx_b', 'Datadog', 186.4, at, 'tooling');
    const pair = [first, second];
    expect(assessTransaction(first, pair, categories, { sensitivity: 3.5 })).toBeUndefined();
    expect(assessTransaction(second, pair, categories, { sensitivity: 3.5 })?.kind).toBe('duplicate');
  });

  it('ignores small charges', () => {
    const tiny = expense('x', 'Datadog', 5, NOW.toISOString(), 'tooling');
    expect(assessTransaction(tiny, ledger.transactions, categories, { sensitivity: 3.5 })).toBeUndefined();
  });
});
