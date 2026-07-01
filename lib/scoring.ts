import { prisma } from "./db";
import { getSettings } from "./settings";
import type { AppSettings } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;
export const RISING_THRESHOLD = 0.25; // +25% WoW flags a "rising" account

export interface LeaderboardRow {
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
  followerGrowth7d: number | null;
  followerGrowth7dPct: number | null;
  followerGrowth30d: number | null;
  followerGrowth30dPct: number | null;

  postCount7d: number;
  avgViews: number; // reach
  totalViews7d: number;
  avgEngagements: number;
  erImpressions: number; // engagements ÷ impressions
  erFollowers: number; // engagements ÷ followers

  wowViewsPct: number | null;
  wowEngPct: number | null;
  rising: boolean;

  reachNorm: number; // 0..100
  erNorm: number; // 0..100
  performanceScore: number; // 0..100
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function percentileRanks(values: number[]): number[] {
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

function zScoreNorms(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  return values.map((x) => (std > 0 ? clamp(((x - mean) / std + 3) / 6 * 100, 0, 100) : 50));
}

function normalize(values: number[], method: string): number[] {
  return method === "zscore" ? zScoreNorms(values) : percentileRanks(values);
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

  // posts authored in the last 14d (this week + last week), latest snapshot each
  const posts = await prisma.post.findMany({
    where: {
      account: { status: "active" },
      isReply: false,
      postedAt: { gte: new Date(twoWeeksAgo) },
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

  interface Interim extends Omit<LeaderboardRow, "rank" | "reachNorm" | "erNorm" | "performanceScore"> {}
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
    const avgViews = postCount7d > 0 ? totalViews7d / postCount7d : 0;
    const avgEngagements = postCount7d > 0 ? totalEng7d / postCount7d : 0;
    const erImpressions = totalViews7d > 0 ? totalEng7d / totalViews7d : 0;
    const erFollowers =
      currentFollowers && currentFollowers > 0 ? avgEngagements / currentFollowers : 0;

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
      followerGrowth7d,
      followerGrowth7dPct,
      followerGrowth30d,
      followerGrowth30dPct,
      postCount7d,
      avgViews,
      totalViews7d,
      avgEngagements,
      erImpressions,
      erFollowers,
      wowViewsPct,
      wowEngPct,
      rising,
    };
  });

  // normalize reach + engagement rate across the tracked set
  const reachNorms = normalize(interim.map((r) => r.avgViews), settings.normalization);
  const erNorms = normalize(interim.map((r) => r.erImpressions), settings.normalization);

  const wSum = settings.reachWeight + settings.engagementWeight;
  const wReach = wSum > 0 ? settings.reachWeight / wSum : 0.5;
  const wEng = wSum > 0 ? settings.engagementWeight / wSum : 0.5;

  const scored: LeaderboardRow[] = interim.map((r, i) => {
    const reachNorm = reachNorms[i] ?? 0;
    const erNorm = erNorms[i] ?? 0;
    const performanceScore = Math.round((wReach * reachNorm + wEng * erNorm) * 10) / 10;
    return { ...r, rank: 0, reachNorm, erNorm, performanceScore };
  });

  scored.sort((a, b) => b.performanceScore - a.performanceScore);
  scored.forEach((r, i) => (r.rank = i + 1));
  return scored;
}

/** Top movers by week-over-week views growth (for the dashboard). */
export function topMovers(rows: LeaderboardRow[], limit = 5): LeaderboardRow[] {
  return [...rows]
    .filter((r) => r.wowViewsPct != null && r.postCount7d > 0)
    .sort((a, b) => (b.wowViewsPct ?? 0) - (a.wowViewsPct ?? 0))
    .slice(0, limit);
}
