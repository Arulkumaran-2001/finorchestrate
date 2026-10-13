import type { Category } from './types.js';
import { toCents } from './money.js';

/**
 * Default envelopes for a small product team that pays for cloud, SaaS and
 * contract work. Keywords power both merchant classification and spoken
 * category matching ("put it under cloud").
 */
export const DEFAULT_CATEGORIES: Category[] = [
  {
    id: 'cloud',
    name: 'Cloud & Infrastructure',
    kind: 'operating',
    monthlyLimitCents: toCents(2600),
    alertThreshold: 0.8,
    tone: 'series-1',
    description: 'AWS compute, storage, data transfer, model inference and hosting.',
    keywords: [
      'cloud', 'aws', 'amazon web services', 'ec2', 'lambda', 's3', 'egress', 'bedrock', 'cloudfront', 'rds',
      'dynamodb', 'gpu', 'compute', 'server', 'servers', 'hosting', 'inference', 'kinesis', 'route 53', 'cdn',
      'vercel', 'cloudflare', 'database', 'infrastructure', 'infra', 'sagemaker', 'storage', 'bandwidth',
    ],
  },
  {
    id: 'tooling',
    name: 'Dev Tools & SaaS',
    kind: 'operating',
    monthlyLimitCents: toCents(950),
    alertThreshold: 0.85,
    tone: 'series-2',
    description: 'Developer tooling, observability and team software seats.',
    keywords: [
      'tools', 'tooling', 'saas', 'software', 'subscription', 'github', 'datadog', 'sentry', 'linear',
      'figma', 'notion', 'slack', 'jetbrains', 'postman', 'docker', 'npm', 'license', 'licenses', 'seats',
      'seat', 'observability', 'monitoring', 'ide', 'dev tools',
    ],
  },
  {
    id: 'contractors',
    name: 'Contractors',
    kind: 'operating',
    monthlyLimitCents: toCents(4200),
    alertThreshold: 0.8,
    tone: 'series-3',
    description: 'Freelance engineering, design and QA invoices.',
    keywords: [
      'contractor', 'contractors', 'freelance', 'freelancer', 'invoice', 'upwork', 'toptal', 'designer',
      'consultant', 'consulting', 'qa', 'agency', 'developer', 'contract',
    ],
  },
  {
    id: 'marketing',
    name: 'Marketing',
    kind: 'operating',
    monthlyLimitCents: toCents(900),
    alertThreshold: 0.8,
    tone: 'series-4',
    description: 'Paid acquisition, sponsorships and launch costs.',
    keywords: [
      'marketing', 'ads', 'ad', 'advertising', 'campaign', 'sponsorship', 'sponsor', 'google ads', 'linkedin',
      'promotion', 'launch', 'newsletter', 'seo', 'conference', 'booth', 'swag',
    ],
  },
  {
    id: 'operations',
    name: 'Operations',
    kind: 'operating',
    monthlyLimitCents: toCents(750),
    alertThreshold: 0.8,
    tone: 'series-5',
    description: 'Accounting, legal, banking fees, domains and coworking.',
    keywords: [
      'operations', 'ops', 'legal', 'lawyer', 'accounting', 'accountant', 'bookkeeping', 'tax', 'bank', 'fee',
      'fees', 'insurance', 'domain', 'domains', 'coworking', 'office', 'rent', 'internet', 'phone', 'stripe fee',
      'payroll', 'admin',
    ],
  },
  {
    id: 'reserve',
    name: 'Safety Reserve',
    kind: 'reserve',
    monthlyLimitCents: toCents(1500),
    alertThreshold: 0.6,
    tone: 'series-6',
    description: 'Unplanned costs. The guardian draws from here before touching other envelopes.',
    keywords: ['reserve', 'emergency', 'cushion', 'buffer', 'rainy day', 'contingency', 'safety'],
  },
];

/**
 * Known merchants map straight to a category and a clean display name. The
 * classifier falls back to keyword matching for anything not listed here.
 */
const MERCHANTS: Array<{ pattern: RegExp; merchant: string; categoryId: string }> = [
  { pattern: /\bbedrock\b/i, merchant: 'AWS Bedrock', categoryId: 'cloud' },
  { pattern: /\bs3\b|\begress\b|data transfer/i, merchant: 'AWS S3', categoryId: 'cloud' },
  { pattern: /\bec2\b|\bgpu\b/i, merchant: 'AWS EC2', categoryId: 'cloud' },
  { pattern: /\blambda\b/i, merchant: 'AWS Lambda', categoryId: 'cloud' },
  { pattern: /\bcloudfront\b/i, merchant: 'AWS CloudFront', categoryId: 'cloud' },
  { pattern: /\brds\b|aurora/i, merchant: 'AWS RDS', categoryId: 'cloud' },
  { pattern: /\baws\b|amazon web services/i, merchant: 'Amazon Web Services', categoryId: 'cloud' },
  { pattern: /\bvercel\b/i, merchant: 'Vercel', categoryId: 'cloud' },
  { pattern: /\bcloudflare\b/i, merchant: 'Cloudflare', categoryId: 'cloud' },
  { pattern: /\bgithub\b/i, merchant: 'GitHub', categoryId: 'tooling' },
  { pattern: /\bdatadog\b/i, merchant: 'Datadog', categoryId: 'tooling' },
  { pattern: /\bsentry\b/i, merchant: 'Sentry', categoryId: 'tooling' },
  { pattern: /\blinear\b/i, merchant: 'Linear', categoryId: 'tooling' },
  { pattern: /\bfigma\b/i, merchant: 'Figma', categoryId: 'tooling' },
  { pattern: /\bnotion\b/i, merchant: 'Notion', categoryId: 'tooling' },
  { pattern: /\bslack\b/i, merchant: 'Slack', categoryId: 'tooling' },
  { pattern: /\bjetbrains\b/i, merchant: 'JetBrains', categoryId: 'tooling' },
  { pattern: /\bpostman\b/i, merchant: 'Postman', categoryId: 'tooling' },
  { pattern: /\bupwork\b/i, merchant: 'Upwork', categoryId: 'contractors' },
  { pattern: /\btoptal\b/i, merchant: 'Toptal', categoryId: 'contractors' },
  { pattern: /google ads/i, merchant: 'Google Ads', categoryId: 'marketing' },
  { pattern: /linkedin/i, merchant: 'LinkedIn Ads', categoryId: 'marketing' },
  { pattern: /\bstripe\b/i, merchant: 'Stripe', categoryId: 'operations' },
  { pattern: /\bwework\b|coworking/i, merchant: 'Coworking', categoryId: 'operations' },
  { pattern: /\bgusto\b/i, merchant: 'Gusto', categoryId: 'operations' },
];

export interface Classification {
  categoryId: string;
  merchant: string;
  /** 1 for a known merchant, lower for keyword matches, 0 for the fallback. */
  confidence: number;
}

export function classifyExpense(text: string, categories: Category[], fallbackCategoryId?: string): Classification {
  const known = MERCHANTS.find((entry) => entry.pattern.test(text));
  if (known && categories.some((category) => category.id === known.categoryId)) {
    return { categoryId: known.categoryId, merchant: known.merchant, confidence: 1 };
  }
  const match = matchCategory(text, categories);
  const merchant = cleanMerchant(text);
  if (match) return { categoryId: match.id, merchant, confidence: 0.7 };
  const fallback =
    categories.find((category) => category.id === fallbackCategoryId) ??
    categories.find((category) => category.kind === 'operating') ??
    categories[0];
  return { categoryId: fallback?.id ?? 'operations', merchant, confidence: 0 };
}

/** Find the category a phrase refers to by id, name or keyword. Longest keyword wins. */
export function matchCategory(text: string, categories: Category[]): Category | undefined {
  const normalized = ` ${normalize(text)} `;
  let best: { category: Category; weight: number } | undefined;
  for (const category of categories) {
    const candidates = [category.id, category.name, ...category.keywords];
    for (const candidate of candidates) {
      const needle = normalize(candidate);
      if (!needle) continue;
      if (normalized.includes(` ${needle} `)) {
        const weight = needle.length + (candidate === category.id || candidate === category.name ? 2 : 0);
        if (!best || weight > best.weight) best = { category, weight };
      }
    }
  }
  return best?.category;
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeMerchant(merchant: string): string {
  return normalize(merchant).replace(/\b(inc|llc|ltd|co|corp)\b/g, '').replace(/\s+/g, ' ').trim();
}

function cleanMerchant(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'Unspecified';
  const words = trimmed.split(' ').slice(0, 4).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
