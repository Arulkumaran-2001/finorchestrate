/** GraphQL documents and the result types the dashboard relies on. */

export type Health = 'healthy' | 'watch' | 'at_risk' | 'over';
export type Severity = 'info' | 'success' | 'warning' | 'critical';

export interface Actor {
  type: string;
  label: string;
}

export interface CategoryStatus {
  id: string;
  name: string;
  kind: 'operating' | 'reserve';
  tone: string;
  plannedCents: number;
  transfersInCents: number;
  transfersOutCents: number;
  limitCents: number;
  spentCents: number;
  remainingCents: number;
  projectedCents: number;
  utilization: number;
  projectedUtilization: number;
  health: Health;
  transactionCount: number;
}

export interface Leg {
  fromCategoryId: string;
  fromName: string;
  toCategoryId: string;
  toName: string;
  amountCents: number;
}

export interface Approval {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  totalCents: number;
  rationale: string;
  targetName: string;
  legs: Leg[];
  requestedBy: Actor;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  resolvedBy: Actor | null;
}

export interface Activity {
  id: string;
  at: string;
  type: string;
  severity: Severity;
  actor: Actor;
  title: string;
  detail: string;
}

export interface ForecastPoint {
  monthIndex: number;
  date: string;
  p10Cents: number;
  p50Cents: number;
  p90Cents: number;
}

export interface Forecast {
  months: number;
  stressPercent: number;
  startingCashCents: number;
  expectedNetBurnCents: number;
  endingP50Cents: number;
  shortfallProbability: number;
  firstRiskMonth: number | null;
  points: ForecastPoint[];
}

export interface Runway {
  cashCents: number;
  stressPercent: number;
  monthlyExpenseCents: number;
  monthlyIncomeCents: number;
  monthlyNetBurnCents: number;
  months: number | null;
  zeroCashDate: string | null;
  cashFlowPositive: boolean;
  grossMonths: number | null;
  sampleMonths: number;
}

export interface Overview {
  generatedAt: string;
  workspaceName: string;
  periodLabel: string;
  cashCents: number;
  runway: Runway;
  flows: Array<{ period: string; label: string; incomeCents: number; expenseCents: number; netBurnCents: number; complete: boolean }>;
  totals: { plannedCents: number; limitCents: number; spentCents: number; projectedCents: number; elapsedFraction: number; daysRemaining: number };
  categories: CategoryStatus[];
  pendingApprovals: Approval[];
  flaggedCount: number;
  flaggedCents: number;
  guardian: {
    enabled: boolean;
    lastSweepAt: string | null;
    nextSweepAt: string | null;
    autonomousUsedCents: number;
    autonomousCapCents: number;
    autonomousLimitCents: number;
    sweepIntervalMinutes: number;
  };
  cashHistory: Array<{ date: string; cashCents: number }>;
  forecast: Forecast;
  recentActivity: Activity[];
}

export interface Transaction {
  id: string;
  occurredAt: string;
  description: string;
  merchant: string;
  amountCents: number;
  direction: 'expense' | 'income';
  categoryId: string;
  categoryName: string;
  source: string;
  status: string;
  reviewedAt: string | null;
  anomaly: { kind: string; reason: string; score: number } | null;
}

export interface Policy {
  enabled: boolean;
  autonomousLimitCents: number;
  monthlyAutonomousCapCents: number;
  reserveFloorCents: number;
  rebalanceTrigger: number;
  anomalySensitivity: number;
  sweepIntervalMinutes: number;
  voiceConfirmAboveCents: number;
}

export interface Connection {
  mcpUrl: string;
  transport: string;
  protocolVersions: string[];
  tokenSource: string;
  tokenPreview: string;
  demoMode: boolean;
  store: string;
  guardianSchedule: boolean;
  notifications: string[];
  planner: { kind: string; model: string | null };
  version: string;
}

export interface CategoryDefinition {
  id: string;
  name: string;
  kind: string;
  tone: string;
  description: string;
  monthlyLimitCents: number;
  keywords?: string[];
}

const APPROVAL = 'id status totalCents rationale targetName legs { fromCategoryId fromName toCategoryId toName amountCents } requestedBy { type label } createdAt expiresAt resolvedAt resolvedBy { type label }';
const CATEGORY = 'id name kind tone plannedCents transfersInCents transfersOutCents limitCents spentCents remainingCents projectedCents utilization projectedUtilization health transactionCount';
const ACTIVITY = 'id at type severity title detail actor { type label }';
const FORECAST = 'months stressPercent startingCashCents expectedNetBurnCents endingP50Cents shortfallProbability firstRiskMonth points { monthIndex date p10Cents p50Cents p90Cents }';
const RUNWAY = 'cashCents stressPercent monthlyExpenseCents monthlyIncomeCents monthlyNetBurnCents months zeroCashDate cashFlowPositive grossMonths sampleMonths';
const TRANSACTION = 'id occurredAt description merchant amountCents direction categoryId categoryName source status reviewedAt anomaly { kind reason score }';

export const OVERVIEW_QUERY = `query Overview {
  overview {
    generatedAt workspaceName periodLabel cashCents
    runway { ${RUNWAY} }
    flows { period label incomeCents expenseCents netBurnCents complete }
    totals { plannedCents limitCents spentCents projectedCents elapsedFraction daysRemaining }
    categories { ${CATEGORY} }
    pendingApprovals { ${APPROVAL} }
    flaggedCount flaggedCents
    guardian { enabled lastSweepAt nextSweepAt autonomousUsedCents autonomousCapCents autonomousLimitCents sweepIntervalMinutes }
    cashHistory { date cashCents }
    forecast { ${FORECAST} }
    recentActivity { ${ACTIVITY} }
  }
}`;

export const FORECAST_QUERY = `query Forecast($months: Int!, $stress: Float) { forecast(months: $months, stressPercent: $stress) { ${FORECAST} } runway(stressPercent: $stress) { ${RUNWAY} } }`;

export const TRANSACTIONS_QUERY = `query Transactions($filter: TransactionFilter) {
  transactions(filter: $filter) { total totalExpenseCents totalIncomeCents items { ${TRANSACTION} } }
}`;

export const CATEGORIES_QUERY = 'query Categories { categories { id name kind tone description monthlyLimitCents keywords } }';

export const ENVELOPES_QUERY = `query Envelopes {
  overview { periodLabel totals { limitCents spentCents projectedCents daysRemaining } categories { ${CATEGORY} } }
  approvals { ${APPROVAL} }
  categories { id description monthlyLimitCents }
}`;

export const GUARDIAN_QUERY = `query Guardian($limit: Int) {
  policy { enabled autonomousLimitCents monthlyAutonomousCapCents reserveFloorCents rebalanceTrigger anomalySensitivity sweepIntervalMinutes voiceConfirmAboveCents }
  overview { guardian { enabled lastSweepAt nextSweepAt autonomousUsedCents autonomousCapCents autonomousLimitCents sweepIntervalMinutes } flaggedCount pendingApprovals { id } }
  activity(limit: $limit) { ${ACTIVITY} }
}`;

export const CONNECTION_QUERY = 'query Connection { connection { mcpUrl transport protocolVersions tokenSource tokenPreview demoMode store guardianSchedule notifications planner { kind model } version } }';

export const RESOLVE_APPROVAL = `mutation Resolve($id: ID!, $decision: Decision!) { resolveApproval(id: $id, decision: $decision) { speech approval { id status } } }`;
export const REVIEW_TRANSACTION = 'mutation Review($id: ID!) { reviewTransaction(id: $id) { id } }';
export const DELETE_TRANSACTION = 'mutation Delete($id: ID!) { deleteTransaction(id: $id) { id } }';
export const LOG_EXPENSE = 'mutation LogExpense($input: ExpenseInput!) { logExpense(input: $input) { speech transaction { id } } }';
export const LOG_INCOME = 'mutation LogIncome($input: IncomeInput!) { logIncome(input: $input) { speech transaction { id } } }';
export const MOVE_BUDGET = 'mutation Move($input: MoveInput!) { moveBudget(input: $input) { status speech } }';
export const SET_LIMIT = 'mutation SetLimit($id: ID!, $cents: Cents!) { setCategoryLimit(id: $id, monthlyLimitCents: $cents) { id monthlyLimitCents } }';
export const UPDATE_POLICY = 'mutation UpdatePolicy($input: PolicyInput!) { updatePolicy(input: $input) { enabled } }';
export const RUN_GUARDIAN = 'mutation RunGuardian { runGuardian { speech executedCount approvalsCount flaggedCount warnings } }';
export const REVEAL_TOKEN = 'mutation Reveal { revealApiToken }';
export const RESET_DEMO = 'mutation Reset { resetDemoData }';
