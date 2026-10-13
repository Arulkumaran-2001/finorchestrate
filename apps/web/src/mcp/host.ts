import { getToolUiResourceUri } from '@modelcontextprotocol/ext-apps/app-bridge';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';

/**
 * The browser side of the Alexa+ simulator: a real MCP host. It connects to
 * the FinOrchestrate server over Streamable HTTP with the official client SDK,
 * exactly as an Alexa+ connector would, and records every JSON-RPC exchange
 * on the wire for the protocol inspector.
 */
export interface TraceEntry {
  id: string;
  method: string;
  /** Tool name for tools/call, resource URI for resources/read. */
  target?: string;
  startedAt: number;
  durationMs?: number;
  httpStatus?: number;
  status: 'pending' | 'ok' | 'error' | 'notification';
  request: unknown;
  response?: unknown;
  origin: 'console' | 'card';
}

type Listener = () => void;

export interface HostInfo {
  serverName: string;
  serverTitle: string | null;
  serverVersion: string;
  protocolVersion: string | null;
  era: string | null;
  endpoint: string;
  instructions: string | null;
}

let traceCounter = 0;

function parseBody(text: string, contentType: string): unknown[] {
  if (!text) return [];
  if (contentType.includes('text/event-stream')) {
    return text
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => {
        try {
          return JSON.parse(line.slice(5).trim());
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

export class McpHost {
  readonly endpoint = new URL('/mcp', window.location.origin);
  readonly client = new Client({ name: 'finorchestrate-voice-console', title: 'Alexa+ simulator', version: '1.0.0' });
  private transport: StreamableHTTPClientTransport;
  private listeners = new Set<Listener>();
  private origin: 'console' | 'card' = 'console';
  traces: TraceEntry[] = [];
  tools: Tool[] = [];
  info: HostInfo | null = null;
  cardHtml: string | null = null;
  status: 'idle' | 'connecting' | 'ready' | 'error' = 'idle';
  error: string | null = null;

  constructor() {
    this.transport = new StreamableHTTPClientTransport(this.endpoint, { fetch: (input, init) => this.tracedFetch(input, init) });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  /** Requests made while a card is driving the bridge are tagged so the inspector can show who asked. */
  async asCard<T>(work: () => Promise<T>): Promise<T> {
    this.origin = 'card';
    try {
      return await work();
    } finally {
      this.origin = 'console';
    }
  }

  private async tracedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    // The 2025-era client opens an optional standalone SSE stream with GET. This server is
    // stateless and always answers 405, so answer locally instead of logging a failed request.
    if ((init?.method ?? 'GET').toUpperCase() === 'GET') return new Response(null, { status: 405 });
    const started = performance.now();
    const origin = this.origin;
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const messages = parseBody(bodyText, 'application/json') as Array<{ id?: string | number; method?: string; params?: { name?: string; uri?: string } }>;
    const entries: TraceEntry[] = messages
      .filter((message) => message.method)
      .map((message) => ({
        id: `t${(traceCounter += 1)}`,
        method: message.method!,
        target: message.params?.name ?? message.params?.uri,
        startedAt: Date.now(),
        status: message.id === undefined ? 'notification' : 'pending',
        request: message,
        origin,
      }));
    if (entries.length > 0) {
      this.traces = [...entries.reverse(), ...this.traces].slice(0, 200);
      this.emit();
    }
    const response = await fetch(input, { ...init, credentials: 'same-origin' });
    const finish = (payloads: unknown[]) => {
      const elapsed = Math.round(performance.now() - started);
      const byId = new Map(
        (payloads as Array<{ id?: string | number }>).filter((payload) => payload && payload.id !== undefined).map((payload) => [String(payload.id), payload]),
      );
      this.traces = this.traces.map((entry) => {
        if (!entries.includes(entry)) return entry;
        const requestId = (entry.request as { id?: string | number }).id;
        const match = requestId !== undefined ? byId.get(String(requestId)) : undefined;
        const failed = !response.ok || Boolean(match && 'error' in (match as object));
        return {
          ...entry,
          durationMs: elapsed,
          httpStatus: response.status,
          response: match,
          status: entry.status === 'notification' ? 'notification' : failed ? 'error' : 'ok',
        };
      });
      this.emit();
    };
    if (entries.length > 0) {
      const contentType = response.headers.get('content-type') ?? '';
      if (response.status === 202 || !response.body) finish([]);
      else
        void response
          .clone()
          .text()
          .then((text) => finish(parseBody(text, contentType)))
          .catch(() => finish([]));
    }
    return response;
  }

  async connect(): Promise<void> {
    if (this.status === 'ready' || this.status === 'connecting') return;
    this.status = 'connecting';
    this.emit();
    try {
      await this.client.connect(this.transport);
      const server = this.client.getServerVersion();
      this.info = {
        serverName: server?.name ?? 'unknown',
        serverTitle: (server as { title?: string } | undefined)?.title ?? null,
        serverVersion: server?.version ?? '',
        protocolVersion: this.client.getNegotiatedProtocolVersion() ?? null,
        era: this.client.getProtocolEra() ?? null,
        endpoint: this.endpoint.href,
        instructions: this.client.getInstructions() ?? null,
      };
      const { tools } = await this.client.listTools();
      this.tools = tools;
      const uri = tools.map((tool) => getToolUiResourceUri(tool)).find(Boolean);
      if (uri) {
        const resource = await this.client.readResource({ uri });
        const content = resource.contents[0] as { text?: string } | undefined;
        this.cardHtml = content?.text ?? null;
      }
      this.status = 'ready';
    } catch (error) {
      this.status = 'error';
      this.error = (error as Error).message;
    }
    this.emit();
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return (await this.client.callTool({ name, arguments: args })) as CallToolResult;
  }

  toolHasCard(name: string): boolean {
    const tool = this.tools.find((entry) => entry.name === name);
    return Boolean(tool && getToolUiResourceUri(tool));
  }

  clearTrace(): void {
    this.traces = [];
    this.emit();
  }

  private holders = 0;
  private closeTimer: number | undefined;

  /** Keep the connection while at least one view uses it. Survives React's double mount in development. */
  retain(): void {
    this.holders += 1;
    window.clearTimeout(this.closeTimer);
    void this.connect();
  }

  release(): void {
    this.holders = Math.max(0, this.holders - 1);
    if (this.holders > 0) return;
    this.closeTimer = window.setTimeout(() => void this.close(), 250);
  }

  async close(): Promise<void> {
    this.status = 'idle';
    await this.client.close().catch(() => undefined);
  }
}
