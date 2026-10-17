import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpApp, type HttpApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createRuntime } from '../src/runtime.js';

const TOKEN = 'test-token-0123456789abcdef';
let server: Server;
let app: HttpApp;
let base: string;

beforeAll(async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    FINO_STORE: 'memory',
    FINO_API_TOKEN: TOKEN,
    FINO_SESSION_SECRET: 'session-secret-for-tests',
    FINO_DEMO_MODE: 'true',
    FINO_WEB_DIST: 'does-not-exist',
  });
  // A fixed clock: the demo ledger is generated relative to "now", so assertions about it must not depend on the day CI runs.
  const runtime = await createRuntime(config, () => undefined, { clock: () => new Date('2026-10-13T08:30:00Z') });
  app = await createHttpApp(runtime);
  server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await new Promise((resolve) => server.close(resolve));
});

async function demoCookie(): Promise<string> {
  const response = await fetch(`${base}/api/session/demo`, { method: 'POST' });
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

async function graphql(cookie: string, query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ query, variables }),
  });
  return { status: response.status, body: (await response.json()) as { data?: Record<string, any>; errors?: Array<{ message: string }> } };
}

describe('HTTP surface', () => {
  it('reports health without auth', async () => {
    const response = await fetch(`${base}/healthz`);
    expect(await response.json()).toMatchObject({ ok: true, store: 'memory' });
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects MCP calls without a token, with a bearer challenge', async () => {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('blocks DNS rebinding through the Host header', async () => {
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}/mcp`, { method: 'POST', headers: { host: 'evil.example', authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(403);
  });

  it('serves MCP over a real socket to a bearer token client', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: 'alexa-plus-test', version: '1.0.0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.length).toBe(13);
    const result = await client.callTool({ name: 'get_budget_status', arguments: { category: 'cloud' } });
    expect((result.structuredContent as { focusId: string }).focusId).toBe('cloud');
    await client.close();
  });

  it('refuses a wrong access key and accepts the right one', async () => {
    const wrong = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessKey: 'nope' }) });
    expect(wrong.status).toBe(401);
    const right = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessKey: TOKEN }) });
    expect(right.status).toBe(200);
    expect(right.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict/);
  });

  it('requires a session for GraphQL', async () => {
    const response = await fetch(`${base}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ overview { cashCents } }' }) });
    expect(response.status).toBe(401);
  });

  it('rejects non JSON GraphQL posts (CSRF hardening)', async () => {
    const cookie = await demoCookie();
    const response = await fetch(`${base}/graphql`, { method: 'POST', headers: { 'content-type': 'text/plain', cookie }, body: '{"query":"{ policy { enabled } }"}' });
    expect(response.status).toBe(415);
  });

  it('answers dashboard queries and mutations through GraphQL', async () => {
    const cookie = await demoCookie();
    const overview = await graphql(
      cookie,
      `{ overview { workspaceName cashCents runway { months monthlyNetBurnCents } categories { id health limitCents projectedCents }
         guardian { enabled autonomousLimitCents } forecast { points { p10Cents p50Cents p90Cents } } } }`,
    );
    expect(overview.body.errors).toBeUndefined();
    expect(overview.body.data!.overview.workspaceName).toBe('Lumen Labs');
    expect(overview.body.data!.overview.categories).toHaveLength(6);

    const sweep = await graphql(cookie, 'mutation { runGuardian { executedCount approvalsCount flaggedCount speech } }');
    expect(sweep.body.data!.runGuardian).toMatchObject({ executedCount: 1, approvalsCount: 1, flaggedCount: 2 });

    const move = await graphql(cookie, 'mutation($input: MoveInput!) { moveBudget(input: $input) { status speech } }', {
      input: { fromCategoryId: 'marketing', toCategoryId: 'cloud', amountCents: 999999 },
    });
    expect(move.body.errors![0]!.message).toContain('only has');

    const page = await graphql(cookie, '{ transactions(filter: { flaggedOnly: true }) { total items { merchant categoryName anomaly { kind } } } }');
    expect(page.body.data!.transactions.total).toBe(2);
  });

  it('validates the Cents scalar', async () => {
    const cookie = await demoCookie();
    const result = await graphql(cookie, 'mutation { logExpense(input: { amountCents: 12.5, description: "x" }) { speech } }');
    expect(result.body.errors?.[0]?.message).toMatch(/whole number of cents/);
  });

  it('runs scheduled sweeps only with the scheduler secret', async () => {
    const post = (secret: string) =>
      fetch(`${base}/internal/guardian-sweep`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret }) });
    expect((await post('wrong')).status).toBe(401);
    const ok = await post('session-secret-for-tests');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true });
  });

  it('explains when Bedrock is not configured', async () => {
    const cookie = await demoCookie();
    const response = await fetch(`${base}/api/agent/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ messages: [{ role: 'user', content: [{ text: 'hi' }] }], tools: [] }),
    });
    expect(response.status).toBe(501);
  });
});
