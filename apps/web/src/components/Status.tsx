import type { Health, Severity } from '../lib/api';
import { Icon, type IconName } from './Icon';
import './status.css';

const HEALTH: Record<Health, { icon: IconName; label: string }> = {
  healthy: { icon: 'success', label: 'On track' },
  watch: { icon: 'clock', label: 'Watch' },
  at_risk: { icon: 'warning', label: 'At risk' },
  over: { icon: 'critical', label: 'Over limit' },
};

/** Health is never conveyed by color alone: every pill carries an icon and a word. */
export function HealthPill({ health, compact = false }: { health: Health; compact?: boolean }) {
  const meta = HEALTH[health];
  return (
    <span className={`status-pill status-pill--${health}${compact ? ' status-pill--compact' : ''}`}>
      <Icon name={meta.icon} size={14} />
      <span>{meta.label}</span>
    </span>
  );
}

const SEVERITY_ICON: Record<Severity, IconName> = { info: 'info', success: 'success', warning: 'warning', critical: 'critical' };

export function SeverityIcon({ severity, size = 16 }: { severity: Severity; size?: number }) {
  return (
    <span className={`severity-icon severity-icon--${severity}`}>
      <Icon name={SEVERITY_ICON[severity]} size={size} />
    </span>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'good' | 'warning' | 'critical' }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function ToneDot({ tone }: { tone: string }) {
  return <span className={`tone-dot tone-dot--${tone}`} aria-hidden="true" />;
}
