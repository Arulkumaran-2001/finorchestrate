import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, QueryCommand, type QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import { ACTIVITY_RETENTION, type ChangeSet, type LedgerRepository, type LedgerSnapshot } from '@finorchestrate/core';

/** Activity items expire after this long through the table's TTL attribute. */
const ACTIVITY_TTL_SECONDS = 180 * 24 * 60 * 60;

/**
 * Single table design, one partition per workspace:
 *
 *   pk = WS#<workspace>   sk = META            workspace settings and guardian policy
 *   pk = WS#<workspace>   sk = TX#<id>         transactions
 *   pk = WS#<workspace>   sk = TRF#<id>        budget transfers
 *   pk = WS#<workspace>   sk = APR#<id>        approvals
 *   pk = WS#<workspace>   sk = ACT#<at>#<id>   activity, expires through `ttl`
 *
 * Record bodies live in a `data` attribute so the domain model can evolve
 * without table migrations. A team ledger is small enough to load whole.
 */
export class DynamoRepository implements LedgerRepository {
  private readonly documents: DynamoDBDocumentClient;
  private readonly pk: string;

  constructor(
    private readonly table: string,
    options: { region?: string | null; workspaceId?: string; client?: DynamoDBDocumentClient } = {},
  ) {
    this.documents =
      options.client ??
      DynamoDBDocumentClient.from(new DynamoDBClient(options.region ? { region: options.region } : {}), {
        marshallOptions: { removeUndefinedValues: true },
      });
    this.pk = `WS#${options.workspaceId ?? 'default'}`;
  }

  async load(): Promise<LedgerSnapshot | null> {
    const items = await this.queryAll();
    const meta = items.find((item) => item.sk === 'META');
    if (!meta) return null;
    const pick = <T>(prefix: string) => items.filter((item) => item.sk.startsWith(prefix)).map((item) => item.data as T);
    return {
      workspace: meta.data as LedgerSnapshot['workspace'],
      transactions: pick('TX#'),
      transfers: pick('TRF#'),
      approvals: pick('APR#'),
      activity: pick<LedgerSnapshot['activity'][number]>('ACT#')
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, ACTIVITY_RETENTION),
    };
  }

  async commit(changes: ChangeSet): Promise<void> {
    const expires = Math.floor(Date.now() / 1000) + ACTIVITY_TTL_SECONDS;
    const puts: Array<Record<string, unknown>> = [];
    if (changes.workspace) puts.push({ sk: 'META', data: changes.workspace });
    for (const tx of changes.putTransactions ?? []) puts.push({ sk: `TX#${tx.id}`, data: tx });
    for (const transfer of changes.putTransfers ?? []) puts.push({ sk: `TRF#${transfer.id}`, data: transfer });
    for (const approval of changes.putApprovals ?? []) puts.push({ sk: `APR#${approval.id}`, data: approval });
    for (const event of changes.putActivity ?? []) puts.push({ sk: `ACT#${event.at}#${event.id}`, data: event, ttl: expires });
    const deletes = (changes.deleteTransactionIds ?? []).map((id) => `TX#${id}`);
    await this.batchWrite(puts, deletes);
  }

  async replace(snapshot: LedgerSnapshot): Promise<void> {
    const existing = await this.queryAll();
    await this.batchWrite([], existing.map((item) => item.sk));
    await this.commit({
      workspace: snapshot.workspace,
      putTransactions: snapshot.transactions,
      putTransfers: snapshot.transfers,
      putApprovals: snapshot.approvals,
      putActivity: snapshot.activity,
    });
  }

  private async queryAll(): Promise<Array<{ sk: string; data: unknown }>> {
    const items: Array<{ sk: string; data: unknown }> = [];
    let cursor: QueryCommandOutput['LastEvaluatedKey'];
    do {
      const page = await this.documents.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': this.pk },
          ExclusiveStartKey: cursor,
        }),
      );
      for (const item of page.Items ?? []) items.push({ sk: String(item.sk), data: item.data });
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    return items;
  }

  /** BatchWrite in chunks of 25 with exponential backoff for unprocessed items. */
  private async batchWrite(puts: Array<Record<string, unknown>>, deletes: string[]): Promise<void> {
    const requests = [
      ...deletes.map((sk) => ({ DeleteRequest: { Key: { pk: this.pk, sk } } })),
      ...puts.map((item) => ({ PutRequest: { Item: { pk: this.pk, ...item } } })),
    ];
    for (let index = 0; index < requests.length; index += 25) {
      let pending: typeof requests | undefined = requests.slice(index, index + 25);
      for (let attempt = 0; pending && pending.length > 0; attempt += 1) {
        if (attempt > 6) throw new Error('DynamoDB kept throttling the batch write.');
        const result = await this.documents.send(new BatchWriteCommand({ RequestItems: { [this.table]: pending } }));
        pending = result.UnprocessedItems?.[this.table] as typeof requests | undefined;
        if (pending && pending.length > 0) await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
      }
    }
  }
}
