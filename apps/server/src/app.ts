import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createYoga } from 'graphql-yoga';
import {
  RateLimiter,
  authenticate,
  clearedSessionCookie,
  clientAddress,
  safeEqual,
  sessionCookie,
  signSession,
  toAuthInfo,
  type Principal,
} from './auth.js';
import type { AgentTurnRequest } from './agent/bedrock.js';
import { buildSchema, type ConnectionInfo, type GraphQLContext } from './graphql/schema.js';
import { HttpError, applySecurityHeaders, contentSecurityPolicy, inlineHashes, readJson, sendError, sendJson, serveStatic } from './http.js';
import { createHostGuard, isSecureRequest, requestOrigin } from './hosts.js';
import { buildMcpServer } from './mcp/server.js';
import type { Runtime } from './runtime.js';

export const PROTOCOL_VERSIONS = ['2025-11-25', '2026-07-28'];

const FALLBACK_CARD = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FinOrchestrate</title></head><body><p>Card view is not built yet. Run npm run build.</p></body></html>`;

export interface HttpApp {
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  close: () => Promise<void>;
  connection: ConnectionInfo;
}

export async function createHttpApp(runtime: Runtime, options: { nextSweepAt?: () => string | null } = {}): Promise<HttpApp> {
  const { config, service, planner, log } = runtime;

  let cardHtml = FALLBACK_CARD;
  try {
    cardHtml = await readFile(path.join(config.viewsDir, 'card.html'), 'utf8');
  } catch {
    log('MCP App card not found in views/, serving a placeholder. Build it with npm run build.');
  }
  const csp = contentSecurityPolicy(inlineHashes(cardHtml));

  const origin = config.publicUrl ?? `http://localhost:${config.port}`;
  const connection: ConnectionInfo = {
    mcpUrl: `${origin}/mcp`,
    protocolVersions: PROTOCOL_VERSIONS,
    planner: planner ? { kind: 'bedrock', model: planner.modelId } : { kind: 'local', model: null },
    nextSweepAt: options.nextSweepAt ?? (() => null),
  };

  const mcpHandler = createMcpHandler(({ authInfo }) => buildMcpServer({ service, cardHtml: async () => cardHtml, version: config.version }, authInfo), {
    onerror: (error) => log(`mcp: ${error.message}`),
  });
  const mcpNode = toNodeHandler(mcpHandler, { onerror: (error) => log(`mcp adapter: ${error.message}`) });

  const guardHost = createHostGuard(config.allowedHosts);

  const yoga = createYoga<{ principal: Principal; origin: string }, GraphQLContext>({
    schema: buildSchema(),
    graphqlEndpoint: '/graphql',
    graphiql: !config.production,
    landingPage: false,
    logging: false,
    // The MCP URL shown in the dashboard follows the address the browser actually used.
    context: ({ principal, origin }) => ({ service, principal, origin, config, connection: { ...connection, mcpUrl: config.publicUrl ? connection.mcpUrl : `${origin}/mcp` } }),
  });

  const loginLimiter = new RateLimiter(10, 60_000);
  const agentLimiter = new RateLimiter(40, 60_000);
  const secureCookies = (req: IncomingMessage) => Boolean(config.publicUrl?.startsWith('https://')) || isSecureRequest(req);
  const credentials = { apiToken: config.apiToken, sessionSecret: config.sessionSecret };

  const requireAuth = (req: IncomingMessage): Principal => {
    const principal = authenticate(req, credentials);
    if (!principal) throw new HttpError(401, 'unauthorized', 'Sign in or send the API token as a bearer token.');
    return principal;
  };

  async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    if (pathname === '/api/session' && req.method === 'GET') {
      const principal = authenticate(req, credentials);
      sendJson(res, 200, { authenticated: Boolean(principal), method: principal?.method ?? null, mode: principal?.mode ?? null, demoMode: config.demoMode });
      return;
    }
    if (pathname === '/api/session' && req.method === 'POST') {
      if (!loginLimiter.allow(clientAddress(req))) throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait a minute and try again.');
      const body = await readJson<{ accessKey?: unknown }>(req);
      if (typeof body.accessKey !== 'string' || !safeEqual(body.accessKey.trim(), config.apiToken)) {
        throw new HttpError(401, 'invalid_key', 'That access key is not right.');
      }
      const session = signSession(config.sessionSecret, 'key');
      sendJson(res, 200, { authenticated: true, mode: 'key' }, { 'set-cookie': sessionCookie(session.value, session.maxAge, secureCookies(req)) });
      return;
    }
    if (pathname === '/api/session/demo' && req.method === 'POST') {
      if (!config.demoMode) throw new HttpError(403, 'demo_disabled', 'Demo access is turned off on this server.');
      const session = signSession(config.sessionSecret, 'demo');
      sendJson(res, 200, { authenticated: true, mode: 'demo' }, { 'set-cookie': sessionCookie(session.value, session.maxAge, secureCookies(req)) });
      return;
    }
    if (pathname === '/api/session' && req.method === 'DELETE') {
      sendJson(res, 200, { authenticated: false }, { 'set-cookie': clearedSessionCookie(secureCookies(req)) });
      return;
    }
    if (pathname === '/api/agent/status' && req.method === 'GET') {
      requireAuth(req);
      sendJson(res, 200, connection.planner);
      return;
    }
    if (pathname === '/api/agent/turn' && req.method === 'POST') {
      requireAuth(req);
      if (!agentLimiter.allow(clientAddress(req))) throw new HttpError(429, 'rate_limited', 'Slow down a little, the planner is rate limited.');
      if (!planner) throw new HttpError(501, 'planner_unavailable', 'Amazon Bedrock is not configured. The console uses the local intent engine.');
      const body = await readJson<AgentTurnRequest>(req, 512 * 1024);
      try {
        sendJson(res, 200, await planner.turn(body));
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(400, 'invalid_request', error.message);
        const name = (error as { name?: string }).name ?? 'Error';
        log(`bedrock: ${name}: ${(error as Error).message}`);
        throw new HttpError(502, 'planner_failed', `Amazon Bedrock returned ${name}. The console will fall back to the local intent engine.`);
      }
      return;
    }
    throw new HttpError(404, 'not_found', 'No such endpoint.');
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    applySecurityHeaders(res);
    const pathname = new URL(req.url ?? '/', 'http://local').pathname;
    try {
      if (pathname === '/healthz') {
        sendJson(res, 200, { ok: true, version: config.version, store: config.store });
        return;
      }
      if (pathname === '/internal/guardian-sweep' && req.method === 'POST') {
        // Scheduled sweeps on AWS: EventBridge Scheduler invokes the function, and the
        // Lambda Web Adapter forwards that event here. The schedule's payload carries a secret.
        const body = await readJson<{ secret?: unknown }>(req, 64 * 1024, { anyContentType: true });
        if (typeof body.secret !== 'string' || !safeEqual(body.secret, config.schedulerSecret)) {
          throw new HttpError(401, 'unauthorized', 'Invalid scheduler secret.');
        }
        const policy = await service.policy();
        if (!policy.enabled) {
          sendJson(res, 200, { ok: true, skipped: 'paused' });
          return;
        }
        const report = await service.runGuardian({ type: 'guardian', label: 'Scheduled sweep (EventBridge)' });
        log(`guardian: ${report.speech}`);
        sendJson(res, 200, { ok: true, speech: report.speech, executed: report.executed.length, approvals: report.approvalsRequested.length, flagged: report.flagged.length });
        return;
      }
      if (pathname === '/mcp') {
        if (!guardHost(req, res)) return;
        const principal = authenticate(req, credentials);
        if (!principal) {
          res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="finorchestrate", error="invalid_token"' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Missing or invalid bearer token.' }, id: null }));
          return;
        }
        (req as IncomingMessage & { auth?: unknown }).auth = toAuthInfo(principal, config.apiToken);
        await mcpNode(req, res);
        return;
      }
      if (pathname === '/graphql') {
        if (!guardHost(req, res)) return;
        const principal = requireAuth(req);
        const type = (req.headers['content-type'] ?? '').toLowerCase();
        const streaming = (req.headers.accept ?? '').includes('text/event-stream');
        // Only JSON posts and event-stream subscriptions: a cross site form can produce neither.
        if (req.method === 'POST' && !type.startsWith('application/json')) throw new HttpError(415, 'unsupported_media_type', 'GraphQL requests must be JSON.');
        if (req.method === 'GET' && !streaming && config.production) throw new HttpError(405, 'method_not_allowed', 'Use POST for GraphQL queries.');
        await yoga(req, res, { principal, origin: requestOrigin(req, config.port) });
        return;
      }
      if (pathname.startsWith('/api/')) {
        if (!guardHost(req, res)) return;
        await handleApi(req, res, pathname);
        return;
      }
      if (config.webDist && (await serveStatic(req, res, config.webDist, csp))) return;
      if (pathname === '/' && !config.webDist) {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`FinOrchestrate API is running. MCP endpoint: ${connection.mcpUrl}\nBuild the dashboard with npm run build, or run npm run dev for the live UI.`);
        return;
      }
      throw new HttpError(404, 'not_found', 'Not found.');
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof HttpError) {
        sendError(res, error);
        return;
      }
      log(`unhandled: ${(error as Error).stack ?? String(error)}`);
      sendError(res, new HttpError(500, 'internal_error', 'Something went wrong on the server.'));
    }
  }

  return {
    handle,
    connection,
    close: async () => {
      await mcpHandler.close();
    },
  };
}
