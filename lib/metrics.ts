import { prisma } from "./db";
import { getSettings } from "./settings";
import { summarizeViews } from "./scoring";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FollowerPoint {
  t: string; // ISO
  followers: number;
  following: number;
}

export interface ReachPoint {
  t: string; // ISO
  views: number;
  engagements: number;
  engagementRate: number; // engagements / views
}

export interface DailyPoint {
  t: string; // ISO day (midnight UTC)
  medianViews: number | null; // median latest views of ORGANIC posts authored that day (null = no posts)
  postCount: number;
}

export interface RecentPost {
  id: string;
  text: string;
  postedAt: string;
  url: string | null;
  isFrozen: boolean;
  commissioned: boolean;
  views: number;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
  engagements: number;
  erImpressions: number;
}

export interface DistributionPoint {
  id: string;
  ageDays: number; // days since posted
  views: number;
  isMax: boolean;
}

export interface CommissionedMarker {
  id: string;
  ageDays: number;
  views: number;
  deliveryRatioViews: number | null; // views ÷ organic baseline median
  underdelivered: boolean;
}

export interface ViewDistribution {
  points: DistributionPoint[]; // organic in-window posts (trailing 7d)
  median: number;
  p25: number;
  mean: number;
  maxViews: number;
  baselineMedianViews: number; // organic 30d median — the "normal band" for commissioned posts
  commissionedMarkers: CommissionedMarker[];
  domainDays: number; // x-axis span (≥ 7)
}

export interface InfluencerDetail {
  account: {
    id: string;
    username: string;
    displayName: string | null;
    profilePicture: string | null;
    description: string | null;
    isBlueVerified: boolean;
    verifiedType: string | null;
    xCreatedAt: string | null;
    tags: string[];
    status: string;
    pollingTier: string;
    lastPolledAt: string | null;
    backfilledAt: string | null;
  };
  followerSeries: FollowerPoint[];
  reachSeries: ReachPoint[];
  dailySeries: DailyPoint[]; // median views per posting day, trailing 30d
  recentPosts: RecentPost[];
  distribution: ViewDistribution;
}

/**
 * Median views per posting day: for each of the trailing `days`, the median of
 * the LATEST view counts of organic posts authored that day. Days with no posts
 * are null (chart gap) rather than zero — no posts is an absence, never a zero.
 */
function buildDailySeries(
  posts: { postedAt: string; views: number; commissioned: boolean }[],
  days = 30,
): DailyPoint[] {
  const byDay = new Map<string, number[]>();
  for (const p of posts) {
    if (p.commissioned) continue; // organic performance only
    const day = p.postedAt.slice(0, 10);
    const arr = byDay.get(day) ?? [];
    arr.push(p.views);
    byDay.set(day, arr);
  }
  const out: DailyPoint[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    const views = byDay.get(key);
    out.push({
      t: d.toISOString(),
      medianViews: views && views.length ? Math.round(summarizeViews(views).median) : null,
      postCount: views?.length ?? 0,
    });
  }
  return out;
}

/** Carry-forward totals: at each run timestamp, sum each post's last-known value
 *  so the line reflects accumulated reach and never dips when a post freezes. */
function buildReachSeries(
  snaps: { postId: string; capturedAt: Date; viewCount: number; engagements: number }[],
): ReachPoint[] {
  const latestViews = new Map<string, number>();
  const latestEng = new Map<string, number>();
  const points: ReachPoint[] = [];
  let i = 0;
  while (i < snaps.length) {
    const t = snaps[i].capturedAt.getTime();
    // consume all snapshots sharing this run timestamp
    while (i < snaps.length && snaps[i].capturedAt.getTime() === t) {
      latestViews.set(snaps[i].postId, snaps[i].viewCount);
      latestEng.set(snaps[i].postId, snaps[i].engagements);
      i++;
    }
    let views = 0;
    for (const v of latestViews.values()) views += v;
    let eng = 0;
    for (const e of latestEng.values()) eng += e;
    points.push({
      t: new Date(t).toISOString(),
      views,
      engagements: eng,
      engagementRate: views > 0 ? eng / views : 0,
    });
  }
  return points;
}

export async function getInfluencerDetail(usernameRaw: string): Promise<InfluencerDetail | null> {
  const username = usernameRaw.trim().replace(/^@/, "").toLowerCase();
  const settings = await getSettings();
  const account = await prisma.account.findUnique({
    where: { username },
    include: { tags: { include: { tag: true } } },
  });
  if (!account) return null;

  const monthAgo = new Date(Date.now() - 30 * DAY_MS);

  const [followerSnaps, postSnaps, recent] = await Promise.all([
    prisma.accountSnapshot.findMany({
      where: { accountId: account.id, capturedAt: { gte: monthAgo } },
      orderBy: { capturedAt: "asc" },
      select: { capturedAt: true, followers: true, following: true },
    }),
    prisma.postSnapshot.findMany({
      where: { accountId: account.id, capturedAt: { gte: monthAgo } },
      orderBy: { capturedAt: "asc" },
      select: { postId: true, capturedAt: true, viewCount: true, engagements: true },
    }),
    prisma.post.findMany({
      where: {
        accountId: account.id,
        ...(settings.includeReplies ? {} : { isReply: false }),
        postedAt: { gte: monthAgo },
      },
      orderBy: { postedAt: "desc" },
      include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
    }),
  ]);

  const followerSeries: FollowerPoint[] = followerSnaps.map((s) => ({
    t: s.capturedAt.toISOString(),
    followers: s.followers,
    following: s.following,
  }));

  const reachSeries = buildReachSeries(postSnaps);

  const recentPosts: RecentPost[] = recent
    .map((p) => {
      const s = p.snapshots[0];
      const views = s?.viewCount ?? 0;
      const engagements = s?.engagements ?? 0;
      return {
        id: p.id,
        text: p.text,
        postedAt: p.postedAt.toISOString(),
        url: p.url,
        isFrozen: p.isFrozen,
        commissioned: p.commissioned,
        views,
        likes: s?.likeCount ?? 0,
        retweets: s?.retweetCount ?? 0,
        replies: s?.replyCount ?? 0,
        quotes: s?.quoteCount ?? 0,
        bookmarks: s?.bookmarkCount ?? 0,
        engagements,
        erImpressions: views > 0 ? engagements / views : 0,
      };
    })
    .sort((a, b) => b.views - a.views);

  // View distribution over the trailing 7d scoring window (why median > mean).
  // Organic posts form the "normal band"; commissioned posts are overlaid as
  // markers so you can see where a paid post landed relative to it.
  const now = Date.now();
  const weekAgo = now - 7 * DAY_MS;
  const organic = recentPosts.filter((p) => !p.commissioned);
  const baselineMedianViews = summarizeViews(organic.map((p) => p.views)).median;

  const inWindow = organic.filter((p) => new Date(p.postedAt).getTime() >= weekAgo);
  const windowViews = inWindow.map((p) => p.views);
  const summary = summarizeViews(windowViews);
  const maxViews = windowViews.length ? Math.max(...windowViews) : 0;

  const commissionedMarkers: CommissionedMarker[] = recentPosts
    .filter((p) => p.commissioned)
    .map((p) => {
      const deliveryRatioViews = baselineMedianViews > 0 ? p.views / baselineMedianViews : null;
      return {
        id: p.id,
        ageDays: (now - new Date(p.postedAt).getTime()) / DAY_MS,
        views: p.views,
        deliveryRatioViews,
        underdelivered:
          deliveryRatioViews != null && deliveryRatioViews < settings.underdeliverThreshold,
      };
    });

  const domainDays = Math.min(
    30,
    Math.max(7, ...commissionedMarkers.map((m) => Math.ceil(m.ageDays)), 7),
  );

  const distribution: ViewDistribution = {
    points: inWindow.map((p) => ({
      id: p.id,
      ageDays: (now - new Date(p.postedAt).getTime()) / DAY_MS,
      views: p.views,
      isMax: p.views === maxViews && maxViews > 0,
    })),
    median: summary.median,
    p25: summary.p25,
    mean: summary.mean,
    maxViews,
    baselineMedianViews,
    commissionedMarkers,
    domainDays,
  };

  const dailySeries = buildDailySeries(
    recentPosts.map((p) => ({ postedAt: p.postedAt, views: p.views, commissioned: p.commissioned })),
  );

  return {
    account: {
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      profilePicture: account.profilePicture,
      description: account.description,
      isBlueVerified: account.isBlueVerified,
      verifiedType: account.verifiedType,
      xCreatedAt: account.xCreatedAt ? account.xCreatedAt.toISOString() : null,
      tags: account.tags.map((t) => t.tag.name),
      status: account.status,
      pollingTier: account.pollingTier,
      lastPolledAt: account.lastPolledAt ? account.lastPolledAt.toISOString() : null,
      backfilledAt: account.backfilledAt ? account.backfilledAt.toISOString() : null,
    },
    followerSeries,
    reachSeries,
    dailySeries,
    recentPosts,
    distribution,
  };
}
