import { useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/overlays';
import { Badge } from '../../components/Status';
import { RESOLVE_APPROVAL, type Approval } from '../../lib/api';
import { shortDate, timeAgo, whole } from '../../lib/format';
import { useMutation } from '../../lib/graphql';
import './shared.css';

export function ApprovalItem({ approval, compact = false }: { approval: Approval; compact?: boolean }) {
  const toast = useToast();
  const resolve = useMutation<{ resolveApproval: { speech: string } }>(RESOLVE_APPROVAL);
  const [choice, setChoice] = useState<'approve' | 'reject' | null>(null);

  const decide = async (decision: 'approve' | 'reject') => {
    setChoice(decision);
    try {
      const result = await resolve.run({ id: approval.id, decision });
      toast({ title: decision === 'approve' ? 'Approved' : 'Rejected', detail: result.resolveApproval.speech, tone: decision === 'approve' ? 'success' : 'info' });
    } catch (error) {
      toast({ title: 'Could not update the approval', detail: (error as Error).message, tone: 'critical' });
    } finally {
      setChoice(null);
    }
  };

  const pending = approval.status === 'pending';
  return (
    <article className={`approval-item${compact ? ' approval-item--compact' : ''}`}>
      <div className="approval-item__head">
        <span className="approval-item__icon">
          <Icon name={pending ? 'lock' : approval.status === 'approved' ? 'success' : 'close'} size={18} />
        </span>
        <div className="approval-item__title">
          <p className="approval-item__amount">
            {whole(approval.totalCents)} <span>into {approval.targetName}</span>
          </p>
          <p className="approval-item__meta">
            {approval.requestedBy.label} · {timeAgo(approval.createdAt)}
            {pending ? ` · expires ${shortDate(approval.expiresAt)}` : ''}
          </p>
        </div>
        {!pending ? <Badge tone={approval.status === 'approved' ? 'good' : 'neutral'}>{approval.status}</Badge> : null}
      </div>
      <ul className="leg-list">
        {approval.legs.map((leg) => (
          <li key={`${leg.fromCategoryId}-${leg.toCategoryId}`} className="leg-list__item">
            <span className="leg-list__name">{leg.fromName}</span>
            <Icon name="transfer" size={16} className="leg-list__arrow" />
            <span className="leg-list__name">{leg.toName}</span>
            <span className="leg-list__amount">{whole(leg.amountCents)}</span>
          </li>
        ))}
      </ul>
      {!compact ? <p className="approval-item__why">{approval.rationale}</p> : null}
      {pending ? (
        <div className="approval-item__actions">
          <Button variant="primary" size="sm" icon="check" loading={choice === 'approve'} disabled={choice !== null} onClick={() => void decide('approve')}>
            Approve
          </Button>
          <Button variant="ghost" size="sm" icon="close" loading={choice === 'reject'} disabled={choice !== null} onClick={() => void decide('reject')}>
            Reject
          </Button>
        </div>
      ) : null}
    </article>
  );
}
