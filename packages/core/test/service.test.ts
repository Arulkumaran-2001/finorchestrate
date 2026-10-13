import { beforeEach, describe, expect, it } from 'vitest';
import { DomainError, FinanceService, MemoryRepository, createDemoLedger, planSweep, type Actor, type LedgerEvent } from '../src/index.js';

const owner: Actor = { type: 'owner', label: 'Dashboard' };
const voice: Actor = { type: 'assistant', label: 'Alexa+ via MCP' };
const guardian: Actor = { type: 'guardian', label: 'Scheduled sweep' };

let clock: Date;
let events: LedgerEvent[];
let service: FinanceService;

beforeEach(async () => {
  clock = new Date('2026-10-13T08:30:00Z');
  events = [];
  service = new FinanceService({
    repository: new MemoryRepository(),
    seed: createDemoLedger,
    clock: () => clock,
    onChange: (event) => events.push(event),
  });
  await service.init();
});

const tick = (minutes: number) => {
  clock = new Date(clock.getTime() + minutes * 60_000);
};

describe('guardian sweep', () => {
  it('moves small gaps on its own and asks before large ones', async () => {
    const report = await service.runGuardian(guardian);
    expect(report.executed).toHaveLength(1);
    expect(report.executed[0]!.targetCategoryId).toBe('tooling');
    expect(report.executed[0]!.totalCents).toBeLessThanOrEqual(25000);
    expect(report.approvalsRequested).toHaveLength(1);
    expect(report.approvalsRequested[0]!.targetCategoryId).toBe('cloud');
    expect(report.approvalsRequested[0]!.totalCents).toBeGreaterThan(25000);
    expect(report.flagged.map((item) => item.merchant).sort()).toEqual(['AWS S3', 'Datadog']);
    expect(report.speech).toContain('on my own');
    expect(events.at(-1)!.activity.some((event) => event.type === 'guardian.sweep')).toBe(true);
  });

  it('is idempotent: a second sweep does not repeat itself', async () => {
    await service.runGuardian(guardian);
    tick(60);
    const second = await service.runGuardian(guardian);
    expect(second.executed).toHaveLength(0);
    expect(second.approvalsRequested).toHaveLength(0);
    expect(second.flagged).toHaveLength(0);
  });

  it('respects the monthly autonomy cap', async () => {
    await service.updatePolicy({ autonomousLimitCents: 25000, monthlyAutonomousCapCents: 25000 }, owner);
    await service.moveBudget({ from: 'reserve', to: 'marketing', amountCents: 1000 }, owner);
    const snapshot = await service.snapshot();
    snapshot.transfers.push({
      id: 'trf_used',
      period: '2026-10',
      fromCategoryId: 'reserve',
      toCategoryId: 'operations',
      amountCents: 20000,
      reason: 'earlier move',
      actor: guardian,
      createdAt: clock.toISOString(),
    });
    const plan = planSweep(snapshot, clock);
    expect(plan.transfers).toHaveLength(0);
    expect(plan.approvals.map((approval) => approval.targetCategoryId).sort()).toEqual(['cloud', 'tooling']);
  });

  it('does nothing while paused', async () => {
    await service.updatePolicy({ enabled: false }, owner);
    const report = await service.runGuardian(guardian);
    expect(report.executed).toHaveLength(0);
    expect(report.approvalsRequested).toHaveLength(0);
    expect(report.speech).toContain('paused');
  });

  it('expires stale approvals', async () => {
    await service.runGuardian(guardian);
    clock = new Date('2026-10-31T23:00:00Z');
    const report = await service.runGuardian(guardian);
    expect(report.expiredApprovals).toBe(1);
  });
});

describe('approvals', () => {
  it('applies an approved guardian proposal', async () => {
    await service.runGuardian(guardian);
    const before = await service.budgetStatus('cloud');
    const result = await service.resolveApproval('latest', 'approve', voice);
    expect(result.transfers).toHaveLength(1);
    const after = await service.budgetStatus('cloud');
    expect(after.focus!.limitCents).toBe(before.focus!.limitCents + result.approval!.totalCents);
    expect(result.speech).toMatch(/^Approved/);
    await expect(service.resolveApproval(result.approval!.id, 'approve', owner)).rejects.toThrow(DomainError);
  });

  it('rejects without moving money', async () => {
    await service.runGuardian(guardian);
    const before = await service.budgetStatus('cloud');
    const result = await service.resolveApproval(undefined, 'reject', voice);
    expect(result.transfers).toHaveLength(0);
    expect((await service.budgetStatus('cloud')).focus!.limitCents).toBe(before.focus!.limitCents);
  });

  it('answers politely when nothing is pending', async () => {
    const result = await service.resolveApproval('latest', 'approve', voice);
    expect(result.approval).toBeNull();
    expect(result.speech).toContain('nothing waiting');
  });
});

describe('moving budget', () => {
  it('executes small voice moves immediately', async () => {
    const result = await service.moveBudget({ from: 'reserve', to: 'marketing', amountCents: 15000 }, voice);
    expect(result.status).toBe('executed');
    expect(result.to.limitCents).toBe(90000 + 15000);
  });

  it('requires confirmation for large voice moves but not for the owner', async () => {
    const spoken = await service.moveBudget({ from: 'Safety Reserve', to: 'cloud', amountCents: 60000 }, voice);
    expect(spoken.status).toBe('approval_required');
    expect(spoken.speech).toContain('Say approve');
    const typed = await service.moveBudget({ from: 'reserve', to: 'cloud', amountCents: 60000 }, owner);
    expect(typed.status).toBe('executed');
  });

  it('refuses to overdraw an envelope', async () => {
    await expect(service.moveBudget({ from: 'marketing', to: 'cloud', amountCents: 500000 }, owner)).rejects.toMatchObject({ code: 'insufficient_budget' });
  });

  it('explains unknown envelopes', async () => {
    await expect(service.moveBudget({ from: 'snacks', to: 'cloud', amountCents: 1000 }, owner)).rejects.toThrow(/could not find/);
  });
});

describe('logging', () => {
  it('auto categorises and reports the envelope', async () => {
    const result = await service.logExpense({ amountCents: 4200, description: 'Bedrock inference', source: 'voice' }, voice);
    expect(result.transaction.categoryId).toBe('cloud');
    expect(result.transaction.merchant).toBe('AWS Bedrock');
    expect(result.autoCategorized).toBe(true);
    expect(result.speech).toMatch(/^Logged \$42 for Bedrock inference under Cloud & Infrastructure\./);
  });

  it('flags a duplicate the moment it is logged', async () => {
    await service.logExpense({ amountCents: 9900, description: 'Postman team plan', merchant: 'Postman', source: 'voice' }, voice);
    tick(5);
    const second = await service.logExpense({ amountCents: 9900, description: 'Postman team plan', merchant: 'Postman', source: 'voice' }, voice);
    expect(second.anomaly?.kind).toBe('duplicate');
    expect(second.transaction.status).toBe('flagged');
    expect(second.speech).toContain('Heads up');
  });

  it('validates input', async () => {
    await expect(service.logExpense({ amountCents: 0, description: 'x', source: 'api' }, voice)).rejects.toThrow(DomainError);
    await expect(service.logExpense({ amountCents: 100, description: '  ', source: 'api' }, voice)).rejects.toThrow(DomainError);
    await expect(
      service.logExpense({ amountCents: 100, description: 'Later', occurredAt: '2027-01-01', source: 'api' }, voice),
    ).rejects.toThrow(/future/);
  });

  it('marks a flagged charge as reviewed', async () => {
    await service.runGuardian(guardian);
    const flagged = (await service.transactions({ flaggedOnly: true })).items;
    expect(flagged.length).toBe(2);
    await service.reviewTransaction(flagged[0]!.id, owner);
    expect((await service.transactions({ flaggedOnly: true })).items).toHaveLength(1);
  });
});

describe('briefing memory', () => {
  it('remembers what each client has already heard', async () => {
    const first = await service.briefing('alexa-kitchen');
    expect(first.since).toBeNull();
    tick(30);
    await service.runGuardian(guardian);
    tick(30);
    const second = await service.briefing('alexa-kitchen');
    expect(second.since).toBe(new Date('2026-10-13T08:30:00Z').toISOString());
    expect(second.speech).toContain('the guardian moved money once on its own');
    tick(30);
    const third = await service.briefing('alexa-kitchen');
    expect(third.speech).toContain('nothing new happened');
    const otherDevice = await service.briefing('alexa-office');
    expect(otherDevice.speech).toContain('the guardian moved money once');
  });
});

describe('reset', () => {
  it('restores the demo ledger', async () => {
    await service.logExpense({ amountCents: 100000, description: 'Something big', source: 'dashboard' }, owner);
    await service.reset(owner);
    const page = await service.transactions({ search: 'Something big' });
    expect(page.total).toBe(0);
    expect((await service.activity(1))[0]!.type).toBe('ledger.reset');
  });
});
