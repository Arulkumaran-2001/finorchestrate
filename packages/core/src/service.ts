import { assessAffordability, type Affordability } from './analytics/affordability.js';
import { assessTransaction, auditTransactions } from './analytics/anomalies.js';
import type { BudgetTotals, CategoryStatus } from './analytics/budget.js';
import { allCategoryStatuses, budgetTotals, categoryStatus, sortByConcern } from './analytics/budget.js';
import type { CashPoint, MonthlyFlow, Runway } from './analytics/cash.js';
import { cashHistory, cashOnHand, computeRunway, monthlyFlows } from './analytics/cash.js';
import type { CashForecast } from './analytics/forecast.js';
import { forecastCash } from './analytics/forecast.js';
import { classifyExpense, matchCategory } from './categories.js';
import { autonomousSpentThisPeriod, planSweep } from './guardian.js';
import { createId as defaultCreateId, type IdFactory } from './ids.js';
import type { Cents } from './money.js';
import { formatMoney, speakMoney, toCents } from './money.js';
import type { ChangeSet, LedgerRepository } from './repository.js';
import { applyChanges } from './repository.js';
import type { Period } from './time.js';
import { DAY_MS, periodEnd, periodLabel, periodOf, speakDate } from './time.js';
import type {
  ActivityEvent,
  ActivitySeverity,
  ActivityType,
  Actor,
  AnomalyFinding,
  Approval,
  BudgetTransfer,
  Category,
  GuardianPolicy,
  LedgerSnapshot,
  Transaction,
  TransactionDirection,
  TransactionSource,
  TransferLeg,
} from './types.js';

export type DomainErrorCode = 'not_found' | 'invalid_input' | 'insufficient_budget' | 'conflict';

/** Errors with a message that can be shown or spoken to the owner as is. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export interface LedgerEvent {
  at: string;
  activity: ActivityEvent[];
}

export interface FinanceServiceOptions {
  repository: LedgerRepository;
  seed: (now: Date) => LedgerSnapshot;
  clock?: () => Date;
  createId?: IdFactory;
  onChange?: (event: LedgerEvent) => void;
}

export interface ExpenseInput {
  amountCents: Cents;
  description: string;
  /** Category id or a spoken name. Omit to classify from the description. */
  category?: string;
  merchant?: string;
  occurredAt?: string;
  source: TransactionSource;
}

export interface IncomeInput {
  amountCents: Cents;
  description: string;
  occurredAt?: string;
  source: TransactionSource;
}

export interface TransactionFilter {
  search?: string;
  categoryId?: string;
  direction?: TransactionDirection;
  flaggedOnly?: boolean;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface NamedLeg extends TransferLeg {
  fromName: string;
  toName: string;
}

export interface ApprovalView extends Approval {
  namedLegs: NamedLeg[];
  targetName: string;
}

export interface LogExpenseResult {
  transaction: Transaction;
  category: CategoryStatus;
  anomaly: AnomalyFinding | null;
  autoCategorized: boolean;
  speech: string;
}

export interface LogIncomeResult {
  transaction: Transaction;
  cashCents: Cents;
  runwayMonths: number;
  speech: string;
}

export interface BudgetStatusResult {
  period: Period;
  periodLabel: string;
  totals: BudgetTotals;
  categories: CategoryStatus[];
  focus: CategoryStatus | null;
  speech: string;
}

export interface RunwayResult extends Runway {
  /** Display name of `stressCategoryId`, or null when the scenario covers all spending. */
  stressCategoryName: string | null;
  speech: string;
}

export interface ForecastResult extends CashForecast {
  speech: string;
}

export interface AuditItem {
  transactionId: string;
  description: string;
  merchant: string;
  amountCents: Cents;
  occurredAt: string;
  categoryId: string;
  categoryName: string;
  finding: AnomalyFinding;
}

export interface AuditSummary {
  items: AuditItem[];
  scannedCount: number;
  windowDays: number;
  sensitivity: number;
  flaggedCents: Cents;
  speech: string;
}

export interface MoveBudgetResult {
  status: 'executed' | 'approval_required';
  transfers: BudgetTransfer[];
  approval: ApprovalView | null;
  from: CategoryStatus;
  to: CategoryStatus;
  speech: string;
}

export interface ResolveApprovalResult {
  approval: ApprovalView | null;
  transfers: BudgetTransfer[];
  speech: string;
}

export interface ApprovalsResult {
  approvals: ApprovalView[];
  speech: string;
}

export interface SweepReport {
  ranAt: string;
  period: Period;
  enabled: boolean;
  executed: Array<{ targetCategoryId: string; targetName: string; totalCents: Cents; legs: NamedLeg[]; reason: string }>;
  approvalsRequested: ApprovalView[];
  flagged: AuditItem[];
  expiredApprovals: number;
  warnings: string[];
  autonomousUsedCents: Cents;
  autonomousCapCents: Cents;
  speech: string;
}

export interface BriefingResult {
  since: string | null;
  events: ActivityEvent[];
  pendingApprovals: ApprovalView[];
  flaggedCount: number;
  runwayMonths: number;
  cashCents: Cents;
  speech: string;
}

export interface Overview {
  generatedAt: string;
  workspaceName: string;
  period: Period;
  periodLabel: string;
  cashCents: Cents;
  runway: Runway;
  flows: MonthlyFlow[];
  totals: BudgetTotals;
  categories: CategoryStatus[];
  pendingApprovals: ApprovalView[];
  flaggedCount: number;
  flaggedCents: Cents;
  guardian: {
    enabled: boolean;
    lastSweepAt: string | null;
    autonomousUsedCents: Cents;
    autonomousCapCents: Cents;
    autonomousLimitCents: Cents;
    sweepIntervalMinutes: number;
  };
  cashHistory: CashPoint[];
  forecast: CashForecast;
  recentActivity: ActivityEvent[];
}

export interface TransactionPage {
  items: Transaction[];
  total: number;
  totalExpenseCents: Cents;
  totalIncomeCents: Cents;
}

const MAX_AMOUNT_CENTS = toCents(1_000_000);

interface Draft {
  snapshot: LedgerSnapshot;
  changes: ChangeSet;
  now: Date;
  activity: ActivityEvent[];
}

/**
 * The one application service. The MCP server, the GraphQL API and the
 * scheduled guardian all call into this class, so every surface shares the
 * same rules, the same audit trail and the same speech.
 */
export class FinanceService {
  private readonly repository: LedgerRepository;
  private readonly seed: (now: Date) => LedgerSnapshot;
  private readonly clock: () => Date;
  private readonly createId: IdFactory;
  private readonly onChange?: (event: LedgerEvent) => void;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: FinanceServiceOptions) {
    this.repository = options.repository;
    this.seed = options.seed;
    this.clock = options.clock ?? (() => new Date());
    this.createId = options.createId ?? defaultCreateId;
    this.onChange = options.onChange;
  }

  now(): Date {
    return this.clock();
  }

  /** Seed the store on first run. Safe to call on every boot. */
  async init(): Promise<void> {
    await this.exclusive(async () => {
      const existing = await this.repository.load();
      if (!existing) await this.repository.replace(this.seed(this.clock()));
    });
  }

  async snapshot(): Promise<LedgerSnapshot> {
    const snapshot = await this.repository.load();
    if (snapshot) return snapshot;
    await this.init();
    return (await this.repository.load())!;
  }

  // ---------------------------------------------------------------- reads

  async overview(): Promise<Overview> {
    const snapshot = await this.snapshot();
    const now = this.clock();
    const period = periodOf(now);
    const categories = allCategoryStatuses(snapshot, now, period);
    const flagged = snapshot.transactions.filter((tx) => tx.status === 'flagged' && !tx.reviewedAt);
    const policy = snapshot.workspace.policy;
    return {
      generatedAt: now.toISOString(),
      workspaceName: snapshot.workspace.name,
      period,
      periodLabel: periodLabel(period),
      cashCents: cashOnHand(snapshot, now),
      runway: computeRunway(snapshot, now),
      flows: monthlyFlows(snapshot, now, 6),
      totals: budgetTotals(categories, now, period),
      categories,
      pendingApprovals: snapshot.approvals.filter((a) => a.status === 'pending').map((a) => this.viewApproval(a, snapshot)),
      flaggedCount: flagged.length,
      flaggedCents: flagged.reduce((total, tx) => total + tx.amountCents, 0),
      guardian: {
        enabled: policy.enabled,
        lastSweepAt: snapshot.workspace.lastSweepAt ?? null,
        autonomousUsedCents: autonomousSpentThisPeriod(snapshot, period),
        autonomousCapCents: policy.monthlyAutonomousCapCents,
        autonomousLimitCents: policy.autonomousLimitCents,
        sweepIntervalMinutes: policy.sweepIntervalMinutes,
      },
      cashHistory: cashHistory(snapshot, now, 120),
      forecast: forecastCash(snapshot, now, 6),
      recentActivity: snapshot.activity.slice(0, 12),
    };
  }

  async categories(): Promise<Category[]> {
    return (await this.snapshot()).workspace.categories;
  }

  async policy(): Promise<GuardianPolicy> {
    return (await this.snapshot()).workspace.policy;
  }

  async budgetStatus(categoryRef?: string): Promise<BudgetStatusResult> {
    const snapshot = await this.snapshot();
    const now = this.clock();
    const period = periodOf(now);
    const statuses = allCategoryStatuses(snapshot, now, period);
    const totals = budgetTotals(statuses, now, period);
    const focus = categoryRef ? statuses.find((s) => s.categoryId === this.resolveCategory(snapshot, categoryRef).id)! : null;
    return {
      period,
      periodLabel: periodLabel(period),
      totals,
      categories: sortByConcern(statuses),
      focus,
      speech: focus ? speakCategory(focus) : speakBudget(statuses, totals),
    };
  }

  /** `categoryRef` limits a stress scenario to one envelope: "what if cloud costs go up 25 percent". */
  async runway(stressPercent = 0, categoryRef?: string): Promise<RunwayResult> {
    const snapshot = await this.snapshot();
    const category = categoryRef && stressPercent !== 0 ? this.resolveCategory(snapshot, categoryRef) : null;
    const runway = computeRunway(snapshot, this.clock(), clampNumber(stressPercent, -90, 300), category?.id ?? null);
    return { ...runway, stressCategoryName: category?.name ?? null, speech: speakRunway(runway, category?.name) };
  }

  async forecast(months: number, stressPercent = 0): Promise<ForecastResult> {
    const snapshot = await this.snapshot();
    const forecast = forecastCash(snapshot, this.clock(), clampNumber(Math.round(months), 1, 12), clampNumber(stressPercent, -90, 300));
    return { ...forecast, speech: speakForecast(forecast) };
  }

  async audit(days = 45, sensitivity?: number): Promise<AuditSummary> {
    const snapshot = await this.snapshot();
    const now = this.clock();
    const windowDays = clampNumber(Math.round(days), 1, 365);
    const threshold = clampNumber(sensitivity ?? snapshot.workspace.policy.anomalySensitivity, 1.5, 10);
    const result = auditTransactions(snapshot.transactions, snapshot.workspace.categories, now, windowDays, threshold);
    const items = result.findings.map(({ transaction, finding }) => this.auditItem(snapshot, transaction, finding));
    return {
      items,
      scannedCount: result.scannedCount,
      windowDays,
      sensitivity: threshold,
      flaggedCents: result.flaggedCents,
      speech: speakAudit(items, result.scannedCount, windowDays),
    };
  }

  async affordability(input: { amountCents: Cents; description: string; category?: string; recurring?: boolean }): Promise<Affordability> {
    const snapshot = await this.snapshot();
    assertAmount(input.amountCents);
    const description = cleanText(input.description, 'this purchase');
    const category = input.category
      ? this.resolveCategory(snapshot, input.category)
      : this.categoryById(snapshot, classifyExpense(description, snapshot.workspace.categories).categoryId);
    return assessAffordability(snapshot, this.clock(), { amountCents: input.amountCents, categoryId: category.id, description, recurring: Boolean(input.recurring) }, category);
  }

  async approvals(status?: Approval['status']): Promise<ApprovalsResult> {
    const snapshot = await this.snapshot();
    const list = snapshot.approvals
      .filter((approval) => !status || approval.status === status)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((approval) => this.viewApproval(approval, snapshot));
    const pending = list.filter((approval) => approval.status === 'pending');
    return { approvals: list, speech: speakApprovals(pending) };
  }

  async transactions(filter: TransactionFilter = {}): Promise<TransactionPage> {
    const snapshot = await this.snapshot();
    const search = filter.search?.trim().toLowerCase();
    const from = filter.from ? Date.parse(filter.from) : Number.NEGATIVE_INFINITY;
    const to = filter.to ? Date.parse(filter.to) : Number.POSITIVE_INFINITY;
    const matches = snapshot.transactions
      .filter((tx) => {
        if (filter.categoryId && tx.categoryId !== filter.categoryId) return false;
        if (filter.direction && tx.direction !== filter.direction) return false;
        if (filter.flaggedOnly && (tx.status !== 'flagged' || tx.reviewedAt)) return false;
        const time = Date.parse(tx.occurredAt);
        if (time < from || time > to) return false;
        if (search && !`${tx.description} ${tx.merchant}`.toLowerCase().includes(search)) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
    const offset = Math.max(0, filter.offset ?? 0);
    const limit = clampNumber(filter.limit ?? 50, 1, 500);
    return {
      items: matches.slice(offset, offset + limit),
      total: matches.length,
      totalExpenseCents: matches.filter((tx) => tx.direction === 'expense').reduce((t, tx) => t + tx.amountCents, 0),
      totalIncomeCents: matches.filter((tx) => tx.direction === 'income').reduce((t, tx) => t + tx.amountCents, 0),
    };
  }

  async activity(limit = 50): Promise<ActivityEvent[]> {
    const snapshot = await this.snapshot();
    return snapshot.activity.slice(0, clampNumber(limit, 1, 400));
  }

  // --------------------------------------------------------------- writes

  async logExpense(input: ExpenseInput, actor: Actor): Promise<LogExpenseResult> {
    assertAmount(input.amountCents);
    const description = cleanText(input.description, '');
    if (!description) throw new DomainError('invalid_input', 'An expense needs a short description.');
    return this.mutate((draft) => {
      const { snapshot, now } = draft;
      const categories = snapshot.workspace.categories;
      const classification = classifyExpense(`${input.merchant ?? ''} ${description}`, categories);
      const category = input.category ? this.resolveCategory(snapshot, input.category) : this.categoryById(snapshot, classification.categoryId);
      const occurredAt = parseOccurredAt(input.occurredAt, now);
      const tx: Transaction = {
        id: this.createId('tx'),
        occurredAt,
        createdAt: now.toISOString(),
        description,
        merchant: cleanText(input.merchant, '') || classification.merchant,
        amountCents: input.amountCents,
        direction: 'expense',
        categoryId: category.id,
        source: input.source,
        status: 'cleared',
      };
      const finding = assessTransaction(tx, snapshot.transactions, categories, { sensitivity: snapshot.workspace.policy.anomalySensitivity });
      if (finding) {
        tx.status = 'flagged';
        tx.anomaly = finding;
      }
      this.stage(draft, { putTransactions: [tx] });
      this.record(draft, 'expense.logged', finding ? 'warning' : 'info', actor, `Logged ${formatMoney(tx.amountCents)} for ${tx.description}`, `${category.name}, via ${actor.label}.`, { transactionId: tx.id });
      if (finding) this.record(draft, 'anomaly.flagged', 'warning', actor, `Unusual charge: ${tx.merchant}`, finding.reason, { transactionId: tx.id });
      const status = categoryStatus(draft.snapshot, category, now);
      return {
        transaction: tx,
        category: status,
        anomaly: finding ?? null,
        autoCategorized: !input.category,
        speech: speakLoggedExpense(tx, status, finding),
      };
    });
  }

  async logIncome(input: IncomeInput, actor: Actor): Promise<LogIncomeResult> {
    assertAmount(input.amountCents);
    const description = cleanText(input.description, 'Incoming payment');
    return this.mutate((draft) => {
      const { now } = draft;
      const tx: Transaction = {
        id: this.createId('tx'),
        occurredAt: parseOccurredAt(input.occurredAt, now),
        createdAt: now.toISOString(),
        description,
        merchant: description,
        amountCents: input.amountCents,
        direction: 'income',
        categoryId: 'income',
        source: input.source,
        status: 'cleared',
      };
      this.stage(draft, { putTransactions: [tx] });
      this.record(draft, 'income.logged', 'success', actor, `Received ${formatMoney(tx.amountCents)}`, `${description}, via ${actor.label}.`, { transactionId: tx.id });
      const runway = computeRunway(draft.snapshot, now);
      return {
        transaction: tx,
        cashCents: runway.cashCents,
        runwayMonths: runway.months,
        speech: `Recorded ${speakMoney(tx.amountCents, { exact: true })} from ${description}. Cash is now ${speakMoney(runway.cashCents)}${Number.isFinite(runway.months) ? `, about ${runway.months.toFixed(1)} months of runway` : ''}.`,
      };
    });
  }

  async updateTransaction(id: string, patch: { description?: string; categoryId?: string; amountCents?: Cents }, actor: Actor): Promise<Transaction> {
    return this.mutate((draft) => {
      const tx = this.transactionById(draft.snapshot, id);
      const next: Transaction = { ...tx };
      if (patch.description !== undefined) next.description = cleanText(patch.description, tx.description);
      if (patch.categoryId !== undefined && tx.direction === 'expense') next.categoryId = this.resolveCategory(draft.snapshot, patch.categoryId).id;
      if (patch.amountCents !== undefined) {
        assertAmount(patch.amountCents);
        next.amountCents = patch.amountCents;
      }
      this.stage(draft, { putTransactions: [next] });
      this.record(draft, 'transaction.updated', 'info', actor, `Updated ${next.description}`, `Now ${formatMoney(next.amountCents)}.`, { transactionId: id });
      return next;
    });
  }

  async reviewTransaction(id: string, actor: Actor): Promise<Transaction> {
    return this.mutate((draft) => {
      const tx = this.transactionById(draft.snapshot, id);
      const next: Transaction = { ...tx, status: 'cleared', reviewedAt: draft.now.toISOString() };
      this.stage(draft, { putTransactions: [next] });
      this.record(draft, 'transaction.reviewed', 'success', actor, `Marked ${tx.merchant} as expected`, `${formatMoney(tx.amountCents)} on ${speakDate(new Date(tx.occurredAt))} was reviewed.`, { transactionId: id });
      return next;
    });
  }

  async deleteTransaction(id: string, actor: Actor): Promise<Transaction> {
    return this.mutate((draft) => {
      const tx = this.transactionById(draft.snapshot, id);
      this.stage(draft, { deleteTransactionIds: [id] });
      this.record(draft, 'transaction.deleted', 'info', actor, `Removed ${tx.description}`, `${formatMoney(tx.amountCents)} was deleted from the ledger.`, { transactionId: id });
      return tx;
    });
  }

  async moveBudget(input: { from: string; to: string; amountCents: Cents; reason?: string }, actor: Actor): Promise<MoveBudgetResult> {
    assertAmount(input.amountCents);
    return this.mutate((draft) => {
      const { snapshot, now } = draft;
      const from = this.resolveCategory(snapshot, input.from);
      const to = this.resolveCategory(snapshot, input.to);
      if (from.id === to.id) throw new DomainError('invalid_input', 'Pick two different envelopes to move money between.');
      const fromStatus = categoryStatus(snapshot, from, now);
      const unspent = fromStatus.limitCents - fromStatus.spentCents;
      if (input.amountCents > unspent) {
        throw new DomainError('insufficient_budget', `${from.name} only has ${formatMoney(Math.max(0, unspent))} unspent this month.`);
      }
      const reason = cleanText(input.reason, actor.type === 'owner' ? 'Manual rebalance' : `Requested through ${actor.label}`);
      const legs: TransferLeg[] = [{ fromCategoryId: from.id, toCategoryId: to.id, amountCents: input.amountCents }];
      const policy = snapshot.workspace.policy;

      if (actor.type !== 'owner' && input.amountCents > policy.voiceConfirmAboveCents) {
        const approval = this.createApproval(draft, legs, to.id, `${reason}. Voice moves above ${formatMoney(policy.voiceConfirmAboveCents, { style: 'whole' })} need a confirmation.`, actor);
        return {
          status: 'approval_required' as const,
          transfers: [],
          approval: this.viewApproval(approval, draft.snapshot),
          from: categoryStatus(draft.snapshot, from, now),
          to: categoryStatus(draft.snapshot, to, now),
          speech: `Moving ${speakMoney(input.amountCents)} from ${from.name} to ${to.name} is above your ${speakMoney(policy.voiceConfirmAboveCents)} voice limit. Say approve to confirm, or reject to cancel.`,
        };
      }
      const transfers = this.executeLegs(draft, legs, reason, actor);
      const toStatus = categoryStatus(draft.snapshot, to, now);
      return {
        status: 'executed' as const,
        transfers,
        approval: null,
        from: categoryStatus(draft.snapshot, from, now),
        to: toStatus,
        speech: `Done. Moved ${speakMoney(input.amountCents)} from ${from.name} to ${to.name}. ${to.name} now has ${speakMoney(Math.max(0, toStatus.remainingCents))} left this month.`,
      };
    });
  }

  /** Approve or reject a pending change. `latest` resolves the newest pending item, which is what "approve it" means. */
  async resolveApproval(idOrLatest: string | undefined, decision: 'approve' | 'reject', actor: Actor): Promise<ResolveApprovalResult> {
    return this.mutate((draft) => {
      const { snapshot, now } = draft;
      const pending = snapshot.approvals
        .filter((approval) => approval.status === 'pending' && Date.parse(approval.expiresAt) > now.getTime())
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const approval = !idOrLatest || idOrLatest === 'latest' ? pending[0] : snapshot.approvals.find((entry) => entry.id === idOrLatest);
      if (!approval) {
        return { approval: null, transfers: [], speech: 'There is nothing waiting for your approval right now.' };
      }
      if (approval.status !== 'pending') {
        throw new DomainError('conflict', `That change was already ${approval.status}.`);
      }
      const resolved: Approval = {
        ...approval,
        status: decision === 'approve' ? 'approved' : 'rejected',
        resolvedAt: now.toISOString(),
        resolvedBy: actor,
      };
      let transfers: BudgetTransfer[] = [];
      if (decision === 'approve') {
        for (const leg of approval.legs) {
          const from = this.categoryById(snapshot, leg.fromCategoryId);
          const status = categoryStatus(snapshot, from, now);
          if (leg.amountCents > status.limitCents - status.spentCents) {
            throw new DomainError('insufficient_budget', `${from.name} no longer has ${formatMoney(leg.amountCents)} unspent, so this change cannot be applied.`);
          }
        }
        transfers = this.executeLegs(draft, approval.legs, approval.rationale, actor, approval.id);
      }
      this.stage(draft, { putApprovals: [resolved] });
      const view = this.viewApproval(resolved, draft.snapshot);
      const summary = describeLegs(view.namedLegs);
      this.record(
        draft,
        'approval.resolved',
        decision === 'approve' ? 'success' : 'info',
        actor,
        decision === 'approve' ? `Approved: ${summary}` : `Rejected: ${summary}`,
        decision === 'approve' ? 'The transfer was applied.' : 'Nothing was moved.',
        { approvalId: approval.id },
      );
      return {
        approval: view,
        transfers,
        speech: decision === 'approve' ? `Approved. I moved ${spokenLegs(view.namedLegs)}.` : `Rejected. Nothing was moved, ${view.targetName} keeps its current limit.`,
      };
    });
  }

  async setCategoryLimit(id: string, monthlyLimitCents: Cents, actor: Actor): Promise<Category> {
    if (!Number.isInteger(monthlyLimitCents) || monthlyLimitCents < 0 || monthlyLimitCents > MAX_AMOUNT_CENTS) {
      throw new DomainError('invalid_input', 'Monthly limits must be between $0 and $1,000,000.');
    }
    return this.mutate((draft) => {
      const category = this.resolveCategory(draft.snapshot, id);
      const updated: Category = { ...category, monthlyLimitCents };
      const workspace = {
        ...draft.snapshot.workspace,
        categories: draft.snapshot.workspace.categories.map((entry) => (entry.id === category.id ? updated : entry)),
        updatedAt: draft.now.toISOString(),
      };
      this.stage(draft, { workspace });
      this.record(draft, 'limit.updated', 'info', actor, `${category.name} limit set to ${formatMoney(monthlyLimitCents, { style: 'whole' })}`, `Was ${formatMoney(category.monthlyLimitCents, { style: 'whole' })} per month.`, { categoryId: category.id });
      return updated;
    });
  }

  async updatePolicy(patch: Partial<GuardianPolicy>, actor: Actor): Promise<GuardianPolicy> {
    return this.mutate((draft) => {
      const current = draft.snapshot.workspace.policy;
      const next: GuardianPolicy = {
        enabled: patch.enabled ?? current.enabled,
        autonomousLimitCents: clampCents(patch.autonomousLimitCents ?? current.autonomousLimitCents),
        monthlyAutonomousCapCents: clampCents(patch.monthlyAutonomousCapCents ?? current.monthlyAutonomousCapCents),
        reserveFloorCents: clampCents(patch.reserveFloorCents ?? current.reserveFloorCents),
        rebalanceTrigger: clampNumber(patch.rebalanceTrigger ?? current.rebalanceTrigger, 0.5, 1.5),
        anomalySensitivity: clampNumber(patch.anomalySensitivity ?? current.anomalySensitivity, 1.5, 10),
        sweepIntervalMinutes: clampNumber(Math.round(patch.sweepIntervalMinutes ?? current.sweepIntervalMinutes), 0, 1440),
        voiceConfirmAboveCents: clampCents(patch.voiceConfirmAboveCents ?? current.voiceConfirmAboveCents),
      };
      if (next.monthlyAutonomousCapCents < next.autonomousLimitCents) {
        throw new DomainError('invalid_input', 'The monthly autonomy cap must be at least the single transfer limit.');
      }
      this.stage(draft, { workspace: { ...draft.snapshot.workspace, policy: next, updatedAt: draft.now.toISOString() } });
      this.record(
        draft,
        'policy.updated',
        'info',
        actor,
        next.enabled ? 'Guardian policy updated' : 'Guardian paused',
        `Autonomy limit ${formatMoney(next.autonomousLimitCents, { style: 'whole' })} per move, ${formatMoney(next.monthlyAutonomousCapCents, { style: 'whole' })} per month. Reserve floor ${formatMoney(next.reserveFloorCents, { style: 'whole' })}.`,
      );
      return next;
    });
  }

  /** One guardian sweep: expire stale approvals, rebalance within policy, request approval beyond it, flag unusual charges. */
  async runGuardian(actor: Actor): Promise<SweepReport> {
    return this.mutate((draft) => {
      const { snapshot, now } = draft;
      const plan = planSweep(snapshot, now);
      const policy = snapshot.workspace.policy;

      for (const id of plan.expiredApprovalIds) {
        const approval = snapshot.approvals.find((entry) => entry.id === id)!;
        this.stage(draft, { putApprovals: [{ ...approval, status: 'expired', resolvedAt: now.toISOString(), resolvedBy: actor }] });
      }

      const guardianActor: Actor = { type: 'guardian', label: actor.type === 'guardian' ? actor.label : `Guardian, run by ${actor.label}` };
      const executed: SweepReport['executed'] = [];
      for (const transfer of plan.transfers) {
        this.executeLegs(draft, transfer.legs, transfer.reason, guardianActor);
        executed.push({
          targetCategoryId: transfer.targetCategoryId,
          targetName: this.categoryById(snapshot, transfer.targetCategoryId).name,
          totalCents: transfer.totalCents,
          legs: this.nameLegs(snapshot, transfer.legs),
          reason: transfer.reason,
        });
      }
      const approvalsRequested = plan.approvals.map((proposal) =>
        this.viewApproval(this.createApproval(draft, proposal.legs, proposal.targetCategoryId, proposal.reason, guardianActor), draft.snapshot),
      );

      const flagged: AuditItem[] = [];
      for (const flag of plan.flags) {
        const tx = this.transactionById(draft.snapshot, flag.transactionId);
        const next: Transaction = { ...tx, status: 'flagged', anomaly: flag.finding };
        this.stage(draft, { putTransactions: [next] });
        this.record(draft, 'anomaly.flagged', 'warning', guardianActor, `Unusual charge: ${tx.merchant}`, flag.finding.reason, { transactionId: tx.id });
        flagged.push(this.auditItem(draft.snapshot, next, flag.finding));
      }
      for (const warning of plan.warnings) {
        this.record(draft, 'guardian.sweep', 'critical', guardianActor, 'Budget gap the guardian cannot cover', warning);
      }

      const report: SweepReport = {
        ranAt: now.toISOString(),
        period: plan.period,
        enabled: policy.enabled,
        executed,
        approvalsRequested,
        flagged,
        expiredApprovals: plan.expiredApprovalIds.length,
        warnings: plan.warnings,
        autonomousUsedCents: autonomousSpentThisPeriod(draft.snapshot, plan.period),
        autonomousCapCents: policy.monthlyAutonomousCapCents,
        speech: '',
      };
      report.speech = speakSweep(report);
      this.stage(draft, { workspace: { ...draft.snapshot.workspace, lastSweepAt: now.toISOString() } });
      const quiet = executed.length === 0 && approvalsRequested.length === 0 && flagged.length === 0 && plan.warnings.length === 0;
      this.record(
        draft,
        'guardian.sweep',
        quiet ? 'info' : 'success',
        guardianActor,
        quiet ? 'Guardian sweep: all clear' : 'Guardian sweep completed',
        report.speech,
      );
      return report;
    });
  }

  /**
   * What changed since this client last asked. The cursor is stored on the
   * workspace, so the memory survives restarts and works across devices.
   */
  async briefing(clientId: string): Promise<BriefingResult> {
    return this.mutate((draft) => {
      const { snapshot, now } = draft;
      const key = clientId.slice(0, 64) || 'default';
      const since = snapshot.workspace.briefingCursors[key] ?? null;
      const sinceTime = since ? Date.parse(since) : now.getTime() - 7 * DAY_MS;
      const events = snapshot.activity
        .filter((event) => Date.parse(event.at) > sinceTime && event.type !== 'guardian.sweep')
        .slice(0, 25);
      const pending = snapshot.approvals.filter((approval) => approval.status === 'pending').map((approval) => this.viewApproval(approval, snapshot));
      const flaggedCount = snapshot.transactions.filter((tx) => tx.status === 'flagged' && !tx.reviewedAt).length;
      const runway = computeRunway(snapshot, now);
      this.stage(draft, {
        workspace: { ...snapshot.workspace, briefingCursors: { ...snapshot.workspace.briefingCursors, [key]: now.toISOString() } },
      });
      return {
        since,
        events,
        pendingApprovals: pending,
        flaggedCount,
        runwayMonths: runway.months,
        cashCents: runway.cashCents,
        speech: speakBriefing(since, events, pending, flaggedCount, runway),
      };
    }, { silent: true });
  }

  async reset(actor: Actor): Promise<void> {
    await this.exclusive(async () => {
      const now = this.clock();
      const fresh = this.seed(now);
      const event: ActivityEvent = {
        id: this.createId('evt'),
        at: now.toISOString(),
        type: 'ledger.reset',
        severity: 'info',
        actor,
        title: 'Demo ledger restored',
        detail: 'Transactions, budgets and guardian history were reset to the sample team.',
      };
      fresh.activity = [event, ...fresh.activity];
      await this.repository.replace(fresh);
      this.onChange?.({ at: now.toISOString(), activity: [event] });
    });
  }

  // -------------------------------------------------------------- helpers

  private async exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async mutate<T>(work: (draft: Draft) => T, options: { silent?: boolean } = {}): Promise<T> {
    return this.exclusive(async () => {
      const snapshot = await this.snapshot();
      const draft: Draft = { snapshot, changes: {}, now: this.clock(), activity: [] };
      const result = work(draft);
      if (hasChanges(draft.changes)) {
        await this.repository.commit(draft.changes);
        if (!options.silent || draft.activity.length > 0) {
          this.onChange?.({ at: draft.now.toISOString(), activity: draft.activity });
        }
      }
      return result;
    });
  }

  /** Merge a change into the draft so later steps in the same operation see it. */
  private stage(draft: Draft, change: ChangeSet): void {
    draft.snapshot = applyChanges(draft.snapshot, change);
    const merge = <T extends { id: string }>(current: T[] | undefined, next: T[] | undefined): T[] | undefined => {
      if (!next) return current;
      const map = new Map((current ?? []).map((item) => [item.id, item]));
      for (const item of next) map.set(item.id, item);
      return [...map.values()];
    };
    draft.changes = {
      workspace: change.workspace ?? draft.changes.workspace,
      putTransactions: merge(draft.changes.putTransactions, change.putTransactions),
      deleteTransactionIds: [...(draft.changes.deleteTransactionIds ?? []), ...(change.deleteTransactionIds ?? [])],
      putTransfers: merge(draft.changes.putTransfers, change.putTransfers),
      putApprovals: merge(draft.changes.putApprovals, change.putApprovals),
      putActivity: merge(draft.changes.putActivity, change.putActivity),
    };
    if (change.workspace && draft.changes.workspace) draft.changes.workspace = draft.snapshot.workspace;
  }

  private record(
    draft: Draft,
    type: ActivityType,
    severity: ActivitySeverity,
    actor: Actor,
    title: string,
    detail: string,
    refs?: Record<string, string>,
  ): ActivityEvent {
    // Keep events from one operation in a stable order by spacing them a millisecond apart.
    const at = new Date(draft.now.getTime() + draft.activity.length).toISOString();
    const event: ActivityEvent = { id: this.createId('evt'), at, type, severity, actor, title, detail, ...(refs ? { refs } : {}) };
    draft.activity.push(event);
    this.stage(draft, { putActivity: [event] });
    return event;
  }

  private executeLegs(draft: Draft, legs: TransferLeg[], reason: string, actor: Actor, approvalId?: string): BudgetTransfer[] {
    const period = periodOf(draft.now);
    const transfers = legs.map<BudgetTransfer>((leg) => ({
      ...leg,
      id: this.createId('trf'),
      period,
      reason,
      actor,
      createdAt: draft.now.toISOString(),
      ...(approvalId ? { approvalId } : {}),
    }));
    this.stage(draft, { putTransfers: transfers });
    const named = this.nameLegs(draft.snapshot, legs);
    this.record(
      draft,
      'transfer.executed',
      actor.type === 'guardian' ? 'success' : 'info',
      actor,
      `Moved ${describeLegs(named)}`,
      reason,
      { transferId: transfers[0]!.id },
    );
    return transfers;
  }

  private createApproval(draft: Draft, legs: TransferLeg[], targetCategoryId: string, rationale: string, actor: Actor): Approval {
    const now = draft.now;
    const approval: Approval = {
      id: this.createId('apr'),
      status: 'pending',
      period: periodOf(now),
      legs,
      totalCents: legs.reduce((total, leg) => total + leg.amountCents, 0),
      rationale,
      requestedBy: actor,
      createdAt: now.toISOString(),
      expiresAt: new Date(Math.min(now.getTime() + 7 * DAY_MS, periodEnd(periodOf(now)).getTime())).toISOString(),
      targetCategoryId,
    };
    this.stage(draft, { putApprovals: [approval] });
    const named = this.nameLegs(draft.snapshot, legs);
    this.record(draft, 'approval.requested', 'warning', actor, `Approval needed: ${describeLegs(named)}`, rationale, { approvalId: approval.id });
    return approval;
  }

  private viewApproval(approval: Approval, snapshot: LedgerSnapshot): ApprovalView {
    return {
      ...approval,
      namedLegs: this.nameLegs(snapshot, approval.legs),
      targetName: snapshot.workspace.categories.find((c) => c.id === approval.targetCategoryId)?.name ?? approval.targetCategoryId,
    };
  }

  private nameLegs(snapshot: LedgerSnapshot, legs: TransferLeg[]): NamedLeg[] {
    const name = (id: string) => snapshot.workspace.categories.find((c) => c.id === id)?.name ?? id;
    return legs.map((leg) => ({ ...leg, fromName: name(leg.fromCategoryId), toName: name(leg.toCategoryId) }));
  }

  private auditItem(snapshot: LedgerSnapshot, tx: Transaction, finding: AnomalyFinding): AuditItem {
    return {
      transactionId: tx.id,
      description: tx.description,
      merchant: tx.merchant,
      amountCents: tx.amountCents,
      occurredAt: tx.occurredAt,
      categoryId: tx.categoryId,
      categoryName: snapshot.workspace.categories.find((c) => c.id === tx.categoryId)?.name ?? tx.categoryId,
      finding,
    };
  }

  private resolveCategory(snapshot: LedgerSnapshot, ref: string): Category {
    const categories = snapshot.workspace.categories;
    const direct = categories.find((category) => category.id === ref || category.name.toLowerCase() === ref.trim().toLowerCase());
    const found = direct ?? matchCategory(ref, categories);
    if (!found) {
      throw new DomainError('not_found', `I could not find an envelope called "${ref}". Try one of: ${categories.map((c) => c.name).join(', ')}.`);
    }
    return found;
  }

  private categoryById(snapshot: LedgerSnapshot, id: string): Category {
    const category = snapshot.workspace.categories.find((entry) => entry.id === id);
    if (!category) throw new DomainError('not_found', `Unknown envelope ${id}.`);
    return category;
  }

  private transactionById(snapshot: LedgerSnapshot, id: string): Transaction {
    const tx = snapshot.transactions.find((entry) => entry.id === id);
    if (!tx) throw new DomainError('not_found', 'That transaction no longer exists.');
    return tx;
  }
}

// ------------------------------------------------------------ narration

function percent(value: number): string {
  return `${Math.round(value * 100)} percent`;
}

function speakCategory(status: CategoryStatus): string {
  const over = status.projectedCents - status.limitCents;
  const base =
    status.remainingCents >= 0
      ? `${status.name} has ${speakMoney(status.remainingCents)} left of ${speakMoney(status.limitCents)} this month.`
      : `${status.name} is ${speakMoney(-status.remainingCents)} over its ${speakMoney(status.limitCents)} limit.`;
  if (status.kind === 'reserve') return `${base} It is the cushion the guardian draws from first.`;
  if (over > 0) return `${base} At the current pace it will finish around ${speakMoney(status.projectedCents)}, about ${speakMoney(over, { approx: true })} over.`;
  return `${base} At the current pace it should finish around ${speakMoney(status.projectedCents)}, inside the limit.`;
}

function speakBudget(statuses: CategoryStatus[], totals: BudgetTotals): string {
  const opening = `You have spent ${speakMoney(totals.spentCents)} of ${speakMoney(totals.limitCents)} this month, ${percent(totals.spentCents / Math.max(1, totals.limitCents))}, with ${totals.daysRemaining} days to go.`;
  const atRisk = sortByConcern(statuses).filter((s) => s.health === 'over' || s.health === 'at-risk');
  if (atRisk.length === 0) {
    const watch = statuses.filter((s) => s.health === 'watch');
    return watch.length > 0 ? `${opening} Everything is on track, though ${watch[0]!.name} is getting close to its limit.` : `${opening} Every envelope is on track.`;
  }
  const first = atRisk[0]!;
  const rest = atRisk.length > 1 ? ` ${atRisk.slice(1).map((s) => s.name).join(' and ')} ${atRisk.length > 2 ? 'are' : 'is'} also trending over.` : '';
  return `${opening} ${first.name} is on pace to run about ${speakMoney(first.projectedCents - first.limitCents, { approx: true })} over.${rest}`;
}

function speakRunway(runway: Runway, categoryName?: string): string {
  const subject = categoryName ? `${categoryName} costs` : 'spending';
  const verb = runway.stressPercent > 0 ? (categoryName ? 'rise' : 'rises') : categoryName ? 'fall' : 'falls';
  const stress = runway.stressPercent !== 0 ? `If ${subject} ${verb} ${Math.abs(runway.stressPercent)} percent, ` : '';
  if (runway.cashFlowPositive) {
    return `${stress}${stress ? 'income' : 'Income'} still covers spending, so cash grows by about ${speakMoney(-runway.monthlyNetBurnCents)} a month. If income stopped, ${speakMoney(runway.cashCents)} would last ${runway.grossMonths.toFixed(1)} months.`;
  }
  const until = runway.zeroCashDate ? new Date(runway.zeroCashDate) : null;
  const untilText = until ? `, which takes you to ${until.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}` : '';
  return `${stress}${stress ? 'net' : 'Net'} burn ${stress ? 'becomes' : 'is'} about ${speakMoney(runway.monthlyNetBurnCents)} a month against ${speakMoney(runway.cashCents)} in cash. That is ${runway.months.toFixed(1)} months of runway${untilText}.`;
}

function speakForecast(forecast: CashForecast): string {
  const last = forecast.points.at(-1)!;
  const chance =
    forecast.shortfallProbability < 0.01
      ? 'The chance of running out of cash in that window is under 1 percent.'
      : `There is about a ${Math.round(forecast.shortfallProbability * 100)} percent chance of running out of cash in that window.`;
  return `In ${forecast.months} month${forecast.months === 1 ? '' : 's'} you will most likely have ${speakMoney(last.p50Cents)}, somewhere between ${speakMoney(last.p10Cents)} and ${speakMoney(last.p90Cents)}. ${chance}`;
}

function speakAudit(items: AuditItem[], scanned: number, days: number): string {
  if (items.length === 0) return `Nothing unusual in the last ${days} days. I checked ${scanned} charges.`;
  const total = items.reduce((sum, item) => sum + item.amountCents, 0);
  const lead = items.length === 1 ? 'I found one charge worth a look.' : `I found ${items.length} charges worth a look, ${speakMoney(total)} in total.`;
  return `${lead} ${items[0]!.finding.reason}${items.length > 1 ? ` ${items[1]!.finding.reason}` : ''}`;
}

function speakLoggedExpense(tx: Transaction, status: CategoryStatus, finding: AnomalyFinding | undefined): string {
  const head = `Logged ${speakMoney(tx.amountCents, { exact: true })} for ${tx.description} under ${status.name}.`;
  const usage =
    status.remainingCents >= 0
      ? ` ${status.name} is at ${percent(status.utilization)} of its ${speakMoney(status.limitCents)} limit.`
      : ` ${status.name} is now ${speakMoney(-status.remainingCents)} over its limit.`;
  const pace = status.kind === 'operating' && status.projectedCents > status.limitCents && status.remainingCents >= 0 ? ` At this pace it will run about ${speakMoney(status.projectedCents - status.limitCents, { approx: true })} over.` : '';
  const alert = finding ? ` Heads up, this looks unusual. ${finding.reason}` : '';
  return `${head}${usage}${pace}${alert}`;
}

function speakApprovals(pending: ApprovalView[]): string {
  if (pending.length === 0) return 'Nothing is waiting for your approval.';
  const first = pending[0]!;
  const more = pending.length > 1 ? ` There ${pending.length === 2 ? 'is one more' : `are ${pending.length - 1} more`} after that.` : '';
  return `${pending.length === 1 ? 'One change is' : `${pending.length} changes are`} waiting. The latest: move ${spokenLegs(first.namedLegs)}. ${first.rationale} Say approve or reject.${more}`;
}

function speakSweep(report: SweepReport): string {
  if (!report.enabled) return 'The guardian is paused, so I did not change anything. You can turn it back on from the dashboard.';
  const parts: string[] = [];
  if (report.executed.length > 0) parts.push(`I moved ${report.executed.map((entry) => spokenLegs(entry.legs)).join(', and ')} on my own`);
  if (report.approvalsRequested.length > 0) {
    parts.push(`I need your approval to move ${report.approvalsRequested.map((approval) => `${speakMoney(approval.totalCents)} into ${approval.targetName}`).join(' and ')}`);
  }
  if (report.flagged.length > 0) parts.push(`I flagged ${report.flagged.length === 1 ? 'one unusual charge' : `${report.flagged.length} unusual charges`}`);
  if (parts.length === 0 && report.warnings.length === 0) return 'Guardian sweep done. Every envelope is on track and nothing looks unusual.';
  const sentence = parts.length > 0 ? `Guardian sweep done. ${joinClauses(parts)}.` : 'Guardian sweep done.';
  return report.warnings.length > 0 ? `${sentence} ${report.warnings[0]}` : sentence;
}

function speakBriefing(since: string | null, events: ActivityEvent[], pending: ApprovalView[], flaggedCount: number, runway: Runway): string {
  const opener = since ? `Since we last spoke on ${speakDate(new Date(since))}` : 'Over the last week';
  const count = (type: ActivityType, filter: (event: ActivityEvent) => boolean = () => true) => events.filter((e) => e.type === type && filter(e)).length;
  const logged = count('expense.logged');
  const income = count('income.logged');
  const autoMoves = count('transfer.executed', (e) => e.actor.type === 'guardian');
  const requested = count('approval.requested');
  const flaggedNew = count('anomaly.flagged');
  const changes: string[] = [];
  if (logged > 0) changes.push(`${logged === 1 ? 'one expense was' : `${logged} expenses were`} logged`);
  if (income > 0) changes.push(`${income === 1 ? 'one payment came' : `${income} payments came`} in`);
  if (autoMoves > 0) changes.push(`the guardian moved money ${autoMoves === 1 ? 'once' : `${autoMoves} times`} on its own`);
  if (requested > 0) changes.push(`${requested === 1 ? 'one new change needs' : `${requested} new changes need`} approval`);
  if (flaggedNew > 0) changes.push(`${flaggedNew === 1 ? 'one charge was' : `${flaggedNew} charges were`} flagged as unusual`);

  const open: string[] = [];
  if (pending.length > 0) open.push(`${pending.length === 1 ? 'one approval' : `${pending.length} approvals`}`);
  if (flaggedCount > 0) open.push(`${flaggedCount === 1 ? 'one flagged charge' : `${flaggedCount} flagged charges`}`);

  const changeText = changes.length > 0 ? `${opener}, ${joinClauses(changes)}.` : `${opener}, nothing new happened.`;
  const openText = open.length > 0 ? ` Still waiting on you: ${joinClauses(open)}.` : ' Nothing is waiting on you.';
  const runwayText = Number.isFinite(runway.months) ? ` Runway is ${runway.months.toFixed(1)} months.` : ' Income currently covers spending.';
  return `${changeText}${openText}${runwayText}`;
}

function spokenLegs(legs: NamedLeg[]): string {
  return legs.map((leg) => `${speakMoney(leg.amountCents)} from ${leg.fromName} to ${leg.toName}`).join(' and ');
}

function describeLegs(legs: NamedLeg[]): string {
  return legs.map((leg) => `${formatMoney(leg.amountCents, { style: 'whole' })} from ${leg.fromName} to ${leg.toName}`).join(', ');
}

function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
}

// ------------------------------------------------------------ validation

function assertAmount(cents: Cents): void {
  if (!Number.isInteger(cents) || cents <= 0) throw new DomainError('invalid_input', 'The amount must be greater than zero.');
  if (cents > MAX_AMOUNT_CENTS) throw new DomainError('invalid_input', 'That amount is larger than this ledger accepts.');
}

function cleanText(value: string | undefined, fallback: string): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  return text || fallback;
}

function parseOccurredAt(value: string | undefined, now: Date): string {
  if (!value) return now.toISOString();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const time = Date.parse(dateOnly ? `${value}T12:00:00.000Z` : value);
  if (Number.isNaN(time)) throw new DomainError('invalid_input', 'The date is not valid. Use the format 2026-10-12.');
  if (time > now.getTime() + DAY_MS) throw new DomainError('invalid_input', 'Transactions cannot be dated in the future.');
  if (time < now.getTime() - 400 * DAY_MS) throw new DomainError('invalid_input', 'Transactions older than about a year cannot be added.');
  return new Date(Math.min(time, now.getTime())).toISOString();
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampCents(value: Cents): Cents {
  return Math.round(clampNumber(value, 0, MAX_AMOUNT_CENTS));
}

function hasChanges(changes: ChangeSet): boolean {
  return Boolean(
    changes.workspace ||
      changes.putTransactions?.length ||
      changes.deleteTransactionIds?.length ||
      changes.putTransfers?.length ||
      changes.putApprovals?.length ||
      changes.putActivity?.length,
  );
}
