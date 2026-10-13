import { Icon, type IconName } from '../../components/Icon';
import { SeverityIcon } from '../../components/Status';
import type { Activity } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import './shared.css';

const ACTOR_ICON: Record<string, IconName> = { owner: 'overview', assistant: 'microphone', guardian: 'shield', system: 'info' };

export function ActivityList({ items, showDetail = true }: { items: Activity[]; showDetail?: boolean }) {
  return (
    <ol className="activity">
      {items.map((item) => (
        <li key={item.id} className="activity__item">
          <SeverityIcon severity={item.severity} />
          <div className="activity__body">
            <p className="activity__title">{item.title}</p>
            {showDetail ? <p className="activity__detail">{item.detail}</p> : null}
            <p className="activity__meta">
              <Icon name={ACTOR_ICON[item.actor.type] ?? 'info'} size={13} />
              <span>{item.actor.label}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={item.at}>{timeAgo(item.at)}</time>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
