import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import './display.css';

interface PanelProps {
  title?: string;
  subtitle?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
  id?: string;
}

export function Panel({ title, subtitle, icon, actions, children, className, padded = true, id }: PanelProps) {
  return (
    <section className={`panel${padded ? '' : ' panel--flush'}${className ? ` ${className}` : ''}`} aria-labelledby={title && id ? `${id}-title` : undefined} id={id}>
      {title ? (
        <header className="panel__header">
          {icon ? (
            <span className="panel__icon">
              <Icon name={icon} size={18} />
            </span>
          ) : null}
          <div className="panel__heading">
            <h2 className="panel__title" id={id ? `${id}-title` : undefined}>
              {title}
            </h2>
            {subtitle ? <p className="panel__subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="panel__body">{children}</div>
    </section>
  );
}

interface StatTileProps {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: IconName;
  trend?: ReactNode;
  tone?: 'default' | 'good' | 'warning' | 'critical';
}

export function StatTile({ label, value, detail, icon, trend, tone = 'default' }: StatTileProps) {
  return (
    <div className={`stat-tile stat-tile--${tone}`}>
      <div className="stat-tile__top">
        <p className="stat-tile__label">{label}</p>
        {icon ? (
          <span className="stat-tile__icon">
            <Icon name={icon} size={18} />
          </span>
        ) : null}
      </div>
      <p className="stat-tile__value">{value}</p>
      {detail ? <p className="stat-tile__detail">{detail}</p> : null}
      {trend ? <div className="stat-tile__trend">{trend}</div> : null}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon">
        <Icon name={icon} size={22} />
      </span>
      <p className="empty-state__title">{title}</p>
      {children ? <p className="empty-state__text">{children}</p> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ width = '100%', height = 14, radius = 6 }: { width?: number | string; height?: number; radius?: number }) {
  return <span className="skeleton" style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-notice" role="alert">
      <Icon name="critical" size={18} />
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="error-notice__retry" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        {eyebrow ? <p className="page-header__eyebrow">{eyebrow}</p> : null}
        <h1 className="page-header__title">{title}</h1>
        {description ? <p className="page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}
