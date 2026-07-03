import { prisma } from "./db";
import { getSettings } from "./settings";
import { quantileSorted, summarizeViews, normalize, type ViewSummary } from "./stats";
import { applyEconomics, type Economics } from "./value";
import type { AppSettings } from "@prisma/client";

// Stats helpers moved to lib/stats.ts; re-exported so existing imports keep working.
export { quantileSorted, summarizeViews, normalize, type ViewSummary };

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
export const RISING_THRESHOLD = 0.25; // +25% WoW flags a "rising" account

export type Direction = "rising" | "falling" | "flat";

export interface LeaderboardRow extends Economics {
  rank: number;
  accountId: string;
  username: string;
  displayName: string | null;
  profilePicture: string | null;
  isBlueVerified: boolean;
  tags: string[];
  status: string;
  pollingTier: string;
  backfilled: boolean;
  lastPolledAt: string | null;

  currentFollowers: number | null;
  following: number | null;
  rateQuoteTweet: number | null;
  ratePost: number | null;
  rateRetweet: number | null;
  rateThread: number | null;
  ratesUpdatedAt: string | null; // staleness hint for the value layer
  followerGrowth7d: number | null;
  followerGrowth7dPct: number | null;
  followerGrowth30d: number | null;
  followerGrowth30dPct: number | null;

  postCount7d: number;
  avgViews: number; // mean views/post (kept for reference; NOT the score input)
  medianViews: number; // reach input to the Performance Score (robust to viral spikes)
  p25Views: number; // "floor" — 25th percentile views/post
  consistency: number | null; // IQR ÷ median; lower = steadier (null if <2 posts)
  totalViews7d: number;
  avgEngagements: number;
  medianEng: number; // median engagements/post 7d — denominator for cost-per-eng
  erImpressions: number; // engagements ÷ impressions
  erFollowers: number; // engagements ÷ followers

  // Confidence layer
  postsInWindow: number; // posts authored in the scoring window
  dataFreshnessHours: number | null; // now − lastPolledAt, in hours
  lowConfidence: boolean;
  lowConfidenceReasons: string[];

  // Movers
  wowViewsPct: number | null;
  wowEngPct: number | null;
  rising: boolean;
  falling: boolean;
  direction: Direction;

  // Per-row 4-week weekly-median views sparkline (oldest → newest)
  viewsSparkline: number[];

  reachNorm: number; // 0..100
  erNorm: number; // 0..100
  performanceScore: number; // 0..100
}

/** Weekly-median views/post over the trailing `weeks` weeks (oldest → newest). */
function weeklyMedianSparkline(
  posts: { postedAt: Date; views: number }[],
  now: number,
  weeks: number,
): number[] {
  const buckets: number[][] = Array.from({ length: weeks }, () => []);
  for (const p of posts) {
    const ageDays = (now - p.postedAt.getTime()) / DAY_MS;
    const weeksAgo = Math.floor(ageDays / 7);
    if (weeksAgo < 0 || weeksAgo >= weeks) continue;
    buckets[weeks - 1 - weeksAgo].push(p.views);
  }
  return buckets.map((b) => {
    if (b.length === 0) return 0;
    return Math.round(quantileSorted([...b].sort((a, c) => a - c), 0.5));
  });
}

function findClosest(
  snaps: { capturedAt: Date; followers: number }[],
  targetMs: number,
): number | null {
  if (snaps.length === 0) return null;
  let best: { capturedAt: Date; followers: number } | null = null;
  let bestDiff = Infinity;
  for (const s of snaps) {
    const diff = Math.abs(s.capturedAt.getTime() - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return best ? best.followers : null;
}

/** Compute the full ranked leaderboard from stored snapshots. */
export async function computeLeaderboard(settingsArg?: AppSettings): Promise<LeaderboardRow[]> {
  const settings = settingsArg ?? (await getSettings());
  const now = Date.now();
  const weekAgo = now - 7 * DAY_MS;
  const twoWeeksAgo = now - 14 * DAY_MS;
  const fourWeeksAgo = now - 28 * DAY_MS;
  const monthAgo = now - 30 * DAY_MS;

  const accounts = await prisma.account.findMany({
    where: { status: "active" },
    include: { tags: { include: { tag: true } } },
  });

  // latest profile snapshot per account (current followers)
  const latestSnaps = await prisma.accountSnapshot.findMany({
    where: { account: { status: "active" } },
    orderBy: { capturedAt: "desc" },
    distinct: ["accountId"],
    select: { accountId: true, followers: true, following: true, capturedAt: true },
  });
  const latestByAccount = new Map(latestSnaps.map((s) => [s.accountId, s]));

  // profile snapshots within 30d (for 7d / 30d growth baselines)
  const histSnaps = await prisma.accountSnapshot.findMany({
    where: { account: { status: "active" }, capturedAt: { gte: new Date(monthAgo) } },
    orderBy: { capturedAt: "asc" },
    select: { accountId: true, followers: true, capturedAt: true },
  });
  const histByAccount = new Map<string, { capturedAt: Date; followers: number }[]>();
  for (const s of histSnaps) {
    const arr = histByAccount.get(s.accountId) ?? [];
    arr.push({ capturedAt: s.capturedAt, followers: s.followers });
    histByAccount.set(s.accountId, arr);
  }

  // Posts authored in the last 28d (4-week sparkline window), latest snapshot each.
  // Scoring uses the 7d/14d subsets; the sparkline uses the full 28d. One query,
  // no per-row round-trips (keeps the cached leaderboard fast).
  const posts = await prisma.post.findMany({
    where: {
      account: { status: "active" },
      isReply: false,
      commissioned: false, // organic reach only — paid placements are scored separately
      postedAt: { gte: new Date(fourWeeksAgo) },
    },
    select: {
      accountId: true,
      postedAt: true,
      snapshots: {
        orderBy: { capturedAt: "desc" },
        take: 1,
        select: { viewCount: true, engagements: true },
      },
    },
  });
  const postsByAccount = new Map<
    string,
    { postedAt: Date; views: number; engagements: number }[]
  >();
  for (const p of posts) {
    const snap = p.snapshots[0];
    if (!snap) continue;
    const arr = postsByAccount.get(p.accountId) ?? [];
    arr.push({ postedAt: p.postedAt, views: snap.viewCount, engagements: snap.engagements });
    postsByAccount.set(p.accountId, arr);
  }

  const minPosts = settings.minPostsForConfidence;
  const staleHours = settings.stalePollHours;
  const fallThresh = settings.fallingThreshold;

  interface Interim
    extends Omit<
      LeaderboardRow,
      "rank" | "reachNorm" | "erNorm" | "performanceScore" | keyof Economics
    > {}
  const interim: Interim[] = accounts.map((a) => {
    const latest = latestByAccount.get(a.id) ?? null;
    const currentFollowers = latest?.followers ?? null;
    const following = latest?.following ?? null;
    const hist = histByAccount.get(a.id) ?? [];

    const f7 = currentFollowers != null ? findClosest(hist, weekAgo) : null;
    const f30 = currentFollowers != null ? findClosest(hist, monthAgo) : null;
    const followerGrowth7d = currentFollowers != null && f7 != null ? currentFollowers - f7 : null;
    const followerGrowth30d = currentFollowers != null && f30 != null ? currentFollowers - f30 : null;
    const followerGrowth7dPct =
      followerGrowth7d != null && f7 && f7 > 0 ? followerGrowth7d / f7 : null;
    const followerGrowth30dPct =
      followerGrowth30d != null && f30 && f30 > 0 ? followerGrowth30d / f30 : null;

    const all = postsByAccount.get(a.id) ?? [];
    const thisWeek = all.filter((p) => p.postedAt.getTime() >= weekAgo);
    const lastWeek = all.filter(
      (p) => p.postedAt.getTime() >= twoWeeksAgo && p.postedAt.getTime() < weekAgo,
    );

    const postCount7d = thisWeek.length;
    const totalViews7d = thisWeek.reduce((s, p) => s + p.views, 0);
    const totalEng7d = thisWeek.reduce((s, p) => s + p.engagements, 0);

    const viewSummary = summarizeViews(thisWeek.map((p) => p.views));
    const avgViews = viewSummary.mean;
    const medianViews = viewSummary.median;
    const p25Views = viewSummary.p25;
    const consistency = viewSummary.consistency;
    const medianEng = summarizeViews(thisWeek.map((p) => p.engagements)).median;

    const avgEngagements = postCount7d > 0 ? totalEng7d / postCount7d : 0;
    const erImpressions = totalViews7d > 0 ? totalEng7d / totalViews7d : 0;
    const erFollowers =
      currentFollowers && currentFollowers > 0 ? avgEngagements / currentFollowers : 0;

    // Movers — this week's mean views/post vs last week's (mirror for engagement).
    const lwCount = lastWeek.length;
    const lwViews = lastWeek.reduce((s, p) => s + p.views, 0);
    const lwEng = lastWeek.reduce((s, p) => s + p.engagements, 0);
    const avgViewsLast = lwCount > 0 ? lwViews / lwCount : 0;
    const avgEngLast = lwCount > 0 ? lwEng / lwCount : 0;
    const wowViewsPct = avgViewsLast > 0 ? (avgViews - avgViewsLast) / avgViewsLast : null;
    const wowEngPct = avgEngLast > 0 ? (avgEngagements - avgEngLast) / avgEngLast : null;
    const rising =
      postCount7d > 0 &&
      ((wowViewsPct != null && wowViewsPct >= RISING_THRESHOLD) ||
        (wowEngPct != null && wowEngPct >= RISING_THRESHOLD));
    const falling =
      postCount7d > 0 &&
      !rising &&
      ((wowViewsPct != null && wowViewsPct <= -fallThresh) ||
        (wowEngPct != null && wowEngPct <= -fallThresh));
    const direction: Direction = rising ? "rising" : falling ? "falling" : "flat";

    // Confidence
    const postsInWindow = postCount7d;
    const dataFreshnessHours = a.lastPolledAt
      ? (now - a.lastPolledAt.getTime()) / HOUR_MS
      : null;
    const lowConfidenceReasons: string[] = [];
    if (postsInWindow < minPosts) {
      lowConfidenceReasons.push(
        `only ${postsInWindow} post${postsInWindow === 1 ? "" : "s"} in 7d (need ${minPosts})`,
      );
    }
    if (dataFreshnessHours == null) {
      lowConfidenceReasons.push("never polled");
    } else if (dataFreshnessHours > staleHours) {
      lowConfidenceReasons.push(`data ${Math.round(dataFreshnessHours)}h stale`);
    }
    const lowConfidence = lowConfidenceReasons.length > 0;

    const viewsSparkline = weeklyMedianSparkline(all, now, 4);

    return {
      accountId: a.id,
      username: a.username,
      displayName: a.displayName,
      profilePicture: a.profilePicture,
      isBlueVerified: a.isBlueVerified,
      tags: a.tags.map((t) => t.tag.name),
      status: a.status,
      pollingTier: a.pollingTier,
      backfilled: a.backfilledAt != null,
      lastPolledAt: a.lastPolledAt ? a.lastPolledAt.toISOString() : null,
      currentFollowers,
      following,
      rateQuoteTweet: a.rateQuoteTweet,
      ratePost: a.ratePost,
      rateRetweet: a.rateRetweet,
      rateThread: a.rateThread,
      ratesUpdatedAt: a.ratesUpdatedAt ? a.ratesUpdatedAt.toISOString() : null,
      followerGrowth7d,
      followerGrowth7dPct,
      followerGrowth30d,
      followerGrowth30dPct,
      postCount7d,
      avgViews,
      medianViews,
      p25Views,
      consistency,
      totalViews7d,
      avgEngagements,
      medianEng,
      erImpressions,
      erFollowers,
      postsInWindow,
      dataFreshnessHours,
      lowConfidence,
      lowConfidenceReasons,
      wowViewsPct,
      wowEngPct,
      rising,
      falling,
      direction,
      viewsSparkline,
    };
  });

  // normalize reach (MEDIAN views) + engagement rate across the tracked set
  const reachNorms = normalize(interim.map((r) => r.medianViews), settings.normalization);
  const erNorms = normalize(interim.map((r) => r.erImpressions), settings.normalization);

  const wSum = settings.reachWeight + settings.engagementWeight;
  const wReach = wSum > 0 ? settings.reachWeight / wSum : 0.5;
  const wEng = wSum > 0 ? settings.engagementWeight / wSum : 0.5;

  const scored = interim.map((r, i) => {
    const reachNorm = reachNorms[i] ?? 0;
    const erNorm = erNorms[i] ?? 0;
    const performanceScore = Math.round((wReach * reachNorm + wEng * erNorm) * 10) / 10;
    return { ...r, rank: 0, reachNorm, erNorm, performanceScore };
  });

  scored.sort((a, b) => b.performanceScore - a.performanceScore);
  scored.forEach((r, i) => (r.rank = i + 1));

  // Economics layer — implied CPMs, Value Score, price-vs-peers. Sits on top of
  // (and never inside) the Performance Score. See lib/value.ts.
  return applyEconomics(scored);
}

/** Top movers by week-over-week views growth (for the dashboard). */
export function topMovers(rows: LeaderboardRow[], limit = 5): LeaderboardRow[] {
  return [...rows]
    .filter((r) => r.wowViewsPct != null && r.postCount7d > 0)
    .sort((a, b) => (b.wowViewsPct ?? 0) - (a.wowViewsPct ?? 0))
    .slice(0, limit);
}

/** Biggest decliners by week-over-week views drop (for the dashboard). */
export function topDecliners(rows: LeaderboardRow[], limit = 5): LeaderboardRow[] {
  return [...rows]
    .filter((r) => r.wowViewsPct != null && r.postCount7d > 0 && (r.wowViewsPct ?? 0) < 0)
    .sort((a, b) => (a.wowViewsPct ?? 0) - (b.wowViewsPct ?? 0))
    .slice(0, limit);
}
