import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceService, MemoryRepository, createDemoLedger } from '@finorchestrate/core';
import { CARD_URI, buildMcpServer } from '../src/mcp/server.js';

const auth: AuthInfo = { token: 'test', clientId: 'api-token', scopes: ['ledger:read', 'ledger:write'], expiresAt: Math.floor(Date.now() / 1000) + 600 };

let service: FinanceService;
let handler: ReturnType<typeof createMcpHandler>;
let client: Client;

async function connect(mode: 'legacy' | 'auto'): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL('http://finorchestrate.test/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init), { authInfo: auth }),
  });
  const next = new Client({ name: 'test-host', version: '1.0.0' }, mode === 'auto' ? { versionNegotiation: { mode: 'auto' } } : {});
  await next.connect(transport);
  return next;
}

beforeEach(async () => {
  const clock = new Date('2026-10-13T08:30:00Z');
  service = new FinanceService({ repository: new MemoryRepository(), seed: createDemoLedger, clock: () => clock });
  await service.init();
  handler = createMcpHandler(({ authInfo }) => buildMcpServer({ service, cardHtml: async () => '<!doctype html><title>card</title>', version: '1.0.0' }, authInfo));
  client = await connect('legacy');
});

afterEach(async () => {
  await client.close();
  await handler.close();
});

describe('MCP server over Streamable HTTP', () => {
  it('negotiates the 2025-11-25 revision for a default client', () => {
    expect(client.getProtocolEra()).toBe('legacy');
    expect(client.getServerVersion()?.name).toBe('finorchestrate');
    expect(client.getInstructions()).toContain('budget guardian');
  });

  it('also serves the 2026-07-28 era from the same endpoint', async () => {
    const modern = await connect('auto');
    expect(modern.getProtocolEra()).toBe('modern');
    const result = await modern.callTool({ name: 'get_runway', arguments: {} });
    expect((result.structuredContent as { kind: string }).kind).toBe('runway');
    await modern.close();
  });

  it('advertises every tool with schemas, annotations and the MCP App card', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        'audit_spending',
        'check_affordability',
        'forecast_cash',
        'get_briefing',
        'get_budget_status',
        'get_runway',
        'list_approvals',
        'log_expense',
        'log_income',
        'move_budget',
        'resolve_approval',
        'review_transaction',
        'run_guardian',
      ].sort(),
    );
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toBeDefined();
      expect(tool.annotations, tool.name).toBeDefined();
      expect((tool._meta as { ui?: { resourceUri?: string } }).ui?.resourceUri, tool.name).toBe(CARD_URI);
    }
    expect(tools.find((tool) => tool.name === 'get_runway')!.annotations!.readOnlyHint).toBe(true);
  });

  it('serves the card as an MCP App resource', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining([CARD_URI, 'finorchestrate://ledger/overview', 'finorchestrate://guardian/policy']),
    );
    const card = await client.readResource({ uri: CARD_URI });
    expect(card.contents[0]!.mimeType).toBe('text/html;profile=mcp-app');
  });

  it('runs a full voice workflow: log, sweep, approve', async () => {
    const logged = await client.callTool({ name: 'log_expense', arguments: { amount: 42, description: 'Bedrock inference' } });
    expect(logged.isError).toBeFalsy();
    expect((logged.content as Array<{ text: string }>)[0]!.text).toMatch(/^Logged \$42 for Bedrock inference/);

    const sweep = await client.callTool({ name: 'run_guardian', arguments: {} });
    const report = sweep.structuredContent as { executed: unknown[]; approvals: Array<{ id: string }> };
    expect(report.executed).toHaveLength(1);
    expect(report.approvals).toHaveLength(1);

    const approved = await client.callTool({ name: 'resolve_approval', arguments: { decision: 'approve' } });
    expect((approved.structuredContent as { applied: boolean }).applied).toBe(true);

    const activity = await service.activity(30);
    expect(activity.some((event) => event.actor.label === 'Alexa+ via MCP')).toBe(true);
  });

  it('returns domain problems as tool errors the model can read', async () => {
    const result = await client.callTool({ name: 'move_budget', arguments: { from_category: 'snacks', to_category: 'cloud', amount: 10 } });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain('could not find an envelope');
  });

  it('rejects invalid arguments before the handler runs', async () => {
    const result = await client.callTool({ name: 'forecast_cash', arguments: { months: 40 } });
    expect(result.isError).toBe(true);
  });

  it('exposes prompts', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual(['purchase_check', 'weekly_review']);
    const prompt = await client.getPrompt({ name: 'purchase_check', arguments: { item: 'a GPU run', amount: '600' } });
    expect(JSON.stringify(prompt.messages)).toContain('check_affordability');
  });
});
