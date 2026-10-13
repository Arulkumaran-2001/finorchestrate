import { useEffect, useMemo, useState } from 'react';
import { categoryIcons } from '@finorchestrate/icons';
import { Button } from '../../components/Button';
import { EmptyState, ErrorNotice, PageHeader, Skeleton } from '../../components/display';
import { Segmented, Select, TextInput, Toggle, type SelectOption } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { ConfirmDialog, useToast } from '../../components/overlays';
import { Badge, ToneDot } from '../../components/Status';
import { CATEGORIES_QUERY, DELETE_TRANSACTION, REVIEW_TRANSACTION, TRANSACTIONS_QUERY, type CategoryDefinition, type Transaction } from '../../lib/api';
import { money, shortDate, whole } from '../../lib/format';
import { useMutation, useQuery } from '../../lib/graphql';
import { navigate, useLocation } from '../../lib/router';
import { AddTransactionDialog } from '../shared/AddTransactionDialog';
import './transactions.css';

type Direction = 'all' | 'expense' | 'income';

const SOURCE_LABEL: Record<string, string> = { import: 'Bank feed', voice: 'Voice', dashboard: 'Dashboard', api: 'API', guardian: 'Guardian' };
const PAGE = 40;

export default function TransactionsPage() {
  const { search: params } = useLocation();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('all');
  const [direction, setDirection] = useState<Direction>('all');
  const flaggedOnly = params.get('flagged') === '1';
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState<'expense' | 'income' | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const toast = useToast();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => setLimit(PAGE), [debounced, category, direction, flaggedOnly]);

  const filter = useMemo(
    () => ({
      ...(debounced ? { search: debounced } : {}),
      ...(category !== 'all' && category !== 'income' ? { categoryId: category } : {}),
      ...(category === 'income' ? { direction: 'income' } : direction !== 'all' ? { direction } : {}),
      ...(flaggedOnly ? { flaggedOnly: true } : {}),
      limit,
    }),
    [debounced, category, direction, flaggedOnly, limit],
  );
  const page = useQuery<{ transactions: { total: number; totalExpenseCents: number; totalIncomeCents: number; items: Transaction[] } }>(TRANSACTIONS_QUERY, { filter });
  const categories = useQuery<{ categories: CategoryDefinition[] }>(CATEGORIES_QUERY);
  const review = useMutation<{ reviewTransaction: { id: string } }>(REVIEW_TRANSACTION);
  const remove = useMutation<{ deleteTransaction: { id: string } }>(DELETE_TRANSACTION);
  const tones = useMemo(() => Object.fromEntries((categories.data?.categories ?? []).map((entry) => [entry.id, entry.tone])), [categories.data]);

  const options: SelectOption[] = [
    { value: 'all', label: 'All envelopes', icon: 'envelope' },
    ...(categories.data?.categories ?? []).map((entry) => ({ value: entry.id, label: entry.name, tone: entry.tone, icon: categoryIcons[entry.id] })),
    { value: 'income', label: 'Income', icon: 'income' },
  ];

  const setFlagged = (value: boolean) => navigate(value ? '/transactions?flagged=1' : '/transactions', { replace: true });

  const markReviewed = async (tx: Transaction) => {
    try {
      await review.run({ id: tx.id });
      toast({ title: 'Marked as expected', detail: `${tx.merchant}, ${money(tx.amountCents)}. The guardian will not flag it again.`, tone: 'success' });
    } catch (error) {
      toast({ title: 'Could not update the charge', detail: (error as Error).message, tone: 'critical' });
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.run({ id: deleting.id });
      toast({ title: 'Transaction removed', detail: `${deleting.description}, ${money(deleting.amountCents)}.`, tone: 'info' });
      setDeleting(null);
    } catch (error) {
      toast({ title: 'Could not remove it', detail: (error as Error).message, tone: 'critical' });
    }
  };

  const data = page.data?.transactions;
  const filtersActive = Boolean(debounced) || category !== 'all' || direction !== 'all' || flaggedOnly;

  return (
    <div className="transactions">
      <PageHeader
        title="Transactions"
        description="Every charge and payment, whether it came from the bank feed, a voice command or this dashboard."
        actions={
          <>
            <Button icon="income" onClick={() => setAdding('income')}>
              Record income
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setAdding('expense')}>
              Log expense
            </Button>
          </>
        }
      />

      <div className="tx-toolbar" role="search">
        <TextInput
          className="tx-toolbar__search"
          leadingIcon="search"
          placeholder="Search merchant or description"
          aria-label="Search transactions"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          trailing={
            search ? (
              <button type="button" className="tx-toolbar__clear" aria-label="Clear search" onClick={() => setSearch('')}>
                <Icon name="close" size={16} />
              </button>
            ) : undefined
          }
        />
        <div className="tx-toolbar__select">
          <Select value={category} onChange={setCategory} options={options} ariaLabel="Filter by envelope" />
        </div>
        <Segmented<Direction>
          label="Type"
          value={category === 'income' ? 'income' : direction}
          onChange={(value) => {
            setDirection(value);
            if (category === 'income' && value !== 'income') setCategory('all');
          }}
          options={[
            { value: 'all', label: 'All' },
            { value: 'expense', label: 'Expenses' },
            { value: 'income', label: 'Income' },
          ]}
        />
        <Toggle checked={flaggedOnly} onChange={setFlagged} label="Flagged only" />
      </div>

      {data ? (
        <dl className="tx-summary" aria-live="polite">
          <div>
            <dt>Shown</dt>
            <dd>{data.total.toLocaleString('en-US')}</dd>
          </div>
          <div>
            <dt>Spending</dt>
            <dd>{whole(data.totalExpenseCents)}</dd>
          </div>
          <div>
            <dt>Income</dt>
            <dd>{whole(data.totalIncomeCents)}</dd>
          </div>
        </dl>
      ) : null}

      {page.error && !data ? <ErrorNotice message={page.error.message} onRetry={page.refetch} /> : null}

      <section className="tx-list" aria-label="Transactions" aria-busy={page.loading}>
        {!data ? (
          Array.from({ length: 8 }, (_, index) => <Skeleton key={index} height={56} radius={10} />)
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={flaggedOnly ? 'success' : 'search'}
            title={flaggedOnly ? 'No flagged charges' : 'Nothing matches'}
            action={
              filtersActive ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setSearch('');
                    setCategory('all');
                    setDirection('all');
                    setFlagged(false);
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          >
            {flaggedOnly ? 'Every recent charge looks like it belongs. The guardian keeps checking.' : 'Try a different search or envelope.'}
          </EmptyState>
        ) : (
          <>
            <div className="tx-table" role="table" aria-label="Transaction list">
              <div className="tx-table__head" role="row">
                <span role="columnheader">Date</span>
                <span role="columnheader">Description</span>
                <span role="columnheader">Envelope</span>
                <span role="columnheader">Source</span>
                <span role="columnheader" className="tx-table__amount">
                  Amount
                </span>
                <span role="columnheader">
                  <span className="visually-hidden">Actions</span>
                </span>
              </div>
              {data.items.map((tx) => {
                const flagged = tx.status === 'flagged' && !tx.reviewedAt;
                return (
                  <div key={tx.id} className={`tx-row${flagged ? ' tx-row--flagged' : ''}`} role="row">
                    <span className="tx-row__date" role="cell">
                      {shortDate(tx.occurredAt)}
                    </span>
                    <span className="tx-row__main" role="cell">
                      <span className="tx-row__icon">
                        <Icon name={tx.direction === 'income' ? 'income' : (categoryIcons[tx.categoryId] ?? 'receipt')} size={18} />
                      </span>
                      <span className="tx-row__text">
                        <span className="tx-row__description">{tx.description}</span>
                        <span className="tx-row__merchant">
                          {tx.merchant}
                          <span className="tx-row__mobile-meta">
                            {' '}
                            · {shortDate(tx.occurredAt)} · {tx.categoryName}
                          </span>
                        </span>
                        {flagged && tx.anomaly ? (
                          <span className="tx-row__anomaly">
                            <Icon name={tx.anomaly.kind === 'duplicate' ? 'duplicate' : 'anomaly'} size={14} />
                            {tx.anomaly.reason}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="tx-row__category" role="cell">
                      {tx.direction === 'income' ? <span className="tx-row__income-dot" aria-hidden="true" /> : <ToneDot tone={tones[tx.categoryId] ?? 'series-1'} />}
                      {tx.categoryName}
                    </span>
                    <span className="tx-row__source" role="cell">
                      {flagged ? <Badge tone="warning">Flagged</Badge> : <Badge>{SOURCE_LABEL[tx.source] ?? tx.source}</Badge>}
                    </span>
                    <span className={`tx-row__amount tx-table__amount${tx.direction === 'income' ? ' tx-row__amount--income' : ''}`} role="cell">
                      {tx.direction === 'income' ? '+' : ''}
                      {money(tx.amountCents)}
                    </span>
                    <span className="tx-row__actions" role="cell">
                      {flagged ? (
                        <Button size="sm" variant="quiet" icon="check" onClick={() => void markReviewed(tx)}>
                          Expected
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" icon="trash" iconOnlyLabel={`Delete ${tx.description}`} onClick={() => setDeleting(tx)} />
                    </span>
                  </div>
                );
              })}
            </div>
            {data.total > data.items.length ? (
              <div className="tx-more">
                <Button onClick={() => setLimit((value) => value + PAGE)} loading={page.loading}>
                  Show more ({data.total - data.items.length} left)
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <AddTransactionDialog open={adding !== null} initialKind={adding ?? 'expense'} onClose={() => setAdding(null)} />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this transaction?"
        description={deleting ? `${deleting.description} for ${money(deleting.amountCents)} on ${shortDate(deleting.occurredAt)} will be removed from the ledger. Budgets and runway update right away.` : ''}
        confirmLabel="Delete"
        tone="danger"
        pending={remove.pending}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
