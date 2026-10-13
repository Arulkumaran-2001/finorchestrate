import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { compact, monthYear, shortDate, whole } from '../lib/format';
import './charts.css';

/* ------------------------------------------------------------ helpers */

function useWidth<T extends HTMLElement>(fallback = 600): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]!.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Round axis bounds to clean steps so ticks read 20K, 30K, 40K rather than 21,337. */
function niceTicks(min: number, max: number, count = 4): number[] {
  const span = Math.max(1, max - min);
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step * 0.5; value += step) ticks.push(Math.round(value));
  return ticks;
}

/* ------------------------------------------------------------ frame */

export function ChartFrame({ chart, table, caption }: { chart: ReactNode; table: ReactNode; caption: string }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <figure className="chart-frame">
      <figcaption className="visually-hidden">{caption}</figcaption>
      <div className="chart-frame__toggle">
        <button type="button" className={`chart-frame__tab${view === 'chart' ? ' chart-frame__tab--active' : ''}`} aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
          Chart
        </button>
        <button type="button" className={`chart-frame__tab${view === 'table' ? ' chart-frame__tab--active' : ''}`} aria-pressed={view === 'table'} onClick={() => setView('table')}>
          Table
        </button>
      </div>
      {view === 'chart' ? chart : <div className="chart-table">{table}</div>}
    </figure>
  );
}

/* ------------------------------------------------------------ cash outlook */

interface OutlookProps {
  history: Array<{ date: string; cashCents: number }>;
  forecast: Array<{ date: string; p10Cents: number; p50Cents: number; p90Cents: number }>;
  height?: number;
}

type OutlookPoint = { time: number; kind: 'actual'; cash: number } | { time: number; kind: 'forecast'; p10: number; p50: number; p90: number };

/** Actual cash flowing into the forecast fan on one time axis, with a "today" marker. */
export function CashOutlookChart({ history, forecast, height = 280 }: OutlookProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const narrow = width < 480;
  const pad = { top: 16, right: narrow ? 12 : 20, bottom: 30, left: narrow ? 44 : 56 };

  const points = useMemo<OutlookPoint[]>(() => {
    const actual = history.map((point) => ({ time: Date.parse(point.date), kind: 'actual' as const, cash: point.cashCents }));
    const ahead = forecast.slice(1).map((point) => ({ time: Date.parse(point.date), kind: 'forecast' as const, p10: point.p10Cents, p50: point.p50Cents, p90: point.p90Cents }));
    return [...actual, ...ahead];
  }, [history, forecast]);

  if (points.length < 2) return <div ref={ref} className="chart chart--empty" style={{ height }} />;

  const times = points.map((point) => point.time);
  const values = points.flatMap((point) => (point.kind === 'actual' ? [point.cash] : [point.p10, point.p90]));
  const ticks = niceTicks(Math.min(0, ...values) < 0 ? Math.min(...values) : Math.min(...values) * 0.9, Math.max(...values));
  const yMin = ticks[0]!;
  const yMax = ticks.at(-1)!;
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const x = (time: number) => pad.left + ((time - tMin) / Math.max(1, tMax - tMin)) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (1 - (value - yMin) / Math.max(1, yMax - yMin)) * (height - pad.top - pad.bottom);

  const actual = points.filter((point): point is Extract<OutlookPoint, { kind: 'actual' }> => point.kind === 'actual');
  const lastActual = actual.at(-1)!;
  const ahead = [{ time: lastActual.time, kind: 'forecast' as const, p10: lastActual.cash, p50: lastActual.cash, p90: lastActual.cash }, ...points.filter((point): point is Extract<OutlookPoint, { kind: 'forecast' }> => point.kind === 'forecast')];
  const actualPath = actual.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.time).toFixed(1)},${y(point.cash).toFixed(1)}`).join(' ');
  const actualArea = `${actualPath} L${x(lastActual.time).toFixed(1)},${y(yMin).toFixed(1)} L${x(actual[0]!.time).toFixed(1)},${y(yMin).toFixed(1)} Z`;
  const medianPath = ahead.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.time).toFixed(1)},${y(point.p50).toFixed(1)}`).join(' ');
  const band = [...ahead.map((point) => `${x(point.time).toFixed(1)},${y(point.p90).toFixed(1)}`), ...[...ahead].reverse().map((point) => `${x(point.time).toFixed(1)},${y(point.p10).toFixed(1)}`)].join(' ');

  const monthTicks: number[] = [];
  const cursor = new Date(tMin);
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  while (cursor.getTime() <= tMax) {
    monthTicks.push(cursor.getTime());
    cursor.setUTCMonth(cursor.getUTCMonth() + (narrow ? 2 : 1));
  }

  const nearest = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = clientX - rect.left;
    let best = 0;
    points.forEach((point, index) => {
      if (Math.abs(x(point.time) - px) < Math.abs(x(points[best]!.time) - px)) best = index;
    });
    setActive(best);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setActive((current) => {
      const start = current ?? points.length - 1;
      return Math.max(0, Math.min(points.length - 1, start + (event.key === 'ArrowRight' ? 1 : -1)));
    });
  };

  const focus = active !== null ? points[active]! : null;
  const focusX = focus ? x(focus.time) : 0;
  const focusY = focus ? y(focus.kind === 'actual' ? focus.cash : focus.p50) : 0;

  return (
    <div
      ref={ref}
      className="chart"
      style={{ height }}
      tabIndex={0}
      role="img"
      aria-label={`Cash was ${whole(lastActual.cash)} today and is most likely ${whole(ahead.at(-1)!.p50)} by ${monthYear(new Date(ahead.at(-1)!.time).toISOString())}. Use the arrow keys to read values.`}
      onPointerMove={(event) => nearest(event.clientX)}
      onPointerLeave={() => setActive(null)}
      onKeyDown={onKey}
      onBlur={() => setActive(null)}
    >
      <svg width={width} height={height} className="chart__svg" aria-hidden="true">
        {ticks.map((tick) => (
          <g key={tick} className="chart__grid">
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
            <text x={pad.left - 10} y={y(tick) + 4} textAnchor="end">
              {compact(tick)}
            </text>
          </g>
        ))}
        {yMin < 0 ? <line className="chart__zero" x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} /> : null}
        {monthTicks.map((tick) => (
          <text key={tick} className="chart__axis-label" x={x(tick)} y={height - 8} textAnchor="middle">
            {new Date(tick).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}
          </text>
        ))}
        <path className="chart__area chart__area--actual" d={actualArea} />
        <polygon className="chart__band" points={band} />
        <path className="chart__line chart__line--actual" d={actualPath} />
        <path className="chart__line chart__line--forecast" d={medianPath} />
        <line className="chart__today" x1={x(lastActual.time)} x2={x(lastActual.time)} y1={pad.top} y2={height - pad.bottom} />
        <text className="chart__today-label" x={x(lastActual.time) + 6} y={pad.top + 10}>
          Today
        </text>
        <circle className="chart__dot" cx={x(lastActual.time)} cy={y(lastActual.cash)} r={4.5} />
        {focus ? (
          <>
            <line className="chart__crosshair" x1={focusX} x2={focusX} y1={pad.top} y2={height - pad.bottom} />
            <circle className="chart__dot chart__dot--focus" cx={focusX} cy={focusY} r={5} />
          </>
        ) : null}
      </svg>
      {focus ? (
        <div className="chart__tooltip" style={{ left: Math.min(Math.max(focusX, 90), width - 90), top: Math.max(8, focusY - 92) }}>
          <p className="chart__tooltip-title">{focus.kind === 'actual' ? shortDate(new Date(focus.time).toISOString()) : monthYear(new Date(focus.time).toISOString())}</p>
          {focus.kind === 'actual' ? (
            <p className="chart__tooltip-row">
              <span className="chart__key chart__key--actual" />
              Cash <strong>{whole(focus.cash)}</strong>
            </p>
          ) : (
            <>
              <p className="chart__tooltip-row">
                <span className="chart__key chart__key--forecast" />
                Likely <strong>{whole(focus.p50)}</strong>
              </p>
              <p className="chart__tooltip-row chart__tooltip-row--muted">
                Range {whole(focus.p10)} to {whole(focus.p90)}
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function OutlookLegend() {
  return (
    <ul className="chart-legend">
      <li>
        <span className="chart__key chart__key--actual" />
        Actual cash
      </li>
      <li>
        <span className="chart__key chart__key--forecast" />
        Most likely
      </li>
      <li>
        <span className="chart__key chart__key--band" />
        10th to 90th percentile
      </li>
    </ul>
  );
}

/* ------------------------------------------------------------ monthly flows */

interface FlowProps {
  flows: Array<{ period: string; label: string; incomeCents: number; expenseCents: number; complete: boolean }>;
  height?: number;
}

/** Income and spending per month as paired columns. Thin bars, rounded data ends, a 2px gap between the pair. */
export function FlowChart({ flows, height = 240 }: FlowProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const pad = { top: 14, right: 8, bottom: 30, left: 48 };
  const ticks = niceTicks(0, Math.max(1, ...flows.flatMap((flow) => [flow.incomeCents, flow.expenseCents])));
  const yMax = ticks.at(-1)!;
  const plotWidth = width - pad.left - pad.right;
  const band = plotWidth / Math.max(1, flows.length);
  const bar = Math.min(24, Math.max(8, (band - 18) / 2));
  const y = (value: number) => pad.top + (1 - value / yMax) * (height - pad.top - pad.bottom);
  const baseline = y(0);

  const column = (cx: number, value: number, className: string) => {
    const top = y(value);
    const h = Math.max(0, baseline - top);
    const r = Math.min(4, h);
    const path = `M${cx},${baseline} V${top + r} Q${cx},${top} ${cx + r},${top} H${cx + bar - r} Q${cx + bar},${top} ${cx + bar},${top + r} V${baseline} Z`;
    return <path className={className} d={path} />;
  };

  return (
    <div ref={ref} className="chart" style={{ height }} onPointerLeave={() => setActive(null)}>
      <svg width={width} height={height} className="chart__svg" role="img" aria-label="Monthly income and spending">
        {ticks.map((tick) => (
          <g key={tick} className="chart__grid">
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
            <text x={pad.left - 10} y={y(tick) + 4} textAnchor="end">
              {compact(tick)}
            </text>
          </g>
        ))}
        {flows.map((flow, index) => {
          const center = pad.left + band * index + band / 2;
          const left = center - bar - 1;
          return (
            <g key={flow.period} className={`chart__column-group${active === index ? ' chart__column-group--active' : ''}`}>
              <rect
                className="chart__hit"
                x={pad.left + band * index}
                y={pad.top}
                width={band}
                height={height - pad.top - pad.bottom}
                onPointerEnter={() => setActive(index)}
                tabIndex={0}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                aria-label={`${flow.label}: income ${whole(flow.incomeCents)}, spending ${whole(flow.expenseCents)}`}
              />
              {column(left, flow.incomeCents, 'chart__bar chart__bar--income')}
              {column(center + 1, flow.expenseCents, 'chart__bar chart__bar--expense')}
              <text className="chart__axis-label" x={center} y={height - 8} textAnchor="middle">
                {flow.label}
                {flow.complete ? '' : ' *'}
              </text>
            </g>
          );
        })}
        <line className="chart__baseline" x1={pad.left} x2={width - pad.right} y1={baseline} y2={baseline} />
      </svg>
      {active !== null && flows[active] ? (
        <div className="chart__tooltip" style={{ left: Math.min(Math.max(pad.left + band * active + band / 2, 100), width - 100), top: 8 }}>
          <p className="chart__tooltip-title">
            {flows[active]!.label}
            {flows[active]!.complete ? '' : ', month to date'}
          </p>
          <p className="chart__tooltip-row">
            <span className="chart__key chart__key--income" />
            Income <strong>{whole(flows[active]!.incomeCents)}</strong>
          </p>
          <p className="chart__tooltip-row">
            <span className="chart__key chart__key--expense" />
            Spending <strong>{whole(flows[active]!.expenseCents)}</strong>
          </p>
          <p className="chart__tooltip-row chart__tooltip-row--muted">Net {whole(flows[active]!.incomeCents - flows[active]!.expenseCents)}</p>
        </div>
      ) : null}
    </div>
  );
}

export function FlowLegend() {
  return (
    <ul className="chart-legend">
      <li>
        <span className="chart__key chart__key--income chart__key--block" />
        Income
      </li>
      <li>
        <span className="chart__key chart__key--expense chart__key--block" />
        Spending
      </li>
      <li className="chart-legend__note">* month to date</li>
    </ul>
  );
}

/* ------------------------------------------------------------ meter and sparkline */

interface MeterProps {
  spentCents: number;
  limitCents: number;
  projectedCents: number;
  health: string;
  label: string;
  size?: 'sm' | 'md';
}

/** Envelope meter: spent fill, projected wash and the limit line on one scale. */
export function EnvelopeMeter({ spentCents, limitCents, projectedCents, health, label, size = 'md' }: MeterProps) {
  const scale = Math.max(limitCents, projectedCents, spentCents, 1);
  const pct = (value: number) => `${Math.max(0, Math.min(100, (value / scale) * 100))}%`;
  return (
    <div className={`meter meter--${health} meter--${size}`} role="img" aria-label={label}>
      <span className="meter__projection" style={{ width: pct(projectedCents) }} />
      <span className="meter__fill" style={{ width: pct(spentCents) }} />
      <span className="meter__limit" style={{ left: pct(limitCents) }} />
    </div>
  );
}

export function MeterLegend() {
  return (
    <ul className="chart-legend chart-legend--small">
      <li>
        <span className="meter-key meter-key--fill" />
        Spent
      </li>
      <li>
        <span className="meter-key meter-key--projection" />
        Projected by month end
      </li>
      <li>
        <span className="meter-key meter-key--limit" />
        Limit
      </li>
    </ul>
  );
}

export function Sparkline({ values, height = 44, label }: { values: number[]; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(200);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (index: number) => 2 + (index / (values.length - 1)) * (width - 6);
  const y = (value: number) => 4 + (1 - (value - min) / Math.max(1, max - min)) * (height - 8);
  const path = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  return (
    <div ref={ref} className="sparkline" style={{ height }} role="img" aria-label={label}>
      <svg width={width} height={height} aria-hidden="true">
        <path className="sparkline__area" d={`${path} L${x(values.length - 1)},${height} L${x(0)},${height} Z`} />
        <path className="sparkline__line" d={path} />
        <circle className="sparkline__dot" cx={x(values.length - 1)} cy={y(values.at(-1)!)} r={3.5} />
      </svg>
    </div>
  );
}
