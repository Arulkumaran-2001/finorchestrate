import { GraphQLScalarType, Kind } from 'graphql';
import { createGraphQLError, createPubSub, createSchema } from 'graphql-yoga';
import {
  DomainError,
  periodLabel,
  type Actor,
  type ApprovalView,
  type CategoryStatus,
  type FinanceService,
  type LedgerEvent,
  type Overview,
  type Transaction,
} from '@finorchestrate/core';
import type { AppConfig } from '../config.js';
import type { Principal } from '../auth.js';

export interface GraphQLContext {
  service: FinanceService;
  principal: Principal;
  /** Origin the browser used, so links shown in the UI match it. */
  origin: string;
  config: AppConfig;
  connection: ConnectionInfo;
}

export interface ConnectionInfo {
  mcpUrl: string;
  protocolVersions: string[];
  planner: { kind: 'bedrock' | 'local'; model: string | null };
  nextSweepAt: () => string | null;
}

export const pubSub = createPubSub<{ ledger: [LedgerEvent] }>();

const typeDefs = /* GraphQL */ `
  "Money in integer US cents."
  scalar Cents
  scalar JSON

  enum Health { healthy watch at_risk over }
  enum Direction { expense income }
  enum ApprovalStatus { pending approved rejected expired }
  enum Decision { approve reject }
  enum Severity { info success warning critical }

  type Actor { type: String! label: String! }

  type Category {
    id: ID!
    name: String!
    kind: String!
    tone: String!
    description: String!
    monthlyLimitCents: Cents!
    alertThreshold: Float!
    "Spoken and merchant keywords that route expenses into this envelope."
    keywords: [String!]!
  }

  type CategoryStatus {
    id: ID!
    name: String!
    kind: String!
    tone: String!
    plannedCents: Cents!
    transfersInCents: Cents!
    transfersOutCents: Cents!
    limitCents: Cents!
    spentCents: Cents!
    remainingCents: Cents!
    projectedCents: Cents!
    utilization: Float!
    projectedUtilization: Float!
    health: Health!
    transactionCount: Int!
    alertThreshold: Float!
  }

  type BudgetTotals {
    plannedCents: Cents!
    limitCents: Cents!
    spentCents: Cents!
    projectedCents: Cents!
    elapsedFraction: Float!
    daysRemaining: Int!
  }

  type Runway {
    cashCents: Cents!
    stressPercent: Float!
    monthlyExpenseCents: Cents!
    monthlyIncomeCents: Cents!
    monthlyNetBurnCents: Cents!
    "Null when income covers spending."
    months: Float
    zeroCashDate: String
    cashFlowPositive: Boolean!
    grossMonths: Float
    sampleMonths: Int!
  }

  type MonthlyFlow { period: String! label: String! incomeCents: Cents! expenseCents: Cents! netBurnCents: Cents! complete: Boolean! }
  type CashPoint { date: String! cashCents: Cents! }
  type ForecastPoint { monthIndex: Int! date: String! p10Cents: Cents! p50Cents: Cents! p90Cents: Cents! }

  type Forecast {
    months: Int!
    stressPercent: Float!
    startingCashCents: Cents!
    expectedNetBurnCents: Cents!
    volatilityCents: Cents!
    endingP50Cents: Cents!
    shortfallProbability: Float!
    firstRiskMonth: Int
    points: [ForecastPoint!]!
    speech: String
  }

  type Leg { fromCategoryId: ID! fromName: String! toCategoryId: ID! toName: String! amountCents: Cents! }

  type Approval {
    id: ID!
    status: ApprovalStatus!
    totalCents: Cents!
    rationale: String!
    targetCategoryId: ID!
    targetName: String!
    legs: [Leg!]!
    requestedBy: Actor!
    createdAt: String!
    expiresAt: String!
    resolvedAt: String
    resolvedBy: Actor
  }

  type GuardianStatus {
    enabled: Boolean!
    lastSweepAt: String
    nextSweepAt: String
    autonomousUsedCents: Cents!
    autonomousCapCents: Cents!
    autonomousLimitCents: Cents!
    sweepIntervalMinutes: Int!
  }

  type Anomaly { kind: String! score: Float! reason: String! baselineCents: Cents relatedTransactionId: ID }

  type Transaction {
    id: ID!
    occurredAt: String!
    createdAt: String!
    description: String!
    merchant: String!
    amountCents: Cents!
    direction: Direction!
    categoryId: ID!
    categoryName: String!
    source: String!
    status: String!
    anomaly: Anomaly
    reviewedAt: String
  }

  type TransactionPage { items: [Transaction!]! total: Int! totalExpenseCents: Cents! totalIncomeCents: Cents! }

  type Activity {
    id: ID!
    at: String!
    type: String!
    severity: Severity!
    actor: Actor!
    title: String!
    detail: String!
    refs: JSON
  }

  type Overview {
    generatedAt: String!
    workspaceName: String!
    period: String!
    periodLabel: String!
    cashCents: Cents!
    runway: Runway!
    flows: [MonthlyFlow!]!
    totals: BudgetTotals!
    categories: [CategoryStatus!]!
    pendingApprovals: [Approval!]!
    flaggedCount: Int!
    flaggedCents: Cents!
    guardian: GuardianStatus!
    cashHistory: [CashPoint!]!
    forecast: Forecast!
    recentActivity: [Activity!]!
  }

  type GuardianPolicy {
    enabled: Boolean!
    autonomousLimitCents: Cents!
    monthlyAutonomousCapCents: Cents!
    reserveFloorCents: Cents!
    rebalanceTrigger: Float!
    anomalySensitivity: Float!
    sweepIntervalMinutes: Int!
    voiceConfirmAboveCents: Cents!
  }

  type AuditItem {
    transactionId: ID!
    description: String!
    merchant: String!
    amountCents: Cents!
    occurredAt: String!
    categoryId: ID!
    categoryName: String!
    anomaly: Anomaly!
  }

  type Audit { items: [AuditItem!]! scannedCount: Int! windowDays: Int! sensitivity: Float! flaggedCents: Cents! speech: String! }

  type SweepReport { ranAt: String! speech: String! executedCount: Int! approvalsCount: Int! flaggedCount: Int! warnings: [String!]! }

  type Planner { kind: String! model: String }

  type Connection {
    mcpUrl: String!
    transport: String!
    protocolVersions: [String!]!
    tokenSource: String!
    tokenPreview: String!
    demoMode: Boolean!
    store: String!
    guardianSchedule: Boolean!
    notifications: [String!]!
    planner: Planner!
    version: String!
  }

  type Session { authenticated: Boolean! method: String! mode: String demoMode: Boolean! }

  type LogResult { transaction: Transaction! speech: String! }
  type MoveResult { status: String! speech: String! approval: Approval }
  type ResolveResult { speech: String! approval: Approval }
  type LedgerEvent { at: String! activity: [Activity!]! }

  input TransactionFilter {
    search: String
    categoryId: ID
    direction: Direction
    flaggedOnly: Boolean
    from: String
    to: String
    limit: Int
    offset: Int
  }

  input ExpenseInput { amountCents: Cents! description: String! category: String merchant: String occurredAt: String }
  input IncomeInput { amountCents: Cents! description: String! occurredAt: String }
  input TransactionPatch { description: String categoryId: ID amountCents: Cents }
  input MoveInput { fromCategoryId: ID! toCategoryId: ID! amountCents: Cents! reason: String }
  input PolicyInput {
    enabled: Boolean
    autonomousLimitCents: Cents
    monthlyAutonomousCapCents: Cents
    reserveFloorCents: Cents
    rebalanceTrigger: Float
    anomalySensitivity: Float
    sweepIntervalMinutes: Int
    voiceConfirmAboveCents: Cents
  }

  type Query {
    session: Session!
    overview: Overview!
    categories: [Category!]!
    transactions(filter: TransactionFilter): TransactionPage!
    activity(limit: Int): [Activity!]!
    approvals(status: ApprovalStatus): [Approval!]!
    policy: GuardianPolicy!
    forecast(months: Int!, stressPercent: Float): Forecast!
    runway(stressPercent: Float): Runway!
    audit(days: Int, sensitivity: Float): Audit!
    connection: Connection!
  }

  type Mutation {
    logExpense(input: ExpenseInput!): LogResult!
    logIncome(input: IncomeInput!): LogResult!
    updateTransaction(id: ID!, input: TransactionPatch!): Transaction!
    reviewTransaction(id: ID!): Transaction!
    deleteTransaction(id: ID!): Transaction!
    moveBudget(input: MoveInput!): MoveResult!
    resolveApproval(id: ID!, decision: Decision!): ResolveResult!
    setCategoryLimit(id: ID!, monthlyLimitCents: Cents!): Category!
    updatePolicy(input: PolicyInput!): GuardianPolicy!
    runGuardian: SweepReport!
    revealApiToken: String!
    resetDemoData: Boolean!
  }

  type Subscription {
    ledgerEvents: LedgerEvent!
  }
`;

const CentsScalar = new GraphQLScalarType({
  name: 'Cents',
  description: 'Money in integer US cents.',
  serialize: (value) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw createGraphQLError('Cents must be a safe integer.');
    return value;
  },
  parseValue: (value) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw createGraphQLError('Cents must be a whole number of cents.');
    return value;
  },
  parseLiteral: (ast) => {
    if (ast.kind !== Kind.INT) throw createGraphQLError('Cents must be a whole number of cents.');
    return Number(ast.value);
  },
});

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  serialize: (value) => value,
  parseValue: (value) => value,
});

const OWNER: Actor = { type: 'owner', label: 'Dashboard' };
const finite = (value: number) => (Number.isFinite(value) ? value : null);
const health = (value: CategoryStatus['health']) => value.replace('-', '_');

function category(status: CategoryStatus) {
  return { ...status, id: status.categoryId, health: health(status.health), utilization: finite(status.utilization) ?? 99, projectedUtilization: finite(status.projectedUtilization) ?? 99 };
}

function approval(view: ApprovalView) {
  return { ...view, legs: view.namedLegs };
}

function runway(value: Overview['runway']) {
  return { ...value, months: finite(value.months), grossMonths: finite(value.grossMonths), sampleMonths: value.basis.sampleMonths };
}

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DomainError) throw createGraphQLError(error.message, { extensions: { code: error.code.toUpperCase() } });
    throw error;
  }
}

function maskToken(token: string): string {
  return token.length <= 8 ? '********' : `${token.slice(0, 4)}${'*'.repeat(12)}${token.slice(-4)}`;
}

export function buildSchema() {
  return createSchema<GraphQLContext>({
    typeDefs,
    resolvers: {
      Cents: CentsScalar,
      JSON: JSONScalar,
      Transaction: {
        categoryName: async (tx: Transaction, _args: unknown, ctx: GraphQLContext) => {
          if (tx.direction === 'income') return 'Income';
          const categories = await ctx.service.categories();
          return categories.find((entry) => entry.id === tx.categoryId)?.name ?? tx.categoryId;
        },
      },
      Query: {
        session: (_root, _args, ctx) => ({ authenticated: true, method: ctx.principal.method, mode: ctx.principal.mode ?? null, demoMode: ctx.config.demoMode }),
        overview: async (_root, _args, ctx) => {
          const overview = await ctx.service.overview();
          return {
            ...overview,
            runway: runway(overview.runway),
            flows: overview.flows.map((flow) => ({ ...flow, label: periodLabel(flow.period).split(' ')[0]!.slice(0, 3) })),
            categories: overview.categories.map(category),
            pendingApprovals: overview.pendingApprovals.map(approval),
            guardian: { ...overview.guardian, nextSweepAt: ctx.connection.nextSweepAt() },
          };
        },
        categories: (_root, _args, ctx) => ctx.service.categories(),
        transactions: (_root, args: { filter?: Record<string, unknown> }, ctx) => ctx.service.transactions((args.filter ?? {}) as never),
        activity: (_root, args: { limit?: number }, ctx) => ctx.service.activity(args.limit ?? 50),
        approvals: async (_root, args: { status?: ApprovalView['status'] }, ctx) => (await ctx.service.approvals(args.status)).approvals.map(approval),
        policy: (_root, _args, ctx) => ctx.service.policy(),
        forecast: (_root, args: { months: number; stressPercent?: number }, ctx) => ctx.service.forecast(args.months, args.stressPercent ?? 0),
        runway: async (_root, args: { stressPercent?: number }, ctx) => runway(await ctx.service.runway(args.stressPercent ?? 0)),
        audit: async (_root, args: { days?: number; sensitivity?: number }, ctx) => {
          const audit = await ctx.service.audit(args.days ?? 45, args.sensitivity);
          return { ...audit, items: audit.items.map((item) => ({ ...item, anomaly: item.finding })) };
        },
        connection: (_root, _args, ctx) => ({
          mcpUrl: ctx.connection.mcpUrl,
          transport: 'Streamable HTTP',
          protocolVersions: ctx.connection.protocolVersions,
          tokenSource: ctx.config.apiTokenSource,
          tokenPreview: maskToken(ctx.config.apiToken),
          demoMode: ctx.config.demoMode,
          store: ctx.config.store,
          guardianSchedule: ctx.config.guardianSchedule,
          notifications: [ctx.config.snsTopicArn ? 'Amazon SNS' : null, ctx.config.webhookUrl ? 'Webhook' : null, 'Activity feed'].filter(Boolean),
          planner: ctx.connection.planner,
          version: ctx.config.version,
        }),
      },
      Mutation: {
        logExpense: (_root, args: { input: { amountCents: number; description: string; category?: string; merchant?: string; occurredAt?: string } }, ctx) =>
          guard(async () => {
            const result = await ctx.service.logExpense({ ...args.input, source: 'dashboard' }, OWNER);
            return { transaction: result.transaction, speech: result.speech };
          }),
        logIncome: (_root, args: { input: { amountCents: number; description: string; occurredAt?: string } }, ctx) =>
          guard(async () => {
            const result = await ctx.service.logIncome({ ...args.input, source: 'dashboard' }, OWNER);
            return { transaction: result.transaction, speech: result.speech };
          }),
        updateTransaction: (_root, args: { id: string; input: { description?: string; categoryId?: string; amountCents?: number } }, ctx) =>
          guard(() => ctx.service.updateTransaction(args.id, args.input, OWNER)),
        reviewTransaction: (_root, args: { id: string }, ctx) => guard(() => ctx.service.reviewTransaction(args.id, OWNER)),
        deleteTransaction: (_root, args: { id: string }, ctx) => guard(() => ctx.service.deleteTransaction(args.id, OWNER)),
        moveBudget: (_root, args: { input: { fromCategoryId: string; toCategoryId: string; amountCents: number; reason?: string } }, ctx) =>
          guard(async () => {
            const result = await ctx.service.moveBudget(
              { from: args.input.fromCategoryId, to: args.input.toCategoryId, amountCents: args.input.amountCents, reason: args.input.reason },
              OWNER,
            );
            return { status: result.status, speech: result.speech, approval: result.approval ? approval(result.approval) : null };
          }),
        resolveApproval: (_root, args: { id: string; decision: 'approve' | 'reject' }, ctx) =>
          guard(async () => {
            const result = await ctx.service.resolveApproval(args.id, args.decision, OWNER);
            return { speech: result.speech, approval: result.approval ? approval(result.approval) : null };
          }),
        setCategoryLimit: (_root, args: { id: string; monthlyLimitCents: number }, ctx) => guard(() => ctx.service.setCategoryLimit(args.id, args.monthlyLimitCents, OWNER)),
        updatePolicy: (_root, args: { input: Record<string, unknown> }, ctx) => guard(() => ctx.service.updatePolicy(args.input, OWNER)),
        runGuardian: (_root, _args, ctx) =>
          guard(async () => {
            const report = await ctx.service.runGuardian({ type: 'owner', label: 'Dashboard' });
            return {
              ranAt: report.ranAt,
              speech: report.speech,
              executedCount: report.executed.length,
              approvalsCount: report.approvalsRequested.length,
              flaggedCount: report.flagged.length,
              warnings: report.warnings,
            };
          }),
        revealApiToken: (_root, _args, ctx) => ctx.config.apiToken,
        resetDemoData: async (_root, _args, ctx) => {
          if (!ctx.config.demoMode) throw createGraphQLError('Resetting is only available in demo mode.', { extensions: { code: 'FORBIDDEN' } });
          await ctx.service.reset(OWNER);
          return true;
        },
      },
      Subscription: {
        ledgerEvents: {
          subscribe: () => pubSub.subscribe('ledger'),
          resolve: (event: LedgerEvent) => event,
        },
      },
    },
  });
}
