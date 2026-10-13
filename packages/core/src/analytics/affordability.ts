import { donorCapacities, planCoverage } from '../guardian.js';
import type { Cents } from '../money.js';
import { formatMoney, roundUpCents, speakMoney } from '../money.js';
import { periodEnd, periodOf, speakDate } from '../time.js';
import type { Category, LedgerSnapshot, TransferLeg } from '../types.js';
import { allCategoryStatuses } from './budget.js';
import { AVERAGE_MONTH_DAYS, computeRunway } from './cash.js';

export type AffordabilityVerdict = 'comfortable' | 'tight' | 'not-advised';

export interface AffordabilityInput {
  amountCents: Cents;
  categoryId: string;
  description: string;
  /** Treat the cost as a new monthly commitment instead of a one off purchase. */
  recurring: boolean;
}

export interface Affordability {
  verdict: AffordabilityVerdict;
  description: string;
  amountCents: Cents;
  recurring: boolean;
  categoryId: string;
  categoryName: string;
  limitCents: Cents;
  spentBeforeCents: Cents;
  projectedBeforeCents: Cents;
  projectedAfterCents: Cents;
  runwayBeforeMonths: number;
  runwayAfterMonths: number;
  /** Negative when the purchase shortens runway. */
  runwayDeltaDays: number;
  reasons: string[];
  suggestion: { kind: 'transfer'; legs: Array<TransferLeg & { fromName: string; toName: string }>; totalCents: Cents } | { kind: 'wait'; until: string } | null;
  speech: string;
}

/**
 * Answer "can we afford this?" with numbers: what it does to the envelope this
 * month, what it does to runway, and the cheapest way to make room if needed.
 */
export function assessAffordability(snapshot: LedgerSnapshot, now: Date, input: AffordabilityInput, category: Category): Affordability {
  const period = periodOf(now);
  const statuses = allCategoryStatuses(snapshot, now, period);
  const status = statuses.find((entry) => entry.categoryId === category.id)!;
  const runway = computeRunway(snapshot, now);

  const projectedAfterCents = status.projectedCents + input.amountCents;
  const cashAfter = runway.cashCents - input.amountCents;
  const burnAfter = runway.monthlyNetBurnCents + (input.recurring ? input.amountCents : 0);
  const runwayAfterMonths = burnAfter <= 0 ? Number.POSITIVE_INFINITY : Math.max(0, cashAfter / burnAfter);
  const runwayDeltaDays =
    Number.isFinite(runway.months) && Number.isFinite(runwayAfterMonths)
      ? Math.round((runwayAfterMonths - runway.months) * AVERAGE_MONTH_DAYS)
      : Number.isFinite(runwayAfterMonths)
        ? Math.round(-runwayAfterMonths * AVERAGE_MONTH_DAYS)
        : 0;

  const reasons: string[] = [];
  const overBy = projectedAfterCents - status.limitCents;
  let suggestion: Affordability['suggestion'] = null;
  if (overBy > 0) {
    reasons.push(`${category.name} would finish the month about ${formatMoney(overBy, { style: 'whole' })} over its ${formatMoney(status.limitCents, { style: 'whole' })} limit.`);
    const need = roundUpCents(overBy);
    const { legs, coveredCents } = planCoverage(category.id, need, donorCapacities(statuses, snapshot.workspace.policy, category.id));
    if (coveredCents >= need && legs.length > 0) {
      suggestion = { kind: 'transfer', legs: legs.map((leg) => ({ ...leg, fromName: nameOf(statuses, leg.fromCategoryId), toName: category.name })), totalCents: coveredCents };
    } else if (!input.recurring) {
      suggestion = { kind: 'wait', until: periodEnd(period).toISOString() };
    }
  } else {
    reasons.push(`${category.name} still has room: ${formatMoney(status.limitCents - projectedAfterCents, { style: 'whole' })} left after this at the current pace.`);
  }
  if (cashAfter < 0) reasons.push('There is not enough cash on hand to cover it.');
  if (Number.isFinite(runwayAfterMonths) && runwayDeltaDays < 0) {
    reasons.push(`Runway moves from ${runway.months.toFixed(1)} to ${runwayAfterMonths.toFixed(1)} months.`);
  }

  let verdict: AffordabilityVerdict = 'comfortable';
  if (cashAfter < 0 || runwayAfterMonths < 3 || (overBy > 0 && !suggestion)) verdict = 'not-advised';
  else if (overBy > 0 || runwayDeltaDays < -21) verdict = 'tight';

  const lead =
    verdict === 'comfortable'
      ? `Yes, ${speakMoney(input.amountCents)} for ${input.description} fits.`
      : verdict === 'tight'
        ? `You can, but it is tight.`
        : `I would hold off on ${input.description} for now.`;
  const detail =
    overBy > 0
      ? suggestion?.kind === 'transfer'
        ? ` ${category.name} would run about ${speakMoney(overBy, { approx: true })} over, so I would first move ${speakMoney(suggestion.totalCents)} from ${suggestion.legs[0]!.fromName}.`
        : suggestion?.kind === 'wait'
          ? ` ${category.name} would run about ${speakMoney(overBy, { approx: true })} over, and no envelope has room. The limit resets on ${speakDate(new Date(suggestion.until))}.`
          : ` ${category.name} would run about ${speakMoney(overBy, { approx: true })} over.`
      : ` ${category.name} keeps ${speakMoney(status.limitCents - projectedAfterCents)} of headroom this month.`;
  const runwayText =
    Number.isFinite(runway.months) && Number.isFinite(runwayAfterMonths) && runwayDeltaDays !== 0
      ? ` Runway ${input.recurring ? 'drops' : 'shifts'} by ${Math.abs(runwayDeltaDays)} days.`
      : '';

  return {
    verdict,
    description: input.description,
    amountCents: input.amountCents,
    recurring: input.recurring,
    categoryId: category.id,
    categoryName: category.name,
    limitCents: status.limitCents,
    spentBeforeCents: status.spentCents,
    projectedBeforeCents: status.projectedCents,
    projectedAfterCents,
    runwayBeforeMonths: runway.months,
    runwayAfterMonths,
    runwayDeltaDays,
    reasons,
    suggestion,
    speech: `${lead}${detail}${runwayText}`.trim(),
  };
}

function nameOf(statuses: ReturnType<typeof allCategoryStatuses>, id: string): string {
  return statuses.find((status) => status.categoryId === id)?.name ?? id;
}
