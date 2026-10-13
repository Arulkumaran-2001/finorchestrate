import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { ActivityEvent, LedgerEvent } from '@finorchestrate/core';

/** Activity worth interrupting someone for. Routine logging stays in the feed. */
const NOTIFY_TYPES = new Set<ActivityEvent['type']>(['approval.requested', 'anomaly.flagged', 'transfer.executed', 'guardian.sweep']);

export interface Notifier {
  handle(event: LedgerEvent): Promise<void>;
  channels: string[];
}

export function shouldNotify(event: ActivityEvent): boolean {
  if (!NOTIFY_TYPES.has(event.type)) return false;
  if (event.type === 'transfer.executed') return event.actor.type === 'guardian';
  if (event.type === 'guardian.sweep') return event.severity === 'critical';
  return true;
}

export function formatNotification(events: ActivityEvent[]): { subject: string; text: string } {
  const lead = events.find((event) => event.type === 'approval.requested') ?? events[0]!;
  const subject = `FinOrchestrate: ${lead.title}`.slice(0, 99);
  const text = events.map((event) => `${event.title}\n${event.detail}`).join('\n\n');
  return { subject, text };
}

/**
 * Fans guardian outcomes out to Amazon SNS (email, SMS, chat) and an optional
 * webhook such as a Slack incoming webhook. Failures are logged, never thrown,
 * so a notification outage can not block the ledger.
 */
export function createNotifier(options: { snsTopicArn: string | null; webhookUrl: string | null; region: string | null; log: (message: string) => void }): Notifier {
  const sns = options.snsTopicArn ? new SNSClient(options.region ? { region: options.region } : {}) : null;
  const channels = [sns ? 'sns' : null, options.webhookUrl ? 'webhook' : null].filter((value): value is string => Boolean(value));
  return {
    channels,
    async handle(event) {
      const relevant = event.activity.filter(shouldNotify);
      if (relevant.length === 0 || channels.length === 0) return;
      const { subject, text } = formatNotification(relevant);
      const tasks: Array<Promise<unknown>> = [];
      if (sns && options.snsTopicArn) tasks.push(sns.send(new PublishCommand({ TopicArn: options.snsTopicArn, Subject: subject, Message: text })));
      if (options.webhookUrl) {
        tasks.push(
          fetch(options.webhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: `*${subject}*\n${text}`, events: relevant }),
            signal: AbortSignal.timeout(5000),
          }),
        );
      }
      const results = await Promise.allSettled(tasks);
      for (const result of results) if (result.status === 'rejected') options.log(`notification failed: ${String(result.reason)}`);
    },
  };
}
