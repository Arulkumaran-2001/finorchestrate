import type { ActivityEvent, Approval, BudgetTransfer, LedgerSnapshot, Transaction, Workspace } from './types.js';

/**
 * A set of record level writes produced by one service operation. Stores
 * apply it as a unit: the file store rewrites one document, DynamoDB issues
 * batched puts and deletes.
 */
export interface ChangeSet {
  workspace?: Workspace;
  putTransactions?: Transaction[];
  deleteTransactionIds?: string[];
  putTransfers?: BudgetTransfer[];
  putApprovals?: Approval[];
  putActivity?: ActivityEvent[];
}

export interface LedgerRepository {
  /** Returns null when the store has never been initialised. */
  load(): Promise<LedgerSnapshot | null>;
  commit(changes: ChangeSet): Promise<void>;
  /** Replace everything, used for first run seeding and demo resets. */
  replace(snapshot: LedgerSnapshot): Promise<void>;
}

export const ACTIVITY_RETENTION = 400;

export function applyChanges(snapshot: LedgerSnapshot, changes: ChangeSet): LedgerSnapshot {
  const upsert = <T extends { id: string }>(list: T[], items: T[] | undefined): T[] => {
    if (!items || items.length === 0) return list;
    const map = new Map(list.map((item) => [item.id, item]));
    for (const item of items) map.set(item.id, item);
    return [...map.values()];
  };
  const removed = new Set(changes.deleteTransactionIds ?? []);
  const activity = upsert(snapshot.activity, changes.putActivity)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, ACTIVITY_RETENTION);
  return {
    workspace: changes.workspace ?? snapshot.workspace,
    transactions: upsert(snapshot.transactions, changes.putTransactions).filter((tx) => !removed.has(tx.id)),
    transfers: upsert(snapshot.transfers, changes.putTransfers),
    approvals: upsert(snapshot.approvals, changes.putApprovals),
    activity,
  };
}

/** Process local store. Also the base for the JSON file store in the server. */
export class MemoryRepository implements LedgerRepository {
  protected snapshot: LedgerSnapshot | null;

  constructor(initial: LedgerSnapshot | null = null) {
    this.snapshot = initial ? structuredClone(initial) : null;
  }

  async load(): Promise<LedgerSnapshot | null> {
    return this.snapshot ? structuredClone(this.snapshot) : null;
  }

  async commit(changes: ChangeSet): Promise<void> {
    if (!this.snapshot) throw new Error('Ledger is not initialised');
    this.snapshot = applyChanges(this.snapshot, structuredClone(changes));
    await this.persist();
  }

  async replace(snapshot: LedgerSnapshot): Promise<void> {
    this.snapshot = structuredClone(snapshot);
    await this.persist();
  }

  /** Hook for durable subclasses. */
  protected async persist(): Promise<void> {}
}
