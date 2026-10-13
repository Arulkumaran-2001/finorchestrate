import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { EmptyState, ErrorNotice, PageHeader, Panel, Skeleton } from '../../components/display';
import { Field, MoneyInput, Segmented, Select, Slider, Toggle } from '../../components/forms';
import { Icon, type IconName } from '../../components/Icon';
import { useToast } from '../../components/overlays';
import { GUARDIAN_QUERY, RUN_GUARDIAN, UPDATE_POLICY, type Activity, type Policy } from '../../lib/api';
import { parseMoneyInput, timeAgo, whole } from '../../lib/format';
import { useMutation, useQuery } from '../../lib/graphql';
import { ActivityList } from '../shared/ActivityList';
import './guardian.css';

interface GuardianData {
  policy: Policy;
  overview: {
    guardian: { enabled: boolean; lastSweepAt: string | null; nextSweepAt: string | null; autonomousUsedCents: number; autonomousCapCents: number };
    flaggedCount: number;
    pendingApprovals: Array<{ id: string }>;
  };
  activity: Activity[];
}

type ActorFilter = 'all' | 'guardian' | 'assistant' | 'owner';

const INTERVALS = [
  { value: '15', label: 'Every 15 minutes' },
  { value: '30', label: 'Every 30 minutes' },
  { value: '60', label: 'Every hour' },
  { value: '240', label: 'Every 4 hours' },
  { value: '1440', label: 'Once a day' },
  { value: '0', label: 'Only when asked' },
];

function sensitivityLabel(value: number): string {
  if (value <= 2.5) return 'Very sensitive, more alerts';
  if (value <= 3.5) return 'Balanced';
  if (value <= 5) return 'Relaxed';
  return 'Only extreme outliers';
}

export default function GuardianPage() {
  const [limit, setLimit] = useState(60);
  const query = useQuery<GuardianData>(GUARDIAN_QUERY, { limit });
  const sweep = useMutation<{ runGuardian: { speech: string; executedCount: number; approvalsCount: number; flaggedCount: number } }>(RUN_GUARDIAN);
  const update = useMutation<{ updatePolicy: { enabled: boolean } }>(UPDATE_POLICY);
  const toast = useToast();
  const [actor, setActor] = useState<ActorFilter>('all');
  const [lastReport, setLastReport] = useState<string | null>(null);

  if (query.error && !query.data) return <ErrorNotice message={query.error.message} onRetry={query.refetch} />;
  const data = query.data;

  const run = async () => {
    try {
      const result = await sweep.run();
      setLastReport(result.runGuardian.speech);
      toast({ title: 'Sweep complete', detail: result.runGuardian.speech, tone: result.runGuardian.approvalsCount + result.runGuardian.flaggedCount > 0 ? 'warning' : 'success', icon: 'shield' });
    } catch (error) {
      toast({ title: 'Sweep failed', detail: (error as Error).message, tone: 'critical' });
    }
  };

  const setEnabled = async (enabled: boolean) => {
    try {
      await update.run({ input: { enabled } });
      toast({ title: enabled ? 'Guardian resumed' : 'Guardian paused', detail: enabled ? 'Scheduled sweeps are back on.' : 'Nothing moves on its own until you turn it back on.', tone: enabled ? 'success' : 'warning' });
    } catch (error) {
      toast({ title: 'Could not change the guardian', detail: (error as Error).message, tone: 'critical' });
    }
  };

  const guardian = data?.overview.guardian;
  const capShare = guardian && guardian.autonomousCapCents > 0 ? Math.min(1, guardian.autonomousUsedCents / guardian.autonomousCapCents) : 0;
  const activity = (data?.activity ?? []).filter((event) => actor === 'all' || event.actor.type === actor);

  return (
    <div className="guardian">
      <PageHeader
        title="Guardian"
        description="An autonomous agent that keeps envelopes in balance. It acts alone inside your limits, asks above them, and leaves a full audit trail."
        actions={
          <Button variant="primary" icon="shield" loading={sweep.pending} onClick={() => void run()} disabled={!data}>
            Run sweep now
          </Button>
        }
      />

      {!data || !guardian ? (
        <Skeleton height={220} radius={20} />
      ) : (
        <section className={`guardian-status${guardian.enabled ? '' : ' guardian-status--paused'}`} aria-label="Guardian status">
          <div className="guardian-status__main">
            <span className="guardian-status__shield">
              <Icon name="shield" size={28} />
            </span>
            <div className="guardian-status__text">
              <p className="guardian-status__state">{guardian.enabled ? 'Guardian is on' : 'Guardian is paused'}</p>
              <p className="guardian-status__meta">
                Last sweep {guardian.lastSweepAt ? timeAgo(guardian.lastSweepAt) : 'never'}
                {guardian.enabled && guardian.nextSweepAt ? ` · next ${timeAgo(guardian.nextSweepAt)}` : ''}
              </p>
            </div>
            <Toggle checked={guardian.enabled} onChange={(value) => void setEnabled(value)} label={guardian.enabled ? 'On' : 'Off'} disabled={update.pending} />
          </div>
          <div className="guardian-status__grid">
            <div className="guardian-stat">
              <p className="guardian-stat__label">Autonomy used this month</p>
              <p className="guardian-stat__value">
                {whole(guardian.autonomousUsedCents)} <span>of {whole(guardian.autonomousCapCents)}</span>
              </p>
              <div className="guardian-stat__track" role="img" aria-label={`${Math.round(capShare * 100)} percent of the monthly autonomy cap used`}>
                <span style={{ width: `${capShare * 100}%` }} />
              </div>
            </div>
            <div className="guardian-stat">
              <p className="guardian-stat__label">Waiting for you</p>
              <p className="guardian-stat__value">{data.overview.pendingApprovals.length}</p>
              <p className="guardian-stat__hint">approvals</p>
            </div>
            <div className="guardian-stat">
              <p className="guardian-stat__label">Flagged charges</p>
              <p className="guardian-stat__value">{data.overview.flaggedCount}</p>
              <p className="guardian-stat__hint">to review</p>
            </div>
          </div>
          {lastReport ? (
            <p className="guardian-status__report" role="status">
              <Icon name="microphone" size={16} />
              {lastReport}
            </p>
          ) : null}
        </section>
      )}

      {data ? <HowItDecides policy={data.policy} /> : null}

      <div className="grid grid--two">
        <Panel title="Audit trail" subtitle="Every action, who took it and why" icon="clock" id="audit">
          <Segmented<ActorFilter>
            label="Filter by actor"
            size="sm"
            value={actor}
            onChange={setActor}
            options={[
              { value: 'all', label: 'All' },
              { value: 'guardian', label: 'Guardian', icon: 'shield' },
              { value: 'assistant', label: 'Voice', icon: 'microphone' },
              { value: 'owner', label: 'Dashboard', icon: 'overview' },
            ]}
          />
          {!data ? (
            <Skeleton height={320} radius={12} />
          ) : activity.length === 0 ? (
            <EmptyState icon="success" title="Nothing here yet">
              Actions by this actor will appear here.
            </EmptyState>
          ) : (
            <>
              <ActivityList items={activity} />
              {data.activity.length >= limit ? (
                <Button variant="ghost" size="sm" onClick={() => setLimit((value) => value + 60)}>
                  Show older activity
                </Button>
              ) : null}
            </>
          )}
        </Panel>
        {data ? <PolicyForm policy={data.policy} /> : <Skeleton height={520} radius={16} />}
      </div>
    </div>
  );
}

function HowItDecides({ policy }: { policy: Policy }) {
  const steps: Array<{ icon: IconName; title: string; text: string }> = [
    { icon: 'forecast', title: 'Projects every envelope', text: 'Spending so far plus what the rest of a typical month adds, adjusted for the current pace.' },
    {
      icon: 'transfer',
      title: `Moves up to ${whole(policy.autonomousLimitCents)} on its own`,
      text: `From the reserve first (keeping ${whole(policy.reserveFloorCents)} in it), then from envelopes with slack. At most ${whole(policy.monthlyAutonomousCapCents)} a month.`,
    },
    { icon: 'lock', title: 'Asks above that', text: 'Bigger gaps become approvals you can accept by voice, from a card, or here.' },
    { icon: 'anomaly', title: 'Flags odd charges', text: 'Duplicates and outliers against each merchant and envelope history, using a robust z-score.' },
  ];
  return (
    <ol className="how-it-decides" aria-label="How the guardian decides">
      {steps.map((step, index) => (
        <li key={step.title} className="how-it-decides__step">
          <span className="how-it-decides__index">{index + 1}</span>
          <span className="how-it-decides__icon">
            <Icon name={step.icon} size={18} />
          </span>
          <p className="how-it-decides__title">{step.title}</p>
          <p className="how-it-decides__text">{step.text}</p>
        </li>
      ))}
    </ol>
  );
}

function PolicyForm({ policy }: { policy: Policy }) {
  const toast = useToast();
  const update = useMutation<{ updatePolicy: { enabled: boolean } }>(UPDATE_POLICY);
  const initial = useMemo(
    () => ({
      autonomous: String(policy.autonomousLimitCents / 100),
      cap: String(policy.monthlyAutonomousCapCents / 100),
      floor: String(policy.reserveFloorCents / 100),
      voice: String(policy.voiceConfirmAboveCents / 100),
      sensitivity: policy.anomalySensitivity,
      interval: String(policy.sweepIntervalMinutes),
    }),
    [policy],
  );
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const autonomous = parseMoneyInput(form.autonomous);
    const cap = parseMoneyInput(form.cap);
    const floor = form.floor.trim() === '0' ? 0 : parseMoneyInput(form.floor);
    const voice = parseMoneyInput(form.voice);
    const next: Record<string, string> = {};
    if (autonomous === null) next.autonomous = 'Enter an amount';
    if (cap === null) next.cap = 'Enter an amount';
    if (floor === null) next.floor = 'Enter an amount, or 0';
    if (voice === null) next.voice = 'Enter an amount';
    if (autonomous !== null && cap !== null && cap < autonomous) next.cap = 'The monthly cap must be at least the per move limit';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    try {
      await update.run({
        input: {
          autonomousLimitCents: autonomous,
          monthlyAutonomousCapCents: cap,
          reserveFloorCents: floor,
          voiceConfirmAboveCents: voice,
          anomalySensitivity: form.sensitivity,
          sweepIntervalMinutes: Number(form.interval),
        },
      });
      toast({ title: 'Policy saved', detail: 'The guardian uses the new limits from its next sweep.', tone: 'success', icon: 'sliders' });
    } catch (error) {
      toast({ title: 'Could not save the policy', detail: (error as Error).message, tone: 'critical' });
    }
  };

  return (
    <Panel title="Policy" subtitle="The limits the guardian and voice commands work within" icon="sliders" id="policy">
      <form className="form-stack" onSubmit={save} noValidate>
        <div className="form-row">
          <Field label="Per move without asking" error={errors.autonomous} hint="Largest single transfer it makes alone">
            {({ inputId, describedBy, invalid }) => <MoneyInput id={inputId} aria-describedby={describedBy} invalid={invalid} value={form.autonomous} onChange={(event) => set('autonomous', event.target.value)} />}
          </Field>
          <Field label="Monthly autonomy cap" error={errors.cap} hint="Total it may move alone each month">
            {({ inputId, describedBy, invalid }) => <MoneyInput id={inputId} aria-describedby={describedBy} invalid={invalid} value={form.cap} onChange={(event) => set('cap', event.target.value)} />}
          </Field>
        </div>
        <div className="form-row">
          <Field label="Reserve floor" error={errors.floor} hint="The reserve never drops below this">
            {({ inputId, describedBy, invalid }) => <MoneyInput id={inputId} aria-describedby={describedBy} invalid={invalid} value={form.floor} onChange={(event) => set('floor', event.target.value)} />}
          </Field>
          <Field label="Confirm voice moves above" error={errors.voice} hint="Larger spoken moves wait for a yes">
            {({ inputId, describedBy, invalid }) => <MoneyInput id={inputId} aria-describedby={describedBy} invalid={invalid} value={form.voice} onChange={(event) => set('voice', event.target.value)} />}
          </Field>
        </div>
        <Field label="Anomaly sensitivity" hint={`${sensitivityLabel(form.sensitivity)} (modified z-score ${form.sensitivity.toFixed(1)})`}>
          {({ inputId, describedBy }) => (
            <Slider
              id={inputId}
              describedBy={describedBy}
              value={form.sensitivity}
              min={2}
              max={6}
              step={0.5}
              onChange={(value) => set('sensitivity', value)}
              valueText={(value) => `${sensitivityLabel(value)}, ${value.toFixed(1)}`}
              marks={[
                { value: 2, label: 'More alerts' },
                { value: 4, label: 'Balanced' },
                { value: 6, label: 'Fewer' },
              ]}
            />
          )}
        </Field>
        <Field label="Scheduled sweeps" hint="On AWS the same schedule runs from EventBridge">
          {({ inputId }) => <Select id={inputId} value={form.interval} onChange={(value) => set('interval', value)} options={INTERVALS.map((entry) => ({ ...entry, icon: 'clock' as IconName }))} />}
        </Field>
        <div className="policy-actions">
          <Button variant="ghost" onClick={() => setForm(initial)} disabled={!dirty}>
            Discard
          </Button>
          <Button variant="primary" type="submit" loading={update.pending} disabled={!dirty}>
            Save policy
          </Button>
        </div>
      </form>
    </Panel>
  );
}
