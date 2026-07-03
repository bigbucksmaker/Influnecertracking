// ---------------------------------------------------------------------------
// Launch recap reports — on-demand (button click), with honest attribution.
//
// The intelligence, in three layers:
//  1. MEASUREMENT (deterministic): for every quote tweet during a tracked
//     launch, compare the main post's views/min pace in the window before the
//     QT vs after it. Uplift% and excess views (actual − pre-pace baseline)
//     are that QT's measured inflection. Windows containing other QTs are
//     flagged `contested` — credit is shared, never double-claimed.
//  2. MEMORY (accumulating): every measurement persists as a QuoteImpact row.
//     Across launches these aggregate into per-creator amplification profiles
//     ("@x has amplified 4 launches, median +38% pace, ~120K excess views") —
//     the system genuinely learns who moves the needle.
//  3. NARRATIVE (Claude): the computed stats + profiles go to Claude, which
//     writes the executive summary, key moments, and recommendations. It
//     narrates the maths; it never invents numbers. Reports degrade
//     gracefully to stats-only when the model is unavailable.
// ---------------------------------------------------------------------------

import { prisma } from "./db";
import { getAnthropic, NICHE_MODEL } from "./anthropic";
import { median } from "./stats";

const MIN_MS = 60_000;
const PRE_WINDOW_MIN = 10; // pace baseline before the QT
const POST_WINDOW_MIN = 15; // impact window after the QT
const CONTEST_MIN = 5; // another QT within ±5 min → contested
const MIN_SPAN_MIN = 3; // need ≥3 min of snapshots per side to measure

interface SnapPoint {
  t: number; // ms
  views: number;
  engagements: number;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

function viewsAt(snaps: SnapPoint[], t: number): number | null {
  let best: SnapPoint | null = null;
  for (const s of snaps) {
    if (s.t <= t) best = s;
    else break;
  }
  return best ? best.views : null;
}

/** Average views/min between t0 and t1, from the stored snapshots. */
function paceBetween(snaps: SnapPoint[], t0: number, t1: number): number | null {
  const pts = snaps.filter((s) => s.t >= t0 && s.t <= t1);
  if (pts.length < 2) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const spanMin = (last.t - first.t) / MIN_MS;
  if (spanMin < MIN_SPAN_MIN) return null;
  return (last.views - first.views) / spanMin;
}

export interface QuoteImpactView {
  quoteTweetId: string;
  authorUsername: string;
  isRoster: boolean;
  qtPostedAt: string;
  qtViews: number;
  prePaceVpm: number;
  postPaceVpm: number;
  upliftPct: number | null;
  excessViews: number;
  contested: boolean;
  insufficientData?: boolean;
}

/**
 * Compute (and persist) the measured inflection for every QT of a tracker.
 * Idempotent — re-running refreshes the rows.
 */
export async function computeAttribution(trackerId: string): Promise<QuoteImpactView[]> {
  const tracker = await prisma.liveTracker.findUnique({ where: { id: trackerId } });
  if (!tracker) return [];

  const [snapsRaw, quotes] = await Promise.all([
    prisma.postSnapshot.findMany({
      where: { postId: tracker.postId, capturedAt: { gte: new Date(tracker.startedAt.getTime() - 15 * MIN_MS) } },
      orderBy: { capturedAt: "asc" },
      select: { capturedAt: true, viewCount: true, engagements: true },
    }),
    prisma.liveQuote.findMany({ where: { trackerId }, orderBy: { postedAt: "asc" } }),
  ]);
  const snaps: SnapPoint[] = snapsRaw.map((s) => ({
    t: s.capturedAt.getTime(),
    views: s.viewCount,
    engagements: s.engagements,
  }));

  const out: QuoteImpactView[] = [];
  for (const q of quotes) {
    const T = q.postedAt.getTime();
    const prePace = paceBetween(snaps, T - PRE_WINDOW_MIN * MIN_MS, T);
    const postPace = paceBetween(snaps, T, T + POST_WINDOW_MIN * MIN_MS);
    const contested = quotes.some(
      (o) => o.id !== q.id && Math.abs(o.postedAt.getTime() - T) <= CONTEST_MIN * MIN_MS,
    );

    if (prePace == null || postPace == null) {
      out.push({
        quoteTweetId: q.tweetId,
        authorUsername: q.authorUsername,
        isRoster: q.isRoster,
        qtPostedAt: q.postedAt.toISOString(),
        qtViews: q.views,
        prePaceVpm: prePace ?? 0,
        postPaceVpm: postPace ?? 0,
        upliftPct: null,
        excessViews: 0,
        contested,
        insufficientData: true,
      });
      continue;
    }

    const upliftPct = prePace > 1 ? (postPace - prePace) / prePace : null;
    const v0 = viewsAt(snaps, T);
    const v1 = viewsAt(snaps, T + POST_WINDOW_MIN * MIN_MS);
    const excessViews =
      v0 != null && v1 != null ? Math.max(0, Math.round(v1 - v0 - prePace * POST_WINDOW_MIN)) : 0;

    const row = {
      trackerId,
      quoteTweetId: q.tweetId,
      authorUsername: q.authorUsername,
      isRoster: q.isRoster,
      qtPostedAt: q.postedAt,
      prePaceVpm: Math.round(prePace * 10) / 10,
      postPaceVpm: Math.round(postPace * 10) / 10,
      upliftPct: upliftPct != null ? Math.round(upliftPct * 1000) / 1000 : null,
      excessViews,
      windowMin: POST_WINDOW_MIN,
      contested,
    };
    // Persist the measurement — this is the long-term memory. Best-effort so a
    // lagging migration can't block report generation.
    try {
      await prisma.quoteImpact.upsert({
        where: { trackerId_quoteTweetId: { trackerId, quoteTweetId: q.tweetId } },
        update: row,
        create: row,
      });
    } catch {
      /* QuoteImpact table may predate `prisma db push` */
    }

    out.push({
      quoteTweetId: q.tweetId,
      authorUsername: q.authorUsername,
      isRoster: q.isRoster,
      qtPostedAt: q.postedAt.toISOString(),
      qtViews: q.views,
      prePaceVpm: row.prePaceVpm,
      postPaceVpm: row.postPaceVpm,
      upliftPct: row.upliftPct,
      excessViews,
      contested,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Memory — cross-launch amplifier profiles
// ---------------------------------------------------------------------------

export interface AmplifierProfile {
  username: string;
  isRoster: boolean;
  launches: number; // distinct trackers this creator amplified
  qts: number;
  medianUpliftPct: number | null;
  totalExcessViews: number;
  cleanMeasurements: number; // uncontested, measurable QTs
}

export async function getAmplifierProfiles(usernames?: string[]): Promise<AmplifierProfile[]> {
  let rows: Awaited<ReturnType<typeof prisma.quoteImpact.findMany>>;
  try {
    rows = await prisma.quoteImpact.findMany({
      where: usernames?.length ? { authorUsername: { in: usernames } } : {},
    });
  } catch {
    return []; // table not migrated yet
  }
  const byAuthor = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byAuthor.get(r.authorUsername) ?? [];
    arr.push(r);
    byAuthor.set(r.authorUsername, arr);
  }
  const out: AmplifierProfile[] = [];
  for (const [username, list] of byAuthor) {
    const clean = list.filter((r) => !r.contested && r.upliftPct != null);
    out.push({
      username,
      isRoster: list.some((r) => r.isRoster),
      launches: new Set(list.map((r) => r.trackerId)).size,
      qts: list.length,
      medianUpliftPct: clean.length ? Math.round(median(clean.map((r) => r.upliftPct as number)) * 1000) / 1000 : null,
      totalExcessViews: list.reduce((s, r) => s + r.excessViews, 0),
      cleanMeasurements: clean.length,
    });
  }
  return out.sort((a, b) => b.totalExcessViews - a.totalExcessViews);
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
  rosterExcessViews: number;
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
    summary: { type: "string", description: "2-4 sentences: how the launch went, in plain operator language." },
    keyMoments: { type: "array", items: { type: "string" }, description: "3-5 timestamped moments (use HH:MM), each tied to a number from the stats." },
    amplifierInsights: { type: "array", items: { type: "string" }, description: "2-4 insights about which creators moved the needle, citing measured uplift/excess views and historical profiles when available." },
    recommendations: { type: "array", items: { type: "string" }, description: "2-4 concrete next-launch recommendations grounded ONLY in the measurements (who to activate, when, what to test)." },
  },
  required: ["headline", "summary", "keyMoments", "amplifierInsights", "recommendations"],
  additionalProperties: false,
} as const;

async function writeNarrative(stats: LaunchStats): Promise<LaunchNarrative | null> {
  try {
    const client = getAnthropic();
    // Compact payload — narrative rides on measurements, never raw dumps.
    const compact = {
      ...stats,
      series: undefined, // the model doesn't need 1000 points
      impacts: stats.impacts.slice(0, 25).map((i) => ({
        author: i.authorUsername,
        roster: i.isRoster,
        at: i.qtPostedAt,
        prePaceVpm: i.prePaceVpm,
        postPaceVpm: i.postPaceVpm,
        upliftPct: i.upliftPct,
        excessViews: i.excessViews,
        contested: i.contested,
        insufficientData: i.insufficientData ?? false,
      })),
      profiles: stats.profiles.slice(0, 15),
      qtMarkers: undefined,
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
            `You are writing the launch recap for an influencer-marketing ops team. Below are MEASURED stats from live-tracking a launch post on X: pace inflections attributed to each quote tweet (pre vs post views/min, excess views vs baseline), plus each amplifier's historical profile across past launches.\n\nRules: every number you mention must come from the data. Contested measurements (QTs landing within 5 minutes of each other) share credit — say so when relevant. insufficientData rows have no reliable measurement — never cite them as impact. Keep it sharp and operator-grade; no fluff.\n\nDATA:\n${JSON.stringify(compact)}`,
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
        select: {
          id: true,
          url: true,
          text: true,
          account: { select: { username: true } },
        },
      },
    },
  });
  if (!tracker) return { error: "Tracker not found" };

  const windowStart = tracker.startedAt;
  const windowEnd = tracker.stoppedAt ?? new Date();

  const snaps = await prisma.postSnapshot.findMany({
    where: { postId: tracker.postId, capturedAt: { gte: new Date(windowStart.getTime() - 5 * MIN_MS), lte: windowEnd } },
    orderBy: { capturedAt: "asc" },
    select: { capturedAt: true, viewCount: true, engagements: true },
  });
  if (snaps.length < 2) return { error: "Not enough tracked data yet — let it tick for a few minutes first." };

  const impacts = await computeAttribution(trackerId);
  const quotes = await prisma.liveQuote.findMany({ where: { trackerId } });
  const involved = [...new Set(impacts.map((i) => i.authorUsername))];
  const profiles = await getAmplifierProfiles(involved);

  // Peak + average pace from consecutive snapshots.
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
    rosterExcessViews: impacts.filter((i) => i.isRoster).reduce((s, i) => s + i.excessViews, 0),
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
      headline: narrative?.headline ?? `${stats.label}: +${stats.viewsGained.toLocaleString("en-US")} views in ${durationMin}m`,
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
