// ---------------------------------------------------------------------------
// Launch recap reports — on-demand (button click), with regression attribution.
//
// The intelligence, in three layers:
//  1. MEASUREMENT (lib/attribution.ts): the main post's pace curve is
//     decomposed as v(t) = baseline(t) + Σ β_i·k_i(t). Each QT's exposure
//     kernel k_i is its OWN view-pace series (LiveQuoteSnapshot) — or a
//     calibrated decay shape when only one observation exists. Non-negative
//     ridge regression yields β_i, the TRANSFER RATE (main-post views per QT
//     view), and attributed views per QT. Burst QTs (≤90s apart) whose
//     kernels are indistinguishable merge into a cluster column; the
//     cluster's attribution splits by observed QT views — proportional,
//     never double-counted.
//  2. MEMORY: measurements persist as QuoteImpact rows and aggregate into
//     cross-launch amplifier track records (median transfer rate, total
//     attributed views) — the system learns who actually moves the needle.
//  3. NARRATIVE (Claude): writes the recap FROM the measurements; it never
//     invents numbers. Reports degrade to stats-only when unavailable.
// ---------------------------------------------------------------------------

import { prisma } from "./db";
import { getAnthropic, NICHE_MODEL } from "./anthropic";
import { median } from "./stats";
import { signalWeightedEngagement, ALGO_CONTEXT, type SignalCounts } from "./x-algo";
import {
  makeGrid,
  paceOnGrid,
  robustBaseline,
  syntheticKernel,
  nnlsRidge,
  clusterByGap,
  kernelMass,
  type CumPoint,
  type Grid,
} from "./attribution";

const MIN_MS = 60_000;
const CLUSTER_GAP_MS = 90_000; // QTs within 90s form one burst
const REAL_KERNEL_MIN_POINTS = 3; // incl. the implicit zero at postedAt
const REAL_KERNEL_MIN_SPAN_MIN = 4;
const DISPLAY_WINDOW_MIN = 10; // cluster-level pre/post pace, for display only

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface QuoteImpactView {
  quoteTweetId: string;
  authorUsername: string;
  isRoster: boolean;
  qtPostedAt: string;
  qtViews: number;
  attributedViews: number;
  creditShare: number | null; // share of all attributed views (0..1)
  transferRate: number | null; // main-post views per view on this QT
  clusterId: string | null;
  clusterSize: number;
  method: "regression" | "cluster-split" | "window";
  kernel: "real" | "synthetic";
  prePaceVpm: number; // cluster-level, display only
  postPaceVpm: number;
  upliftPct: number | null;
  contested: boolean;
  insufficientData?: boolean;
}

export interface AttributionSummary {
  gridMinutes: number;
  totalViewsGained: number;
  baselineViews: number; // organic decay's share
  excessViews: number; // above baseline
  attributedViews: number; // regression-assigned to QTs
  unattributedExcess: number; // surges no kernel explains
  r2: number; // regression fit on the excess curve
  realKernels: number;
  syntheticKernels: number;
}

// ---------------------------------------------------------------------------
// Attribution pipeline
// ---------------------------------------------------------------------------

export async function computeAttribution(trackerId: string): Promise<{
  impacts: QuoteImpactView[];
  summary: AttributionSummary | null;
}> {
  const tracker = await prisma.liveTracker.findUnique({ where: { id: trackerId } });
  if (!tracker) return { impacts: [], summary: null };

  const windowStart = tracker.startedAt.getTime() - 5 * MIN_MS;
  const windowEnd = (tracker.stoppedAt ?? new Date()).getTime();

  const [snapsRaw, quotes] = await Promise.all([
    prisma.postSnapshot.findMany({
      where: { postId: tracker.postId, capturedAt: { gte: new Date(windowStart - 15 * MIN_MS), lte: new Date(windowEnd) } },
      orderBy: { capturedAt: "asc" },
      select: { capturedAt: true, viewCount: true },
    }),
    prisma.liveQuote.findMany({ where: { trackerId }, orderBy: { postedAt: "asc" } }),
  ]);

  let qtSnaps: { tweetId: string; capturedAt: Date; views: number }[] = [];
  try {
    qtSnaps = await prisma.liveQuoteSnapshot.findMany({
      where: { trackerId },
      orderBy: { capturedAt: "asc" },
      select: { tweetId: true, capturedAt: true, views: true },
    });
  } catch {
    /* table may predate migration — synthetic kernels take over */
  }
  const qtSnapsById = new Map<string, CumPoint[]>();
  for (const s of qtSnaps) {
    const arr = qtSnapsById.get(s.tweetId) ?? [];
    arr.push({ t: s.capturedAt.getTime(), v: s.views });
    qtSnapsById.set(s.tweetId, arr);
  }

  if (quotes.length === 0) return { impacts: [], summary: null };

  const mainCum: CumPoint[] = snapsRaw.map((s) => ({ t: s.capturedAt.getTime(), v: s.viewCount }));
  const grid: Grid = makeGrid(windowStart, windowEnd, MIN_MS);
  const mainPace = paceOnGrid(mainCum, grid);
  const coveredSteps = mainPace.filter((v) => v > 0).length;

  // Too sparse to regress → every QT reported as insufficient, no fake numbers.
  if (mainCum.length < 4 || coveredSteps < 8 || grid.steps < 10) {
    const impacts = quotes.map((q) => emptyImpact(q, "window", true));
    return { impacts, summary: null };
  }

  const { baseline } = robustBaseline(mainPace, 12);
  const excess = mainPace.map((v, i) => Math.max(0, v - baseline[i]));

  // --- Kernels & clustering -----------------------------------------------
  const times = quotes.map((q) => q.postedAt.getTime());
  const clusterIdx = clusterByGap(times, CLUSTER_GAP_MS);
  const clusterSizes = new Map<number, number>();
  for (const c of clusterIdx) clusterSizes.set(c, (clusterSizes.get(c) ?? 0) + 1);

  interface Column {
    kernel: number[];
    members: number[]; // quote indices
    real: boolean;
    cluster: number;
  }
  const columns: Column[] = [];
  const syntheticByCluster = new Map<number, number>(); // cluster → column idx
  let realKernels = 0;
  let syntheticKernels = 0;

  quotes.forEach((q, qi) => {
    const obs = [{ t: q.postedAt.getTime(), v: 0 }, ...(qtSnapsById.get(q.tweetId) ?? [])];
    const spanMin = obs.length >= 2 ? (obs[obs.length - 1].t - obs[0].t) / MIN_MS : 0;
    const isReal = obs.length >= REAL_KERNEL_MIN_POINTS && spanMin >= REAL_KERNEL_MIN_SPAN_MIN;
    if (isReal) {
      realKernels++;
      columns.push({ kernel: paceOnGrid(obs, grid), members: [qi], real: true, cluster: clusterIdx[qi] });
    } else {
      syntheticKernels++;
      const k = syntheticKernel(q.postedAt.getTime(), Math.max(q.views, 1), grid);
      const existing = syntheticByCluster.get(clusterIdx[qi]);
      if (existing != null) {
        // Same-burst synthetic kernels are shape-identical — merge the column.
        const col = columns[existing];
        for (let i = 0; i < grid.steps; i++) col.kernel[i] += k[i];
        col.members.push(qi);
      } else {
        syntheticByCluster.set(clusterIdx[qi], columns.length);
        columns.push({ kernel: k, members: [qi], real: false, cluster: clusterIdx[qi] });
      }
    }
  });

  const live = columns.filter((c) => kernelMass(c.kernel) > 0);
  const { beta, r2 } = nnlsRidge(excess, live.map((c) => c.kernel));

  // --- Per-quote allocation -------------------------------------------------
  const perQuote = new Map<number, { attributed: number; transfer: number | null; method: QuoteImpactView["method"]; real: boolean }>();
  live.forEach((col, j) => {
    const mass = kernelMass(col.kernel);
    const attributed = beta[j] * mass;
    if (col.members.length === 1) {
      perQuote.set(col.members[0], {
        attributed,
        transfer: beta[j],
        method: col.real ? "regression" : clusterSizes.get(col.cluster)! > 1 ? "cluster-split" : "regression",
        real: col.real,
      });
    } else {
      // Merged burst column: split by observed QT views — proportional credit.
      const totalViews = col.members.reduce((s, qi) => s + Math.max(1, quotes[qi].views), 0);
      for (const qi of col.members) {
        const w = Math.max(1, quotes[qi].views) / totalViews;
        perQuote.set(qi, { attributed: attributed * w, transfer: beta[j], method: "cluster-split", real: false });
      }
    }
  });

  const totalAttributed = [...perQuote.values()].reduce((s, v) => s + v.attributed, 0);

  // --- Cluster-level display pace ------------------------------------------
  const clusterPace = new Map<number, { pre: number; post: number }>();
  for (const [c] of clusterSizes) {
    const members = quotes.filter((_, qi) => clusterIdx[qi] === c);
    const startMs = Math.min(...members.map((q) => q.postedAt.getTime()));
    const k0 = Math.floor((startMs - grid.t0) / grid.stepMs);
    const pre = sliceMean(mainPace, k0 - DISPLAY_WINDOW_MIN, k0);
    const post = sliceMean(mainPace, k0, k0 + DISPLAY_WINDOW_MIN);
    clusterPace.set(c, { pre, post });
  }

  // --- Assemble + persist ----------------------------------------------------
  const impacts: QuoteImpactView[] = [];
  for (let qi = 0; qi < quotes.length; qi++) {
    const q = quotes[qi];
    const alloc = perQuote.get(qi);
    const cp = clusterPace.get(clusterIdx[qi]) ?? { pre: 0, post: 0 };
    const clusterSize = clusterSizes.get(clusterIdx[qi]) ?? 1;
    const view: QuoteImpactView = {
      quoteTweetId: q.tweetId,
      authorUsername: q.authorUsername,
      isRoster: q.isRoster,
      qtPostedAt: q.postedAt.toISOString(),
      qtViews: q.views,
      attributedViews: Math.round(alloc?.attributed ?? 0),
      creditShare:
        alloc && totalAttributed > 0 ? Math.round((alloc.attributed / totalAttributed) * 1000) / 1000 : null,
      transferRate: alloc?.transfer != null ? Math.round(alloc.transfer * 1000) / 1000 : null,
      clusterId: `c${clusterIdx[qi]}`,
      clusterSize,
      method: alloc?.method ?? "window",
      kernel: alloc?.real ? "real" : "synthetic",
      prePaceVpm: Math.round(cp.pre * 10) / 10,
      postPaceVpm: Math.round(cp.post * 10) / 10,
      upliftPct: cp.pre > 1 ? Math.round(((cp.post - cp.pre) / cp.pre) * 1000) / 1000 : null,
      contested: clusterSize > 1,
      insufficientData: alloc == null,
    };
    impacts.push(view);

    try {
      await prisma.quoteImpact.upsert({
        where: { trackerId_quoteTweetId: { trackerId, quoteTweetId: q.tweetId } },
        update: impactRow(trackerId, q, view, grid),
        create: impactRow(trackerId, q, view, grid),
      });
    } catch {
      /* QuoteImpact table/columns may predate `prisma db push` */
    }
  }

  const totalViewsGained = mainPace.reduce((s, v) => s + v, 0);
  const baselineViews = Math.min(
    totalViewsGained,
    Math.round(baseline.reduce((s, v) => s + v, 0)),
  );
  const excessTotal = Math.round(excess.reduce((s, v) => s + v, 0));

  return {
    impacts,
    summary: {
      gridMinutes: grid.steps,
      totalViewsGained: Math.round(totalViewsGained),
      baselineViews,
      excessViews: excessTotal,
      attributedViews: Math.round(totalAttributed),
      unattributedExcess: Math.max(0, excessTotal - Math.round(totalAttributed)),
      r2: Math.round(r2 * 1000) / 1000,
      realKernels,
      syntheticKernels,
    },
  };
}

function sliceMean(xs: number[], lo: number, hi: number): number {
  const a = Math.max(0, lo);
  const b = Math.min(xs.length, hi);
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += xs[i];
  return s / (b - a);
}

function emptyImpact(
  q: { tweetId: string; authorUsername: string; isRoster: boolean; postedAt: Date; views: number },
  method: QuoteImpactView["method"],
  insufficient: boolean,
): QuoteImpactView {
  return {
    quoteTweetId: q.tweetId,
    authorUsername: q.authorUsername,
    isRoster: q.isRoster,
    qtPostedAt: q.postedAt.toISOString(),
    qtViews: q.views,
    attributedViews: 0,
    creditShare: null,
    transferRate: null,
    clusterId: null,
    clusterSize: 1,
    method,
    kernel: "synthetic",
    prePaceVpm: 0,
    postPaceVpm: 0,
    upliftPct: null,
    contested: false,
    insufficientData: insufficient,
  };
}

function impactRow(
  trackerId: string,
  q: { tweetId: string; authorUsername: string; isRoster: boolean; postedAt: Date },
  v: QuoteImpactView,
  grid: Grid,
) {
  return {
    trackerId,
    quoteTweetId: q.tweetId,
    authorUsername: q.authorUsername,
    isRoster: q.isRoster,
    qtPostedAt: q.postedAt,
    prePaceVpm: v.prePaceVpm,
    postPaceVpm: v.postPaceVpm,
    upliftPct: v.upliftPct,
    excessViews: v.attributedViews, // legacy column carries the attributed figure
    windowMin: grid.steps,
    contested: v.contested,
    attributedViews: v.attributedViews,
    creditShare: v.creditShare,
    transferRate: v.transferRate,
    clusterId: v.clusterId,
    method: v.method,
  };
}

// ---------------------------------------------------------------------------
// Memory — cross-launch amplifier profiles
// ---------------------------------------------------------------------------

export interface AmplifierProfile {
  username: string;
  isRoster: boolean;
  launches: number;
  qts: number;
  totalAttributedViews: number;
  medianTransferRate: number | null; // main-post views per QT view
  medianUpliftPct: number | null; // legacy display metric
  cleanMeasurements: number;
}

export async function getAmplifierProfiles(usernames?: string[]): Promise<AmplifierProfile[]> {
  let rows: Awaited<ReturnType<typeof prisma.quoteImpact.findMany>>;
  try {
    rows = await prisma.quoteImpact.findMany({
      where: usernames?.length ? { authorUsername: { in: usernames } } : {},
    });
  } catch {
    return [];
  }
  const byAuthor = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byAuthor.get(r.authorUsername) ?? [];
    arr.push(r);
    byAuthor.set(r.authorUsername, arr);
  }
  const out: AmplifierProfile[] = [];
  for (const [username, list] of byAuthor) {
    const transfers = list.map((r) => r.transferRate).filter((x): x is number => x != null);
    const uplifts = list.filter((r) => !r.contested && r.upliftPct != null).map((r) => r.upliftPct as number);
    out.push({
      username,
      isRoster: list.some((r) => r.isRoster),
      launches: new Set(list.map((r) => r.trackerId)).size,
      qts: list.length,
      totalAttributedViews: list.reduce((s, r) => s + (r.attributedViews || r.excessViews), 0),
      medianTransferRate: transfers.length ? Math.round(median(transfers) * 1000) / 1000 : null,
      medianUpliftPct: uplifts.length ? Math.round(median(uplifts) * 1000) / 1000 : null,
      cleanMeasurements: list.filter((r) => r.method === "regression").length,
    });
  }
  return out.sort((a, b) => b.totalAttributedViews - a.totalAttributedViews);
}

// ---------------------------------------------------------------------------
// Report assembly + narrative
// ---------------------------------------------------------------------------

export interface LaunchStats {
  label: string;
  author: string;
  postText: string;
  postUrl: string | null;
  windowStart: string;
  windowEnd: string;
  durationMin: number;
  startViews: number;
  endViews: number;
  viewsGained: number;
  endEngagements: number;
  peakPaceVpm: number;
  peakPaceAt: string | null;
  avgPaceVpm: number;
  qtCount: number;
  rosterQtCount: number;
  qtTotalViews: number;
  rosterAttributedViews: number;
  attribution: AttributionSummary | null;
  /** Engagement gained over the window, split by signal — counted the way the
   *  ranker values it (see lib/x-algo.ts; relativities are directional). */
  signalMix: (SignalCounts & { weightedScore: number; weightedReplyShare: number }) | null;
  impacts: QuoteImpactView[];
  profiles: AmplifierProfile[];
  series: { t: string; views: number; engagements: number }[];
  qtMarkers: { t: string; username: string; isRoster: boolean }[];
}

export interface LaunchNarrative {
  headline: string;
  summary: string;
  keyMoments: string[];
  amplifierInsights: string[];
  recommendations: string[];
}

const NARRATIVE_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One punchy line, ≤90 chars, with the launch's defining number." },
    summary: { type: "string", description: "2-4 sentences: how the launch went, incl. the baseline vs QT-attributed split, in plain operator language." },
    keyMoments: { type: "array", items: { type: "string" }, description: "3-5 timestamped moments (HH:MM), each tied to a number from the stats." },
    amplifierInsights: { type: "array", items: { type: "string" }, description: "2-4 insights on who moved the needle: attributed views, transfer rates (main views per QT view), and historical track records where present. Note cluster-split credit when relevant." },
    recommendations: { type: "array", items: { type: "string" }, description: "2-4 concrete next-launch recommendations grounded ONLY in the measurements (who to activate, when, what to test)." },
  },
  required: ["headline", "summary", "keyMoments", "amplifierInsights", "recommendations"],
  additionalProperties: false,
} as const;

async function writeNarrative(stats: LaunchStats): Promise<LaunchNarrative | null> {
  try {
    const client = getAnthropic();
    const compact = {
      ...stats,
      series: undefined,
      qtMarkers: undefined,
      impacts: stats.impacts.slice(0, 25).map((i) => ({
        author: i.authorUsername,
        roster: i.isRoster,
        at: i.qtPostedAt,
        qtViews: i.qtViews,
        attributedViews: i.attributedViews,
        creditShare: i.creditShare,
        transferRate: i.transferRate,
        method: i.method,
        cluster: i.clusterId,
        clusterSize: i.clusterSize,
        insufficientData: i.insufficientData ?? false,
      })),
      profiles: stats.profiles.slice(0, 15),
    };
    const res = await client.messages.create({
      model: NICHE_MODEL,
      max_tokens: 1500,
      thinking: { type: "disabled" },
      output_config: { format: { type: "json_schema", schema: NARRATIVE_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `You are writing the launch recap for an influencer-marketing ops team. The stats below come from regression attribution over a live-tracked launch post on X: the post's pace curve was decomposed into an organic baseline plus per-quote-tweet exposure kernels; attributedViews and transferRate (main-post views per view on the QT) are MEASURED via non-negative least squares. method "cluster-split" means several burst QTs shared one kernel and credit was split by their observed views — present those as a group with individual estimates. insufficientData rows have no measurement — never cite them as impact. The attribution block gives the launch-level split (baseline vs excess vs attributed vs unattributed) and the regression fit r2 — mention the fit honestly if it is weak (<0.4). The signalMix block counts engagement gained by type with a ranker-weighted score (weights are directional, from the last public release).\n\nGround your recommendations in how X's ranking actually works:\n${ALGO_CONTEXT}\n\nRules: every number must come from the data. When you cite algorithm mechanics, they must come from the context above, flagged as directional where weights are involved. Keep it sharp and operator-grade; no fluff.\n\nDATA:\n${JSON.stringify(compact)}`,
        },
      ],
    });
    const block = res.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;
    return JSON.parse(block.text) as LaunchNarrative;
  } catch (e) {
    console.error("[launch-report] narrative failed:", e);
    return null;
  }
}

export async function generateLaunchReport(
  trackerId: string,
  createdBy?: string | null,
): Promise<{ reportId: string } | { error: string }> {
  const tracker = await prisma.liveTracker.findUnique({
    where: { id: trackerId },
    include: {
      post: {
        select: { id: true, url: true, text: true, account: { select: { username: true } } },
      },
    },
  });
  if (!tracker) return { error: "Tracker not found" };

  const windowStart = tracker.startedAt;
  const windowEnd = tracker.stoppedAt ?? new Date();

  const snaps = await prisma.postSnapshot.findMany({
    where: {
      postId: tracker.postId,
      capturedAt: { gte: new Date(windowStart.getTime() - 5 * MIN_MS), lte: windowEnd },
    },
    orderBy: { capturedAt: "asc" },
    select: {
      capturedAt: true,
      viewCount: true,
      engagements: true,
      likeCount: true,
      retweetCount: true,
      replyCount: true,
      quoteCount: true,
    },
  });
  if (snaps.length < 2) {
    return { error: "Not enough tracked data yet — let it tick for a few minutes first." };
  }

  const { impacts, summary } = await computeAttribution(trackerId);
  const quotes = await prisma.liveQuote.findMany({ where: { trackerId } });
  const involved = [...new Set(impacts.map((i) => i.authorUsername))];
  const profiles = await getAmplifierProfiles(involved);

  let peakPaceVpm = 0;
  let peakPaceAt: string | null = null;
  for (let i = 1; i < snaps.length; i++) {
    const dtMin = (snaps[i].capturedAt.getTime() - snaps[i - 1].capturedAt.getTime()) / MIN_MS;
    if (dtMin <= 0) continue;
    const vpm = (snaps[i].viewCount - snaps[i - 1].viewCount) / dtMin;
    if (vpm > peakPaceVpm) {
      peakPaceVpm = vpm;
      peakPaceAt = snaps[i].capturedAt.toISOString();
    }
  }
  const first = snaps[0];
  const last = snaps[snaps.length - 1];
  const durationMin = Math.max(1, Math.round((last.capturedAt.getTime() - first.capturedAt.getTime()) / MIN_MS));

  // Signal mix — engagement gained over the window, counted the way the
  // ranker values it (replies dominate; likes are the cheapest signal).
  const gained: SignalCounts = {
    likes: Math.max(0, last.likeCount - first.likeCount),
    retweets: Math.max(0, last.retweetCount - first.retweetCount),
    replies: Math.max(0, last.replyCount - first.replyCount),
    quotes: Math.max(0, last.quoteCount - first.quoteCount),
  };
  const weightedScore = Math.round(signalWeightedEngagement(gained));
  const replyContribution = gained.replies * 13.5;
  const signalMix = {
    ...gained,
    weightedScore,
    weightedReplyShare: weightedScore > 0 ? Math.round((replyContribution / weightedScore) * 100) / 100 : 0,
  };

  const stats: LaunchStats = {
    label: tracker.label ?? `@${tracker.post.account.username} launch`,
    author: tracker.post.account.username,
    postText: tracker.post.text.slice(0, 280),
    postUrl: tracker.post.url,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    durationMin,
    startViews: first.viewCount,
    endViews: last.viewCount,
    viewsGained: last.viewCount - first.viewCount,
    endEngagements: last.engagements,
    peakPaceVpm: Math.round(peakPaceVpm),
    peakPaceAt,
    avgPaceVpm: Math.round((last.viewCount - first.viewCount) / durationMin),
    qtCount: quotes.length,
    rosterQtCount: quotes.filter((q) => q.isRoster).length,
    qtTotalViews: quotes.reduce((s, q) => s + q.views, 0),
    rosterAttributedViews: impacts.filter((i) => i.isRoster).reduce((s, i) => s + i.attributedViews, 0),
    attribution: summary,
    signalMix,
    impacts,
    profiles,
    series: snaps.map((s) => ({ t: s.capturedAt.toISOString(), views: s.viewCount, engagements: s.engagements })),
    qtMarkers: quotes.map((q) => ({ t: q.postedAt.toISOString(), username: q.authorUsername, isRoster: q.isRoster })),
  };

  const narrative = await writeNarrative(stats);

  const report = await prisma.launchReport.create({
    data: {
      trackerId,
      createdBy: createdBy ?? null,
      windowStart,
      windowEnd,
      headline:
        narrative?.headline ??
        `${stats.label}: +${stats.viewsGained.toLocaleString("en-US")} views in ${durationMin}m`,
      statsJson: JSON.stringify(stats),
      narrativeJson: narrative ? JSON.stringify(narrative) : "",
    },
  });
  return { reportId: report.id };
}

export interface LaunchReportView {
  id: string;
  trackerId: string;
  createdBy: string | null;
  createdAt: string;
  headline: string;
  stats: LaunchStats;
  narrative: LaunchNarrative | null;
}

export async function getLaunchReport(reportId: string): Promise<LaunchReportView | null> {
  const r = await prisma.launchReport.findUnique({ where: { id: reportId } });
  if (!r) return null;
  let stats: LaunchStats;
  try {
    stats = JSON.parse(r.statsJson) as LaunchStats;
  } catch {
    return null;
  }
  let narrative: LaunchNarrative | null = null;
  if (r.narrativeJson) {
    try {
      narrative = JSON.parse(r.narrativeJson) as LaunchNarrative;
    } catch {
      narrative = null;
    }
  }
  return {
    id: r.id,
    trackerId: r.trackerId,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    headline: r.headline,
    stats,
    narrative,
  };
}

export async function listLaunchReports(trackerId: string) {
  try {
    const rows = await prisma.launchReport.findMany({
      where: { trackerId },
      orderBy: { createdAt: "desc" },
      select: { id: true, headline: true, createdAt: true, createdBy: true },
    });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  } catch {
    return [];
  }
}
