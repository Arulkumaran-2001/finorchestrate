export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

/** Sample standard deviation (n - 1). */
export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Median absolute deviation. */
export function medianAbsoluteDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

/**
 * Iglewicz and Hoaglin modified z-score. Robust to the very outliers it is
 * trying to find, unlike a mean and standard deviation test.
 */
export function modifiedZScore(value: number, sample: number[]): number {
  const center = median(sample);
  const mad = medianAbsoluteDeviation(sample);
  if (mad === 0) {
    // Perfectly regular history (for example a fixed subscription). Fall back to
    // the mean absolute deviation so a change still produces a finite score.
    const meanDeviation = mean(sample.map((entry) => Math.abs(entry - center)));
    if (meanDeviation === 0) return value === center ? 0 : Number.POSITIVE_INFINITY * Math.sign(value - center);
    return (value - center) / (1.253314 * meanDeviation);
  }
  return (0.6745 * (value - center)) / mad;
}

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base]! : sorted[base]! + rest * (next - sorted[base]!);
}

/** Standard normal cumulative distribution (Abramowitz and Stegun 7.1.26). */
export function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}
