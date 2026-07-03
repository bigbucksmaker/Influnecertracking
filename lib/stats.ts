// Shared, dependency-free statistics helpers used by scoring, the value layer,
// placements, and the planner. Extracted from lib/scoring.ts so lib/value.ts can
// use them without a runtime import cycle (scoring → value → scoring).

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Linear-interpolated quantile (q in 0..1) of an ASC-sorted array. */
export function quantileSorted(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Median of an unsorted array (0 when empty). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  return quantileSorted([...values].sort((a, b) => a - b), 0.5);
}

export interface ViewSummary {
  mean: number;
  median: number;
  p25: number;
  consistency: number | null; // IQR / median, or null when undefined/<2 posts
}

/** Robust summary of a set of per-post view counts. */
export function summarizeViews(views: number[]): ViewSummary {
  const n = views.length;
  if (n === 0) return { mean: 0, median: 0, p25: 0, consistency: null };
  const sorted = [...views].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const med = quantileSorted(sorted, 0.5);
  const p25 = quantileSorted(sorted, 0.25);
  const p75 = quantileSorted(sorted, 0.75);
  const consistency = n >= 2 && med > 0 ? (p75 - p25) / med : null;
  return { mean, median: med, p25, consistency };
}

/** Percentile rank (0–100) of each value within the set, ties share rank. */
export function percentileRanks(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [50];
  return values.map((x) => {
    let less = 0;
    let eq = 0;
    for (const v of values) {
      if (v < x) less++;
      else if (v === x) eq++;
    }
    return ((less + 0.5 * eq) / n) * 100;
  });
}

/** Z-score normalisation squashed to 0–100 (mean → 50, ±3σ → 0/100). */
export function zScoreNorms(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  return values.map((x) => (std > 0 ? clamp((((x - mean) / std + 3) / 6) * 100, 0, 100) : 50));
}

export function normalize(values: number[], method: string): number[] {
  return method === "zscore" ? zScoreNorms(values) : percentileRanks(values);
}
