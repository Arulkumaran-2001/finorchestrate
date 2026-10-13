import { App } from '@modelcontextprotocol/ext-apps';
import type { Card, ForecastCard } from '@finorchestrate/core';
import { formatMoney } from '@finorchestrate/core';
import { iconSvg } from '@finorchestrate/icons';
import { escapeHtml, forecastXFractions, renderCard, FORECAST_CHART } from './render.js';
import './card.css';

const root = document.getElementById('root')!;
const app = new App({ name: 'FinOrchestrate card', version: '1.0.0' }, {}, { autoResize: true });
let current: Card | null = null;

function applyTheme(theme: string | undefined): void {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
}

/** Widths and offsets are applied through CSSOM so the card needs no inline style attributes. */
function applyGeometry(scope: ParentNode): void {
  scope.querySelectorAll<HTMLElement>('[data-width]').forEach((element) => {
    element.style.width = `${element.dataset.width}%`;
  });
  scope.querySelectorAll<HTMLElement>('[data-left]').forEach((element) => {
    element.style.left = `${element.dataset.left}%`;
  });
}

/**
 * Report the rendered height right away. The SDK's automatic resize waits for
 * an animation frame, which browsers pause in background tabs, so the host
 * would otherwise keep a stale height until the tab is visible again.
 */
function reportSize(): void {
  const element = document.documentElement;
  const previous = element.style.height;
  element.style.height = 'max-content';
  const height = Math.ceil(element.getBoundingClientRect().height);
  element.style.height = previous;
  void app.sendSizeChanged({ width: Math.ceil(window.innerWidth), height }).catch(() => undefined);
}

function show(card: Card): void {
  current = card;
  root.innerHTML = `<article class="fo-card fo-card--${card.kind}">${renderCard(card)}</article>`;
  applyGeometry(root);
  if (card.kind === 'forecast') wireForecast(card);
  reportSize();
}

function showMessage(text: string, tone: 'info' | 'critical' = 'info'): void {
  root.innerHTML = `<article class="fo-card"><div class="fo-callout fo-callout--${tone}">${iconSvg(tone === 'critical' ? 'critical' : 'info', 18)}<p>${escapeHtml(text)}</p></div></article>`;
}

function wireForecast(card: ForecastCard): void {
  const figure = root.querySelector<HTMLElement>('[data-chart]');
  const cursor = root.querySelector<SVGLineElement>('[data-cursor]');
  const tooltip = root.querySelector<HTMLElement>('[data-tooltip]');
  if (!figure || !cursor || !tooltip) return;
  const fractions = forecastXFractions(card.points.length);
  let active = card.points.length - 1;

  const focus = (index: number) => {
    active = Math.max(0, Math.min(card.points.length - 1, index));
    const point = card.points[active]!;
    const x = fractions[active]! * FORECAST_CHART.width;
    cursor.setAttribute('x1', String(x));
    cursor.setAttribute('x2', String(x));
    cursor.classList.add('fo-chart__cursor--visible');
    tooltip.hidden = false;
    tooltip.innerHTML = `<p class="fo-chart__tooltip-date">${escapeHtml(new Date(point.date).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }))}</p>
      <p><span class="fo-legend__key fo-legend__key--line"></span>Likely <strong>${escapeHtml(formatMoney(point.p50Cents, { style: 'whole' }))}</strong></p>
      <p class="fo-muted">Range ${escapeHtml(formatMoney(point.p10Cents, { style: 'whole' }))} to ${escapeHtml(formatMoney(point.p90Cents, { style: 'whole' }))}</p>`;
    const left = fractions[active]! * figure.clientWidth;
    tooltip.style.left = `${Math.min(Math.max(left, 80), figure.clientWidth - 80)}px`;
  };
  const clear = () => {
    cursor.classList.remove('fo-chart__cursor--visible');
    tooltip.hidden = true;
  };

  figure.tabIndex = 0;
  figure.addEventListener('pointermove', (event) => {
    const rect = figure.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    let nearest = 0;
    fractions.forEach((value, index) => {
      if (Math.abs(value - fraction) < Math.abs(fractions[nearest]! - fraction)) nearest = index;
    });
    focus(nearest);
  });
  figure.addEventListener('pointerleave', clear);
  figure.addEventListener('focus', () => focus(active));
  figure.addEventListener('blur', clear);
  figure.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') focus(active - 1);
    else if (event.key === 'ArrowRight') focus(active + 1);
    else return;
    event.preventDefault();
  });
}

async function act(button: HTMLButtonElement): Promise<void> {
  const area = button.closest<HTMLElement>('[data-actions]');
  const buttons = area ? [...area.querySelectorAll<HTMLButtonElement>('button')] : [button];
  buttons.forEach((entry) => (entry.disabled = true));
  button.classList.add('fo-button--busy');
  const { action, id, from, to, amount } = button.dataset;
  const call =
    action === 'approve' || action === 'reject'
      ? { name: 'resolve_approval', arguments: { decision: action, approval_id: id } }
      : action === 'review'
        ? { name: 'review_transaction', arguments: { transaction_id: id } }
        : { name: 'move_budget', arguments: { from_category: from, to_category: to, amount: Number(amount) / 100, reason: 'Make room for a planned purchase' } };
  try {
    const result = await app.callServerTool(call);
    const card = result.structuredContent as Card | undefined;
    const speech = card?.speech ?? (result.content?.[0] as { text?: string } | undefined)?.text ?? 'Done.';
    // Reflect the decision on the approval it belongs to, so the card never shows a stale "pending".
    const block = button.closest<HTMLElement>('[data-approval]');
    const tag = block?.querySelector<HTMLElement>('.fo-tag');
    if (tag && !result.isError && (action === 'approve' || action === 'reject')) {
      const status = action === 'approve' ? 'approved' : 'rejected';
      tag.className = `fo-tag fo-tag--${status}`;
      tag.textContent = status;
    }
    if (area) {
      area.outerHTML =`<p class="fo-status fo-status--${result.isError ? 'critical' : 'success'}">${iconSvg(result.isError ? 'critical' : 'success', 16)}<span>${escapeHtml(speech)}</span></p>`;
    }
    reportSize();
    // Keep the conversation's model in the loop when the host supports it.
    await app.updateModelContext({ content: [{ type: 'text', text: `The user used the FinOrchestrate card: ${speech}` }] }).catch(() => undefined);
  } catch (error) {
    buttons.forEach((entry) => (entry.disabled = false));
    button.classList.remove('fo-button--busy');
    area?.insertAdjacentHTML('afterend', `<p class="fo-status fo-status--critical">${iconSvg('critical', 16)}<span>${escapeHtml((error as Error).message)}</span></p>`);
    reportSize();
  }
}

root.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
  if (button && !button.disabled) void act(button);
});

app.ontoolresult = (result) => {
  const card = result.structuredContent as Card | undefined;
  if (card && typeof card === 'object' && 'kind' in card) show(card);
  else showMessage((result.content?.[0] as { text?: string } | undefined)?.text ?? 'No result.', result.isError ? 'critical' : 'info');
};
app.ontoolcancelled = () => showMessage('The request was cancelled.');
app.onhostcontextchanged = (context) => {
  applyTheme(context.theme);
  if (current) show(current);
};

void app
  .connect()
  .then(() => applyTheme(app.getHostContext()?.theme))
  .catch(() => showMessage('This card needs an MCP Apps host to display results.'));
