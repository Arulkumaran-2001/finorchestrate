import { DEFAULT_CATEGORIES } from './categories.js';
import type { Cents } from './money.js';
import { toCents } from './money.js';
import { DAY_MS, daysInPeriod, periodOf, periodStart, shiftPeriod } from './time.js';
import type { ActivityEvent, Approval, BudgetTransfer, GuardianPolicy, LedgerSnapshot, Transaction } from './types.js';

export const DEFAULT_POLICY: GuardianPolicy = {
  enabled: true,
  autonomousLimitCents: toCents(250),
  monthlyAutonomousCapCents: toCents(600),
  reserveFloorCents: toCents(500),
  rebalanceTrigger: 1,
  anomalySensitivity: 3.5,
  sweepIntervalMinutes: 60,
  voiceConfirmAboveCents: toCents(500),
};

/** Small deterministic PRNG so the demo ledger is identical on every machine. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Recurring {
  days: number[];
  merchant: string;
  description: string;
  categoryId: string;
  min: number;
  max?: number;
  direction?: 'expense' | 'income';
  /** Only in months where `index % every === phase`. */
  every?: number;
  phase?: number;
}

const SCHEDULE: Recurring[] = [
  { days: [2], merchant: 'Amazon Web Services', description: 'EC2 and EBS monthly invoice', categoryId: 'cloud', min: 820, max: 960 },
  { days: [2], merchant: 'AWS S3', description: 'S3 storage and requests', categoryId: 'cloud', min: 140, max: 185 },
  { days: [4, 11, 18, 25], merchant: 'AWS Bedrock', description: 'Bedrock inference usage', categoryId: 'cloud', min: 78, max: 118 },
  { days: [3], merchant: 'AWS Lambda', description: 'Lambda and API Gateway', categoryId: 'cloud', min: 42, max: 64 },
  { days: [8], merchant: 'Vercel', description: 'Vercel Pro team plan', categoryId: 'cloud', min: 60 },
  { days: [12], merchant: 'Cloudflare', description: 'Cloudflare Pro plan', categoryId: 'cloud', min: 25 },
  { days: [3], merchant: 'GitHub', description: 'GitHub Team seats', categoryId: 'tooling', min: 168 },
  { days: [6], merchant: 'Datadog', description: 'Datadog APM and log management', categoryId: 'tooling', min: 178, max: 194 },
  { days: [9], merchant: 'Sentry', description: 'Sentry Team plan', categoryId: 'tooling', min: 80 },
  { days: [10], merchant: 'Linear', description: 'Linear Standard plan', categoryId: 'tooling', min: 40 },
  { days: [14], merchant: 'Figma', description: 'Figma Professional seats', categoryId: 'tooling', min: 75 },
  { days: [15], merchant: 'Notion', description: 'Notion Plus workspace', categoryId: 'tooling', min: 48 },
  { days: [15], merchant: 'Slack', description: 'Slack Pro workspace', categoryId: 'tooling', min: 35 },
  { days: [20], merchant: 'JetBrains', description: 'JetBrains All Products licence', categoryId: 'tooling', min: 62 },
  { days: [5], merchant: 'Mira Chen', description: 'Backend contract, sprint invoice', categoryId: 'contractors', min: 1650, max: 1900 },
  { days: [19], merchant: 'Studio Parallel', description: 'Product design retainer', categoryId: 'contractors', min: 1150, max: 1350 },
  { days: [7, 21], merchant: 'Google Ads', description: 'Search campaign for the beta', categoryId: 'marketing', min: 120, max: 175 },
  { days: [16], merchant: 'LinkedIn Ads', description: 'Developer audience campaign', categoryId: 'marketing', min: 130, max: 170 },
  { days: [24], merchant: 'Console Weekly', description: 'Newsletter sponsorship slot', categoryId: 'marketing', min: 300, every: 2, phase: 0 },
  { days: [1], merchant: 'Bench Accounting', description: 'Monthly bookkeeping', categoryId: 'operations', min: 220 },
  { days: [1], merchant: 'Hatch Coworking', description: 'Coworking desks for four', categoryId: 'operations', min: 380 },
  { days: [1], merchant: 'Northwind Retail', description: 'Platform retainer', categoryId: 'income', min: 4000, direction: 'income' },
  { days: [10, 24], merchant: 'Stripe', description: 'Template marketplace payout', categoryId: 'income', min: 260, max: 420, direction: 'income' },
];

const HISTORY_MONTHS = 5;

/**
 * Builds the sample ledger for "Lumen Labs", a four person product studio.
 * Everything is placed relative to `now` so the demo is always current: five
 * complete months of history, a partial current month, an S3 egress spike and
 * a duplicated Datadog charge that the guardian is expected to catch.
 */
export function createDemoLedger(now: Date): LedgerSnapshot {
  const random = mulberry32(20261023);
  const current = periodOf(now);
  const firstPeriod = shiftPeriod(current, -HISTORY_MONTHS);
  const openingAt = periodStart(firstPeriod);
  const transactions: Transaction[] = [];
  let counter = 0;
  const id = (prefix: string) => `${prefix}_demo${String(++counter).padStart(5, '0')}`;
  const money = (min: number, max?: number): Cents => toCents(max === undefined ? min : min + (max - min) * random());

  const add = (at: Date, merchant: string, description: string, categoryId: string, amountCents: Cents, direction: 'expense' | 'income' = 'expense', source: Transaction['source'] = 'import') => {
    if (at.getTime() > now.getTime()) return;
    transactions.push({
      id: id('tx'),
      occurredAt: at.toISOString(),
      createdAt: at.toISOString(),
      description,
      merchant,
      amountCents,
      direction,
      categoryId,
      source,
      status: 'cleared',
    });
  };

  for (let index = 0; index <= HISTORY_MONTHS; index += 1) {
    const period = shiftPeriod(firstPeriod, index);
    const start = periodStart(period).getTime();
    const lastDay = daysInPeriod(period);
    const isCurrent = period === current;
    for (const item of SCHEDULE) {
      if (item.every && index % item.every !== (item.phase ?? 0)) continue;
      // The current month's Datadog charges are planted below as a duplicate pair.
      if (isCurrent && item.merchant === 'Datadog') continue;
      for (const day of item.days) {
        const at = new Date(start + (Math.min(day, lastDay) - 1) * DAY_MS + (9 + Math.floor(random() * 8)) * 3_600_000);
        let amount = money(item.min, item.max);
        if (isCurrent && item.merchant === 'AWS Bedrock') amount = Math.round(amount * 1.12);
        add(at, item.merchant, item.description, item.categoryId, amount, item.direction ?? 'expense');
      }
    }
    // Stripe fees follow marketplace payouts.
    const payouts = transactions.filter((tx) => tx.merchant === 'Stripe' && tx.direction === 'income' && periodOf(new Date(tx.occurredAt)) === period);
    if (payouts.length > 0) {
      const fees = Math.round(payouts.reduce((total, tx) => total + tx.amountCents, 0) * 0.029);
      add(new Date(start + (Math.min(28, lastDay) - 1) * DAY_MS + 10 * 3_600_000), 'Stripe', 'Stripe processing fees', 'operations', fees);
    }
  }

  // One off history that makes the ledger feel lived in.
  const monthStart = (offset: number) => periodStart(shiftPeriod(current, offset)).getTime();
  add(new Date(monthStart(-4) + 21 * DAY_MS + 11 * 3_600_000), 'Helio Health', 'Integration milestone payment', 'income', toCents(2500), 'income');
  add(new Date(monthStart(-3) + 12 * DAY_MS + 15 * 3_600_000), 'Clerky', 'Contractor agreement templates', 'operations', toCents(99));
  add(new Date(monthStart(-2) + 16 * DAY_MS + 13 * 3_600_000), 'Apple Store', 'Laptop battery replacement', 'reserve', toCents(329));
  add(new Date(monthStart(-1) + 9 * DAY_MS + 16 * 3_600_000), 'Namecheap', 'Domain renewals', 'operations', toCents(64), 'expense', 'voice');

  // The current month's story, anchored to now and kept inside the month.
  const floor = periodStart(current).getTime() + 2 * 3_600_000;
  const recent = (hoursAgo: number) => new Date(Math.max(floor, now.getTime() - hoursAgo * 3_600_000));
  const datadog = toCents(186.4);
  add(recent(50), 'Datadog', 'Datadog APM and log management', 'tooling', datadog);
  add(recent(54), 'AWS EC2', 'GPU training run, g6.12xlarge spot', 'cloud', toCents(640));
  add(recent(27), 'AWS S3', 'S3 cross-region data transfer', 'cloud', toCents(486.12));
  add(recent(20), 'Datadog', 'Datadog APM and log management', 'tooling', datadog);
  add(recent(3), 'Corner Bistro', 'Team lunch for the launch review', 'operations', toCents(86.5), 'expense', 'voice');

  transactions.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

  // Guardian history from last month: one autonomous move, one approved request.
  const previous = shiftPeriod(current, -1);
  const prevStart = periodStart(previous).getTime();
  const guardian = { type: 'guardian' as const, label: 'Scheduled sweep' };
  const owner = { type: 'owner' as const, label: 'Dashboard' };
  const autoAt = new Date(prevStart + 17 * DAY_MS + 9 * 3_600_000).toISOString();
  const approvalAt = new Date(prevStart + 24 * DAY_MS + 9 * 3_600_000).toISOString();
  const approvedAt = new Date(prevStart + 24 * DAY_MS + 14 * 3_600_000).toISOString();
  const approval: Approval = {
    id: 'apr_demo00001',
    status: 'approved',
    period: previous,
    legs: [{ fromCategoryId: 'reserve', toCategoryId: 'contractors', amountCents: toCents(300) }],
    totalCents: toCents(300),
    rationale: 'Contractors was on pace to finish about $280 over. The $300 gap is above the $250 autonomy limit, so it needs your approval.',
    requestedBy: guardian,
    createdAt: approvalAt,
    expiresAt: new Date(Date.parse(approvalAt) + 7 * DAY_MS).toISOString(),
    resolvedAt: approvedAt,
    resolvedBy: owner,
    targetCategoryId: 'contractors',
  };
  const transfers: BudgetTransfer[] = [
    {
      id: 'trf_demo00001',
      period: previous,
      fromCategoryId: 'reserve',
      toCategoryId: 'marketing',
      amountCents: toCents(90),
      reason: 'Marketing was on pace for $968 against a $900 limit. Moved $90 within the $250 autonomy limit.',
      actor: guardian,
      createdAt: autoAt,
    },
    {
      id: 'trf_demo00002',
      period: previous,
      fromCategoryId: 'reserve',
      toCategoryId: 'contractors',
      amountCents: toCents(300),
      reason: approval.rationale,
      actor: owner,
      createdAt: approvedAt,
      approvalId: approval.id,
    },
  ];

  const lastSweepAt = new Date(Math.max(floor, now.getTime() - 56 * 3_600_000)).toISOString();
  const lunch = transactions.find((tx) => tx.merchant === 'Corner Bistro');
  const activity: ActivityEvent[] = [
    ...(lunch
      ? [{
          id: 'evt_demo00006',
          at: lunch.occurredAt,
          type: 'expense.logged' as const,
          severity: 'info' as const,
          actor: { type: 'assistant' as const, label: 'Alexa+ via MCP' },
          title: 'Logged $86.50 for Team lunch for the launch review',
          detail: 'Operations, via Alexa+ via MCP.',
          refs: { transactionId: lunch.id },
        }]
      : []),
    {
      id: 'evt_demo00005',
      at: lastSweepAt,
      type: 'guardian.sweep',
      severity: 'info',
      actor: guardian,
      title: 'Guardian sweep: all clear',
      detail: 'Guardian sweep done. Every envelope is on track and nothing looks unusual.',
    },
    {
      id: 'evt_demo00004',
      at: approvedAt,
      type: 'approval.resolved',
      severity: 'success',
      actor: owner,
      title: 'Approved: $300 from Safety Reserve to Contractors',
      detail: 'The transfer was applied.',
      refs: { approvalId: approval.id },
    },
    {
      id: 'evt_demo00003',
      at: approvalAt,
      type: 'approval.requested',
      severity: 'warning',
      actor: guardian,
      title: 'Approval needed: $300 from Safety Reserve to Contractors',
      detail: approval.rationale,
      refs: { approvalId: approval.id },
    },
    {
      id: 'evt_demo00002',
      at: autoAt,
      type: 'transfer.executed',
      severity: 'success',
      actor: guardian,
      title: 'Moved $90 from Safety Reserve to Marketing',
      detail: transfers[0]!.reason,
      refs: { transferId: 'trf_demo00001' },
    },
    {
      id: 'evt_demo00001',
      at: openingAt.toISOString(),
      type: 'policy.updated',
      severity: 'info',
      actor: owner,
      title: 'Guardian enabled',
      detail: 'Autonomy limit $250 per move, $600 per month. Reserve floor $500.',
    },
  ];

  const nowIso = now.toISOString();
  return {
    workspace: {
      id: 'default',
      name: 'Lumen Labs',
      currency: 'USD',
      openingBalanceCents: toCents(48000),
      openingBalanceAt: openingAt.toISOString(),
      categories: structuredClone(DEFAULT_CATEGORIES).map((category) => ({
        ...category,
        monthlyLimitCents: DEMO_LIMITS[category.id] ?? category.monthlyLimitCents,
      })),
      policy: { ...DEFAULT_POLICY },
      createdAt: openingAt.toISOString(),
      updatedAt: nowIso,
      lastSweepAt,
      briefingCursors: {},
    },
    transactions,
    transfers,
    approvals: [approval],
    activity: activity.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
  };
}

const DEMO_LIMITS: Record<string, Cents> = {
  cloud: toCents(2000),
  tooling: toCents(760),
  contractors: toCents(3600),
  marketing: toCents(900),
  operations: toCents(750),
  reserve: toCents(1500),
};

/** An empty ledger for teams that want to start from scratch. */
export function createEmptyLedger(now: Date, openingBalanceCents: Cents = 0): LedgerSnapshot {
  const iso = now.toISOString();
  return {
    workspace: {
      id: 'default',
      name: 'My team',
      currency: 'USD',
      openingBalanceCents,
      openingBalanceAt: iso,
      categories: structuredClone(DEFAULT_CATEGORIES),
      policy: { ...DEFAULT_POLICY },
      createdAt: iso,
      updatedAt: iso,
      briefingCursors: {},
    },
    transactions: [],
    transfers: [],
    approvals: [],
    activity: [],
  };
}
