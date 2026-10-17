import type {
  AffordabilityCard,
  ApprovalsCard,
  AuditCard,
  BriefingCard,
  BudgetCard,
  Card,
  CardApproval,
  CardCategory,
  CardFinding,
  CardLeg,
  ExpenseCard,
  ForecastCard,
  IncomeCard,
  MoveCard,
  ResolutionCard,
  RunwayCard,
  SweepCard,
} from '@finorchestrate/core';
import { formatMoney } from '@finorchestrate/core';
import { categoryIcons, iconSvg, type IconName } from '@finorchestrate/icons';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const money = (cents: number) => escapeHtml(formatMoney(cents, { style: Math.abs(cents) >= 100000 ? 'whole' : 'auto' }));
const whole = (cents: number) => escapeHtml(formatMoney(cents, { style: 'whole' }));
const date = (iso: string) => escapeHtml(new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }));
const months = (value: number | null) => (value === null ? 'Cash positive' : `${value.toFixed(1)} months`);

const HEALTH: Record<CardCategory['health'], { icon: IconName; label: string }> = {
  healthy: { icon: 'success', label: 'On track' },
  watch: { icon: 'clock', label: 'Watch' },
  'at-risk': { icon: 'warning', label: 'At risk' },
  over: { icon: 'critical', label: 'Over limit' },
};

function header(icon: IconName, eyebrow: string, title: string, aside = ''): string {
  return `<header class="fo-card__header">
    <span class="fo-card__glyph">${iconSvg(icon, 20)}</span>
    <div class="fo-card__heading">
      <p class="fo-card__eyebrow">${escapeHtml(eyebrow)}</p>
      <h1 class="fo-card__title">${title}</h1>
    </div>
    ${aside}
  </header>`;
}

function pill(health: CardCategory['health']): string {
  const meta = HEALTH[health];
  return `<span class="fo-pill fo-pill--${health}">${iconSvg(meta.icon, 14)}<span>${meta.label}</span></span>`;
}

/** Spent fill, projected tick and limit line on one scale. Widths are applied after render through CSSOM. */
function meter(category: Pick<CardCategory, 'spentCents' | 'limitCents' | 'projectedCents' | 'health'>, label: string): string {
  const scale = Math.max(category.limitCents, category.projectedCents, category.spentCents, 1);
  const pct = (value: number) => Math.max(0, Math.min(100, (value / scale) * 100)).toFixed(2);
  return `<div class="fo-meter fo-meter--${category.health}" role="img" aria-label="${escapeHtml(label)}">
    <span class="fo-meter__projection" data-width="${pct(category.projectedCents)}"></span>
    <span class="fo-meter__fill" data-width="${pct(category.spentCents)}"></span>
    <span class="fo-meter__limit" data-left="${pct(category.limitCents)}"></span>
  </div>`;
}

function categoryRow(category: CardCategory, focused = false): string {
  const label = `${category.name}: spent ${formatMoney(category.spentCents)} of ${formatMoney(category.limitCents)}, projected ${formatMoney(category.projectedCents, { style: 'whole' })}`;
  const remaining =
    category.remainingCents >= 0 ? `${whole(category.remainingCents)} left` : `${whole(-category.remainingCents)} over`;
  return `<li class="fo-envelope${focused ? ' fo-envelope--focused' : ''}">
    <div class="fo-envelope__top">
      <span class="fo-envelope__swatch fo-tone--${escapeHtml(category.tone)}"></span>
      <span class="fo-envelope__icon">${iconSvg(categoryIcons[category.id] ?? 'envelope', 16)}</span>
      <span class="fo-envelope__name">${escapeHtml(category.name)}</span>
      ${pill(category.health)}
    </div>
    ${meter(category, label)}
    <div class="fo-envelope__numbers">
      <span>${money(category.spentCents)} <span class="fo-muted">of ${whole(category.limitCents)}</span></span>
      <span class="fo-muted">Projected ${whole(category.projectedCents)} · ${remaining}</span>
    </div>
  </li>`;
}

function legs(list: CardLeg[]): string {
  return `<ul class="fo-legs">${list
    .map(
      (leg) => `<li class="fo-legs__item">
        <span class="fo-legs__from">${escapeHtml(leg.fromName)}</span>
        <span class="fo-legs__arrow">${iconSvg('transfer', 16)}</span>
        <span class="fo-legs__to">${escapeHtml(leg.toName)}</span>
        <span class="fo-legs__amount">${whole(leg.amountCents)}</span>
      </li>`,
    )
    .join('')}</ul>`;
}

function approvalBlock(approval: CardApproval): string {
  const actionable = approval.status === 'pending';
  return `<section class="fo-approval" data-approval="${escapeHtml(approval.id)}">
    <div class="fo-approval__head">
      <span class="fo-approval__amount">${whole(approval.totalCents)}</span>
      <span class="fo-muted">into ${escapeHtml(approval.targetName)}</span>
      <span class="fo-tag fo-tag--${approval.status}">${escapeHtml(approval.status)}</span>
    </div>
    ${legs(approval.legs)}
    <p class="fo-approval__why">${escapeHtml(approval.rationale)}</p>
    <p class="fo-approval__meta">Requested by ${escapeHtml(approval.requestedBy)} · expires ${date(approval.expiresAt)}</p>
    ${
      actionable
        ? `<div class="fo-actions" data-actions>
            <button type="button" class="fo-button fo-button--primary" data-action="approve" data-id="${escapeHtml(approval.id)}">${iconSvg('check', 16)}<span>Approve</span></button>
            <button type="button" class="fo-button fo-button--ghost" data-action="reject" data-id="${escapeHtml(approval.id)}">${iconSvg('close', 16)}<span>Reject</span></button>
          </div>`
        : ''
    }
  </section>`;
}

function finding(item: CardFinding, actionable: boolean): string {
  const icon: IconName = item.kind === 'duplicate' ? 'duplicate' : 'anomaly';
  const kindLabel = item.kind === 'duplicate' ? 'Possible duplicate' : item.kind === 'new-merchant' ? 'New merchant' : 'Unusual amount';
  return `<li class="fo-finding" data-finding="${escapeHtml(item.transactionId)}">
    <span class="fo-finding__icon">${iconSvg(icon, 18)}</span>
    <div class="fo-finding__body">
      <div class="fo-finding__top">
        <span class="fo-finding__merchant">${escapeHtml(item.merchant)}</span>
        <span class="fo-finding__amount">${money(item.amountCents)}</span>
      </div>
      <p class="fo-finding__kind">${kindLabel} · ${escapeHtml(item.categoryName)} · ${date(item.occurredAt)}</p>
      <p class="fo-finding__reason">${escapeHtml(item.reason)}</p>
      ${
        actionable
          ? `<div class="fo-actions" data-actions><button type="button" class="fo-button fo-button--ghost fo-button--small" data-action="review" data-id="${escapeHtml(item.transactionId)}">${iconSvg('check', 14)}<span>It was expected</span></button></div>`
          : ''
      }
    </div>
  </li>`;
}

function stat(label: string, value: string, hint = ''): string {
  return `<div class="fo-stat"><p class="fo-stat__label">${escapeHtml(label)}</p><p class="fo-stat__value">${value}</p>${hint ? `<p class="fo-stat__hint">${hint}</p>` : ''}</div>`;
}

function budget(card: BudgetCard): string {
  const pct = card.limitCents > 0 ? Math.round((card.spentCents / card.limitCents) * 100) : 0;
  const focus = card.focusId ? card.categories.find((c) => c.id === card.focusId) : undefined;
  if (focus) {
    return `${header(categoryIcons[focus.id] ?? 'envelope', `Envelope · ${card.periodLabel}`, escapeHtml(focus.name), pill(focus.health))}
      <div class="fo-card__body">
        <div class="fo-hero"><span class="fo-hero__value">${whole(Math.abs(focus.remainingCents))}</span><span class="fo-hero__label">${focus.remainingCents >= 0 ? 'left this month' : 'over the limit'}</span></div>
        ${meter(focus, `Spent ${formatMoney(focus.spentCents)} of ${formatMoney(focus.limitCents)}`)}
        <div class="fo-stats">${stat('Spent', money(focus.spentCents))}${stat('Limit', whole(focus.limitCents))}${stat('Projected', whole(focus.projectedCents))}</div>
      </div>`;
  }
  return `${header('envelope', `Budget · ${card.periodLabel}`, `${whole(card.spentCents)} <span class="fo-muted">of ${whole(card.limitCents)}</span>`, `<span class="fo-chip">${card.daysRemaining} days left</span>`)}
    <div class="fo-card__body">
      <p class="fo-summary">${pct}% of this month's budget is used. Projected month end: ${whole(card.projectedCents)}.</p>
      <ul class="fo-envelopes">${card.categories.map((category) => categoryRow(category)).join('')}</ul>
      ${legend()}
    </div>`;
}

function legend(): string {
  return `<p class="fo-legend"><span class="fo-legend__key fo-legend__key--fill"></span>Spent <span class="fo-legend__key fo-legend__key--projection"></span>Projected <span class="fo-legend__key fo-legend__key--limit"></span>Limit</p>`;
}

function expense(card: ExpenseCard): string {
  return `${header('receipt', card.autoCategorized ? 'Expense logged · auto categorised' : 'Expense logged', money(card.transaction.amountCents))}
    <div class="fo-card__body">
      <p class="fo-summary"><strong>${escapeHtml(card.transaction.description)}</strong> <span class="fo-muted">· ${escapeHtml(card.transaction.merchant)} · ${date(card.transaction.occurredAt)}</span></p>
      ${
        card.anomaly
          ? `<div class="fo-callout fo-callout--warning">${iconSvg(card.anomaly.kind === 'duplicate' ? 'duplicate' : 'anomaly', 18)}<p>${escapeHtml(card.anomaly.reason)}</p></div>`
          : ''
      }
      <ul class="fo-envelopes">${categoryRow(card.category, true)}</ul>
    </div>`;
}

function income(card: IncomeCard): string {
  return `${header('income', 'Income recorded', money(card.transaction.amountCents))}
    <div class="fo-card__body">
      <p class="fo-summary"><strong>${escapeHtml(card.transaction.description)}</strong> <span class="fo-muted">· ${date(card.transaction.occurredAt)}</span></p>
      <div class="fo-stats">${stat('Cash now', whole(card.cashCents))}${stat('Runway', escapeHtml(months(card.runwayMonths)))}</div>
    </div>`;
}

function runway(card: RunwayCard): string {
  const until = card.zeroCashDate ? new Date(card.zeroCashDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : null;
  const stress =
    card.stressPercent !== 0
      ? `<span class="fo-chip fo-chip--accent">${escapeHtml(card.stressScope ?? 'Spending')} ${card.stressPercent > 0 ? '+' : ''}${card.stressPercent}%</span>`
      : '';
  return `${header('runway', 'Runway', escapeHtml(card.months === null ? 'Cash positive' : `${card.months.toFixed(1)} months`), stress)}
    <div class="fo-card__body">
      <p class="fo-summary">${until ? `At this burn the cash lasts until <strong>${escapeHtml(until)}</strong>.` : 'Income covers spending, so cash is growing.'}</p>
      <div class="fo-stats">
        ${stat('Cash on hand', whole(card.cashCents))}
        ${stat('Net burn / month', whole(Math.max(0, card.monthlyNetBurnCents)), `${whole(card.monthlyExpenseCents)} out, ${whole(card.monthlyIncomeCents)} in`)}
        ${stat('If income stopped', escapeHtml(months(card.grossMonths)))}
      </div>
    </div>`;
}

export const FORECAST_CHART = { width: 560, height: 200, pad: { top: 14, right: 16, bottom: 26, left: 52 } };

/** Horizontal position of each forecast point as a fraction of the chart width, for the hover layer. */
export function forecastXFractions(count: number): number[] {
  const { width, pad } = FORECAST_CHART;
  return Array.from({ length: count }, (_, i) => (pad.left + (i / Math.max(1, count - 1)) * (width - pad.left - pad.right)) / width);
}

function forecast(card: ForecastCard): string {
  const { width, height, pad } = FORECAST_CHART;
  const values = card.points.flatMap((point) => [point.p10Cents, point.p90Cents]);
  const min = Math.min(0, ...values);
  const max = Math.max(...values);
  const x = (index: number) => pad.left + (index / Math.max(1, card.points.length - 1)) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (1 - (value - min) / Math.max(1, max - min)) * (height - pad.top - pad.bottom);
  const band = [...card.points.map((p, i) => `${x(i)},${y(p.p90Cents)}`), ...[...card.points].reverse().map((p, i) => `${x(card.points.length - 1 - i)},${y(p.p10Cents)}`)].join(' ');
  const line = card.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.p50Cents)}`).join(' ');
  const ticks = [min, (min + max) / 2, max].map((value) => `<g class="fo-chart__tick"><line x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}"/><text x="${pad.left - 8}" y="${y(value) + 4}" text-anchor="end">${escapeHtml(formatMoney(value, { style: 'compact' }))}</text></g>`).join('');
  const labels = card.points
    .map((p, i) => (i % Math.ceil(card.points.length / 6) === 0 || i === card.points.length - 1 ? `<text class="fo-chart__label" x="${x(i)}" y="${height - 6}" text-anchor="middle">${escapeHtml(new Date(p.date).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }))}</text>` : ''))
    .join('');
  const last = card.points.at(-1)!;
  const zero = min < 0 ? `<line class="fo-chart__zero" x1="${pad.left}" x2="${width - pad.right}" y1="${y(0)}" y2="${y(0)}"/>` : '';
  const risk = card.shortfallProbability < 0.01 ? 'under 1%' : `${Math.round(card.shortfallProbability * 100)}%`;
  return `${header('forecast', `Cash forecast · ${card.months} months`, `${whole(last.p50Cents)} <span class="fo-muted">likely</span>`)}
    <div class="fo-card__body">
      <p class="fo-summary">Range ${whole(last.p10Cents)} to ${whole(last.p90Cents)} by ${date(last.date)}. Chance of running out: <strong>${risk}</strong>.</p>
      <figure class="fo-chart" data-chart>
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Cash forecast from ${escapeHtml(formatMoney(card.startingCashCents, { style: 'whole' }))} to ${escapeHtml(formatMoney(last.p50Cents, { style: 'whole' }))}">
          ${ticks}${zero}
          <polygon class="fo-chart__band" points="${band}"/>
          <path class="fo-chart__line" d="${line}"/>
          <circle class="fo-chart__dot" cx="${x(card.points.length - 1)}" cy="${y(last.p50Cents)}" r="4"/>
          ${labels}
          <line class="fo-chart__cursor" data-cursor x1="0" x2="0" y1="${pad.top}" y2="${height - pad.bottom}"/>
        </svg>
        <div class="fo-chart__tooltip" data-tooltip hidden></div>
      </figure>
      <p class="fo-legend"><span class="fo-legend__key fo-legend__key--line"></span>Most likely <span class="fo-legend__key fo-legend__key--band"></span>10th to 90th percentile</p>
    </div>`;
}

function audit(card: AuditCard): string {
  return `${header('anomaly', `Spending audit · last ${card.windowDays} days`, card.items.length === 0 ? 'All clear' : `${card.items.length} to review`, card.items.length > 0 ? `<span class="fo-chip fo-chip--warning">${whole(card.flaggedCents)}</span>` : '')}
    <div class="fo-card__body">
      ${
        card.items.length === 0
          ? `<div class="fo-empty">${iconSvg('success', 22)}<p>Checked ${card.scannedCount} charges. Nothing is out of pattern.</p></div>`
          : `<ul class="fo-findings">${card.items.map((item) => finding(item, true)).join('')}</ul>`
      }
    </div>`;
}

function affordability(card: AffordabilityCard): string {
  const verdict = {
    comfortable: { icon: 'success' as IconName, label: 'Fits the budget' },
    tight: { icon: 'warning' as IconName, label: 'Tight' },
    'not-advised': { icon: 'critical' as IconName, label: 'Hold off' },
  }[card.verdict];
  const projected = { spentCents: card.projectedBeforeCents, limitCents: card.limitCents, projectedCents: card.projectedAfterCents, health: card.projectedAfterCents > card.limitCents ? ('at-risk' as const) : ('healthy' as const) };
  const suggestion =
    card.suggestion?.kind === 'transfer'
      ? `<div class="fo-callout fo-callout--info">${iconSvg('transfer', 18)}<div><p>Make room first by moving ${whole(card.suggestion.totalCents)}:</p>${legs(card.suggestion.legs)}
          <div class="fo-actions" data-actions><button type="button" class="fo-button fo-button--primary fo-button--small" data-action="move" data-from="${escapeHtml(card.suggestion.legs[0]!.fromId)}" data-to="${escapeHtml(card.suggestion.legs[0]!.toId)}" data-amount="${card.suggestion.legs[0]!.amountCents}">${iconSvg('transfer', 14)}<span>Move ${whole(card.suggestion.legs[0]!.amountCents)} now</span></button></div></div></div>`
      : card.suggestion?.kind === 'wait'
        ? `<div class="fo-callout fo-callout--info">${iconSvg('calendar', 18)}<p>No envelope has room. The limit resets on ${date(card.suggestion.until)}.</p></div>`
        : '';
  return `${header('wallet', `Can we afford it? · ${card.recurring ? 'monthly' : 'one off'}`, `${money(card.amountCents)} <span class="fo-muted">for ${escapeHtml(card.description)}</span>`)}
    <div class="fo-card__body">
      <div class="fo-verdict fo-verdict--${card.verdict}">${iconSvg(verdict.icon, 18)}<span>${verdict.label}</span></div>
      <p class="fo-summary">${escapeHtml(card.categoryName)}: projected ${whole(card.projectedBeforeCents)} now, ${whole(card.projectedAfterCents)} with this, against ${whole(card.limitCents)}.</p>
      ${meter(projected, `${card.categoryName} projected ${formatMoney(card.projectedAfterCents)} against ${formatMoney(card.limitCents)}`)}
      <p class="fo-legend"><span class="fo-legend__key fo-legend__key--fill"></span>Projected now <span class="fo-legend__key fo-legend__key--projection"></span>With this purchase <span class="fo-legend__key fo-legend__key--limit"></span>Limit</p>
      <div class="fo-stats">${stat('Runway before', escapeHtml(months(card.runwayBeforeMonths)))}${stat('Runway after', escapeHtml(months(card.runwayAfterMonths)), card.runwayDeltaDays !== 0 ? `${card.runwayDeltaDays > 0 ? '+' : ''}${card.runwayDeltaDays} days` : '')}</div>
      ${suggestion}
    </div>`;
}

function move(card: MoveCard): string {
  if (card.status === 'approval_required') {
    return `${header('lock', 'Needs your confirmation', `Move ${whole(card.legs.reduce((t, l) => t + l.amountCents, 0))}`)}
      <div class="fo-card__body">
        ${legs(card.legs)}
        <p class="fo-summary">This is above the voice confirmation limit, so nothing has moved yet.</p>
        ${card.approvalId ? `<div class="fo-actions" data-actions>
          <button type="button" class="fo-button fo-button--primary" data-action="approve" data-id="${escapeHtml(card.approvalId)}">${iconSvg('check', 16)}<span>Approve</span></button>
          <button type="button" class="fo-button fo-button--ghost" data-action="reject" data-id="${escapeHtml(card.approvalId)}">${iconSvg('close', 16)}<span>Reject</span></button>
        </div>` : ''}
      </div>`;
  }
  return `${header('transfer', 'Budget moved', whole(card.legs.reduce((t, l) => t + l.amountCents, 0)))}
    <div class="fo-card__body">
      ${legs(card.legs)}
      <ul class="fo-envelopes">${categoryRow(card.to, true)}${categoryRow(card.from)}</ul>
    </div>`;
}

function approvals(card: ApprovalsCard): string {
  const pending = card.approvals.filter((a) => a.status === 'pending');
  return `${header('clock', 'Approvals', pending.length === 0 ? 'Nothing waiting' : `${pending.length} waiting`)}
    <div class="fo-card__body">
      ${pending.length === 0 ? `<div class="fo-empty">${iconSvg('success', 22)}<p>The guardian has everything under its autonomy limit.</p></div>` : pending.map(approvalBlock).join('')}
    </div>`;
}

function resolution(card: ResolutionCard): string {
  const approved = card.approval?.status === 'approved';
  return `${header(approved ? 'success' : 'info', 'Approval', card.approval ? (approved ? 'Approved and applied' : 'Rejected') : 'Nothing pending')}
    <div class="fo-card__body">
      ${card.approval ? legs(card.approval.legs) : ''}
      <p class="fo-summary">${escapeHtml(card.speech)}</p>
    </div>`;
}

function sweep(card: SweepCard): string {
  const capPct = card.autonomousCapCents > 0 ? Math.min(100, (card.autonomousUsedCents / card.autonomousCapCents) * 100) : 0;
  const sections: string[] = [];
  if (card.executed.length > 0) {
    sections.push(`<section class="fo-section"><h2 class="fo-section__title">${iconSvg('shield', 16)}Moved on its own</h2>${card.executed.map((entry) => `${legs(entry.legs)}<p class="fo-approval__why">${escapeHtml(entry.reason)}</p>`).join('')}</section>`);
  }
  if (card.approvals.length > 0) sections.push(`<section class="fo-section"><h2 class="fo-section__title">${iconSvg('lock', 16)}Needs your approval</h2>${card.approvals.map(approvalBlock).join('')}</section>`);
  if (card.flagged.length > 0) sections.push(`<section class="fo-section"><h2 class="fo-section__title">${iconSvg('anomaly', 16)}Flagged charges</h2><ul class="fo-findings">${card.flagged.map((item) => finding(item, true)).join('')}</ul></section>`);
  for (const warning of card.warnings) sections.push(`<div class="fo-callout fo-callout--critical">${iconSvg('critical', 18)}<p>${escapeHtml(warning)}</p></div>`);
  return `${header('shield', `Guardian sweep · ${date(card.ranAt)}`, sections.length === 0 ? 'All clear' : 'Sweep complete')}
    <div class="fo-card__body">
      ${sections.length === 0 ? `<div class="fo-empty">${iconSvg('success', 22)}<p>Every envelope is on track and nothing looks unusual.</p></div>` : sections.join('')}
      <div class="fo-cap">
        <div class="fo-cap__labels"><span>Autonomy used this month</span><span>${whole(card.autonomousUsedCents)} of ${whole(card.autonomousCapCents)}</span></div>
        <div class="fo-cap__track" role="img" aria-label="Autonomy used ${escapeHtml(formatMoney(card.autonomousUsedCents))} of ${escapeHtml(formatMoney(card.autonomousCapCents))}"><span class="fo-cap__fill" data-width="${capPct.toFixed(1)}"></span></div>
      </div>
    </div>`;
}

const SEVERITY_ICON: Record<string, IconName> = { info: 'info', success: 'success', warning: 'warning', critical: 'critical' };

function briefing(card: BriefingCard): string {
  const since = card.since ? `Since ${date(card.since)}` : 'Last 7 days';
  return `${header('pulse', `Briefing · ${since}`, `${whole(card.cashCents)} <span class="fo-muted">· ${escapeHtml(months(card.runwayMonths))}</span>`)}
    <div class="fo-card__body">
      ${
        card.events.length === 0
          ? `<div class="fo-empty">${iconSvg('success', 22)}<p>Nothing new since last time.</p></div>`
          : `<ol class="fo-timeline">${card.events
              .slice(0, 8)
              .map(
                (event) => `<li class="fo-timeline__item fo-timeline__item--${event.severity}">
                  <span class="fo-timeline__icon">${iconSvg(SEVERITY_ICON[event.severity] ?? 'info', 16)}</span>
                  <div><p class="fo-timeline__title">${escapeHtml(event.title)}</p><p class="fo-timeline__meta">${escapeHtml(event.actor)} · ${date(event.at)}</p></div>
                </li>`,
              )
              .join('')}</ol>`
      }
      ${card.pendingApprovals.map(approvalBlock).join('')}
    </div>`;
}

export function renderCard(card: Card): string {
  switch (card.kind) {
    case 'budget':
      return budget(card);
    case 'expense':
      return expense(card);
    case 'income':
      return income(card);
    case 'runway':
      return runway(card);
    case 'forecast':
      return forecast(card);
    case 'audit':
      return audit(card);
    case 'affordability':
      return affordability(card);
    case 'move':
      return move(card);
    case 'approvals':
      return approvals(card);
    case 'resolution':
      return resolution(card);
    case 'sweep':
      return sweep(card);
    case 'briefing':
      return briefing(card);
    case 'review':
      return `${header('success', 'Reviewed', 'Marked as expected')}<div class="fo-card__body"><p class="fo-summary">${escapeHtml(card.speech)}</p></div>`;
    default:
      return `${header('info', 'FinOrchestrate', 'Result')}<div class="fo-card__body"><p class="fo-summary">${escapeHtml((card as { speech?: string }).speech ?? '')}</p></div>`;
  }
}
