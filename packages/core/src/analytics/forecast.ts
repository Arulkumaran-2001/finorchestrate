import type { Cents } from '../money.js';
import { addMonths } from '../time.js';
import type { LedgerSnapshot } from '../types.js';
import { burnProfile, cashOnHand } from './cash.js';
import { normalCdf, standardDeviation } from './stats.js';

/** z for the 10th and 90th percentile of a normal distribution. */
const Z_80 = 1.2815515655;

export interface ForecastPoint {
  monthIndex: number;
  date: string;
  p10Cents: Cents;
  p50Cents: Cents;
  p90Cents: Cents;
}

export interface CashForecast {
  months: number;
  stressPercent: number;
  startingCashCents: Cents;
  expectedNetBurnCents: Cents;
  /** Month to month spread of net burn the bands are built from. */
  volatilityCents: Cents;
  points: ForecastPoint[];
  endingP50Cents: Cents;
  /** Probability that cash drops below zero by the end of the horizon. */
  shortfallProbability: number;
  /** First month where the pessimistic path (P10) goes negative, if any. */
  firstRiskMonth: number | null;
}

/**
 * Cash projection with an uncertainty band. Monthly net burn is treated as a
 * random walk: the median path moves by the average burn, and the band widens
 * with the square root of time using the observed month to month volatility.
 */
export function forecastCash(snapshot: LedgerSnapshot, now: Date, months: number, stressPercent = 0): CashForecast {
  const horizon = Math.min(24, Math.max(1, Math.round(months)));
  const startingCashCents = cashOnHand(snapshot, now);
  const burn = burnProfile(snapshot, now, 6);
  const stress = 1 + Math.max(-90, stressPercent) / 100;
  const expectedNetBurnCents = Math.round(burn.averageExpenseCents * stress - burn.averageIncomeCents);
  const observed = standardDeviation(burn.monthlyNetBurns);
  // Too little history understates risk, so keep a floor of 12 percent of gross spend.
  const volatilityCents = Math.round(Math.max(observed, burn.averageExpenseCents * 0.12));

  const points: ForecastPoint[] = [];
  let firstRiskMonth: number | null = null;
  for (let month = 0; month <= horizon; month += 1) {
    const p50Cents = Math.round(startingCashCents - expectedNetBurnCents * month);
    const spread = Math.round(Z_80 * volatilityCents * Math.sqrt(month));
    const point: ForecastPoint = {
      monthIndex: month,
      date: addMonths(now, month).toISOString().slice(0, 10),
      p10Cents: p50Cents - spread,
      p50Cents,
      p90Cents: p50Cents + spread,
    };
    if (firstRiskMonth === null && month > 0 && point.p10Cents < 0) firstRiskMonth = month;
    points.push(point);
  }
  const last = points.at(-1)!;
  const sigma = volatilityCents * Math.sqrt(horizon);
  const shortfallProbability = sigma > 0 ? normalCdf((0 - last.p50Cents) / sigma) : last.p50Cents < 0 ? 1 : 0;

  return {
    months: horizon,
    stressPercent,
    startingCashCents,
    expectedNetBurnCents,
    volatilityCents,
    points,
    endingP50Cents: last.p50Cents,
    shortfallProbability: Math.round(shortfallProbability * 1000) / 1000,
    firstRiskMonth,
  };
}
