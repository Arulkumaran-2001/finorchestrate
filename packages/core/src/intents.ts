import { matchCategory, normalize } from './categories.js';
import type { Category } from './types.js';

/**
 * Deterministic voice intent engine. It maps an utterance to one MCP tool
 * call so the assistant works fully offline. A model based planner can sit in
 * front of it; this engine is the fallback and the test oracle.
 */
export type ToolName =
  | 'get_budget_status'
  | 'log_expense'
  | 'log_income'
  | 'get_runway'
  | 'forecast_cash'
  | 'audit_spending'
  | 'check_affordability'
  | 'move_budget'
  | 'list_approvals'
  | 'resolve_approval'
  | 'run_guardian'
  | 'get_briefing';

export interface ParsedIntent {
  tool: ToolName;
  arguments: Record<string, unknown>;
  /** Short restatement of what was understood, shown in the console transcript. */
  understood: string;
}

export interface IntentContext {
  categories: Pick<Category, 'id' | 'name' | 'keywords' | 'kind'>[];
  now?: Date;
}

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALE: Record<string, number> = { hundred: 100, thousand: 1000, grand: 1000, million: 1_000_000 };

/** "forty two" becomes "42", "twelve hundred" becomes "1200", "a thousand" becomes "1000". */
export function wordsToNumbers(text: string): string {
  const tokens = text.split(/(\s+|-)/);
  const out: string[] = [];
  let current = 0;
  let total = 0;
  let inNumber = false;
  let pendingGlue: string[] = [];

  const flush = () => {
    if (inNumber) out.push(String(total + current));
    out.push(...pendingGlue);
    pendingGlue = [];
    current = 0;
    total = 0;
    inNumber = false;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const raw = tokens[index]!;
    if (/^(\s+|-)$/.test(raw)) {
      if (inNumber) pendingGlue.push(raw);
      else out.push(raw);
      continue;
    }
    const word = raw.toLowerCase();
    const nextWord = tokens.slice(index + 1).find((token) => !/^(\s+|-)$/.test(token))?.toLowerCase();
    if (word in SMALL) {
      current += SMALL[word]!;
      inNumber = true;
      pendingGlue = [];
    } else if (word in SCALE && (inNumber || word !== 'grand')) {
      const scale = SCALE[word]!;
      if (!inNumber) current = 1;
      if (scale === 100) current *= 100;
      else {
        total += current * scale;
        current = 0;
      }
      inNumber = true;
      pendingGlue = [];
    } else if (word === 'a' && nextWord !== undefined && nextWord in SCALE && !inNumber) {
      current = 1;
      inNumber = true;
      pendingGlue = [];
    } else if (word === 'and' && inNumber && nextWord !== undefined && nextWord in SMALL) {
      pendingGlue = [];
    } else {
      flush();
      out.push(raw);
    }
  }
  flush();
  return out.join('');
}

export interface AmountMatch {
  dollars: number;
  index: number;
  length: number;
}

/** Find the money amount in an utterance. Prefers explicit dollar signs and units. */
export function extractAmount(text: string): AmountMatch | undefined {
  const pattern = /(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(k|thousand|grand)?(?:\s?(dollars?|bucks|usd))?(?:\s(?:and\s)?(\d{1,2})\s?cents?)?/gi;
  const candidates: Array<AmountMatch & { weight: number }> = [];
  for (const match of text.matchAll(pattern)) {
    const [whole, dollarSign, integer, fraction, multiplier, unit, cents] = match;
    if (!integer) continue;
    let value = Number(integer.replace(/,/g, ''));
    if (fraction) value += Number(`0.${fraction}`);
    if (multiplier) value *= 1000;
    if (cents) value += Number(cents) / 100;
    const following = text.slice((match.index ?? 0) + whole.length).trimStart().toLowerCase();
    // Skip things that are clearly not money: "3 months", "20 percent", "in 2 weeks".
    if (!dollarSign && !unit && /^(months?|percent|%|days?|weeks?|years?|x\b|times)/.test(following)) continue;
    const weight = (dollarSign ? 4 : 0) + (unit ? 3 : 0) + (multiplier ? 1 : 0) + (fraction ? 1 : 0);
    candidates.push({ dollars: Math.round(value * 100) / 100, index: match.index ?? 0, length: whole.length, weight });
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.weight - a.weight || a.index - b.index);
  const best = candidates[0]!;
  return { dollars: best.dollars, index: best.index, length: best.length };
}

function extractPercent(text: string): number | undefined {
  const match = /(\d+(?:\.\d+)?)\s?(%|percent|per cent)/.exec(text);
  if (match) return Number(match[1]);
  if (/\bdouble[sd]?\b/.test(text)) return 100;
  if (/\bhalf\b/.test(text)) return 50;
  return undefined;
}

function extractMonths(text: string): number | undefined {
  const match = /(\d+)\s?(months?|mo\b|quarters?|years?)/.exec(text);
  if (match) {
    const value = Number(match[1]);
    if (match[2]!.startsWith('quarter')) return value * 3;
    if (match[2]!.startsWith('year')) return value * 12;
    return value;
  }
  if (/\bquarter\b/.test(text)) return 3;
  if (/\b(year|twelve months)\b/.test(text)) return 12;
  return undefined;
}

function extractDate(text: string, now: Date): string | undefined {
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  if (/\byesterday\b/.test(text)) return iso(new Date(now.getTime() - 86_400_000));
  const daysAgo = /(\d+)\s?days?\s?ago/.exec(text);
  if (daysAgo) return iso(new Date(now.getTime() - Number(daysAgo[1]) * 86_400_000));
  return undefined;
}

const DECREASE = /\b(drops?|dropped|down|decreases?|decreased|cuts?|lower|less|falls?|fell|shrinks?|reduced?)\b/;

const FILLER =/^(hey\s+|ok\s+|okay\s+)?(alexa|computer|assistant)?[,\s]*(please\s+|can you\s+|could you\s+|would you\s+|i want to\s+|i'd like to\s+|go ahead and\s+)*/i;

/** Strip filler and convert number words. Keeps the speaker's casing so descriptions read naturally. */
function clean(text: string): string {
  const tidy = text.replace(/[’']/g, "'").replace(/[?!.]+$/g, '').trim();
  return wordsToNumbers(tidy.replace(FILLER, '').trim()).replace(/\s+/g, ' ').trim();
}

function categoryFrom(fragment: string, context: IntentContext): string | undefined {
  return matchCategory(fragment, context.categories as Category[])?.id;
}

function describe(fragment: string): string {
  return fragment
    .trim()
    .replace(/\b(under|in|into|to|from)\s+(the\s+)?[a-z& ]+(category|envelope|budget)\b.*$/i, '')
    .replace(/^((for|on|to|from|the|a|an|some|of)\s+)+/i, '')
    .replace(/\b(yesterday|today|\d+\s?days?\s?ago)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A what-if on runway, limited to one envelope when the speaker names one ("cloud costs", "contractor spend"). */
function stressedRunway(text: string, stress: number, context: IntentContext): ParsedIntent {
  const category = matchCategory(text, context.categories as Category[]);
  const rising = stress >= 0;
  const scope = category ? `${category.name} costs ${rising ? 'rise' : 'fall'}` : `spending ${rising ? 'rises' : 'falls'}`;
  return {
    tool: 'get_runway',
    arguments: { stress_percent: stress, ...(category ? { category: category.id } : {}) },
    understood: `Runway if ${scope} ${Math.abs(stress)}%`,
  };
}

export function parseUtterance(utterance: string, context: IntentContext): ParsedIntent | null {
  // `cased` keeps the original casing for descriptions; `text` is what the rules match against.
  // Both have identical length, so an index found in one is valid in the other.
  const cased = clean(utterance);
  const text = cased.toLowerCase();
  if (!text) return null;
  const now = context.now ?? new Date();
  const amount = extractAmount(text);

  if (/\b(pending|waiting).*(approval|approve)|\b(approvals|anything to approve|what needs (my )?approval|needs? my (ok|okay|approval|sign ?off))\b/.test(text)) {
    return { tool: 'list_approvals', arguments: {}, understood: 'List pending approvals' };
  }
  if (
    /^(yes|yeah|yep|sure|approve|approved|confirm|confirmed|go ahead|do it|sounds good)\b/.test(text) ||
    /\b(approve|confirm) (it|that|this|the (change|transfer|move|proposal|request))\b/.test(text)
  ) {
    return { tool: 'resolve_approval', arguments: { decision: 'approve' }, understood: 'Approve the latest pending change' };
  }
  if (/^(no|nope)\b|\b(reject|decline|deny|cancel that|don't do (it|that))\b/.test(text)) {
    return { tool: 'resolve_approval', arguments: { decision: 'reject' }, understood: 'Reject the latest pending change' };
  }
  if (/\b(what did i miss|what('s| has)? (changed|happened|new)|catch me up|brief me|briefing|since (we|i) last|anything new|what did (the )?guardian)\b/.test(text)) {
    return { tool: 'get_briefing', arguments: {}, understood: 'Brief me on what changed' };
  }
  if (/\b(run|start|trigger)\b.*\b(guardian|sweep|check)\b|\brebalance\b|\bguardian\b/.test(text)) {
    return { tool: 'run_guardian', arguments: {}, understood: 'Run a guardian sweep now' };
  }
  if (/\b(can|could|should) (i|we) (afford|buy|spend|get|pay)|\bafford\b|\bis it (ok|okay|safe) to (buy|spend)\b/.test(text)) {
    const recurring = /\b(monthly|per month|a month|every month|subscription|recurring)\b/.test(text);
    const afterAmount = amount ? cased.slice(amount.index + amount.length) : cased.replace(/^.*\b(afford|buy|spend|get|pay)\b/i, '');
    const description =
      describe(afterAmount.replace(/^\s*(dollars?|bucks|usd)\b/i, '').replace(/\b(a|per|every)\s?month(ly)?\b|\bmonthly\b|\bsubscription\b/gi, '')) ||
      'this purchase';
    if (!amount) {
      return { tool: 'get_budget_status', arguments: {}, understood: 'Show budget status (no amount was heard)' };
    }
    const category = categoryFrom(text, context);
    return {
      tool: 'check_affordability',
      arguments: { amount: amount.dollars, description, recurring, ...(category ? { category } : {}) },
      understood: `Check if ${formatDollars(amount.dollars)}${recurring ? ' per month' : ''} for ${description} fits`,
    };
  }
  const move = /\b(move|shift|transfer|reallocate|take|pull)\b.*\bfrom\b\s+(.+?)\s+\b(to|into|over to)\b\s+(.+?)(?:\s+\b(because|for|so|since)\b\s+(.+))?$/i.exec(cased);
  if (move && amount) {
    const from = categoryFrom(move[2]!, context);
    const to = categoryFrom(move[4]!, context);
    if (from && to && from !== to) {
      const reason = move[6] ? capitalize(describe(move[6])) : undefined;
      return {
        tool: 'move_budget',
        arguments: { from_category: from, to_category: to, amount: amount.dollars, ...(reason ? { reason } : {}) },
        understood: `Move ${formatDollars(amount.dollars)} from ${labelOf(from, context)} to ${labelOf(to, context)}`,
      };
    }
  }
  if (amount && /\b(received|got paid|income|deposit(ed)?|client paid|paid us|revenue|invoice paid|payment from)\b/.test(text)) {
    const description = describe(cased.slice(amount.index + amount.length).replace(/^\s*(dollars?|bucks|usd)\b/i, '')) || 'Incoming payment';
    const occurredOn = extractDate(text, now);
    return {
      tool: 'log_income',
      arguments: { amount: amount.dollars, description: capitalize(description), ...(occurredOn ? { occurred_on: occurredOn } : {}) },
      understood: `Record ${formatDollars(amount.dollars)} of income`,
    };
  }
  if (amount && (/\b(log|add|record|track|spent|spend|paid|pay|charge[sd]?|bought|expense|put)\b/.test(text) || /^\$?\d/.test(text))) {
    const afterAmount = cased.slice(amount.index + amount.length).replace(/^\s*(dollars?|bucks|usd)\b/i, '');
    const explicit = /\b(?:under|in|into|to)\s+(?:the\s+)?([a-z& ]+?)(?:\s+(?:category|envelope|budget))?\s*$/i.exec(afterAmount);
    const explicitCategory = explicit ? categoryFrom(explicit[1]!, context) : undefined;
    const descriptionSource = explicitCategory && explicit ? afterAmount.slice(0, explicit.index) : afterAmount;
    const before = cased.slice(0, amount.index).replace(/\b(log|add|record|track|i|we|spent|spend|paid|pay|put|an?|expense|of)\b/gi, '').trim();
    const description = capitalize(describe(descriptionSource) || describe(before) || 'Expense');
    const occurredOn = extractDate(text, now);
    const category = explicitCategory ?? undefined;
    return {
      tool: 'log_expense',
      arguments: { amount: amount.dollars, description, ...(category ? { category } : {}), ...(occurredOn ? { occurred_on: occurredOn } : {}) },
      understood: `Log ${formatDollars(amount.dollars)} for ${description}${category ? ` under ${labelOf(category, context)}` : ''}`,
    };
  }
  if (/\b(runway|how long|months? (left|of (money|cash|runway))|how many months|burn( rate)?|last at this|run out)\b/.test(text)) {
    const percent = extractPercent(text);
    const stress = percent !== undefined ? (DECREASE.test(text) ? -percent : percent) : undefined;
    return stress !== undefined ? stressedRunway(text, stress, context) : { tool: 'get_runway', arguments: {}, understood: 'Calculate runway' };
  }
  if (/\bwhat if\b.*\b(costs?|spend(ing)?|burn|expenses?|bills?)\b/.test(text)) {
    const percent = extractPercent(text) ?? 20;
    return stressedRunway(text, DECREASE.test(text) ? -percent : percent, context);
  }
  if (/\b(forecast|projection|project|outlook|where will (we|i) be|next \d+ months?|in \d+ months?|cash flow)\b/.test(text)) {
    const months = Math.min(12, Math.max(1, extractMonths(text) ?? 3));
    return { tool: 'forecast_cash', arguments: { months }, understood: `Forecast cash for ${months} month${months === 1 ? '' : 's'}` };
  }
  if (/\b(unusual|strange|weird|odd|suspicious|anomal\w*|duplicate[sd]?|audit|anything off|double charged|charged twice|fraud)\b/.test(text)) {
    return { tool: 'audit_spending', arguments: {}, understood: 'Look for unusual charges' };
  }
  const category = categoryFrom(text, context);
  if (/\b(budget|left|remaining|status|how are we doing|how('s| is) (it|everything|the month)|spend(ing)?|spent|overview|envelopes?)\b/.test(text) || category) {
    return {
      tool: 'get_budget_status',
      arguments: category ? { category } : {},
      understood: category ? `Budget status for ${labelOf(category, context)}` : 'Budget status for this month',
    };
  }
  return null;
}

function labelOf(id: string, context: IntentContext): string {
  return context.categories.find((category) => category.id === id)?.name ?? id;
}

function formatDollars(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export const EXAMPLE_UTTERANCES = [
  'How is the budget looking this month?',
  'Log forty two dollars for Bedrock inference',
  'How many months of runway do we have?',
  'What if cloud costs go up 25 percent?',
  'Any unusual charges?',
  'Can we afford a 600 dollar GPU run?',
  'Move 150 from reserve to marketing',
  'Forecast the next 6 months',
  'What did I miss?',
  'Approve it',
];

