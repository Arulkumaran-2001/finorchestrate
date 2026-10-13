import { useEffect, useState } from 'react';
import { categoryIcons } from '@finorchestrate/icons';
import { CashOutlookChart, ChartFrame, EnvelopeMeter, FlowChart, FlowLegend, MeterLegend, OutlookLegend, Sparkline } from '../../charts/charts';
import { Button } from '../../components/Button';
import { EmptyState, ErrorNotice, PageHeader, Panel, Skeleton, StatTile } from '../../components/display';
import { Slider } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/overlays';
import { HealthPill, ToneDot } from '../../components/Status';
import { FORECAST_QUERY, OVERVIEW_QUERY, RUN_GUARDIAN, type Forecast, type Overview, type Runway } from '../../lib/api';
import { monthYear, percent, shortDate, timeAgo, whole } from '../../lib/format';
import { useMutation, useQuery } from '../../lib/graphql';
import { ROUTES, navigate } from '../../lib/router';
import { ActivityList } from '../shared/ActivityList';
import { AddTransactionDialog } from '../shared/AddTransactionDialog';
import { ApprovalItem } from '../shared/ApprovalItem';
import './overview.css';

function useDebounced<T>(value: T, delay = 180): T {
  const [state, setState] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setState(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return state;
}

export default function OverviewPage() {
  const overview = useQuery<{ overview: Overview }>(OVERVIEW_QUERY);
  const [stress, setStress] = useState(0);
  const debouncedStress = useDebounced(stress);
  const scenario = useQuery<{ forecast: Forecast; runway: Runway }>(FORECAST_QUERY, { months: 6, stress: debouncedStress });
  const sweep = useMutation<{ runGuardian: { speech: string; executedCount: number; approvalsCount: number; flaggedCount: number } }>(RUN_GUARDIAN);
  const toast = useToast();
  const [adding, setAdding] = useState(false);

  if (overview.error && !overview.data) return <ErrorNotice message={overview.error.message} onRetry={overview.refetch} />;
  const data = overview.data?.overview;
  if (!data) return <OverviewSkeleton />;

  const runway = scenario.data?.runway ?? data.runway;
  const forecast = scenario.data?.forecast ?? data.forecast;
  const atRisk = data.categories.filter((category) => category.health === 'at_risk' || category.health === 'over');
  const attention = data.pendingApprovals.length + (data.flaggedCount > 0 ? 1 : 0);
  const summary =
    atRisk.length > 0
      ? `${atRisk.map((category) => category.name).join(' and ')} ${atRisk.length > 1 ? 'are' : 'is'} trending over this month.`
      : 'Every envelope is on track this month.';

  const runSweep = async () => {
    try {
      const result = await sweep.run();
      toast({ title: 'Guardian sweep complete', detail: result.runGuardian.speech, tone: result.runGuardian.approvalsCount > 0 || result.runGuardian.flaggedCount > 0 ? 'warning' : 'success', icon: 'shield' });
    } catch (error) {
      toast({ title: 'Sweep failed', detail: (error as Error).message, tone: 'critical' });
    }
  };

  const spentShare = data.totals.limitCents > 0 ? data.totals.spentCents / data.totals.limitCents : 0;
  const cashTrend = data.cashHistory.slice(-45).map((point) => point.cashCents);

  return (
    <div className="overview">
      <PageHeader
        eyebrow={
          <>
            <Icon name="calendar" size={16} />
            {data.periodLabel} · {data.totals.daysRemaining} days left
          </>
        }
        title={`${data.workspaceName} at a glance`}
        description={`${summary} ${attention > 0 ? `${attention} ${attention === 1 ? 'item needs' : 'items need'} your decision.` : 'Nothing needs your decision.'}`}
        actions={
          <>
            <Button icon="shield" loading={sweep.pending} onClick={() => void runSweep()}>
              Run guardian
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
              Log expense
            </Button>
          </>
        }
      />

      <div className="grid grid--two">
        <section className="runway-hero" aria-labelledby="runway-title">
          <div className="runway-hero__top">
            <span className="runway-hero__badge">
              <Icon name="runway" size={18} />
              <span id="runway-title">Runway</span>
            </span>
            {runway.stressPercent !== 0 ? <span className="runway-hero__scenario">Scenario: spending +{runway.stressPercent}%</span> : null}
          </div>
          <p className="runway-hero__figure">
            {runway.months === null ? (
              'Cash positive'
            ) : (
              <>
                {runway.months.toFixed(1)}
                <span className="runway-hero__unit">months</span>
              </>
            )}
          </p>
          <p className="runway-hero__caption">
            {runway.zeroCashDate ? (
              <>
                Cash lasts until <strong>{monthYear(runway.zeroCashDate)}</strong> at a net burn of <strong>{whole(runway.monthlyNetBurnCents)}</strong> a month.
              </>
            ) : (
              'Income covers spending, so cash is growing.'
            )}
          </p>
          <dl className="runway-hero__facts">
            <div>
              <dt>Cash on hand</dt>
              <dd>{whole(runway.cashCents)}</dd>
            </div>
            <div>
              <dt>Spend / month</dt>
              <dd>{whole(runway.monthlyExpenseCents)}</dd>
            </div>
            <div>
              <dt>If income stopped</dt>
              <dd>{runway.grossMonths === null ? 'n/a' : `${runway.grossMonths.toFixed(1)} mo`}</dd>
            </div>
          </dl>
          <div className="runway-hero__scenario-control">
            <p className="runway-hero__label" id="stress-label">
              What if spending rises?
            </p>
            <Slider
              value={stress}
              min={0}
              max={60}
              step={5}
              onChange={setStress}
              label="Simulated rise in spending"
              describedBy="stress-label"
              valueText={(value) => `${value} percent`}
              marks={[
                { value: 0, label: 'Today' },
                { value: 20, label: '+20%' },
                { value: 40, label: '+40%' },
                { value: 60, label: '+60%' },
              ]}
            />
          </div>
        </section>

        <Panel
          title="Needs your decision"
          subtitle="Approvals the guardian could not make alone, and charges that look wrong"
          icon="lock"
          id="attention"
          className="attention"
        >
          {data.pendingApprovals.length === 0 && data.flaggedCount === 0 ? (
            <EmptyState icon="success" title="You are all caught up">
              The guardian handled everything inside its autonomy limit.
            </EmptyState>
          ) : (
            <div className="attention__list">
              {data.pendingApprovals.slice(0, 2).map((approval) => (
                <ApprovalItem key={approval.id} approval={approval} compact />
              ))}
              {data.flaggedCount > 0 ? (
                <button type="button" className="attention__flagged" onClick={() => navigate(`${ROUTES.transactions}?flagged=1`)}>
                  <span className="attention__flagged-icon">
                    <Icon name="anomaly" size={20} />
                  </span>
                  <span className="attention__flagged-text">
                    <strong>
                      {data.flaggedCount} unusual {data.flaggedCount === 1 ? 'charge' : 'charges'}
                    </strong>
                    <span>{whole(data.flaggedCents)} flagged for review</span>
                  </span>
                  <Icon name="chevronRight" size={18} />
                </button>
              ) : null}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid--stats overview__stats">
        <StatTile
          label="Cash on hand"
          icon="wallet"
          value={whole(data.cashCents)}
          detail={`Net burn ${whole(data.runway.monthlyNetBurnCents)} a month`}
          trend={<Sparkline values={cashTrend} label={`Cash over the last 45 days, now ${whole(data.cashCents)}`} />}
        />
        <StatTile
          label="Spent this month"
          icon="receipt"
          value={whole(data.totals.spentCents)}
          detail={`${percent(spentShare)} of ${whole(data.totals.limitCents)} with ${data.totals.daysRemaining} days left`}
          trend={<EnvelopeMeter spentCents={data.totals.spentCents} limitCents={data.totals.limitCents} projectedCents={data.totals.projectedCents} health={data.totals.projectedCents > data.totals.limitCents ? 'at_risk' : 'healthy'} label="Total monthly budget" size="sm" />}
        />
        <StatTile
          label="Projected month end"
          icon="forecast"
          tone={data.totals.projectedCents > data.totals.limitCents ? 'warning' : 'good'}
          value={whole(data.totals.projectedCents)}
          detail={
            data.totals.projectedCents > data.totals.limitCents
              ? `${whole(data.totals.projectedCents - data.totals.limitCents)} over plan at this pace`
              : `${whole(data.totals.limitCents - data.totals.projectedCents)} under plan`
          }
        />
        <StatTile
          label="Guardian autonomy"
          icon="shield"
          tone={data.guardian.enabled ? 'good' : 'warning'}
          value={`${whole(data.guardian.autonomousUsedCents)} / ${whole(data.guardian.autonomousCapCents)}`}
          detail={
            data.guardian.enabled
              ? `Last sweep ${data.guardian.lastSweepAt ? timeAgo(data.guardian.lastSweepAt) : 'never'}${data.guardian.nextSweepAt ? `, next ${timeAgo(data.guardian.nextSweepAt)}` : ''}`
              : 'Paused. Open Guardian to resume.'
          }
        />
      </div>

      <Panel
        title="Cash outlook"
        subtitle={`Actual cash for 120 days, then the next 6 months. ${forecast.shortfallProbability < 0.01 ? 'Chance of running out: under 1%.' : `Chance of running out: ${Math.round(forecast.shortfallProbability * 100)}%.`}`}
        icon="forecast"
        id="outlook"
      >
        <ChartFrame
          caption="Cash outlook"
          chart={<CashOutlookChart history={data.cashHistory} forecast={forecast.points} />}
          table={
            <table>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Pessimistic</th>
                  <th scope="col">Most likely</th>
                  <th scope="col">Optimistic</th>
                </tr>
              </thead>
              <tbody>
                {forecast.points.map((point) => (
                  <tr key={point.date}>
                    <td>{monthYear(point.date)}</td>
                    <td>{whole(point.p10Cents)}</td>
                    <td>{whole(point.p50Cents)}</td>
                    <td>{whole(point.p90Cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
        <OutlookLegend />
      </Panel>

      <div className="grid grid--two">
        <Panel
          title="Envelopes"
          subtitle={`${data.periodLabel}, sorted by concern`}
          icon="envelope"
          id="envelopes"
          actions={
            <Button variant="ghost" size="sm" iconAfter="chevronRight" onClick={() => navigate(ROUTES.envelopes)}>
              Manage
            </Button>
          }
        >
          <ul className="envelope-list">
            {[...data.categories]
              .sort((a, b) => b.projectedUtilization - a.projectedUtilization)
              .map((category) => (
                <li key={category.id} className="envelope-row">
                  <div className="envelope-row__top">
                    <ToneDot tone={category.tone} />
                    <Icon name={categoryIcons[category.id] ?? 'envelope'} size={16} className="envelope-row__icon" />
                    <span className="envelope-row__name">{category.name}</span>
                    <HealthPill health={category.health} compact />
                  </div>
                  <EnvelopeMeter
                    spentCents={category.spentCents}
                    limitCents={category.limitCents}
                    projectedCents={category.projectedCents}
                    health={category.health}
                    label={`${category.name}: spent ${whole(category.spentCents)} of ${whole(category.limitCents)}, projected ${whole(category.projectedCents)}`}
                  />
                  <div className="envelope-row__numbers">
                    <span>
                      <strong>{whole(category.spentCents)}</strong> of {whole(category.limitCents)}
                    </span>
                    <span>Projected {whole(category.projectedCents)}</span>
                  </div>
                </li>
              ))}
          </ul>
          <MeterLegend />
        </Panel>

        <div className="stack">
          <Panel title="Income and spending" subtitle="Last six months" icon="pulse" id="flows">
            <ChartFrame
              caption="Monthly income and spending"
              chart={<FlowChart flows={data.flows} />}
              table={
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Month</th>
                      <th scope="col">Income</th>
                      <th scope="col">Spending</th>
                      <th scope="col">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.flows.map((flow) => (
                      <tr key={flow.period}>
                        <td>
                          {flow.label}
                          {flow.complete ? '' : ' (to date)'}
                        </td>
                        <td>{whole(flow.incomeCents)}</td>
                        <td>{whole(flow.expenseCents)}</td>
                        <td>{whole(flow.incomeCents - flow.expenseCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            />
            <FlowLegend />
          </Panel>
          <Panel
            title="Recent activity"
            subtitle="Voice, dashboard and guardian, in one trail"
            icon="clock"
            id="activity"
            actions={
              <Button variant="ghost" size="sm" iconAfter="chevronRight" onClick={() => navigate(ROUTES.guardian)}>
                Audit trail
              </Button>
            }
          >
            <ActivityList items={data.recentActivity.slice(0, 5)} showDetail={false} />
          </Panel>
        </div>
      </div>
      <p className="overview__updated">Updated {shortDate(data.generatedAt)}, {new Date(data.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
      <AddTransactionDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="overview" aria-busy="true" aria-label="Loading overview">
      <div className="overview__skeleton-header">
        <Skeleton width={180} height={14} />
        <Skeleton width="60%" height={34} radius={8} />
      </div>
      <div className="grid grid--two">
        <Skeleton height={340} radius={20} />
        <Skeleton height={340} radius={16} />
      </div>
      <div className="grid grid--stats">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} height={140} radius={16} />
        ))}
      </div>
    </div>
  );
}
