import { loadConfig } from '../config.js';
import { createRuntime, type Runtime } from '../runtime.js';

let runtime: Promise<Runtime> | null = null;

/**
 * Entry point for the scheduled guardian on AWS Lambda. An EventBridge
 * Scheduler rule invokes it on the policy interval; the HTTP server runs in a
 * separate function behind a Function URL.
 */
export async function handler(): Promise<{ ok: boolean; speech: string; executed: number; approvals: number; flagged: number }> {
  runtime ??= createRuntime(loadConfig(), (message) => console.log(message));
  const { service, notifier } = await runtime;
  const policy = await service.policy();
  if (!policy.enabled) return { ok: true, speech: 'Guardian is paused.', executed: 0, approvals: 0, flagged: 0 };
  const report = await service.runGuardian({ type: 'guardian', label: 'Scheduled sweep (EventBridge)' });
  // Give notifications triggered by the sweep a moment to flush before the sandbox freezes.
  await new Promise((resolve) => setTimeout(resolve, notifier.channels.length > 0 ? 400 : 0));
  return { ok: true, speech: report.speech, executed: report.executed.length, approvals: report.approvalsRequested.length, flagged: report.flagged.length };
}
