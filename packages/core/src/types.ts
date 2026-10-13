import type { Cents } from './money.js';
import type { Period } from './time.js';

export type CategoryKind = 'operating' | 'reserve';

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  /** Planned monthly budget before any transfers. */
  monthlyLimitCents: Cents;
  /** Utilization (0..1) at which the category starts reporting `watch`. */
  alertThreshold: number;
  /** Design token name used by the dashboard and MCP App cards. */
  tone: CategoryTone;
  description: string;
  /** Merchant and spoken keywords that route expenses into this category. */
  keywords: string[];
}

export type CategoryTone = 'series-1' | 'series-2' | 'series-3' | 'series-4' | 'series-5' | 'series-6' | 'series-7' | 'series-8';

export type TransactionDirection = 'expense' | 'income';

export type TransactionSource = 'voice' | 'dashboard' | 'api' | 'guardian' | 'import';

export type TransactionStatus = 'cleared' | 'flagged';

export type AnomalyKind = 'duplicate' | 'merchant-outlier' | 'category-outlier' | 'new-merchant';

export interface AnomalyFinding {
  kind: AnomalyKind;
  /** Higher is more unusual. Modified z-score or a normalized ratio. */
  score: number;
  /** One sentence, plain language, suitable for speech. */
  reason: string;
  /** Typical amount the finding compared against, when one exists. */
  baselineCents?: Cents;
  /** Transaction this one appears to duplicate. */
  relatedTransactionId?: string;
}

export interface Transaction {
  id: string;
  occurredAt: string;
  createdAt: string;
  description: string;
  merchant: string;
  amountCents: Cents;
  direction: TransactionDirection;
  categoryId: string;
  source: TransactionSource;
  status: TransactionStatus;
  anomaly?: AnomalyFinding;
  reviewedAt?: string;
}

export type ActorType = 'owner' | 'assistant' | 'guardian' | 'system';

export interface Actor {
  type: ActorType;
  /** Free text such as "Dashboard", "Alexa+ via MCP" or "Guardian sweep". */
  label: string;
}

export interface TransferLeg {
  fromCategoryId: string;
  toCategoryId: string;
  amountCents: Cents;
}

export interface BudgetTransfer extends TransferLeg {
  id: string;
  period: Period;
  reason: string;
  actor: Actor;
  createdAt: string;
  approvalId?: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface Approval {
  id: string;
  status: ApprovalStatus;
  period: Period;
  legs: TransferLeg[];
  totalCents: Cents;
  /** Why the change is being proposed, written for the owner. */
  rationale: string;
  requestedBy: Actor;
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string;
  resolvedBy?: Actor;
  /** Category whose overspend triggered the proposal, used for de-duplication. */
  targetCategoryId: string;
}

export type ActivitySeverity = 'info' | 'success' | 'warning' | 'critical';

export type ActivityType =
  | 'expense.logged'
  | 'income.logged'
  | 'transaction.updated'
  | 'transaction.deleted'
  | 'transaction.reviewed'
  | 'anomaly.flagged'
  | 'transfer.executed'
  | 'approval.requested'
  | 'approval.resolved'
  | 'guardian.sweep'
  | 'policy.updated'
  | 'limit.updated'
  | 'ledger.reset';

export interface ActivityEvent {
  id: string;
  at: string;
  type: ActivityType;
  severity: ActivitySeverity;
  actor: Actor;
  title: string;
  detail: string;
  /** Ids of the records this event touched. */
  refs?: Record<string, string>;
}

export interface GuardianPolicy {
  enabled: boolean;
  /** The guardian may execute a single transfer up to this amount without asking. */
  autonomousLimitCents: Cents;
  /** Total the guardian may move on its own within one budget period. */
  monthlyAutonomousCapCents: Cents;
  /** Reserve categories never drop below this unspent amount. */
  reserveFloorCents: Cents;
  /** Projected utilization that triggers rebalancing. 1 means projected to exceed the limit. */
  rebalanceTrigger: number;
  /** Modified z-score above which a charge is reported as unusual. */
  anomalySensitivity: number;
  /** Minutes between scheduled sweeps. Zero disables the in-process schedule. */
  sweepIntervalMinutes: number;
  /** Voice moves larger than this need an explicit confirmation step. */
  voiceConfirmAboveCents: Cents;
}

export interface Workspace {
  id: string;
  name: string;
  currency: 'USD';
  openingBalanceCents: Cents;
  openingBalanceAt: string;
  categories: Category[];
  policy: GuardianPolicy;
  createdAt: string;
  updatedAt: string;
  lastSweepAt?: string;
  /** Per client briefing cursors, keyed by a stable client id. This is the cross session memory. */
  briefingCursors: Record<string, string>;
}

export interface LedgerSnapshot {
  workspace: Workspace;
  transactions: Transaction[];
  transfers: BudgetTransfer[];
  approvals: Approval[];
  activity: ActivityEvent[];
}
