import { prisma } from "./db";
import { computeLeaderboard, type LeaderboardRow } from "./scoring";
import { getSettings } from "./settings";

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

export interface RecentPost {
  id: string;
  text: string;
  postedAt: string;
  url: string | null;
  isFrozen: boolean;
  views: number;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
  engagements: number;
  erImpressions: number;
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
  row: LeaderboardRow | null;
  followerSeries: FollowerPoint[];
  reachSeries: ReachPoint[];
  recentPosts: RecentPost[];
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

  const [followerSnaps, postSnaps, recent, board] = await Promise.all([
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
    computeLeaderboard(settings),
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
    row: board.find((r) => r.accountId === account.id) ?? null,
    followerSeries,
    reachSeries,
    recentPosts,
  };
}
