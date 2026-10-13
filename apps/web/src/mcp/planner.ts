import type { CallToolResult } from '@modelcontextprotocol/client';
import { EXAMPLE_UTTERANCES, parseUtterance, type IntentContext } from '@finorchestrate/core';
import type { McpHost } from './host';

/**
 * Turns one utterance into MCP tool calls and a spoken reply.
 *
 * - The local planner uses the deterministic intent engine from the core
 *   package. It works offline and costs nothing.
 * - The Bedrock planner runs a tool use loop: the server asks Amazon Bedrock
 *   (Converse API) what to do, the browser executes the requested tools over
 *   MCP, and the results go back until the model answers.
 */
export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: CallToolResult | null;
  error: string | null;
  durationMs: number;
}

export interface TurnOutcome {
  reply: string;
  calls: ToolCallRecord[];
  planner: 'local' | 'bedrock';
  understood: string | null;
  fallback: string | null;
}

type BedrockBlock = { text?: string; toolUse?: { toolUseId: string; name: string; input: Record<string, unknown> }; toolResult?: unknown };
export type BedrockMessage = { role: 'user' | 'assistant'; content: BedrockBlock[] };

let callCounter = 0;

async function execute(host: McpHost, name: string, args: Record<string, unknown>): Promise<ToolCallRecord> {
  const started = performance.now();
  const id = `call-${(callCounter += 1)}`;
  try {
    const result = await host.callTool(name, args);
    return { id, name, args, result, error: null, durationMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { id, name, args, result: null, error: (error as Error).message, durationMs: Math.round(performance.now() - started) };
  }
}

export function speechOf(record: ToolCallRecord): string {
  if (record.error) return `That did not work: ${record.error}`;
  const structured = record.result?.structuredContent as { speech?: string } | undefined;
  if (structured?.speech) return structured.speech;
  const text = (record.result?.content as Array<{ type: string; text?: string }> | undefined)?.find((block) => block.type === 'text')?.text;
  return text ?? 'Done.';
}

const HELP =
  'I can log expenses and income, tell you how the budget and runway look, forecast cash, check if you can afford something, move money between envelopes, look for unusual charges and run the guardian. Try: ';

export async function runLocal(host: McpHost, text: string, context: IntentContext): Promise<TurnOutcome> {
  const intent = parseUtterance(text, context);
  if (!intent) {
    const examples = EXAMPLE_UTTERANCES.slice(0, 3).map((example) => `"${example}"`).join(', ');
    return { reply: `${HELP}${examples}.`, calls: [], planner: 'local', understood: null, fallback: null };
  }
  const record = await execute(host, intent.tool, intent.arguments);
  return { reply: speechOf(record), calls: [record], planner: 'local', understood: intent.understood, fallback: null };
}

export async function runBedrock(host: McpHost, text: string, history: BedrockMessage[], context: IntentContext): Promise<{ outcome: TurnOutcome; history: BedrockMessage[] }> {
  const messages: BedrockMessage[] = [...history, { role: 'user', content: [{ text }] }];
  const tools = host.tools.map((tool) => ({ name: tool.name, description: tool.description ?? tool.title ?? tool.name, inputSchema: tool.inputSchema as Record<string, unknown> }));
  const calls: ToolCallRecord[] = [];
  try {
    for (let step = 0; step < 6; step += 1) {
      const response = await fetch('/api/agent/turn', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages, tools }),
      });
      // Success carries the model message; failures carry a human readable `message` string.
      const body = (await response.json().catch(() => ({}))) as { stopReason?: string; message?: BedrockMessage | string };
      if (!response.ok || typeof body.message !== 'object') {
        throw new Error(typeof body.message === 'string' ? body.message : 'The planner did not answer.');
      }
      const message = body.message;
      messages.push(message);
      const uses = message.content.filter((block) => block.toolUse).map((block) => block.toolUse!);
      if (body.stopReason !== 'tool_use' || uses.length === 0) {
        const reply = message.content.map((block) => block.text ?? '').join(' ').trim() || (calls.length ? speechOf(calls.at(-1)!) : 'Done.');
        return { outcome: { reply, calls, planner: 'bedrock', understood: null, fallback: null }, history: messages.slice(-16) };
      }
      const results: BedrockBlock[] = [];
      for (const use of uses) {
        const record = await execute(host, use.name, use.input ?? {});
        calls.push(record);
        results.push({
          toolResult: {
            toolUseId: use.toolUseId,
            status: record.error || record.result?.isError ? 'error' : 'success',
            content: [record.result?.structuredContent ? { json: record.result.structuredContent } : { text: speechOf(record) }],
          },
        });
      }
      messages.push({ role: 'user', content: results });
    }
    return {
      outcome: { reply: calls.length ? speechOf(calls.at(-1)!) : 'Done.', calls, planner: 'bedrock', understood: null, fallback: null },
      history: messages.slice(-16),
    };
  } catch (error) {
    const local = await runLocal(host, text, context);
    return { outcome: { ...local, calls: [...calls, ...local.calls], fallback: (error as Error).message }, history };
  }
}
