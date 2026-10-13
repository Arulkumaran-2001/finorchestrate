import { BedrockRuntimeClient, ConverseCommand, type ContentBlock, type Message, type Tool } from '@aws-sdk/client-bedrock-runtime';

/**
 * Model side of the Alexa+ simulator. The browser is the MCP host: it lists
 * the server's tools, sends the conversation here, executes any tool calls the
 * model asks for over MCP, and comes back with the results. Credentials and
 * model access stay on the server.
 */
export interface AgentTurnRequest {
  messages: Message[];
  tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>;
}

export interface AgentTurnResponse {
  stopReason: string;
  message: Message;
  usage: { inputTokens: number; outputTokens: number } | null;
  latencyMs: number | null;
}

export const ASSISTANT_SYSTEM_PROMPT = [
  'You are the voice of FinOrchestrate, a budget guardian for a small product team, speaking through an Alexa+ style device.',
  'Use the tools for every number. Never invent amounts, dates or balances.',
  'Reply in one to three short spoken sentences with no markdown, lists or emoji. Round money to whole dollars unless repeating something the user just said.',
  'Each tool result includes a `speech` field. Build on it, do not contradict it.',
  'If a move comes back as approval_required, ask the user to confirm. Only call resolve_approval after the user clearly says yes or no.',
  'If the request is unrelated to money, budgets or runway, say briefly what you can help with.',
].join(' ');

const MAX_MESSAGES = 24;
const MAX_PAYLOAD_CHARS = 120_000;

export class BedrockPlanner {
  private readonly client: BedrockRuntimeClient;

  constructor(
    readonly modelId: string,
    region: string | null,
    client?: BedrockRuntimeClient,
  ) {
    this.client = client ?? new BedrockRuntimeClient(region ? { region } : {});
  }

  async turn(request: AgentTurnRequest): Promise<AgentTurnResponse> {
    validate(request);
    const tools: Tool[] = request.tools.map((tool) => ({
      toolSpec: {
        name: tool.name,
        description: (tool.description ?? tool.name).slice(0, 1000),
        inputSchema: { json: tool.inputSchema as never },
      },
    }));
    const output = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: ASSISTANT_SYSTEM_PROMPT }],
        messages: request.messages.slice(-MAX_MESSAGES),
        toolConfig: tools.length > 0 ? { tools } : undefined,
        inferenceConfig: { maxTokens: 700, temperature: 0.2 },
      }),
    );
    const message = output.output?.message ?? { role: 'assistant', content: [{ text: 'Sorry, I did not get an answer back.' } as ContentBlock] };
    return {
      stopReason: output.stopReason ?? 'end_turn',
      message,
      usage: output.usage ? { inputTokens: output.usage.inputTokens ?? 0, outputTokens: output.usage.outputTokens ?? 0 } : null,
      latencyMs: output.metrics?.latencyMs ?? null,
    };
  }
}

function validate(request: AgentTurnRequest): void {
  if (!request || !Array.isArray(request.messages) || request.messages.length === 0) throw new RangeError('messages must be a non empty array');
  if (!Array.isArray(request.tools) || request.tools.length > 40) throw new RangeError('tools must be an array of at most 40 entries');
  for (const message of request.messages) {
    if (message.role !== 'user' && message.role !== 'assistant') throw new RangeError('message role must be user or assistant');
    if (!Array.isArray(message.content)) throw new RangeError('message content must be an array');
  }
  if (JSON.stringify(request).length > MAX_PAYLOAD_CHARS) throw new RangeError('conversation is too large');
}
