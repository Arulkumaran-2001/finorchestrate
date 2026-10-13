import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinanceService, createDemoLedger } from '@finorchestrate/core';
import { BedrockPlanner } from '../src/agent/bedrock.js';
import { createNotifier, shouldNotify } from '../src/notify.js';
import { DynamoRepository } from '../src/store/dynamo-repository.js';

const NOW = new Date('2026-10-13T08:30:00Z');

/** A tiny in-memory DynamoDB table behind the mocked document client. */
function fakeTable() {
  const items = new Map<string, Record<string, unknown>>();
  const documents = mockClient(DynamoDBDocumentClient);
  documents.on(QueryCommand).callsFake((input) => {
    const pk = input.ExpressionAttributeValues[':pk'];
    return { Items: [...items.values()].filter((item) => item.pk === pk) };
  });
  documents.on(BatchWriteCommand).callsFake((input) => {
    for (const request of Object.values(input.RequestItems as Record<string, Array<Record<string, any>>>)[0]!) {
      if (request.PutRequest) items.set(`${request.PutRequest.Item.pk}|${request.PutRequest.Item.sk}`, request.PutRequest.Item);
      if (request.DeleteRequest) items.delete(`${request.DeleteRequest.Key.pk}|${request.DeleteRequest.Key.sk}`);
    }
    return { UnprocessedItems: {} };
  });
  return { items, documents };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DynamoRepository', () => {
  it('round trips a ledger through the single table layout', async () => {
    const { items, documents } = fakeTable();
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
    const repository = new DynamoRepository('finorchestrate', { client });
    const service = new FinanceService({ repository, seed: createDemoLedger, clock: () => NOW });
    await service.init();

    const keys = [...items.keys()];
    expect(keys.some((key) => key.endsWith('|META'))).toBe(true);
    expect(keys.filter((key) => key.includes('|TX#')).length).toBeGreaterThan(100);
    expect([...items.values()].filter((item) => String(item.sk).startsWith('ACT#')).every((item) => typeof item.ttl === 'number')).toBe(true);

    const report = await service.runGuardian({ type: 'guardian', label: 'test' });
    expect(report.executed).toHaveLength(1);
    const reloaded = await repository.load();
    expect(reloaded!.transfers.length).toBe(3);
    expect(reloaded!.approvals.filter((approval) => approval.status === 'pending')).toHaveLength(1);

    const tx = reloaded!.transactions[0]!;
    await service.deleteTransaction(tx.id, { type: 'owner', label: 'test' });
    expect(items.has(`WS#default|TX#${tx.id}`)).toBe(false);
    documents.restore();
  });

  it('retries unprocessed batch items', async () => {
    const documents = mockClient(DynamoDBDocumentClient);
    documents.on(QueryCommand).resolves({ Items: [] });
    let calls = 0;
    documents.on(BatchWriteCommand).callsFake((input) => {
      calls += 1;
      const requests = Object.values(input.RequestItems as Record<string, unknown[]>)[0]!;
      return calls === 1 ? { UnprocessedItems: { finorchestrate: requests.slice(0, 1) } } : { UnprocessedItems: {} };
    });
    const repository = new DynamoRepository('finorchestrate', { client: DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' })) });
    await repository.commit({ putActivity: [{ id: 'evt_1', at: NOW.toISOString(), type: 'policy.updated', severity: 'info', actor: { type: 'owner', label: 't' }, title: 't', detail: 'd' }] });
    expect(calls).toBe(2);
    documents.restore();
  });
});

describe('BedrockPlanner', () => {
  it('sends the conversation and MCP tool specs to the Converse API', async () => {
    const bedrock = mockClient(BedrockRuntimeClient);
    bedrock.on(ConverseCommand).resolves({
      stopReason: 'tool_use',
      output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 't1', name: 'get_runway', input: {} } }] } },
      usage: { inputTokens: 900, outputTokens: 20, totalTokens: 920 },
      metrics: { latencyMs: 410 },
    });
    const planner = new BedrockPlanner('amazon.nova-lite-v1:0', 'us-east-1', new BedrockRuntimeClient({ region: 'us-east-1' }));
    const result = await planner.turn({
      messages: [{ role: 'user', content: [{ text: 'How long is our runway?' }] }],
      tools: [{ name: 'get_runway', description: 'Runway', inputSchema: { type: 'object', properties: {} } }],
    });
    expect(result.stopReason).toBe('tool_use');
    const input = bedrock.commandCalls(ConverseCommand)[0]!.args[0].input;
    expect(input.modelId).toBe('amazon.nova-lite-v1:0');
    expect(input.toolConfig?.tools?.[0]?.toolSpec?.name).toBe('get_runway');
    expect(input.system?.[0]).toHaveProperty('text');
    bedrock.restore();
  });

  it('rejects malformed conversations before calling AWS', async () => {
    const planner = new BedrockPlanner('amazon.nova-lite-v1:0', 'us-east-1', new BedrockRuntimeClient({ region: 'us-east-1' }));
    await expect(planner.turn({ messages: [], tools: [] })).rejects.toThrow(RangeError);
    await expect(planner.turn({ messages: [{ role: 'system' as never, content: [] }], tools: [] })).rejects.toThrow(RangeError);
  });
});

describe('notifier', () => {
  const guardianMove = { id: 'e1', at: NOW.toISOString(), type: 'transfer.executed' as const, severity: 'success' as const, actor: { type: 'guardian' as const, label: 'Scheduled sweep' }, title: 'Moved $170', detail: 'Tooling was trending over.' };
  const ownerMove = { ...guardianMove, id: 'e2', actor: { type: 'owner' as const, label: 'Dashboard' } };
  const logged = { ...guardianMove, id: 'e3', type: 'expense.logged' as const };

  it('only interrupts for guardian actions, approvals and anomalies', () => {
    expect(shouldNotify(guardianMove)).toBe(true);
    expect(shouldNotify(ownerMove)).toBe(false);
    expect(shouldNotify(logged)).toBe(false);
  });

  it('publishes to SNS and the webhook, and survives a failing channel', async () => {
    const sns = mockClient(SNSClient);
    sns.on(PublishCommand).resolves({ MessageId: 'm1' });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('webhook down'));
    const logs: string[] = [];
    const notifier = createNotifier({ snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:finorchestrate', webhookUrl: 'https://hooks.example/finorchestrate', region: 'us-east-1', log: (m) => logs.push(m) });
    await notifier.handle({ at: NOW.toISOString(), activity: [guardianMove, logged] });
    expect(sns.commandCalls(PublishCommand)[0]!.args[0].input.Subject).toContain('Moved $170');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(logs[0]).toContain('webhook down');
    sns.restore();
  });
});
