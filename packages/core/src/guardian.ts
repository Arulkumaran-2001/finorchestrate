import type { CategoryStatus } from './analytics/budget.js';
import { allCategoryStatuses } from './analytics/budget.js';
import { assessTransaction } from './analytics/anomalies.js';
import type { Cents } from './money.js';
import { formatMoney, roundUpCents, sumCents } from './money.js';
import type { Period } from './time.js';
import { DAY_MS, periodOf } from './time.js';
import type { AnomalyFinding, GuardianPolicy, LedgerSnapshot, TransferLeg } from './types.js';

export interface DonorCapacity {
  categoryId: string;
  name: string;
  kind: CategoryStatus['kind'];
  availableCents: Cents;
}

/**
 * Money that can be moved without creating a new problem. Reserves give up
 * anything above the policy floor. Operating envelopes only give up surplus
 * beyond their own projection plus a ten percent cushion.
 */
export function donorCapacities(statuses: CategoryStatus[], policy: GuardianPolicy, excludeCategoryId?: string): DonorCapacity[] {
  const donors: DonorCapacity[] = [];
  for (const status of statuses) {
    if (status.categoryId === excludeCategoryId) continue;
    const available =
      status.kind === 'reserve'
        ? status.limitCents - status.spentCents - policy.reserveFloorCents
        : status.limitCents - status.projectedCents - Math.round(status.limitCents * 0.1);
    const rounded = Math.floor(available / 1000) * 1000;
    if (rounded > 0) donors.push({ categoryId: status.categoryId, name: status.name, kind: status.kind, availableCents: rounded });
  }
  return donors.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'reserve' ? -1 : 1;
    return b.availableCents - a.availableCents;
  });
}

/** Greedy cover: reserve first, then the envelope with the most slack. */
export function planCoverage(targetCategoryId: string, shortfallCents: Cents, donors: DonorCapacity[]): { legs: TransferLeg[]; coveredCents: Cents } {
  const legs: TransferLeg[] = [];
  let remaining = shortfallCents;
  for (const donor of donors) {
    if (remaining <= 0) break;
    if (donor.categoryId === targetCategoryId) continue;
    const amount = Math.min(donor.availableCents, remaining);
    if (amount <= 0) continue;
    legs.push({ fromCategoryId: donor.categoryId, toCategoryId: targetCategoryId, amountCents: amount });
    remaining -= amount;
  }
  return { legs, coveredCents: shortfallCents - Math.max(remaining, 0) };
}

export interface PlannedTransfer {
  targetCategoryId: string;
  legs: TransferLeg[];
  totalCents: Cents;
  reason: string;
}

export interface PlannedApproval extends PlannedTransfer {
  shortfallCents: Cents;
  uncoveredCents: Cents;
}

export interface PlannedFlag {
  transactionId: string;
  finding: AnomalyFinding;
}

export interface SweepPlan {
  period: Period;
  transfers: PlannedTransfer[];
  approvals: PlannedApproval[];
  flags: PlannedFlag[];
  expiredApprovalIds: string[];
  /** Situations the guardian could not act on, written for the owner. */
  warnings: string[];
  autonomousUsedCents: Cents;
}

export function autonomousSpentThisPeriod(snapshot: LedgerSnapshot, period: Period): Cents {
  return sumCents(
    snapshot.transfers.filter((t) => t.period === period && t.actor.type === 'guardian' && !t.approvalId).map((t) => t.amountCents),
  );
}

/**
 * Pure planning step of a guardian sweep. The service executes the plan, so
 * the plan can be unit tested and shown to the owner as a dry run.
 */
export function planSweep(snapshot: LedgerSnapshot, now: Date): SweepPlan {
  const policy = snapshot.workspace.policy;
  const period = periodOf(now);
  const plan: SweepPlan = {
    period,
    transfers: [],
    approvals: [],
    flags: [],
    expiredApprovalIds: snapshot.approvals
      .filter((approval) => approval.status === 'pending' && Date.parse(approval.expiresAt) <= now.getTime())
      .map((approval) => approval.id),
    warnings: [],
    autonomousUsedCents: autonomousSpentThisPeriod(snapshot, period),
  };
  if (!policy.enabled) return plan;

  // Statuses change as the plan moves money, so work on a mutable copy.
  const statuses = allCategoryStatuses(snapshot, now, period);
  const byId = new Map(statuses.map((status) => [status.categoryId, { ...status }]));
  const openTargets = new Set(
    snapshot.approvals
      .filter((approval) => approval.status === 'pending' && approval.period === period && !plan.expiredApprovalIds.includes(approval.id))
      .map((approval) => approval.targetCategoryId),
  );

  const pressured = [...byId.values()]
    .filter((status) => status.kind === 'operating' && status.projectedCents > status.limitCents * policy.rebalanceTrigger)
    .sort((a, b) => b.projectedCents - b.limitCents - (a.projectedCents - a.limitCents));

  let autonomousUsed = plan.autonomousUsedCents;
  for (const target of pressured) {
    if (openTargets.has(target.categoryId)) continue;
    const shortfall = roundUpCents(target.projectedCents - target.limitCents);
    if (shortfall <= 0) continue;
    const donors = donorCapacities([...byId.values()], policy, target.categoryId);
    const { legs, coveredCents } = planCoverage(target.categoryId, shortfall, donors);
    const projectedText = `${target.name} is on pace for ${formatMoney(target.projectedCents, { style: 'whole' })} against a ${formatMoney(target.limitCents, { style: 'whole' })} limit`;

    if (legs.length === 0) {
      plan.warnings.push(`${projectedText}, and no envelope has spare budget to cover the ${formatMoney(shortfall, { style: 'whole' })} gap.`);
      continue;
    }
    const fits = coveredCents === shortfall && shortfall <= policy.autonomousLimitCents && autonomousUsed + shortfall <= policy.monthlyAutonomousCapCents;
    if (fits) {
      plan.transfers.push({
        targetCategoryId: target.categoryId,
        legs,
        totalCents: coveredCents,
        reason: `${projectedText}. Moved ${formatMoney(coveredCents, { style: 'whole' })} within the ${formatMoney(policy.autonomousLimitCents, { style: 'whole' })} autonomy limit.`,
      });
      autonomousUsed += coveredCents;
    } else {
      const why =
        coveredCents < shortfall
          ? `Only ${formatMoney(coveredCents, { style: 'whole' })} of the ${formatMoney(shortfall, { style: 'whole' })} gap can be covered`
          : shortfall > policy.autonomousLimitCents
            ? `The ${formatMoney(shortfall, { style: 'whole' })} gap is above the ${formatMoney(policy.autonomousLimitCents, { style: 'whole' })} autonomy limit`
            : `Covering it would pass the ${formatMoney(policy.monthlyAutonomousCapCents, { style: 'whole' })} monthly autonomy cap`;
      plan.approvals.push({
        targetCategoryId: target.categoryId,
        legs,
        totalCents: coveredCents,
        shortfallCents: shortfall,
        uncoveredCents: shortfall - coveredCents,
        reason: `${projectedText}. ${why}, so it needs your approval.`,
      });
    }
    // Reflect the planned move so later targets see the reduced donor capacity.
    for (const leg of legs) {
      const donor = byId.get(leg.fromCategoryId);
      if (donor) donor.limitCents -= leg.amountCents;
      const receiver = byId.get(leg.toCategoryId);
      if (receiver) receiver.limitCents += leg.amountCents;
    }
  }

  const windowStart = now.getTime() - 45 * DAY_MS;
  for (const tx of snapshot.transactions) {
    if (tx.direction !== 'expense' || tx.status === 'flagged' || tx.reviewedAt) continue;
    const time = Date.parse(tx.occurredAt);
    if (time < windowStart || time > now.getTime()) continue;
    const finding = assessTransaction(tx, snapshot.transactions, snapshot.workspace.categories, { sensitivity: policy.anomalySensitivity });
    if (finding) plan.flags.push({ transactionId: tx.id, finding });
  }
  return plan;
}
