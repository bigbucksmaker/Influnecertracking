import { computeCredits } from "@/lib/cost";
import { parseTwitterDate } from "@/lib/twitter-time";
import {
  type AccountBalance,
  type ApiEndpoint,
  type DataProvider,
  type LatestTweetsParams,
  type PageResult,
  type ProviderResult,
  type RawPostMetrics,
  type RawUserProfile,
  type SearchParams,
  ProviderError,
} from "./types";

const BASE_URL = "https://api.twitterapi.io";

// twitterapi.io throttles by QPS per key. Free tier = 1 request / 5s; paid tiers
// allow ~200 req/s. We serialize + space requests client-side to avoid 429s.
// Set TWITTERAPI_QPS_MS=0 (or a small value like 50) once you're on a paid plan.
const MIN_INTERVAL_MS = Number(process.env.TWITTERAPI_QPS_MS ?? 5200);
let requestChain: Promise<number> = Promise.resolve(0);

function throttle(): Promise<void> {
  if (!(MIN_INTERVAL_MS > 0)) return Promise.resolve();
  const next = requestChain.then(async (lastAt) => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastAt);
    if (wait > 0) await sleep(wait);
    return Date.now();
  });
  requestChain = next;
  return next.then(() => undefined);
}

function toInt(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : 0;
  if (typeof v === "string") {
    const n = parseInt(v.replace(/[,_]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function mapUser(d: any): RawUserProfile {
  return {
    xUserId: String(d.id ?? ""),
    username: String(d.userName ?? d.screen_name ?? "").toLowerCase(),
    name: d.name ?? null,
    followers: toInt(d.followers),
    following: toInt(d.following),
    statusesCount: toInt(d.statusesCount),
    mediaCount: toInt(d.mediaCount),
    favouritesCount: toInt(d.favouritesCount),
    isBlueVerified: Boolean(d.isBlueVerified),
    verifiedType: d.verifiedType ?? null,
    profilePicture: d.profilePicture ?? null,
    description: d.description ?? null,
    location: d.location ?? null,
    createdAt: parseTwitterDate(d.createdAt),
  };
}

function mapTweet(t: any): RawPostMetrics {
  const author = t.author ?? {};
  return {
    tweetId: String(t.id ?? ""),
    authorUserId: author.id != null ? String(author.id) : null,
    authorUsername: author.userName ? String(author.userName).toLowerCase() : null,
    text: t.text ?? "",
    postedAt: parseTwitterDate(t.createdAt) ?? new Date(),
    lang: t.lang ?? null,
    isReply: Boolean(t.isReply),
    // A retweet carries the ORIGINAL author's metrics, not the retweeter's —
    // detect via the retweeted_tweet object (fallback to the "RT @" text prefix).
    isRetweet: Boolean(t.retweeted_tweet) || /^RT @[A-Za-z0-9_]+:/.test(t.text ?? ""),
    url: t.url ?? null,
    viewCount: toInt(t.viewCount),
    likeCount: toInt(t.likeCount),
    retweetCount: toInt(t.retweetCount),
    replyCount: toInt(t.replyCount),
    quoteCount: toInt(t.quoteCount),
    bookmarkCount: toInt(t.bookmarkCount),
  };
}

// Envelope helpers (see skill: response shape varies per endpoint).
function pickTweets(json: any): any[] {
  const arr = json?.tweets ?? json?.data?.tweets ?? json?.data ?? [];
  return Array.isArray(arr) ? arr : [];
}
function pickHasNext(json: any): boolean {
  return Boolean(json?.has_next_page ?? json?.data?.has_next_page ?? false);
}
function pickCursor(json: any): string | null {
  return json?.next_cursor ?? json?.data?.next_cursor ?? null;
}

export class TwitterApiIoProvider implements DataProvider {
  readonly name = "twitterapi.io";
  private apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.TWITTERAPI_IO_KEY ?? "";
    if (!key) {
      throw new Error(
        "TWITTERAPI_IO_KEY is not set. Add it to .env.local or set DATA_PROVIDER=mock.",
      );
    }
    this.apiKey = key;
  }

  private async request(
    endpoint: ApiEndpoint,
    path: string,
    params: Record<string, string | number | boolean | undefined>,
  ): Promise<any> {
    const url = new URL(BASE_URL + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const maxAttempts = 4;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await throttle();
        const res = await fetch(url.toString(), {
          method: "GET",
          headers: { "x-api-key": this.apiKey, accept: "application/json" },
          // Never cache — every read is a fresh, billed snapshot.
          cache: "no-store",
        });

        if (res.status === 429 || res.status >= 500) {
          // transient (usually QPS) — wait at least one throttle window and retry
          lastErr = new ProviderError(
            `Upstream ${res.status} on ${path}`,
            res.status,
            endpoint,
          );
          if (attempt < maxAttempts) {
            await sleep(Math.max(MIN_INTERVAL_MS, 800 * attempt * attempt));
            continue;
          }
          throw lastErr;
        }

        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
          const detail =
            typeof json?.detail === "string"
              ? json.detail
              : json?.msg || json?.message || `HTTP ${res.status}`;
          throw new ProviderError(detail, res.status, endpoint);
        }
        // Some endpoints return HTTP 200 with a semantic error envelope.
        if (json?.status === "error") {
          throw new ProviderError(json?.msg || "Provider returned error", 200, endpoint);
        }
        return json;
      } catch (err) {
        lastErr = err;
        if (err instanceof ProviderError && err.status !== 429 && err.status < 500) throw err;
        if (attempt >= maxAttempts) throw err;
        await sleep(Math.max(MIN_INTERVAL_MS, 800 * attempt * attempt));
      }
    }
    throw lastErr instanceof Error ? lastErr : new ProviderError("Unknown error", 0, endpoint);
  }

  async getUserByUsername(username: string): Promise<ProviderResult<RawUserProfile>> {
    const json = await this.request("user_info", "/twitter/user/info", {
      userName: cleanHandle(username),
    });
    const d = json?.data;
    if (!d || !d.id) {
      throw new ProviderError(
        json?.msg || `User @${username} not found`,
        404,
        "user_info",
      );
    }
    return {
      data: mapUser(d),
      cost: { endpoint: "user_info", itemsReturned: 1, creditsCharged: computeCredits("user_info", 1) },
    };
  }

  async getUserLatestTweets(params: LatestTweetsParams): Promise<PageResult<RawPostMetrics>> {
    const json = await this.request("user_last_tweets", "/twitter/user/last_tweets", {
      userName: params.username ? cleanHandle(params.username) : undefined,
      userId: params.userId,
      cursor: params.cursor ?? "",
      includeReplies: params.includeReplies ?? false,
    });
    const tweets = pickTweets(json).map(mapTweet);
    return {
      data: tweets,
      cost: {
        endpoint: "user_last_tweets",
        itemsReturned: tweets.length,
        creditsCharged: computeCredits("user_last_tweets", tweets.length),
      },
      hasNextPage: pickHasNext(json),
      nextCursor: pickCursor(json),
    };
  }

  async searchTweets(params: SearchParams): Promise<PageResult<RawPostMetrics>> {
    const json = await this.request("advanced_search", "/twitter/tweet/advanced_search", {
      query: params.query,
      queryType: params.queryType ?? "Latest",
      cursor: params.cursor ?? "",
    });
    const tweets = pickTweets(json).map(mapTweet);
    return {
      data: tweets,
      cost: {
        endpoint: "advanced_search",
        itemsReturned: tweets.length,
        creditsCharged: computeCredits("advanced_search", tweets.length),
      },
      hasNextPage: pickHasNext(json),
      nextCursor: pickCursor(json),
    };
  }

  async getTweetsByIds(tweetIds: string[]): Promise<ProviderResult<RawPostMetrics[]>> {
    const ids = [...new Set(tweetIds.filter(Boolean))];
    if (ids.length === 0) {
      return {
        data: [],
        cost: { endpoint: "tweets_by_ids", itemsReturned: 0, creditsCharged: 0 },
      };
    }
    // Chunk to stay well within URL / backend limits.
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));

    const all: RawPostMetrics[] = [];
    let credits = 0;
    for (const chunk of chunks) {
      const json = await this.request("tweets_by_ids", "/twitter/tweets", {
        tweet_ids: chunk.join(","),
      });
      const tweets = pickTweets(json).map(mapTweet);
      all.push(...tweets);
      credits += computeCredits("tweets_by_ids", tweets.length);
    }
    return {
      data: all,
      cost: { endpoint: "tweets_by_ids", itemsReturned: all.length, creditsCharged: credits },
    };
  }

  async getBalance(): Promise<ProviderResult<AccountBalance>> {
    const json = await this.request("balance", "/oapi/my/info", {});
    return {
      data: {
        rechargeCredits: toInt(json?.recharge_credits),
        bonusCredits: toInt(json?.total_bonus_credits),
      },
      cost: { endpoint: "balance", itemsReturned: 0, creditsCharged: 0 },
    };
  }
}

function cleanHandle(h: string): string {
  return h.trim().replace(/^@/, "").toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
