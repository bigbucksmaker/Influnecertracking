import { computeCredits } from "@/lib/cost";
import {
  type AccountBalance,
  type DataProvider,
  type LatestTweetsParams,
  type PageResult,
  type ProviderResult,
  type RawPostMetrics,
  type RawUserProfile,
  type SearchParams,
  ProviderError,
} from "./types";

// ---------------------------------------------------------------------------
// Deterministic mock provider — lets the whole app run with DATA_PROVIDER=mock
// and no API key. Data is derived from the username so it's stable across polls,
// with view counts that grow as posts age (so charts show real movement).
// ---------------------------------------------------------------------------

function hash(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clean(h: string): string {
  return h.trim().replace(/^@/, "").toLowerCase();
}

function popularity(username: string): number {
  return 0.15 + (hash("pop:" + username) % 1000) / 1000 / 1.18; // ~0.15..1.0
}

function baseFollowers(username: string): number {
  const pop = popularity(username);
  return Math.round(1000 * Math.pow(10, pop * 3)); // ~1k .. ~1M
}

function followersAt(username: string, now: number): number {
  const base = baseFollowers(username);
  const pop = popularity(username);
  const dailyGrowth = 0.001 + pop * 0.01;
  const windowStartH = (now - 60 * 24 * 3600 * 1000) / 3600000;
  const hoursSince = now / 3600000 - windowStartH;
  return base + Math.round((base * dailyGrowth * hoursSince) / 24);
}

function metricsFor(username: string, unixHour: number, now: number) {
  const postedAtMs = unixHour * 3600 * 1000;
  const ageH = Math.max(0, (now - postedAtMs) / 3600000);
  const r = mulberry32(hash(`${username}:${unixHour}`));
  const pop = popularity(username);
  const perTweet = 0.3 + r() * 1.4;
  const maxViews = Math.max(50, followersAt(username, now) * pop * perTweet * 0.8);
  const views = Math.round(maxViews * (1 - Math.exp(-ageH / 40))) + Math.round(20 + r() * 40);
  const er = 0.008 + r() * 0.05;
  const eng = views * er;
  return {
    postedAt: new Date(postedAtMs),
    viewCount: views,
    likeCount: Math.round(eng * 0.7),
    retweetCount: Math.round(eng * 0.08),
    replyCount: Math.round(eng * 0.1),
    quoteCount: Math.round(eng * 0.05),
    bookmarkCount: Math.round(eng * 0.07),
  };
}

/** Post schedule for a user: evenly spaced whole-hour anchors going back in time. */
function scheduleHours(username: string, count: number, now: number): number[] {
  const pop = popularity(username);
  const intervalH = Math.round(6 + (1 - pop) * 30); // popular users post more often
  const nowHour = Math.floor(now / 3600000);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(nowHour - i * intervalH);
  return out;
}

function buildTweet(username: string, unixHour: number, now: number): RawPostMetrics {
  const m = metricsFor(username, unixHour, now);
  const id = `mock-${username}-${unixHour}`;
  return {
    tweetId: id,
    authorUserId: String(hash("id:" + username)),
    authorUsername: username,
    text: `Sample post from @${username} — insight #${unixHour % 1000} on growth, marketing, and building in public.`,
    postedAt: m.postedAt,
    lang: "en",
    isReply: false,
    url: `https://x.com/${username}/status/${unixHour}`,
    viewCount: m.viewCount,
    likeCount: m.likeCount,
    retweetCount: m.retweetCount,
    replyCount: m.replyCount,
    quoteCount: m.quoteCount,
    bookmarkCount: m.bookmarkCount,
  };
}

export class MockProvider implements DataProvider {
  readonly name = "mock";

  async getUserByUsername(username: string): Promise<ProviderResult<RawUserProfile>> {
    const u = clean(username);
    if (!u) throw new ProviderError("empty username", 400, "user_info");
    const now = Date.now();
    const pop = popularity(u);
    return {
      data: {
        xUserId: String(hash("id:" + u)),
        username: u,
        name: u.charAt(0).toUpperCase() + u.slice(1),
        followers: followersAt(u, now),
        following: Math.round(200 + pop * 3000),
        statusesCount: Math.round(500 + pop * 40000),
        mediaCount: Math.round(100 + pop * 5000),
        favouritesCount: Math.round(1000 + pop * 30000),
        isBlueVerified: pop > 0.5,
        verifiedType: pop > 0.8 ? "Business" : null,
        profilePicture: null,
        description: `Mock profile for @${u}. (DATA_PROVIDER=mock)`,
        location: "Internet",
        createdAt: new Date("2019-01-01T00:00:00Z"),
      },
      cost: { endpoint: "user_info", itemsReturned: 1, creditsCharged: computeCredits("user_info", 1) },
    };
  }

  async getUserLatestTweets(params: LatestTweetsParams): Promise<PageResult<RawPostMetrics>> {
    const u = clean(params.username ?? "");
    const now = Date.now();
    const hours = scheduleHours(u, 20, now);
    const tweets = hours.map((h) => buildTweet(u, h, now));
    return {
      data: tweets,
      cost: {
        endpoint: "user_last_tweets",
        itemsReturned: tweets.length,
        creditsCharged: computeCredits("user_last_tweets", tweets.length),
      },
      hasNextPage: false,
      nextCursor: null,
    };
  }

  async searchTweets(params: SearchParams): Promise<PageResult<RawPostMetrics>> {
    const fromMatch = /from:(\w+)/i.exec(params.query);
    const u = clean(fromMatch?.[1] ?? "");
    const now = Date.now();
    const sinceMatch = /since_time:(\d+)/.exec(params.query);
    const untilMatch = /until_time:(\d+)/.exec(params.query);
    const sinceMs = sinceMatch ? Number(sinceMatch[1]) * 1000 : 0;
    const untilMs = untilMatch ? Number(untilMatch[1]) * 1000 : now;
    // generate a wide schedule then filter to the requested window
    const hours = scheduleHours(u, 60, now);
    const tweets = hours
      .map((h) => buildTweet(u, h, now))
      .filter((t) => t.postedAt.getTime() >= sinceMs && t.postedAt.getTime() <= untilMs);
    return {
      data: tweets,
      cost: {
        endpoint: "advanced_search",
        itemsReturned: tweets.length,
        creditsCharged: computeCredits("advanced_search", tweets.length),
      },
      hasNextPage: false,
      nextCursor: null,
    };
  }

  async getTweetsByIds(tweetIds: string[]): Promise<ProviderResult<RawPostMetrics[]>> {
    const ids = [...new Set(tweetIds.filter(Boolean))];
    const now = Date.now();
    const data = ids
      .map((id) => {
        const m = /^mock-(.+)-(\d+)$/.exec(id);
        if (!m) return null;
        return buildTweet(m[1], Number(m[2]), now);
      })
      .filter((t): t is RawPostMetrics => t !== null);
    return {
      data,
      cost: {
        endpoint: "tweets_by_ids",
        itemsReturned: data.length,
        creditsCharged: computeCredits("tweets_by_ids", data.length),
      },
    };
  }

  async getBalance(): Promise<ProviderResult<AccountBalance>> {
    return {
      data: { rechargeCredits: 5_000_000, bonusCredits: 0 },
      cost: { endpoint: "balance", itemsReturned: 0, creditsCharged: 0 },
    };
  }
}
