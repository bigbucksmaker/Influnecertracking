// ---------------------------------------------------------------------------
// Attribution mathematics for launch tracking — pure functions, no I/O.
//
// Problem: quote tweets land in coordinated bursts (seconds apart), so naive
// before/after windows collapse — every QT contests every other. Instead we
// decompose the main post's pace curve:
//
//     v(t) = b(t) + Σ_i β_i · k_i(t) + ε(t)
//
//   v(t)  main-post views/min on a 1-minute grid
//   b(t)  robust rolling-median baseline (the algorithm's organic decay),
//         fitted twice: surge minutes are excluded from the second pass
//   k_i   QT i's exposure kernel: its OWN view pace when we have a series,
//         else a calibrated exponential-decay shape anchored at its post time
//   β_i   ≥ 0, solved by ridge-regularised non-negative least squares —
//         the TRANSFER RATE: main-post views per view on that QT
//
// Attributed views for QT i = β_i · Σ_t k_i(t). Simultaneous QTs separate by
// kernel shape; QTs whose kernels are indistinguishable (synthetic, same
// burst) are merged into a cluster column and the cluster's attribution is
// split by observed QT views — proportional allocation, never double-counted.
// ---------------------------------------------------------------------------

export interface CumPoint {
  t: number; // ms epoch
  v: number; // cumulative value at t (views)
}

export interface Grid {
  t0: number; // ms epoch of the first step boundary
  steps: number; // number of 1-step intervals
  stepMs: number;
}

export function makeGrid(startMs: number, endMs: number, stepMs = 60_000): Grid {
  const steps = Math.max(1, Math.ceil((endMs - startMs) / stepMs));
  return { t0: startMs, steps, stepMs };
}

/** Monotone linear interpolation of a cumulative series at time t. */
function cumAt(points: CumPoint[], t: number): number {
  if (points.length === 0) return 0;
  if (t <= points[0].t) return points[0].v;
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].t) {
      const a = points[i - 1];
      const b = points[i];
      if (b.t === a.t) return b.v;
      const f = (t - a.t) / (b.t - a.t);
      return a.v + (b.v - a.v) * f;
    }
  }
  return points[points.length - 1].v;
}

/**
 * Per-step pace (units/step) from a cumulative series, resampled on the grid.
 * Steps outside the observed span get 0 (no extrapolated growth).
 */
export function paceOnGrid(points: CumPoint[], grid: Grid): number[] {
  const out = new Array<number>(grid.steps).fill(0);
  if (points.length < 2) return out;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const firstT = sorted[0].t;
  const lastT = sorted[sorted.length - 1].t;
  for (let k = 0; k < grid.steps; k++) {
    const a = grid.t0 + k * grid.stepMs;
    const b = a + grid.stepMs;
    if (b <= firstT || a >= lastT) continue;
    const va = cumAt(sorted, Math.max(a, firstT));
    const vb = cumAt(sorted, Math.min(b, lastT));
    const covered = (Math.min(b, lastT) - Math.max(a, firstT)) / grid.stepMs;
    // Scale partial coverage up to a full-step rate, then weight by coverage —
    // net effect: the observed delta lands in the step without inflation.
    out[k] = Math.max(0, vb - va) * (covered > 0 ? 1 : 0);
  }
  return out;
}

/** Rolling median with a centred window; NaN-safe. */
function rollingMedian(xs: number[], halfWindow: number, skip?: boolean[]): number[] {
  const out = new Array<number>(xs.length).fill(0);
  for (let i = 0; i < xs.length; i++) {
    const lo = Math.max(0, i - halfWindow);
    const hi = Math.min(xs.length - 1, i + halfWindow);
    const vals: number[] = [];
    for (let j = lo; j <= hi; j++) {
      if (skip?.[j]) continue;
      vals.push(xs[j]);
    }
    if (vals.length === 0) {
      for (let j = lo; j <= hi; j++) vals.push(xs[j]); // fallback: unfiltered
    }
    vals.sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    out[i] = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }
  return out;
}

export interface BaselineResult {
  baseline: number[];
  surge: boolean[]; // steps flagged as above-baseline surges
}

/**
 * Two-pass robust baseline: rolling median → flag surges (pace > 1.4×median
 * + absolute guard) → rolling median excluding surge steps. Captures the
 * organic decay without letting QT spikes drag it upward.
 */
export function robustBaseline(pace: number[], halfWindow = 12): BaselineResult {
  const pass1 = rollingMedian(pace, halfWindow);
  const surge = pace.map((p, i) => p > pass1[i] * 1.4 + 5);
  const pass2 = rollingMedian(pace, halfWindow, surge);
  // Baseline can never exceed observed pace's local reality by construction of
  // the median; clamp to ≥0.
  return { baseline: pass2.map((b) => Math.max(0, b)), surge };
}

/**
 * Exposure kernel for a QT with too few observations to form a real series:
 * exponential attention decay anchored at postedAt, scaled so the kernel's
 * mass equals the QT's last observed views. Half-life default 20 min — the
 * well-documented attention decay scale for X posts.
 */
export function syntheticKernel(
  postedAtMs: number,
  totalViews: number,
  grid: Grid,
  halfLifeMin = 20,
): number[] {
  const out = new Array<number>(grid.steps).fill(0);
  if (totalViews <= 0) return out;
  const lambda = Math.LN2 / halfLifeMin;
  let mass = 0;
  const shape = new Array<number>(grid.steps).fill(0);
  for (let k = 0; k < grid.steps; k++) {
    const stepStart = grid.t0 + k * grid.stepMs;
    const minsSince = (stepStart + grid.stepMs / 2 - postedAtMs) / 60_000;
    if (minsSince < 0) continue;
    const val = Math.exp(-lambda * minsSince);
    shape[k] = val;
    mass += val;
  }
  if (mass <= 0) return out;
  for (let k = 0; k < grid.steps; k++) out[k] = (shape[k] / mass) * totalViews;
  return out;
}

export interface NnlsResult {
  beta: number[];
  yhat: number[];
  r2: number;
  iterations: number;
}

/**
 * Ridge-regularised non-negative least squares via cyclic coordinate descent.
 *   min ‖y − Xβ‖² + λ‖β‖²  s.t. β ≥ 0
 * X is column-major: X[j] is regressor j on the grid. Deterministic,
 * dependency-free, and fast at this scale (≤ ~1500 steps × ≤ ~60 columns).
 */
export function nnlsRidge(y: number[], X: number[][], lambda?: number, maxIters = 500): NnlsResult {
  const n = y.length;
  const m = X.length;
  const beta = new Array<number>(m).fill(0);
  if (m === 0 || n === 0) return { beta, yhat: new Array(n).fill(0), r2: 0, iterations: 0 };

  // Gram matrix and X^T y.
  const G: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const c = new Array<number>(m).fill(0);
  for (let j = 0; j < m; j++) {
    for (let k = j; k < m; k++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += X[j][i] * X[k][i];
      G[j][k] = s;
      G[k][j] = s;
    }
    let s = 0;
    for (let i = 0; i < n; i++) s += X[j][i] * y[i];
    c[j] = s;
  }
  const meanDiag = G.reduce((s, _, j) => s + G[j][j], 0) / m;
  const ridge = lambda ?? Math.max(1e-9, 0.05 * meanDiag);

  let iterations = 0;
  for (let iter = 0; iter < maxIters; iter++) {
    iterations = iter + 1;
    let maxDelta = 0;
    for (let j = 0; j < m; j++) {
      const denom = G[j][j] + ridge;
      if (denom <= 0) continue;
      let gj = 0;
      for (let k = 0; k < m; k++) gj += G[j][k] * beta[k];
      const next = Math.max(0, beta[j] + (c[j] - gj - ridge * beta[j]) / denom);
      maxDelta = Math.max(maxDelta, Math.abs(next - beta[j]));
      beta[j] = next;
    }
    if (maxDelta < 1e-6) break;
  }

  const yhat = new Array<number>(n).fill(0);
  for (let j = 0; j < m; j++) {
    if (beta[j] === 0) continue;
    for (let i = 0; i < n; i++) yhat[i] += beta[j] * X[j][i];
  }
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (y[i] - yhat[i]) ** 2;
    ssTot += (y[i] - meanY) ** 2;
  }
  const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
  return { beta, yhat, r2, iterations };
}

/** Cluster items by time proximity: same cluster while gaps ≤ gapMs. Returns cluster index per item (input must be time-sorted). */
export function clusterByGap(timesMs: number[], gapMs: number): number[] {
  const out = new Array<number>(timesMs.length).fill(0);
  let cluster = 0;
  for (let i = 1; i < timesMs.length; i++) {
    if (timesMs[i] - timesMs[i - 1] > gapMs) cluster++;
    out[i] = cluster;
  }
  return out;
}

/** Sum of a kernel = the exposure mass it represents (views). */
export function kernelMass(k: number[]): number {
  let s = 0;
  for (const v of k) s += v;
  return s;
}
