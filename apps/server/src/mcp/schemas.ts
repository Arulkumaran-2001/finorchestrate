import * as z from 'zod/v4';

/**
 * Output schemas for every tool. The SDK validates `structuredContent`
 * against them before a result leaves the server and advertises the derived
 * JSON Schema in tools/list, so clients can rely on the shape.
 */
const cents = z.number().int().describe('Amount in US cents');
const health = z.enum(['healthy', 'watch', 'at-risk', 'over']);

const category = z.object({
  id: z.string(),
  name: z.string(),
  tone: z.string(),
  kind: z.enum(['operating', 'reserve']),
  health,
  spentCents: cents,
  limitCents: cents,
  projectedCents: cents,
  remainingCents: cents,
});

const leg = z.object({ fromId: z.string(), fromName: z.string(), toId: z.string(), toName: z.string(), amountCents: cents });

const approval = z.object({
  id: z.string(),
  status: z.enum(['pending', 'approved', 'rejected', 'expired']),
  totalCents: cents,
  targetName: z.string(),
  rationale: z.string(),
  legs: z.array(leg),
  requestedBy: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
});

const finding = z.object({
  transactionId: z.string(),
  merchant: z.string(),
  description: z.string(),
  amountCents: cents,
  occurredAt: z.string(),
  categoryName: z.string(),
  kind: z.string(),
  reason: z.string(),
});

const transaction = z.object({
  id: z.string(),
  description: z.string(),
  merchant: z.string(),
  amountCents: cents,
  occurredAt: z.string(),
  categoryId: z.string(),
  direction: z.enum(['expense', 'income']),
});

const speech = z.string().describe('One to three sentences written to be spoken aloud');
const months = z.number().nullable().describe('Months, or null when income covers spending');

export const outputSchemas = {
  budget: z.object({
    kind: z.literal('budget'),
    speech,
    periodLabel: z.string(),
    daysRemaining: z.number().int(),
    spentCents: cents,
    limitCents: cents,
    projectedCents: cents,
    focusId: z.string().nullable(),
    categories: z.array(category),
  }),
  expense: z.object({
    kind: z.literal('expense'),
    speech,
    transaction,
    category,
    autoCategorized: z.boolean(),
    anomaly: z.object({ kind: z.string(), reason: z.string() }).nullable(),
  }),
  income: z.object({ kind: z.literal('income'), speech, transaction, cashCents: cents, runwayMonths: months }),
  runway: z.object({
    kind: z.literal('runway'),
    speech,
    cashCents: cents,
    stressPercent: z.number(),
    stressScope: z.string().nullable(),
    monthlyExpenseCents: cents,
    monthlyIncomeCents: cents,
    monthlyNetBurnCents: cents,
    months,
    zeroCashDate: z.string().nullable(),
    grossMonths: months,
    cashFlowPositive: z.boolean(),
  }),
  forecast: z.object({
    kind: z.literal('forecast'),
    speech,
    months: z.number().int(),
    stressPercent: z.number(),
    startingCashCents: cents,
    expectedNetBurnCents: cents,
    shortfallProbability: z.number().min(0).max(1),
    firstRiskMonth: z.number().int().nullable(),
    points: z.array(z.object({ date: z.string(), p10Cents: cents, p50Cents: cents, p90Cents: cents })),
  }),
  audit: z.object({
    kind: z.literal('audit'),
    speech,
    windowDays: z.number().int(),
    scannedCount: z.number().int(),
    flaggedCents: cents,
    items: z.array(finding),
  }),
  affordability: z.object({
    kind: z.literal('affordability'),
    speech,
    verdict: z.enum(['comfortable', 'tight', 'not-advised']),
    description: z.string(),
    amountCents: cents,
    recurring: z.boolean(),
    categoryName: z.string(),
    limitCents: cents,
    projectedBeforeCents: cents,
    projectedAfterCents: cents,
    runwayBeforeMonths: months,
    runwayAfterMonths: months,
    runwayDeltaDays: z.number().int(),
    reasons: z.array(z.string()),
    suggestion: z
      .union([
        z.object({ kind: z.literal('transfer'), totalCents: cents, legs: z.array(leg) }),
        z.object({ kind: z.literal('wait'), until: z.string() }),
      ])
      .nullable(),
  }),
  move: z.object({
    kind: z.literal('move'),
    speech,
    status: z.enum(['executed', 'approval_required']),
    approvalId: z.string().nullable(),
    legs: z.array(leg),
    from: category,
    to: category,
  }),
  approvals: z.object({ kind: z.literal('approvals'), speech, approvals: z.array(approval) }),
  resolution: z.object({ kind: z.literal('resolution'), speech, applied: z.boolean(), approval: approval.nullable() }),
  sweep: z.object({
    kind: z.literal('sweep'),
    speech,
    ranAt: z.string(),
    enabled: z.boolean(),
    executed: z.array(z.object({ targetName: z.string(), totalCents: cents, reason: z.string(), legs: z.array(leg) })),
    approvals: z.array(approval),
    flagged: z.array(finding),
    warnings: z.array(z.string()),
    autonomousUsedCents: cents,
    autonomousCapCents: cents,
  }),
  briefing: z.object({
    kind: z.literal('briefing'),
    speech,
    since: z.string().nullable(),
    cashCents: cents,
    runwayMonths: months,
    flaggedCount: z.number().int(),
    pendingApprovals: z.array(approval),
    events: z.array(
      z.object({ at: z.string(), title: z.string(), detail: z.string(), severity: z.enum(['info', 'success', 'warning', 'critical']), actor: z.string() }),
    ),
  }),
  review: z.object({ kind: z.literal('review'), speech, transactionId: z.string() }),
};
