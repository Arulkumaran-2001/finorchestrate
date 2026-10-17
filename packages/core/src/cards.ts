import type { Affordability } from './analytics/affordability.js';
import type { CategoryStatus } from './analytics/budget.js';
import type { Cents } from './money.js';
import type {
  ApprovalView,
  AuditItem,
  AuditSummary,
  BriefingResult,
  BudgetStatusResult,
  ForecastResult,
  LogExpenseResult,
  LogIncomeResult,
  MoveBudgetResult,
  NamedLeg,
  ResolveApprovalResult,
  RunwayResult,
  SweepReport,
  ApprovalsResult,
} from './service.js';
import type { ActivitySeverity, Transaction } from './types.js';

/**
 * Card payloads are the `structuredContent` of every MCP tool result. They are
 * small, JSON safe (no Infinity) and carry a `speech` line, so the same object
 * drives a voice reply, an MCP App card and the web console.
 */
export interface CardCategory {
  id: string;
  name: string;
  tone: string;
  kind: 'operating' | 'reserve';
  health: CategoryStatus['health'];
  spentCents: Cents;
  limitCents: Cents;
  projectedCents: Cents;
  remainingCents: Cents;
}

export interface CardLeg {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amountCents: Cents;
}

export interface CardApproval {
  id: string;
  status: ApprovalView['status'];
  totalCents: Cents;
  targetName: string;
  rationale: string;
  legs: CardLeg[];
  requestedBy: string;
  createdAt: string;
  expiresAt: string;
}

export interface CardFinding {
  transactionId: string;
  merchant: string;
  description: string;
  amountCents: Cents;
  occurredAt: string;
  categoryName: string;
  kind: string;
  reason: string;
}

export interface CardTransaction {
  id: string;
  description: string;
  merchant: string;
  amountCents: Cents;
  occurredAt: string;
  categoryId: string;
  direction: Transaction['direction'];
}

export type BudgetCard = {
  kind: 'budget';
  speech: string;
  periodLabel: string;
  daysRemaining: number;
  spentCents: Cents;
  limitCents: Cents;
  projectedCents: Cents;
  focusId: string | null;
  categories: CardCategory[];
};

export type ExpenseCard = {
  kind: 'expense';
  speech: string;
  transaction: CardTransaction;
  category: CardCategory;
  autoCategorized: boolean;
  anomaly: { kind: string; reason: string } | null;
};

export type IncomeCard = {
  kind: 'income';
  speech: string;
  transaction: CardTransaction;
  cashCents: Cents;
  runwayMonths: number | null;
};

export type RunwayCard = {
  kind: 'runway';
  speech: string;
  cashCents: Cents;
  stressPercent: number;
  /** Name of the envelope a stress scenario applies to, or null for all spending. */
  stressScope: string | null;
  monthlyExpenseCents: Cents;
  monthlyIncomeCents: Cents;
  monthlyNetBurnCents: Cents;
  months: number | null;
  zeroCashDate: string | null;
  grossMonths: number | null;
  cashFlowPositive: boolean;
};

export type ForecastCard = {
  kind: 'forecast';
  speech: string;
  months: number;
  stressPercent: number;
  startingCashCents: Cents;
  expectedNetBurnCents: Cents;
  shortfallProbability: number;
  firstRiskMonth: number | null;
  points: Array<{ date: string; p10Cents: Cents; p50Cents: Cents; p90Cents: Cents }>;
};

export type AuditCard = {
  kind: 'audit';
  speech: string;
  windowDays: number;
  scannedCount: number;
  flaggedCents: Cents;
  items: CardFinding[];
};

export type AffordabilityCard = {
  kind: 'affordability';
  speech: string;
  verdict: Affordability['verdict'];
  description: string;
  amountCents: Cents;
  recurring: boolean;
  categoryName: string;
  limitCents: Cents;
  projectedBeforeCents: Cents;
  projectedAfterCents: Cents;
  runwayBeforeMonths: number | null;
  runwayAfterMonths: number | null;
  runwayDeltaDays: number;
  reasons: string[];
  suggestion: { kind: 'transfer'; totalCents: Cents; legs: CardLeg[] } | { kind: 'wait'; until: string } | null;
};

export type MoveCard = {
  kind: 'move';
  speech: string;
  status: MoveBudgetResult['status'];
  approvalId: string | null;
  legs: CardLeg[];
  from: CardCategory;
  to: CardCategory;
};

export type ApprovalsCard = {
  kind: 'approvals';
  speech: string;
  approvals: CardApproval[];
};

export type ResolutionCard = {
  kind: 'resolution';
  speech: string;
  applied: boolean;
  approval: CardApproval | null;
};

export type SweepCard = {
  kind: 'sweep';
  speech: string;
  ranAt: string;
  enabled: boolean;
  executed: Array<{ targetName: string; totalCents: Cents; reason: string; legs: CardLeg[] }>;
  approvals: CardApproval[];
  flagged: CardFinding[];
  warnings: string[];
  autonomousUsedCents: Cents;
  autonomousCapCents: Cents;
};

export type BriefingCard = {
  kind: 'briefing';
  speech: string;
  since: string | null;
  cashCents: Cents;
  runwayMonths: number | null;
  flaggedCount: number;
  pendingApprovals: CardApproval[];
  events: Array<{ at: string; title: string; detail: string; severity: ActivitySeverity; actor: string }>;
};

export type ReviewCard = {
  kind: 'review';
  speech: string;
  transactionId: string;
};

export type Card =
  | BudgetCard
  | ExpenseCard
  | IncomeCard
  | RunwayCard
  | ForecastCard
  | AuditCard
  | AffordabilityCard
  | MoveCard
  | ApprovalsCard
  | ResolutionCard
  | SweepCard
  | BriefingCard
  | ReviewCard;

const finite = (value: number): number | null => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);

export function cardCategory(status: CategoryStatus): CardCategory {
  return {
    id: status.categoryId,
    name: status.name,
    tone: status.tone,
    kind: status.kind,
    health: status.health,
    spentCents: status.spentCents,
    limitCents: status.limitCents,
    projectedCents: status.projectedCents,
    remainingCents: status.remainingCents,
  };
}

export function cardLegs(legs: NamedLeg[]): CardLeg[] {
  return legs.map((leg) => ({ fromId: leg.fromCategoryId, fromName: leg.fromName, toId: leg.toCategoryId, toName: leg.toName, amountCents: leg.amountCents }));
}

export function cardApproval(approval: ApprovalView): CardApproval {
  return {
    id: approval.id,
    status: approval.status,
    totalCents: approval.totalCents,
    targetName: approval.targetName,
    rationale: approval.rationale,
    legs: cardLegs(approval.namedLegs),
    requestedBy: approval.requestedBy.label,
    createdAt: approval.createdAt,
    expiresAt: approval.expiresAt,
  };
}

export function cardFinding(item: AuditItem): CardFinding {
  return {
    transactionId: item.transactionId,
    merchant: item.merchant,
    description: item.description,
    amountCents: item.amountCents,
    occurredAt: item.occurredAt,
    categoryName: item.categoryName,
    kind: item.finding.kind,
    reason: item.finding.reason,
  };
}

function cardTransaction(tx: Transaction): CardTransaction {
  return {
    id: tx.id,
    description: tx.description,
    merchant: tx.merchant,
    amountCents: tx.amountCents,
    occurredAt: tx.occurredAt,
    categoryId: tx.categoryId,
    direction: tx.direction,
  };
}

export const cards = {
  budget(result: BudgetStatusResult): BudgetCard {
    return {
      kind: 'budget',
      speech: result.speech,
      periodLabel: result.periodLabel,
      daysRemaining: result.totals.daysRemaining,
      spentCents: result.totals.spentCents,
      limitCents: result.totals.limitCents,
      projectedCents: result.totals.projectedCents,
      focusId: result.focus?.categoryId ?? null,
      categories: result.categories.map(cardCategory),
    };
  },
  expense(result: LogExpenseResult): ExpenseCard {
    return {
      kind: 'expense',
      speech: result.speech,
      transaction: cardTransaction(result.transaction),
      category: cardCategory(result.category),
      autoCategorized: result.autoCategorized,
      anomaly: result.anomaly ? { kind: result.anomaly.kind, reason: result.anomaly.reason } : null,
    };
  },
  income(result: LogIncomeResult): IncomeCard {
    return {
      kind: 'income',
      speech: result.speech,
      transaction: cardTransaction(result.transaction),
      cashCents: result.cashCents,
      runwayMonths: finite(result.runwayMonths),
    };
  },
  runway(result: RunwayResult): RunwayCard {
    return {
      kind: 'runway',
      speech: result.speech,
      cashCents: result.cashCents,
      stressPercent: result.stressPercent,
      stressScope: result.stressCategoryName,
      monthlyExpenseCents: result.monthlyExpenseCents,
      monthlyIncomeCents: result.monthlyIncomeCents,
      monthlyNetBurnCents: result.monthlyNetBurnCents,
      months: finite(result.months),
      zeroCashDate: result.zeroCashDate,
      grossMonths: finite(result.grossMonths),
      cashFlowPositive: result.cashFlowPositive,
    };
  },
  forecast(result: ForecastResult): ForecastCard {
    return {
      kind: 'forecast',
      speech: result.speech,
      months: result.months,
      stressPercent: result.stressPercent,
      startingCashCents: result.startingCashCents,
      expectedNetBurnCents: result.expectedNetBurnCents,
      shortfallProbability: result.shortfallProbability,
      firstRiskMonth: result.firstRiskMonth,
      points: result.points.map((point) => ({ date: point.date, p10Cents: point.p10Cents, p50Cents: point.p50Cents, p90Cents: point.p90Cents })),
    };
  },
  audit(result: AuditSummary): AuditCard {
    return {
      kind: 'audit',
      speech: result.speech,
      windowDays: result.windowDays,
      scannedCount: result.scannedCount,
      flaggedCents: result.flaggedCents,
      items: result.items.map(cardFinding),
    };
  },
  affordability(result: Affordability): AffordabilityCard {
    return {
      kind: 'affordability',
      speech: result.speech,
      verdict: result.verdict,
      description: result.description,
      amountCents: result.amountCents,
      recurring: result.recurring,
      categoryName: result.categoryName,
      limitCents: result.limitCents,
      projectedBeforeCents: result.projectedBeforeCents,
      projectedAfterCents: result.projectedAfterCents,
      runwayBeforeMonths: finite(result.runwayBeforeMonths),
      runwayAfterMonths: finite(result.runwayAfterMonths),
      runwayDeltaDays: result.runwayDeltaDays,
      reasons: result.reasons,
      suggestion:
        result.suggestion?.kind === 'transfer'
          ? {
              kind: 'transfer',
              totalCents: result.suggestion.totalCents,
              legs: result.suggestion.legs.map((leg) => ({ fromId: leg.fromCategoryId, fromName: leg.fromName, toId: leg.toCategoryId, toName: leg.toName, amountCents: leg.amountCents })),
            }
          : result.suggestion,
    };
  },
  move(result: MoveBudgetResult): MoveCard {
    const legs = result.approval
      ? cardLegs(result.approval.namedLegs)
      : result.transfers.map((transfer) => ({
          fromId: transfer.fromCategoryId,
          fromName: result.from.name,
          toId: transfer.toCategoryId,
          toName: result.to.name,
          amountCents: transfer.amountCents,
        }));
    return {
      kind: 'move',
      speech: result.speech,
      status: result.status,
      approvalId: result.approval?.id ?? null,
      legs,
      from: cardCategory(result.from),
      to: cardCategory(result.to),
    };
  },
  approvals(result: ApprovalsResult): ApprovalsCard {
    return { kind: 'approvals', speech: result.speech, approvals: result.approvals.map(cardApproval) };
  },
  resolution(result: ResolveApprovalResult): ResolutionCard {
    return {
      kind: 'resolution',
      speech: result.speech,
      applied: result.transfers.length > 0,
      approval: result.approval ? cardApproval(result.approval) : null,
    };
  },
  sweep(result: SweepReport): SweepCard {
    return {
      kind: 'sweep',
      speech: result.speech,
      ranAt: result.ranAt,
      enabled: result.enabled,
      executed: result.executed.map((entry) => ({ targetName: entry.targetName, totalCents: entry.totalCents, reason: entry.reason, legs: cardLegs(entry.legs) })),
      approvals: result.approvalsRequested.map(cardApproval),
      flagged: result.flagged.map(cardFinding),
      warnings: result.warnings,
      autonomousUsedCents: result.autonomousUsedCents,
      autonomousCapCents: result.autonomousCapCents,
    };
  },
  briefing(result: BriefingResult): BriefingCard {
    return {
      kind: 'briefing',
      speech: result.speech,
      since: result.since,
      cashCents: result.cashCents,
      runwayMonths: finite(result.runwayMonths),
      flaggedCount: result.flaggedCount,
      pendingApprovals: result.pendingApprovals.map(cardApproval),
      events: result.events.map((event) => ({ at: event.at, title: event.title, detail: event.detail, severity: event.severity, actor: event.actor.label })),
    };
  },
};
