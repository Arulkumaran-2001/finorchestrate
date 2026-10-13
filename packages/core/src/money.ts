/**
 * Money is stored and computed as integer cents everywhere in the domain.
 * Floating point dollars only exist at the edges (user input and display).
 */
export type Cents = number;

export function toCents(dollars: number): Cents {
  if (!Number.isFinite(dollars)) {
    throw new RangeError(`Invalid money amount: ${dollars}`);
  }
  return Math.round(dollars * 100);
}

export function toDollars(cents: Cents): number {
  return cents / 100;
}

/** Round a positive amount of cents up to the next whole step (default ten dollars). */
export function roundUpCents(cents: Cents, stepCents: Cents = 1000): Cents {
  if (cents <= 0) return 0;
  return Math.ceil(cents / stepCents) * stepCents;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

const exactFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const compactFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export interface FormatMoneyOptions {
  /** `exact` keeps cents, `whole` rounds to dollars, `compact` renders 12.4K style. */
  style?: 'exact' | 'whole' | 'compact' | 'auto';
  /** Prefix positive values with a plus sign. */
  signed?: boolean;
}

export function formatMoney(cents: Cents, options: FormatMoneyOptions = {}): string {
  const style = options.style ?? 'auto';
  const dollars = toDollars(cents);
  let text: string;
  if (style === 'exact') {
    text = exactFormatter.format(dollars);
  } else if (style === 'whole') {
    text = wholeFormatter.format(dollars);
  } else if (style === 'compact') {
    text = compactFormatter.format(dollars);
  } else {
    text = Number.isInteger(dollars) ? wholeFormatter.format(dollars) : exactFormatter.format(dollars);
  }
  if (options.signed && cents > 0) text = `+${text}`;
  return text;
}

/**
 * Voice friendly money. Estimates and balances round to whole dollars from a
 * hundred up, so "$583 left" is spoken instead of "$582.71". Pass `exact` for
 * amounts the owner just said, so a confirmation repeats "$42.50" verbatim.
 */
export function speakMoney(cents: Cents, options: { exact?: boolean; approx?: boolean } = {}): string {
  const abs = Math.abs(cents);
  const whole = options.approx || (options.exact ? abs % 100 === 0 : abs >= 10000 || abs % 100 === 0);
  const text = whole ? wholeFormatter.format(Math.round(abs / 100)) : exactFormatter.format(abs / 100);
  return cents < 0 ? `minus ${text}` : text;
}
