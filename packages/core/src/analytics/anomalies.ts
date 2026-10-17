import { normalizeMerchant } from '../categories.js';
import type { Cents } from '../money.js';
import { formatMoney } from '../money.js';
import { DAY_MS } from '../time.js';
import type { AnomalyFinding, Category, Transaction } from '../types.js';
import { median, modifiedZScore, quantile } from './stats.js';

export interface AnomalyOptions {
  /** Modified z-score threshold. 3.5 is the textbook default. */
  sensitivity: number;
  /** Charges below this are never reported. Small noise is not worth a voice alert. */
  minimumCents?: Cents;
  /** Window, in days, in which an identical charge counts as a duplicate. */
  duplicateWindowDays?: number;
}

const MIN_MERCHANT_SAMPLES = 4;
const MIN_CATEGORY_SAMPLES = 6;
const CATEGORY_LOOKBACK_DAYS = 150;

/**
 * Decide whether one expense looks wrong given everything that came before it.
 * Checks run from most to least certain: duplicates, then the merchant's own
 * history, then the category's history.
 */
export function assessTransaction(
  tx: Transaction,
  ledger: Transaction[],
  categories: Category[],
  options: AnomalyOptions,
): AnomalyFinding | undefined {
  if (tx.direction !== 'expense') return undefined;
  const minimum = options.minimumCents ?? 2000;
  if (tx.amountCents < minimum) return undefined;

  const time = Date.parse(tx.occurredAt);
  const merchantKey = normalizeMerchant(tx.merchant);
  const windowMs = (options.duplicateWindowDays ?? 3) * DAY_MS;
  // Charges with the same timestamp (a statement imported twice) are ordered by when they were recorded, then by id,
  // so exactly one of an identical pair counts as the earlier one.
  const earlier = ledger.filter((other) => {
    if (other.id === tx.id || other.direction !== 'expense') return false;
    const at = Date.parse(other.occurredAt);
    if (at !== time) return at < time;
    return other.createdAt === tx.createdAt ? other.id < tx.id : other.createdAt < tx.createdAt;
  });

  const duplicate = earlier.find(
    (other) =>
      other.amountCents === tx.amountCents &&
      normalizeMerchant(other.merchant) === merchantKey &&
      time - Date.parse(other.occurredAt) <= windowMs,
  );
  if (duplicate) {
    const days = Math.max(0, Math.round((time - Date.parse(duplicate.occurredAt)) / DAY_MS));
    const when = days === 0 ? 'earlier the same day' : days === 1 ? 'the day before' : `${days} days earlier`;
    return {
      kind: 'duplicate',
      score: 10,
      reason: `${tx.merchant} charged ${formatMoney(tx.amountCents)} twice. The same amount posted ${when}.`,
      baselineCents: duplicate.amountCents,
      relatedTransactionId: duplicate.id,
    };
  }

  const merchantHistory = earlier.filter((other) => normalizeMerchant(other.merchant) === merchantKey).map((other) => other.amountCents);
  if (merchantHistory.length >= MIN_MERCHANT_SAMPLES) {
    const score = modifiedZScore(tx.amountCents, merchantHistory);
    const typical = median(merchantHistory);
    if (score >= options.sensitivity && tx.amountCents >= typical * 1.3 && tx.amountCents - typical >= 2500) {
      const ratio = tx.amountCents / typical;
      return {
        kind: 'merchant-outlier',
        score: round(score),
        reason: `${tx.merchant} billed ${formatMoney(tx.amountCents)}, about ${ratio.toFixed(1)} times its usual ${formatMoney(Math.round(typical), { style: 'whole' })}.`,
        baselineCents: Math.round(typical),
      };
    }
    return undefined;
  }
  // A short but consistent merchant history (a monthly invoice seen once or twice)
  // vouches for the charge. Comparing it with the whole category would misfire.
  if (merchantHistory.length > 0 && tx.amountCents <= Math.max(...merchantHistory) * 1.5) return undefined;

  const category = categories.find((entry) => entry.id === tx.categoryId);
  const categoryHistory = earlier
    .filter((other) => other.categoryId === tx.categoryId && time - Date.parse(other.occurredAt) <= CATEGORY_LOOKBACK_DAYS * DAY_MS)
    .map((other) => other.amountCents);
  if (categoryHistory.length >= MIN_CATEGORY_SAMPLES) {
    const score = modifiedZScore(tx.amountCents, categoryHistory);
    const typical = median(categoryHistory);
    const p90 = quantile(categoryHistory, 0.9);
    const isNewMerchant = merchantHistory.length === 0;
    const threshold = options.sensitivity + 0.5;
    if (score >= threshold && tx.amountCents >= typical * 2 && tx.amountCents > p90) {
      const label = category?.name ?? 'this category';
      return {
        kind: isNewMerchant ? 'new-merchant' : 'category-outlier',
        score: round(score),
        reason: isNewMerchant
          ? `First charge from ${tx.merchant}, and at ${formatMoney(tx.amountCents)} it is larger than 9 in 10 ${label} charges.`
          : `${formatMoney(tx.amountCents)} is unusually large for ${label}, where a typical charge is ${formatMoney(Math.round(typical), { style: 'whole' })}.`,
        baselineCents: Math.round(typical),
      };
    }
  }
  return undefined;
}

export interface AuditResult {
  findings: Array<{ transaction: Transaction; finding: AnomalyFinding }>;
  scannedCount: number;
  windowDays: number;
  sensitivity: number;
  flaggedCents: Cents;
}

/** Scan recent expenses. Already flagged items keep their finding, reviewed items are skipped. */
export function auditTransactions(transactions: Transaction[], categories: Category[], now: Date, days: number, sensitivity: number): AuditResult {
  const from = now.getTime() - days * DAY_MS;
  const recent = transactions
    .filter((tx) => tx.direction === 'expense' && Date.parse(tx.occurredAt) >= from && Date.parse(tx.occurredAt) <= now.getTime())
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const findings: AuditResult['findings'] = [];
  for (const tx of recent) {
    if (tx.reviewedAt) continue;
    const finding = tx.anomaly ?? assessTransaction(tx, transactions, categories, { sensitivity });
    if (finding) findings.push({ transaction: tx, finding });
  }
  findings.sort((a, b) => b.finding.score - a.finding.score || b.transaction.amountCents - a.transaction.amountCents);
  return {
    findings,
    scannedCount: recent.length,
    windowDays: days,
    sensitivity,
    flaggedCents: findings.reduce((total, entry) => total + entry.transaction.amountCents, 0),
  };
}

function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 99;
}
