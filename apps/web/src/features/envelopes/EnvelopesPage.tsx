import { useEffect, useState, type FormEvent } from 'react';
import { categoryIcons } from '@finorchestrate/icons';
import { EnvelopeMeter, MeterLegend } from '../../charts/charts';
import { Button } from '../../components/Button';
import { EmptyState, ErrorNotice, PageHeader, Panel, Skeleton } from '../../components/display';
import { Field, MoneyInput, Select, TextInput } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { Dialog, useToast } from '../../components/overlays';
import { HealthPill, ToneDot } from '../../components/Status';
import { ENVELOPES_QUERY, MOVE_BUDGET, SET_LIMIT, type Approval, type CategoryStatus } from '../../lib/api';
import { parseMoneyInput, whole } from '../../lib/format';
import { useMutation, useQuery } from '../../lib/graphql';
import { ApprovalItem } from '../shared/ApprovalItem';
import './envelopes.css';

interface EnvelopesData {
  overview: { periodLabel: string; totals: { limitCents: number; spentCents: number; projectedCents: number; daysRemaining: number }; categories: CategoryStatus[] };
  approvals: Approval[];
  categories: Array<{ id: string; description: string; monthlyLimitCents: number }>;
}

export default function EnvelopesPage() {
  const query = useQuery<EnvelopesData>(ENVELOPES_QUERY);
  const [moving, setMoving] = useState<{ from?: string; to?: string } | null>(null);

  if (query.error && !query.data) return <ErrorNotice message={query.error.message} onRetry={query.refetch} />;
  const data = query.data;
  const pending = data?.approvals.filter((approval) => approval.status === 'pending') ?? [];
  const history = data?.approvals.filter((approval) => approval.status !== 'pending').slice(0, 4) ?? [];

  return (
    <div className="envelopes">
      <PageHeader
        title="Envelopes"
        description="Each envelope is a monthly limit. Moves between them are audited, and the guardian only rebalances inside the autonomy limit you set."
        actions={
          <Button variant="primary" icon="transfer" onClick={() => setMoving({})} disabled={!data}>
            Move money
          </Button>
        }
      />
      {data ? (
        <dl className="envelopes__totals">
          <div>
            <dt>{data.overview.periodLabel}</dt>
            <dd>
              {whole(data.overview.totals.spentCents)} <span>of {whole(data.overview.totals.limitCents)} spent</span>
            </dd>
          </div>
          <div>
            <dt>Projected month end</dt>
            <dd>{whole(data.overview.totals.projectedCents)}</dd>
          </div>
          <div>
            <dt>Days left</dt>
            <dd>{data.overview.totals.daysRemaining}</dd>
          </div>
        </dl>
      ) : null}

      {pending.length > 0 ? (
        <Panel title="Waiting for your approval" subtitle="Above the autonomy limit, so the guardian asked first" icon="lock" id="pending">
          <div className="envelopes__approvals">
            {pending.map((approval) => (
              <ApprovalItem key={approval.id} approval={approval} />
            ))}
          </div>
        </Panel>
      ) : null}

      <section aria-label="Envelopes" className="envelope-grid">
        {!data
          ? Array.from({ length: 6 }, (_, index) => <Skeleton key={index} height={300} radius={16} />)
          : [...data.overview.categories]
              .sort((a, b) => (a.kind === b.kind ? b.limitCents - a.limitCents : a.kind === 'reserve' ? 1 : -1))
              .map((category) => (
                <EnvelopeCard
                  key={category.id}
                  category={category}
                  description={data.categories.find((entry) => entry.id === category.id)?.description ?? ''}
                  plannedCents={data.categories.find((entry) => entry.id === category.id)?.monthlyLimitCents ?? category.plannedCents}
                  onMoveFrom={() => setMoving({ from: category.id })}
                  onMoveTo={() => setMoving({ to: category.id })}
                />
              ))}
      </section>
      {data ? <MeterLegend /> : null}

      <Panel title="Recent decisions" subtitle="Approved, rejected or expired changes" icon="clock" id="history">
        {history.length === 0 ? (
          <EmptyState icon="success" title="No decisions yet">
            Approvals you resolve show up here with who decided and when.
          </EmptyState>
        ) : (
          <div className="envelopes__approvals envelopes__approvals--history">
            {history.map((approval) => (
              <ApprovalItem key={approval.id} approval={approval} compact />
            ))}
          </div>
        )}
      </Panel>

      {data ? <MoveDialog open={moving !== null} initial={moving ?? {}} categories={data.overview.categories} onClose={() => setMoving(null)} /> : null}
    </div>
  );
}

function EnvelopeCard({
  category,
  description,
  plannedCents,
  onMoveFrom,
  onMoveTo,
}: {
  category: CategoryStatus;
  description: string;
  plannedCents: number;
  onMoveFrom: () => void;
  onMoveTo: () => void;
}) {
  const toast = useToast();
  const setLimit = useMutation<{ setCategoryLimit: { id: string } }>(SET_LIMIT);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const net = category.transfersInCents - category.transfersOutCents;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const cents = parseMoneyInput(value);
    if (cents === null) {
      setError('Enter a monthly amount such as 2,400');
      return;
    }
    try {
      await setLimit.run({ id: category.id, cents });
      toast({ title: `${category.name} limit updated`, detail: `Now ${whole(cents)} per month.`, tone: 'success' });
      setEditing(false);
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  return (
    <article className={`envelope-card envelope-card--${category.health}`}>
      <header className="envelope-card__header">
        <span className="envelope-card__icon">
          <Icon name={categoryIcons[category.id] ?? 'envelope'} size={20} />
        </span>
        <div className="envelope-card__title">
          <h2>
            <ToneDot tone={category.tone} /> {category.name}
          </h2>
          <p>{category.kind === 'reserve' ? 'Reserve, drawn on first by the guardian' : `${category.transactionCount} ${category.transactionCount === 1 ? 'charge' : 'charges'} this month`}</p>
        </div>
        <HealthPill health={category.health} compact />
      </header>
      <p className="envelope-card__figure">
        {whole(Math.abs(category.remainingCents))}
        <span>{category.remainingCents >= 0 ? 'left this month' : 'over the limit'}</span>
      </p>
      <EnvelopeMeter
        spentCents={category.spentCents}
        limitCents={category.limitCents}
        projectedCents={category.projectedCents}
        health={category.health}
        label={`${category.name}: spent ${whole(category.spentCents)} of ${whole(category.limitCents)}, projected ${whole(category.projectedCents)}`}
      />
      <dl className="envelope-card__facts">
        <div>
          <dt>Spent</dt>
          <dd>{whole(category.spentCents)}</dd>
        </div>
        <div>
          <dt>Projected</dt>
          <dd>{category.kind === 'reserve' ? 'n/a' : whole(category.projectedCents)}</dd>
        </div>
        <div>
          <dt>Limit</dt>
          <dd>{whole(category.limitCents)}</dd>
        </div>
        <div>
          <dt>Moves</dt>
          <dd className={net > 0 ? 'envelope-card__in' : net < 0 ? 'envelope-card__out' : ''}>{net === 0 ? 'None' : `${net > 0 ? '+' : '-'}${whole(Math.abs(net))}`}</dd>
        </div>
      </dl>
      {description ? <p className="envelope-card__description">{description}</p> : null}
      {editing ? (
        <form className="envelope-card__edit" onSubmit={save} noValidate>
          <Field label="Monthly plan" error={error} hint={`Currently ${whole(plannedCents)} before moves`}>
            {({ inputId, describedBy, invalid }) => (
              <MoneyInput id={inputId} aria-describedby={describedBy} invalid={invalid} value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
            )}
          </Field>
          <div className="envelope-card__actions">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" loading={setLimit.pending}>
              Save limit
            </Button>
          </div>
        </form>
      ) : (
        <div className="envelope-card__actions">
          <Button
            size="sm"
            icon="pencil"
            onClick={() => {
              setValue(String(plannedCents / 100));
              setError(null);
              setEditing(true);
            }}
          >
            Edit plan
          </Button>
          <Button size="sm" variant="ghost" icon="transfer" onClick={category.remainingCents > 0 ? onMoveFrom : onMoveTo}>
            {category.remainingCents > 0 ? 'Move out' : 'Top up'}
          </Button>
        </div>
      )}
    </article>
  );
}

function MoveDialog({ open, initial, categories, onClose }: { open: boolean; initial: { from?: string; to?: string }; categories: CategoryStatus[]; onClose: () => void }) {
  const toast = useToast();
  const move = useMutation<{ moveBudget: { status: string; speech: string } }>(MOVE_BUDGET);
  const reserve = categories.find((category) => category.kind === 'reserve')?.id ?? categories[0]?.id ?? '';
  const [from, setFrom] = useState(reserve);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const fromId = initial.from ?? (initial.to === reserve ? (categories.find((c) => c.id !== reserve)?.id ?? '') : reserve);
    setFrom(fromId);
    setTo(initial.to ?? categories.find((category) => category.id !== fromId && (category.health === 'over' || category.health === 'at_risk'))?.id ?? categories.find((c) => c.id !== fromId)?.id ?? '');
    setAmount('');
    setReason('');
    setError(null);
  }, [open, initial, categories, reserve]);

  const source = categories.find((category) => category.id === from);
  const target = categories.find((category) => category.id === to);
  const unspent = source ? Math.max(0, source.limitCents - source.spentCents) : 0;
  const gap = target ? Math.max(0, target.projectedCents - target.limitCents) : 0;
  const options = categories.map((category) => ({ value: category.id, label: category.name, tone: category.tone, description: `${whole(Math.max(0, category.limitCents - category.spentCents))} unspent` }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cents = parseMoneyInput(amount);
    if (from === to) return setError('Pick two different envelopes.');
    if (cents === null) return setError('Enter an amount such as 150.');
    if (cents > unspent) return setError(`${source?.name} only has ${whole(unspent)} unspent this month.`);
    try {
      const result = await move.run({ input: { fromCategoryId: from, toCategoryId: to, amountCents: cents, ...(reason.trim() ? { reason: reason.trim() } : {}) } });
      toast({ title: 'Budget moved', detail: result.moveBudget.speech, tone: 'success', icon: 'transfer' });
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Move money between envelopes"
      description="Changes this month's limits only. The plan resets next month."
      icon="transfer"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="move-money" loading={move.pending}>
            Move money
          </Button>
        </>
      }
    >
      <form id="move-money" className="form-stack" onSubmit={submit} noValidate>
        <div className="form-row">
          <Field label="From">{({ inputId }) => <Select id={inputId} value={from} onChange={setFrom} options={options} />}</Field>
          <Field label="To">{({ inputId }) => <Select id={inputId} value={to} onChange={setTo} options={options} />}</Field>
        </div>
        <Field
          label="Amount"
          error={error}
          hint={
            <>
              {whole(unspent)} unspent in {source?.name ?? 'the source'}
              {gap > 0 ? `. ${target?.name} is projected ${whole(gap)} over.` : '.'}
            </>
          }
        >
          {({ inputId, describedBy, invalid }) => (
            <MoneyInput id={inputId} aria-describedby={describedBy} invalid={invalid} value={amount} onChange={(event) => setAmount(event.target.value)} data-autofocus />
          )}
        </Field>
        {gap > 0 && gap <= unspent ? (
          <button type="button" className="suggestion" onClick={() => setAmount(String(Math.ceil(gap / 1000) * 10))}>
            <Icon name="forecast" size={16} />
            Cover the projected gap: {whole(Math.ceil(gap / 1000) * 1000)}
          </button>
        ) : null}
        <Field label="Reason" optional>
          {({ inputId }) => <TextInput id={inputId} maxLength={140} placeholder="GPU training run for the launch demo" value={reason} onChange={(event) => setReason(event.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
}
