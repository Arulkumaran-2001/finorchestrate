import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { AuthInfo, CallToolResult } from '@modelcontextprotocol/server';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { DomainError, cards, formatMoney, toCents, type Actor, type Card, type FinanceService } from '@finorchestrate/core';
import { outputSchemas } from './schemas.js';

export const CARD_URI = 'ui://finorchestrate/card.html';

export const SERVER_INSTRUCTIONS = [
  'FinOrchestrate is the budget guardian for a small product team. It tracks spending in monthly envelopes, knows cash and runway, and runs an autonomous guardian that rebalances envelopes within limits the owner set.',
  'Every tool returns a `speech` field written to be read aloud. When you answer by voice, prefer it verbatim or shorten it; do not read raw numbers from the JSON.',
  'Amount arguments are US dollars. Category arguments accept an envelope id (cloud, tooling, contractors, marketing, operations, reserve) or a natural name such as "the safety reserve".',
  'Moves above the voice confirmation limit come back as approval_required. Ask the user to confirm, then call resolve_approval. Never approve on the user\'s behalf without hearing a clear yes.',
  'For "what did I miss" or a first greeting of the day, call get_briefing. It remembers what this client has already heard.',
].join('\n\n');

export interface McpServerDeps {
  service: FinanceService;
  cardHtml: () => Promise<string>;
  version: string;
}

function actorFor(authInfo: AuthInfo | undefined): Actor {
  if (authInfo?.clientId === 'web-console') return { type: 'assistant', label: 'Alexa+ simulator' };
  if (authInfo?.clientId === 'api-token') return { type: 'assistant', label: 'Alexa+ via MCP' };
  return { type: 'assistant', label: 'MCP client' };
}

/** Text first for voice hosts, JSON second for older clients, structured content for everyone else. */
function toResult(card: Card): CallToolResult {
  return {
    content: [
      { type: 'text', text: card.speech },
      { type: 'text', text: JSON.stringify(card) },
    ],
    structuredContent: card as unknown as Record<string, unknown>,
  };
}

async function run(work: () => Promise<Card>): Promise<CallToolResult> {
  try {
    return toResult(await work());
  } catch (error) {
    if (error instanceof DomainError) {
      return { content: [{ type: 'text', text: error.message }], isError: true };
    }
    throw error;
  }
}

const dollars = (description: string) => z.number().positive().max(1_000_000).describe(description);
const categoryRef = (description: string) => z.string().min(1).max(60).describe(description);
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const ui = { ui: { resourceUri: CARD_URI } };

/**
 * Builds one MCP server instance. `createMcpHandler` calls this per request,
 * so the instance only closes over long lived dependencies and the caller.
 */
export function buildMcpServer(deps: McpServerDeps, authInfo: AuthInfo | undefined): McpServer {
  const { service } = deps;
  const actor = actorFor(authInfo);
  const clientKey = authInfo?.clientId ?? 'anonymous';

  const server = new McpServer(
    {
      name: 'finorchestrate',
      title: 'FinOrchestrate Budget Guardian',
      version: deps.version,
      websiteUrl: 'https://github.com/finorchestrate/finorchestrate',
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerAppTool(
    server,
    'get_budget_status',
    {
      title: 'Budget status',
      description: 'How this month is going: spent, limit and projected month end spend for every envelope, or one envelope in detail.',
      inputSchema: z.object({ category: categoryRef('Optional envelope to focus on, for example "cloud"').optional() }),
      outputSchema: outputSchemas.budget,
      annotations: readOnly,
      _meta: ui,
    },
    async ({ category }) => run(async () => cards.budget(await service.budgetStatus(category))),
  );

  registerAppTool(
    server,
    'log_expense',
    {
      title: 'Log an expense',
      description: 'Record money spent. The envelope is detected from the description when not given. Returns the envelope status and flags the charge if it looks unusual or duplicated.',
      inputSchema: z.object({
        amount: dollars('Amount in US dollars, for example 42.5'),
        description: z.string().min(1).max(140).describe('What it was for, for example "Bedrock inference"'),
        category: categoryRef('Envelope id or name. Omit to auto categorise.').optional(),
        merchant: z.string().max(80).optional().describe('Who was paid, when known'),
        occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date in YYYY-MM-DD. Defaults to now.'),
      }),
      outputSchema: outputSchemas.expense,
      annotations: write,
      _meta: ui,
    },
    async (args) =>
      run(async () =>
        cards.expense(
          await service.logExpense(
            {
              amountCents: toCents(args.amount),
              description: args.description,
              category: args.category,
              merchant: args.merchant,
              occurredAt: args.occurred_on,
              source: 'voice',
            },
            actor,
          ),
        ),
      ),
  );

  registerAppTool(
    server,
    'log_income',
    {
      title: 'Record income',
      description: 'Record money received, such as a client payment or a marketplace payout. Returns the new cash position and runway.',
      inputSchema: z.object({
        amount: dollars('Amount in US dollars'),
        description: z.string().min(1).max(140).describe('Who paid and why'),
        occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date in YYYY-MM-DD. Defaults to now.'),
      }),
      outputSchema: outputSchemas.income,
      annotations: write,
      _meta: ui,
    },
    async (args) =>
      run(async () =>
        cards.income(await service.logIncome({ amountCents: toCents(args.amount), description: args.description, occurredAt: args.occurred_on, source: 'voice' }, actor)),
      ),
  );

  registerAppTool(
    server,
    'get_runway',
    {
      title: 'Runway',
      description:
        'Cash on hand, monthly net burn and how many months the money lasts. Pass stress_percent to ask "what if spending rises 25 percent", and category to limit the change to one envelope ("what if cloud costs go up 25 percent").',
      inputSchema: z.object({
        stress_percent: z.number().min(-90).max(300).optional().describe('Change in spending to simulate, for example 25 or -10'),
        category: z.string().min(1).max(60).optional().describe('Envelope the change applies to, by name or id. Omit to change all spending.'),
      }),
      outputSchema: outputSchemas.runway,
      annotations: readOnly,
      _meta: ui,
    },
    async ({ stress_percent, category }) => run(async () => cards.runway(await service.runway(stress_percent ?? 0, category))),
  );

  registerAppTool(
    server,
    'forecast_cash',
    {
      title: 'Cash forecast',
      description: 'Month by month cash projection with a likely range (10th to 90th percentile) and the chance of running out within the horizon.',
      inputSchema: z.object({
        months: z.number().int().min(1).max(12).describe('Horizon in months, 1 to 12'),
        stress_percent: z.number().min(-90).max(300).optional().describe('Optional change in spending to simulate'),
      }),
      outputSchema: outputSchemas.forecast,
      annotations: readOnly,
      _meta: ui,
    },
    async ({ months, stress_percent }) => run(async () => cards.forecast(await service.forecast(months, stress_percent ?? 0))),
  );

  registerAppTool(
    server,
    'audit_spending',
    {
      title: 'Audit spending',
      description: 'Look for duplicate charges and amounts far outside a merchant or envelope history, using a robust modified z-score.',
      inputSchema: z.object({
        days: z.number().int().min(1).max(365).optional().describe('How far back to look. Default 45.'),
        sensitivity: z.number().min(1.5).max(10).optional().describe('Lower finds more. Default from the guardian policy, usually 3.5.'),
      }),
      outputSchema: outputSchemas.audit,
      annotations: readOnly,
      _meta: ui,
    },
    async ({ days, sensitivity }) => run(async () => cards.audit(await service.audit(days ?? 45, sensitivity))),
  );

  registerAppTool(
    server,
    'check_affordability',
    {
      title: 'Check affordability',
      description: 'Before buying something: what it does to its envelope this month and to runway, with a verdict and the cheapest way to make room.',
      inputSchema: z.object({
        amount: dollars('Price in US dollars'),
        description: z.string().min(1).max(140).describe('What is being bought'),
        category: categoryRef('Envelope id or name. Omit to infer from the description.').optional(),
        recurring: z.boolean().optional().describe('True for a new monthly commitment such as a subscription'),
      }),
      outputSchema: outputSchemas.affordability,
      annotations: readOnly,
      _meta: ui,
    },
    async (args) =>
      run(async () =>
        cards.affordability(
          await service.affordability({ amountCents: toCents(args.amount), description: args.description, category: args.category, recurring: args.recurring }),
        ),
      ),
  );

  registerAppTool(
    server,
    'move_budget',
    {
      title: 'Move budget',
      description:
        'Move part of one envelope\'s monthly limit to another. Small moves apply at once. Moves above the voice confirmation limit return approval_required and wait for resolve_approval.',
      inputSchema: z.object({
        from_category: categoryRef('Envelope to take from'),
        to_category: categoryRef('Envelope to give to'),
        amount: dollars('Amount in US dollars'),
        reason: z.string().max(140).optional().describe('Why, for the audit trail'),
      }),
      outputSchema: outputSchemas.move,
      annotations: write,
      _meta: ui,
    },
    async (args) =>
      run(async () =>
        cards.move(await service.moveBudget({ from: args.from_category, to: args.to_category, amountCents: toCents(args.amount), reason: args.reason }, actor)),
      ),
  );

  registerAppTool(
    server,
    'list_approvals',
    {
      title: 'Pending approvals',
      description: 'Changes waiting for the owner: guardian proposals above its autonomy limit and large voice moves.',
      inputSchema: z.object({}),
      outputSchema: outputSchemas.approvals,
      annotations: readOnly,
      _meta: ui,
    },
    async () => run(async () => cards.approvals(await service.approvals('pending'))),
  );

  registerAppTool(
    server,
    'resolve_approval',
    {
      title: 'Approve or reject',
      description: 'Approve or reject a pending change. Without approval_id it acts on the most recent pending change, which is what "approve it" means. Only call after the user clearly decided.',
      inputSchema: z.object({
        decision: z.enum(['approve', 'reject']),
        approval_id: z.string().max(64).optional().describe('Specific approval id. Defaults to the latest pending one.'),
      }),
      outputSchema: outputSchemas.resolution,
      annotations: write,
      _meta: ui,
    },
    async ({ decision, approval_id }) => run(async () => cards.resolution(await service.resolveApproval(approval_id ?? 'latest', decision, actor))),
  );

  registerAppTool(
    server,
    'run_guardian',
    {
      title: 'Run the guardian',
      description:
        'Run an autonomous guardian sweep now: rebalance envelopes that are trending over within the autonomy limit, request approval beyond it, and flag unusual charges. Safe to repeat.',
      inputSchema: z.object({}),
      outputSchema: outputSchemas.sweep,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: ui,
    },
    async () => run(async () => cards.sweep(await service.runGuardian(actor))),
  );

  registerAppTool(
    server,
    'get_briefing',
    {
      title: 'Briefing',
      description: 'What changed since this client last asked, plus anything waiting on the owner. Remembers each client across sessions.',
      inputSchema: z.object({
        listener: z.string().max(40).optional().describe('Optional name of the person or device, to keep separate memories'),
      }),
      outputSchema: outputSchemas.briefing,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: ui,
    },
    async ({ listener }) => run(async () => cards.briefing(await service.briefing(listener ? `${clientKey}:${listener.toLowerCase()}` : clientKey))),
  );

  registerAppTool(
    server,
    'review_transaction',
    {
      title: 'Mark a charge as expected',
      description: 'Clear the unusual flag on a charge after the owner confirmed it was expected.',
      inputSchema: z.object({ transaction_id: z.string().min(1).max(64) }),
      outputSchema: outputSchemas.review,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: CARD_URI, visibility: ['model', 'app'] } },
    },
    async ({ transaction_id }) =>
      run(async () => {
        const tx = await service.reviewTransaction(transaction_id, actor);
        return { kind: 'review', transactionId: tx.id, speech: `Marked the ${formatMoney(tx.amountCents)} ${tx.merchant} charge as expected.` };
      }),
  );

  registerAppResource(
    server,
    'FinOrchestrate card',
    CARD_URI,
    { description: 'Interactive card that renders every FinOrchestrate tool result, with approve, reject and review actions.' },
    async () => ({
      contents: [{ uri: CARD_URI, mimeType: RESOURCE_MIME_TYPE, text: await deps.cardHtml(), _meta: { ui: { prefersBorder: true } } }],
    }),
  );

  server.registerResource(
    'ledger-overview',
    'finorchestrate://ledger/overview',
    { title: 'Ledger overview', description: 'Cash, runway, envelope health and open items for the current month.', mimeType: 'application/json' },
    async (uri) => {
      const overview = await service.overview();
      const summary = {
        workspace: overview.workspaceName,
        period: overview.periodLabel,
        cashCents: overview.cashCents,
        runwayMonths: Number.isFinite(overview.runway.months) ? Math.round(overview.runway.months * 10) / 10 : null,
        monthlyNetBurnCents: overview.runway.monthlyNetBurnCents,
        envelopes: overview.categories.map((c) => ({ id: c.categoryId, name: c.name, health: c.health, spentCents: c.spentCents, limitCents: c.limitCents, projectedCents: c.projectedCents })),
        pendingApprovals: overview.pendingApprovals.length,
        flaggedCharges: overview.flaggedCount,
        guardian: overview.guardian,
      };
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(summary, null, 2) }] };
    },
  );

  server.registerResource(
    'guardian-policy',
    'finorchestrate://guardian/policy',
    { title: 'Guardian policy', description: 'Autonomy limits, reserve floor and anomaly sensitivity the guardian works within.', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await service.policy(), null, 2) }] }),
  );

  server.registerPrompt(
    'weekly_review',
    {
      title: 'Weekly budget review',
      description: 'A spoken weekly review: what changed, where the month is heading, and anything that needs a decision.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: 'Give me my weekly budget review. Call get_briefing, then get_budget_status, then audit_spending. Answer in at most four short spoken sentences, lead with anything that needs my decision, and offer to approve pending changes.',
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'purchase_check',
    {
      title: 'Can we afford it?',
      description: 'Check a purchase before committing to it.',
      argsSchema: z.object({
        item: z.string().describe('What you want to buy'),
        amount: z.string().describe('Price in US dollars'),
      }),
    },
    ({ item, amount }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `I am thinking about buying ${item} for $${amount}. Call check_affordability. If it suggests a transfer, tell me the exact move and ask before calling move_budget.`,
          },
        },
      ],
    }),
  );

  return server;
}
