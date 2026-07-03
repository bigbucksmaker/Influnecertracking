// ---------------------------------------------------------------------------
// Live post tracking — the launch-day panel.
//
// Use case: a launch post goes out from a founder/brand profile; the roster
// amplifies it with quote tweets and replies. This module gives that post a
// high-frequency time series (per-minute snapshots while "live") plus a
// quote-tweet discovery feed, so the panel can show pace (views/min,
// engagements/min), totals, and which roster creators have amplified.
//
// Cost design (twitterapi.io):
//  • Each tick reads ONLY the tracked post (one `tweets?tweet_ids=` id →
//    15 credits, $0.00015), so realtime cadences stay cheap: 5s ticks ≈
//    10.8K credits/hour (~$0.11/h) while a panel is open.
//  • Quote DISCOVERY (advanced_search) runs every ~4 minutes and refreshes the
//    metrics of the quote tweets it returns — QT numbers lag ≤4 min by design.
//  • Ticks are rate-limited server-side by `intervalSec` (floor 5s) no matter
//    how many tabs are open; a per-minute cron covers closed-tab tracking.
//  • `maxDurationMin` auto-stops every tracker (default 24h) so a forgotten
//    tracker cannot bleed credits.
// ---------------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { getProvider } from "./provider";
import { recordCost, recordError } from "./logging";
import { ingestPosts } from "./ingest";
import { getSettings } from "./settings";
import { engagementsOf } from "./engagement";
import { parseTweetId } from "./handles";
import type { RawPostMetrics } from "./provider/types";
import type { LiveTracker } from "@prisma/client";

const MIN_INTERVAL_SEC = 5; // hard floor between provider fetches per tracker (realtime mode)
const QUOTE_CHECK_SEC = 120; // discover quote tweets every ~2 min (also = QT kernel resolution)
const ROSTER_KEEPALIVE_LIMIT = 19; // roster QTs refreshed per cycle when they scroll off search

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface LiveSeriesPoint {
  t: string; // ISO
  views: number;
  engagements: number;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
}

export interface LiveQuoteView {
  tweetId: string;
  url: string | null;
  authorUsername: string;
  authorName: string | null;
  authorFollowers: number;
  text: string;
  postedAt: string;
  views: number;
  engagements: number;
  isRoster: boolean;
}

export interface LiveTrackerSummary {
  id: string;
  label: string | null;
  status: string;
  startedAt: string;
  stoppedAt: string | null;
  lastTickAt: string | null;
  intervalSec: number;
  maxDurationMin: number;
  shareToken: string | null;
  campaignId: string | null;
  campaignName: string | null;
  post: {
    id: string;
    url: string | null;
    text: string;
    postedAt: string;
    author: { username: string; displayName: string | null; profilePicture: string | null };
  };
  latest: LiveSeriesPoint | null;
  quoteCount: number;
  rosterQuoteCount: number;
}

export interface LivePayload {
  tracker: LiveTrackerSummary;
  series: LiveSeriesPoint[];
  quotes: LiveQuoteView[];
  quoteTotals: {
    count: number;
    totalViews: number;
    totalEngagements: number;
    rosterCount: number;
    rosterViews: number;
  };
}

// ---------------------------------------------------------------------------
// Create / control
// ---------------------------------------------------------------------------

export async function createTracker(input: {
  tweet: string; // URL or id
  label?: string | null;
  campaignId?: string | null;
  intervalSec?: number | null;
  maxDurationMin?: number | null;
  createdBy?: string | null;
}): Promise<{ trackerId: string }> {
  const tweetId = parseTweetId(input.tweet);
  if (!tweetId) throw new Error("Could not parse a tweet id or URL from the input");

  const settings = await getSettings();
  let post = await prisma.post.findUnique({ where: { id: tweetId } });

  if (!post) {
    // Ingest the tweet once — creates the author account if it isn't tracked
    // (launch posts usually come from a brand/founder profile, not the roster).
    const provider = getProvider();
    const start = Date.now();
    let res;
    try {
      res = await provider.getTweetsByIds([tweetId]);
    } catch (err) {
      await recordError("tweets_by_ids", err, { purpose: "live", durationMs: Date.now() - start });
      throw err;
    }
    const apiCallId = await recordCost(res.cost, { purpose: "live", durationMs: Date.now() - start });
    const raw = res.data[0];
    if (!raw) throw new Error("The provider returned no tweet for that id/URL");

    const authorUsername = (raw.authorUsername ?? "").toLowerCase();
    if (!authorUsername) throw new Error("Tweet has no resolvable author");
    let account = await prisma.account.findUnique({ where: { username: authorUsername } });
    if (!account) {
      account = await prisma.account.create({
        data: {
          username: authorUsername,
          xUserId: raw.authorUserId ?? undefined,
          status: "active",
          addedBy: input.createdBy ?? "live-tracker",
        },
      });
    }
    await ingestPosts(
      account.id,
      [raw],
      { capturedAt: new Date(), source: "live", apiCallId },
      { freezeAgeDays: settings.freezeAgeDays, includeReplies: true },
    );
    post = await prisma.post.findUnique({ where: { id: tweetId } });
    if (!post) throw new Error("Tweet could not be stored (it may be a retweet)");
  }

  // Un-freeze while live so nothing else stops updating it.
  await prisma.post.update({ where: { id: post.id }, data: { isFrozen: false, frozenAt: null } });

  const tracker = await prisma.liveTracker.create({
    data: {
      postId: post.id,
      label: input.label?.trim() || null,
      campaignId: input.campaignId || null,
      intervalSec: Math.max(MIN_INTERVAL_SEC, input.intervalSec ?? 60),
      maxDurationMin: Math.min(7 * 24 * 60, Math.max(10, input.maxDurationMin ?? 1440)),
      createdBy: input.createdBy ?? null,
    },
  });
  return { trackerId: tracker.id };
}

export async function setTrackerStatus(id: string, status: "live" | "stopped"): Promise<void> {
  await prisma.liveTracker.update({
    where: { id },
    data:
      status === "stopped"
        ? { status, stoppedAt: new Date() }
        : { status, stoppedAt: null, startedAt: new Date() }, // resume restarts the auto-stop clock
  });
}

/** Change the fetch cadence of a running tracker (floor 30s). */
export async function setTrackerInterval(id: string, intervalSec: number): Promise<void> {
  await prisma.liveTracker.update({
    where: { id },
    data: { intervalSec: Math.min(3600, Math.max(MIN_INTERVAL_SEC, Math.round(intervalSec))) },
  });
}

export async function deleteTracker(id: string): Promise<void> {
  await prisma.liveTracker.delete({ where: { id } }).catch(() => null);
}

/** Create (or rotate) the public read-only share token for a tracker. */
export async function enableShare(id: string): Promise<string> {
  const token = randomBytes(18).toString("base64url"); // 24 URL-safe chars
  await prisma.liveTracker.update({ where: { id }, data: { shareToken: token } });
  return token;
}

/** Revoke the public link. */
export async function disableShare(id: string): Promise<void> {
  await prisma.liveTracker.update({ where: { id }, data: { shareToken: null } });
}

/** Resolve a public share token to a payload. READ-ONLY — never ticks, so a
 *  public viewer can never trigger a provider call or spend credits. */
export async function getTrackerPayloadByToken(token: string): Promise<LivePayload | null> {
  if (!token || token.length < 16 || token.length > 64) return null;
  const t = await prisma.liveTracker.findUnique({
    where: { shareToken: token },
    select: { id: true },
  });
  return t ? getTrackerPayload(t.id) : null;
}

// ---------------------------------------------------------------------------
// Tick — one high-frequency measurement cycle
// ---------------------------------------------------------------------------

function rawToUpdate(raw: RawPostMetrics) {
  return {
    views: raw.viewCount,
    engagements: engagementsOf(raw),
  };
}

/**
 * Run one measurement cycle for a tracker. Server-side rate-limited: fetches
 * only when the last fetch is older than `intervalSec` (≥30s), so any number
 * of open tabs plus the cron produce at most one provider call per interval.
 */
export async function tickTracker(id: string): Promise<{ fetched: boolean; stopped: boolean }> {
  const tracker = await prisma.liveTracker.findUnique({ where: { id } });
  if (!tracker || tracker.status !== "live") return { fetched: false, stopped: false };

  const now = Date.now();

  // Auto-stop guard — a forgotten tracker must not bleed credits.
  if (now - tracker.startedAt.getTime() > tracker.maxDurationMin * 60_000) {
    await prisma.liveTracker.update({
      where: { id },
      data: { status: "stopped", stoppedAt: new Date() },
    });
    return { fetched: false, stopped: true };
  }

  const interval = Math.max(MIN_INTERVAL_SEC, tracker.intervalSec) * 1000;
  if (tracker.lastTickAt && now - tracker.lastTickAt.getTime() < interval) {
    return { fetched: false, stopped: false };
  }

  // Claim the tick BEFORE fetching so concurrent requests can't double-spend.
  const claimed = await prisma.liveTracker.updateMany({
    where: {
      id,
      status: "live",
      OR: [{ lastTickAt: null }, { lastTickAt: { lt: new Date(now - interval) } }],
    },
    data: { lastTickAt: new Date(now) },
  });
  if (claimed.count === 0) return { fetched: false, stopped: false };

  const post = await prisma.post.findUnique({ where: { id: tracker.postId } });
  if (!post) return { fetched: false, stopped: false };

  // Cheap tick: the tracked post ONLY (15 credits) — this is what makes 5s
  // realtime affordable. Quote-tweet metrics refresh on the discovery cycle.
  const provider = getProvider();
  const start = Date.now();
  let res;
  try {
    res = await provider.getTweetsByIds([tracker.postId]);
  } catch (err) {
    await recordError("tweets_by_ids", err, {
      accountId: post.accountId,
      purpose: "live",
      durationMs: Date.now() - start,
    });
    return { fetched: false, stopped: false };
  }
  const apiCallId = await recordCost(res.cost, {
    accountId: post.accountId,
    purpose: "live",
    durationMs: Date.now() - start,
  });

  const capturedAt = new Date();

  // Snapshot the tracked post.
  const main = res.data.find((r) => r.tweetId === tracker.postId);
  if (main) {
    await prisma.postSnapshot.upsert({
      where: { postId_capturedAt: { postId: tracker.postId, capturedAt } },
      update: {},
      create: {
        postId: tracker.postId,
        accountId: post.accountId,
        capturedAt,
        viewCount: main.viewCount,
        likeCount: main.likeCount,
        retweetCount: main.retweetCount,
        replyCount: main.replyCount,
        quoteCount: main.quoteCount,
        bookmarkCount: main.bookmarkCount,
        engagements: engagementsOf(main),
        source: "live",
        apiCallId,
      },
    });
    await prisma.post.update({
      where: { id: tracker.postId },
      data: { lastMetricsAt: capturedAt },
    });
  }

  // Periodically discover NEW quote tweets (also refreshes metrics of the
  // QTs the search returns — QT numbers intentionally lag ≤4 min).
  if (
    !tracker.lastQuoteCheckAt ||
    now - tracker.lastQuoteCheckAt.getTime() >= QUOTE_CHECK_SEC * 1000
  ) {
    await discoverQuotes(tracker, post.accountId).catch(() => null);
  }

  return { fetched: true, stopped: false };
}

/**
 * Search for quote tweets of the tracked post, upsert the feed, and record a
 * LiveQuoteSnapshot for every QT observed — these snapshots are the exposure
 * kernels the launch-report regression attributes inflections with. Roster
 * QTs that have scrolled off the search page get a keep-alive batch read so
 * their kernels stay alive for the whole launch.
 */
async function discoverQuotes(tracker: LiveTracker, accountId: string): Promise<void> {
  const provider = getProvider();
  const start = Date.now();
  let page;
  try {
    // X search operator for quote tweets of a specific post.
    page = await provider.searchTweets({ query: `quoted_tweet_id:${tracker.postId}`, queryType: "Latest" });
  } catch (err) {
    await recordError("advanced_search", err, {
      accountId,
      purpose: "live_quotes",
      durationMs: Date.now() - start,
    });
    return;
  }
  await recordCost(page.cost, { accountId, purpose: "live_quotes", durationMs: Date.now() - start });

  const authors = [...new Set(page.data.map((r) => (r.authorUsername ?? "").toLowerCase()).filter(Boolean))];
  const roster = await prisma.account.findMany({
    where: { username: { in: authors } },
    select: { username: true },
  });
  const rosterSet = new Set(roster.map((a) => a.username));

  const capturedAt = new Date();
  const seenIds = new Set<string>();
  const snapshotRows: { trackerId: string; tweetId: string; capturedAt: Date; views: number; engagements: number }[] = [];

  for (const raw of page.data) {
    if (!raw.tweetId || raw.isRetweet) continue;
    const username = (raw.authorUsername ?? "").toLowerCase();
    if (!username) continue;
    seenIds.add(raw.tweetId);
    snapshotRows.push({
      trackerId: tracker.id,
      tweetId: raw.tweetId,
      capturedAt,
      views: raw.viewCount,
      engagements: engagementsOf(raw),
    });
    await prisma.liveQuote.upsert({
      where: { trackerId_tweetId: { trackerId: tracker.id, tweetId: raw.tweetId } },
      update: { ...rawToUpdate(raw), capturedAt },
      create: {
        trackerId: tracker.id,
        tweetId: raw.tweetId,
        authorUsername: username,
        authorName: null,
        authorFollowers: 0,
        text: raw.text,
        url: raw.url,
        postedAt: raw.postedAt,
        views: raw.viewCount,
        engagements: engagementsOf(raw),
        isRoster: rosterSet.has(username),
      },
    });
  }

  // Roster keep-alive: roster QTs no longer on the latest search page still
  // need kernel points. One batched read, capped, roster-priority.
  const staleRoster = await prisma.liveQuote.findMany({
    where: { trackerId: tracker.id, isRoster: true, tweetId: { notIn: [...seenIds] } },
    orderBy: { views: "desc" },
    take: ROSTER_KEEPALIVE_LIMIT,
    select: { tweetId: true },
  });
  if (staleRoster.length > 0) {
    const t2 = Date.now();
    try {
      const res = await provider.getTweetsByIds(staleRoster.map((q) => q.tweetId));
      await recordCost(res.cost, { accountId, purpose: "live_quotes", durationMs: Date.now() - t2 });
      for (const raw of res.data) {
        if (!raw.tweetId) continue;
        snapshotRows.push({
          trackerId: tracker.id,
          tweetId: raw.tweetId,
          capturedAt,
          views: raw.viewCount,
          engagements: engagementsOf(raw),
        });
        await prisma.liveQuote.updateMany({
          where: { trackerId: tracker.id, tweetId: raw.tweetId },
          data: { ...rawToUpdate(raw), capturedAt },
        });
      }
    } catch (err) {
      await recordError("tweets_by_ids", err, { accountId, purpose: "live_quotes", durationMs: Date.now() - t2 });
    }
  }

  // Kernel points — best-effort so a lagging migration can't block discovery.
  if (snapshotRows.length > 0) {
    try {
      await prisma.liveQuoteSnapshot.createMany({ data: snapshotRows, skipDuplicates: true });
    } catch {
      /* LiveQuoteSnapshot table may predate `prisma db push` */
    }
  }

  await prisma.liveTracker.update({
    where: { id: tracker.id },
    data: { lastQuoteCheckAt: new Date() },
  });
}

/** Cron entry: tick every live tracker that is due (auto-stopping expired ones). */
export async function tickAllLive(): Promise<{ ticked: number; stopped: number }> {
  const live = await prisma.liveTracker.findMany({ where: { status: "live" }, select: { id: true } });
  let ticked = 0;
  let stopped = 0;
  for (const t of live) {
    const r = await tickTracker(t.id);
    if (r.fetched) ticked++;
    if (r.stopped) stopped++;
  }
  return { ticked, stopped };
}

// ---------------------------------------------------------------------------
// Payloads for the panel
// ---------------------------------------------------------------------------

const trackerInclude = {
  campaign: { select: { name: true } },
  post: {
    select: {
      id: true,
      url: true,
      text: true,
      postedAt: true,
      account: { select: { username: true, displayName: true, profilePicture: true } },
    },
  },
} as const;

type TrackerWithRels = LiveTracker & {
  campaign: { name: string } | null;
  post: {
    id: string;
    url: string | null;
    text: string;
    postedAt: Date;
    account: { username: string; displayName: string | null; profilePicture: string | null };
  };
};

function summarize(t: TrackerWithRels, latest: LiveSeriesPoint | null, quoteCount: number, rosterQuoteCount: number): LiveTrackerSummary {
  return {
    id: t.id,
    label: t.label,
    status: t.status,
    startedAt: t.startedAt.toISOString(),
    stoppedAt: t.stoppedAt ? t.stoppedAt.toISOString() : null,
    lastTickAt: t.lastTickAt ? t.lastTickAt.toISOString() : null,
    intervalSec: t.intervalSec,
    maxDurationMin: t.maxDurationMin,
    shareToken: t.shareToken,
    campaignId: t.campaignId,
    campaignName: t.campaign?.name ?? null,
    post: {
      id: t.post.id,
      url: t.post.url,
      text: t.post.text,
      postedAt: t.post.postedAt.toISOString(),
      author: {
        username: t.post.account.username,
        displayName: t.post.account.displayName,
        profilePicture: t.post.account.profilePicture,
      },
    },
    latest,
    quoteCount,
    rosterQuoteCount,
  };
}

function toPoint(s: {
  capturedAt: Date;
  viewCount: number;
  engagements: number;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  bookmarkCount: number;
}): LiveSeriesPoint {
  return {
    t: s.capturedAt.toISOString(),
    views: s.viewCount,
    engagements: s.engagements,
    likes: s.likeCount,
    retweets: s.retweetCount,
    replies: s.replyCount,
    quotes: s.quoteCount,
    bookmarks: s.bookmarkCount,
  };
}

export async function listTrackers(): Promise<LiveTrackerSummary[]> {
  const trackers = await prisma.liveTracker.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: trackerInclude,
  });
  const out: LiveTrackerSummary[] = [];
  for (const t of trackers as TrackerWithRels[]) {
    const [latestSnap, quoteCount, rosterQuoteCount] = await Promise.all([
      prisma.postSnapshot.findFirst({
        where: { postId: t.postId },
        orderBy: { capturedAt: "desc" },
      }),
      prisma.liveQuote.count({ where: { trackerId: t.id } }),
      prisma.liveQuote.count({ where: { trackerId: t.id, isRoster: true } }),
    ]);
    out.push(summarize(t, latestSnap ? toPoint(latestSnap) : null, quoteCount, rosterQuoteCount));
  }
  return out;
}

export async function getTrackerPayload(id: string): Promise<LivePayload | null> {
  const t = (await prisma.liveTracker.findUnique({
    where: { id },
    include: trackerInclude,
  })) as TrackerWithRels | null;
  if (!t) return null;

  const [snaps, quotes] = await Promise.all([
    prisma.postSnapshot.findMany({
      where: { postId: t.postId, capturedAt: { gte: new Date(t.startedAt.getTime() - 5 * 60_000) } },
      orderBy: { capturedAt: "asc" },
      take: 2000,
    }),
    prisma.liveQuote.findMany({
      where: { trackerId: id },
      orderBy: { postedAt: "desc" },
      take: 300,
    }),
  ]);

  const series = snaps.map(toPoint);
  const latest = series.length ? series[series.length - 1] : null;

  const quoteViews: LiveQuoteView[] = quotes.map((q) => ({
    tweetId: q.tweetId,
    url: q.url ?? `https://x.com/${q.authorUsername}/status/${q.tweetId}`,
    authorUsername: q.authorUsername,
    authorName: q.authorName,
    authorFollowers: q.authorFollowers,
    text: q.text,
    postedAt: q.postedAt.toISOString(),
    views: q.views,
    engagements: q.engagements,
    isRoster: q.isRoster,
  }));

  const rosterQuotes = quoteViews.filter((q) => q.isRoster);
  return {
    tracker: summarize(t, latest, quoteViews.length, rosterQuotes.length),
    series,
    quotes: quoteViews,
    quoteTotals: {
      count: quoteViews.length,
      totalViews: quoteViews.reduce((s, q) => s + q.views, 0),
      totalEngagements: quoteViews.reduce((s, q) => s + q.engagements, 0),
      rosterCount: rosterQuotes.length,
      rosterViews: rosterQuotes.reduce((s, q) => s + q.views, 0),
    },
  };
}
