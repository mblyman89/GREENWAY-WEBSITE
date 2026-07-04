/**
 * src/lib/discovery/benchmarks-core.ts
 *
 * PURE, dependency-free statistical helpers for computing CCRS benchmarks.
 * No DB, no server-only — unit-testable and reusable by the server
 * benchmarks layer.
 *
 * STANDING RULE — never fabricate: empty inputs yield nulls / zero sample
 * size, never invented numbers.
 */

/**
 * Linear-interpolated percentile of a numeric array (0..1). Returns null for
 * empty input. Does NOT mutate the input (sorts a copy).
 */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const clamped = Math.min(1, Math.max(0, p));
  const idx = clamped * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

export type MinorSummary = {
  sample_size: number;
  min_minor: number | null;
  p25_minor: number | null;
  median_minor: number | null;
  p75_minor: number | null;
  max_minor: number | null;
  avg_minor: number | null;
};

/**
 * Summarize an array of integer minor-unit values into the benchmark shape.
 * Percentile results are rounded to whole minor units (cents). Empty → nulls.
 */
export function summarizeMinor(values: number[]): MinorSummary {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) {
    return {
      sample_size: 0,
      min_minor: null,
      p25_minor: null,
      median_minor: null,
      p75_minor: null,
      max_minor: null,
      avg_minor: null,
    };
  }
  const sum = clean.reduce((a, b) => a + b, 0);
  const round = (n: number | null): number | null => (n == null ? null : Math.round(n));
  return {
    sample_size: clean.length,
    min_minor: Math.min(...clean),
    p25_minor: round(percentile(clean, 0.25)),
    median_minor: round(percentile(clean, 0.5)),
    p75_minor: round(percentile(clean, 0.75)),
    max_minor: Math.max(...clean),
    avg_minor: Math.round(sum / clean.length),
  };
}

/** Average of a numeric array, or null when empty (for potency % etc.). */
export function avgNum(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}
