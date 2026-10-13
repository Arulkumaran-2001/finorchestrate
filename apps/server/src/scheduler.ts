import type { FinanceService } from '@finorchestrate/core';

/**
 * In-process guardian schedule for single server deployments. It checks once
 * a minute and sweeps when the policy interval has passed since the last
 * sweep, so a restart never causes a burst of sweeps. On AWS the same sweep
 * runs from an EventBridge schedule instead (see lambda/guardian.ts).
 */
export class GuardianScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private nextAt: string | null = null;

  private notBefore = 0;

  constructor(
    private readonly service: FinanceService,
    private readonly log: (message: string) => void,
    /** Grace period after boot. Demo mode uses it so a presenter can run the first sweep live. */
    private readonly startDelayMinutes = 0,
  ) {}

  start(): void {
    if (this.timer) return;
    this.notBefore = Date.now() + this.startDelayMinutes * 60_000;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  nextSweepAt(): string | null {
    return this.nextAt;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const snapshot = await this.service.snapshot();
      const { policy, lastSweepAt } = snapshot.workspace;
      if (!policy.enabled || policy.sweepIntervalMinutes <= 0) {
        this.nextAt = null;
        return;
      }
      const intervalMs = policy.sweepIntervalMinutes * 60_000;
      const due = Math.max(lastSweepAt ? Date.parse(lastSweepAt) + intervalMs : Date.now(), this.notBefore);
      this.nextAt = new Date(Math.max(due, Date.now())).toISOString();
      if (Date.now() >= due) {
        const report = await this.service.runGuardian({ type: 'guardian', label: 'Scheduled sweep' });
        this.nextAt = new Date(Date.parse(report.ranAt) + intervalMs).toISOString();
        this.log(`guardian: ${report.speech}`);
      }
    } catch (error) {
      this.log(`guardian sweep failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
