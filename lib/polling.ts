import { prisma } from "./db";
import { getProvider } from "./provider";
import type { Account, AppSettings } from "@prisma/client";
import type { ApiEndpoint, CostInfo, RawPostMetrics } from "./provider/types";
import { recordCost, recordError, type CallContext } from "./logging";
import { ingestPosts, ingestProfile } from "./ingest";
import { getSettings } from "./settings";
import { toUnixSeconds } from "./twitter-time";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Tiering & scheduling
// ---------------------------------------------------------------------------
export function determineTier(lastPostedAt: Date | null, activeWindowHours: number): string {
  if (!lastPostedAt) return "dormant";
  return Date.now() - lastPostedAt.getTime() <= activeWindowHours * HOUR_MS
    ? "active"
    : "dormant";
}

export function isDue(account: Account, settings: AppSettings, now: number = Date.now()): boolean {
  if (account.status !== "active") return false;
  if (!account.backfilledAt) return true; // never backfilled → do it now
  if (!account.lastPolledAt) return true;
  const tier = determineTier(account.lastPostedAt, settings.activeWindowHours);
  const intervalH = tier === "active" ? settings.activePollHours : settings.dormantPollHours;
  return now - account.lastPolledAt.getTime() >= intervalH * HOUR_MS;
}

// ---------------------------------------------------------------------------
// Tracked provider calls (records cost / errors, returns the log id)
// ---------------------------------------------------------------------------
type AnyResult<T> = { data: T; cost: CostInfo; hasNextPage?: boolean; nextCursor?: string | null };

async function callTracked<T>(
  endpoint: ApiEndpoint,
  ctx: CallContext,
  fn: () => Promise<AnyResult<T>>,
): Promise<{ res: AnyResult<T>; apiCallId: string }> {
  const start = Date.now();
  try {
    const res = await fn();
    const apiCallId = await recordCost(res.cost, { ...ctx, durationMs: Date.now() - start });
    return { res, apiCallId };
  } catch (err) {
    await recordError(endpoint, err, { ...ctx, durationMs: Date.now() - start });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Per-account results
// ---------------------------------------------------------------------------
export interface AccountRunResult {
  accountId: string;
  username: string;
  ok: boolean;
  mode: "poll" | "backfill";
  posts: number;
  snapshots: number;
  credits: number;
  error?: string;
}

/** Pull the last N days of posts for a freshly-added account and store initial snapshots. */
export async function backfillAccount(
  accountId: string,
  settingsArg?: AppSettings,
): Promise<AccountRunResult> {
  const settings = settingsArg ?? (await getSettings());
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return blankResult(accountId, "?", "backfill", "account not found");

  const username = account.username;
  const capturedAt = new Date();
  const ctx: CallContext = { accountId, purpose: "backfill" };
  let credits = 0;
  let posts = 0;
  let snapshots = 0;
  let maxPostedAt: Date | null = account.lastPostedAt;

  try {
    const provider = getProvider();
    // 1) profile snapshot
    const { res: prof, apiCallId: profId } = await callTracked("user_info", ctx, () =>
      provider.getUserByUsername(username),
    );
    credits += prof.cost.creditsCharged;
    await ingestProfile(accountId, prof.data, { capturedAt, source: "backfill", apiCallId: profId });
    const userId = prof.data.xUserId || undefined;

    // 2) date-bounded post history via advanced search
    const since = toUnixSeconds(new Date(capturedAt.getTime() - settings.backfillDays * DAY_MS));
    const until = toUnixSeconds(capturedAt);
    const query = `from:${username} since_time:${since} until_time:${until}`;

    let cursor: string | undefined = "";
    const maxPages = 25;
    for (let page = 0; page < maxPages; page++) {
      const { res, apiCallId } = await callTracked("advanced_search", ctx, () =>
        provider.searchTweets({ query, queryType: "Latest", cursor }),
      );
      credits += res.cost.creditsCharged;
      const r = await ingestPosts(
        accountId,
        res.data,
        { capturedAt, source: "backfill", apiCallId },
        { freezeAgeDays: settings.freezeAgeDays, includeReplies: settings.includeReplies },
      );
      posts += r.postsSeen;
      snapshots += r.snapshotsCreated;
      if (r.maxPostedAt && (!maxPostedAt || r.maxPostedAt > maxPostedAt)) maxPostedAt = r.maxPostedAt;
      if (!res.hasNextPage || !res.nextCursor) break;
      cursor = res.nextCursor;
    }

    await prisma.account.update({
      where: { id: accountId },
      data: {
        backfilledAt: capturedAt,
        lastPolledAt: capturedAt,
        lastPostedAt: maxPostedAt ?? undefined,
        pollingTier: determineTier(maxPostedAt, settings.activeWindowHours),
        xUserId: userId,
      },
    });

    return { accountId, username, ok: true, mode: "backfill", posts, snapshots, credits };
  } catch (err) {
    return {
      accountId,
      username,
      ok: false,
      mode: "backfill",
      posts,
      snapshots,
      credits,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Regular poll: refresh profile + metrics for all not-yet-frozen in-window posts. */
export async function pollAccount(
  accountId: string,
  opts: { capturedAt?: Date; settings?: AppSettings } = {},
): Promise<AccountRunResult> {
  const settings = opts.settings ?? (await getSettings());
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return blankResult(accountId, "?", "poll", "account not found");

  // Not backfilled yet → do that instead (covers this poll too).
  if (!account.backfilledAt) return backfillAccount(accountId, settings);

  const username = account.username;
  const capturedAt = opts.capturedAt ?? new Date();
  const freezeBefore = new Date(capturedAt.getTime() - settings.freezeAgeDays * DAY_MS);
  const ctx: CallContext = { accountId, purpose: "poll" };

  let credits = 0;
  let posts = 0;
  let snapshots = 0;
  let maxPostedAt: Date | null = account.lastPostedAt;
  const ingestedIds = new Set<string>();

  try {
    const provider = getProvider();
    // 1) profile
    const { res: prof, apiCallId: profId } = await callTracked("user_info", ctx, () =>
      provider.getUserByUsername(username),
    );
    credits += prof.cost.creditsCharged;
    await ingestProfile(accountId, prof.data, { capturedAt, source: "poll", apiCallId: profId });
    const userId = account.xUserId || prof.data.xUserId || undefined;

    // 2) recent posts (paginate only as far back as the freeze window)
    let cursor: string | undefined = "";
    const maxPages = 3;
    for (let page = 0; page < maxPages; page++) {
      const { res, apiCallId } = await callTracked("user_last_tweets", ctx, () =>
        provider.getUserLatestTweets({
          username,
          userId,
          cursor,
          includeReplies: settings.includeReplies,
        }),
      );
      credits += res.cost.creditsCharged;
      const r = await ingestPosts(
        accountId,
        res.data,
        { capturedAt, source: "poll", apiCallId },
        { freezeAgeDays: settings.freezeAgeDays, includeReplies: settings.includeReplies },
      );
      posts += r.postsSeen;
      snapshots += r.snapshotsCreated;
      for (const p of res.data) ingestedIds.add(p.tweetId);
      if (r.maxPostedAt && (!maxPostedAt || r.maxPostedAt > maxPostedAt)) maxPostedAt = r.maxPostedAt;

      const oldest = res.data.length ? res.data[res.data.length - 1].postedAt : null;
      if (!res.hasNextPage || !res.nextCursor) break;
      if (oldest && oldest.getTime() < freezeBefore.getTime()) break;
      cursor = res.nextCursor;
    }

    // 3) refresh in-window posts that fell off the latest page (cheap batch read)
    const stale = await prisma.post.findMany({
      where: {
        accountId,
        isFrozen: false,
        postedAt: { gte: freezeBefore },
        id: { notIn: [...ingestedIds] },
      },
      select: { id: true },
    });
    if (stale.length > 0) {
      const { res, apiCallId } = await callTracked("tweets_by_ids", { ...ctx, purpose: "refresh" }, () =>
        provider.getTweetsByIds(stale.map((s) => s.id)),
      );
      credits += res.cost.creditsCharged;
      const r = await ingestPosts(
        accountId,
        res.data as RawPostMetrics[],
        { capturedAt, source: "refresh", apiCallId },
        { freezeAgeDays: settings.freezeAgeDays, includeReplies: settings.includeReplies },
      );
      posts += r.postsSeen;
      snapshots += r.snapshotsCreated;
    }

    await prisma.account.update({
      where: { id: accountId },
      data: {
        lastPolledAt: capturedAt,
        lastPostedAt: maxPostedAt ?? undefined,
        pollingTier: determineTier(maxPostedAt, settings.activeWindowHours),
      },
    });

    return { accountId, username, ok: true, mode: "poll", posts, snapshots, credits };
  } catch (err) {
    return {
      accountId,
      username,
      ok: false,
      mode: "poll",
      posts,
      snapshots,
      credits,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Batch poll (used by cron + manual "run poll now")
// ---------------------------------------------------------------------------
export interface PollRunSummary {
  startedAt: string;
  accountsConsidered: number;
  accountsRun: number;
  ok: number;
  failed: number;
  posts: number;
  snapshots: number;
  credits: number;
  dueBefore: number; // accounts due at the start of this run
  remaining: number; // due accounts NOT processed this run (when limited)
  results: AccountRunResult[];
}

export async function pollAllDue(
  opts: { force?: boolean; concurrency?: number; limit?: number } = {},
): Promise<PollRunSummary> {
  const settings = await getSettings();
  const capturedAt = new Date();
  const now = capturedAt.getTime();
  const accounts = await prisma.account.findMany({ where: { status: "active" } });

  const allDue = opts.force ? accounts : accounts.filter((a) => isDue(a, settings, now));
  // Process at most `limit` accounts this run so the client can drain the queue
  // in small, timeout-safe batches and show progress. Draining works because
  // each polled account gets lastPolledAt set → it's no longer "due" next batch.
  const batch = opts.limit && opts.limit > 0 ? allDue.slice(0, opts.limit) : allDue;
  const concurrency = opts.concurrency ?? 5;

  const results = await pool(batch, concurrency, (account) =>
    pollAccount(account.id, { capturedAt, settings }),
  );

  const summary: PollRunSummary = {
    startedAt: capturedAt.toISOString(),
    accountsConsidered: accounts.length,
    accountsRun: results.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    posts: results.reduce((s, r) => s + r.posts, 0),
    snapshots: results.reduce((s, r) => s + r.snapshots, 0),
    credits: results.reduce((s, r) => s + r.credits, 0),
    dueBefore: allDue.length,
    remaining: allDue.length - batch.length,
    results,
  };
  return summary;
}

/**
 * Server-side background poll: drains all due accounts in one server process
 * (survives client refresh), with a DB-backed heartbeat + progress that every
 * user/tab reads consistently. A lock (pollRunningAt) prevents overlapping runs.
 */
export async function runBackgroundPoll(
  opts: { force?: boolean } = {},
): Promise<{ started: boolean; reason?: string; total?: number }> {
  const settings = await getSettings();
  const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
  if (settings.pollRunningAt && Date.now() - settings.pollRunningAt.getTime() < HEARTBEAT_STALE_MS) {
    return { started: false, reason: "already-running" };
  }

  const now = Date.now();
  const accounts = await prisma.account.findMany({ where: { status: "active" } });
  const due = opts.force ? accounts : accounts.filter((a) => isDue(a, settings, now));
  const capturedAt = new Date();

  await prisma.appSettings.update({
    where: { id: "singleton" },
    data: { pollRunningAt: capturedAt, pollDone: 0, pollTotal: due.length, pollFinishedAt: null },
  });

  let done = 0;
  try {
    await pool(due, 6, async (a) => {
      await pollAccount(a.id, { capturedAt, settings });
      done++;
      // heartbeat + progress every few accounts
      if (done % 5 === 0) {
        await prisma.appSettings
          .update({ where: { id: "singleton" }, data: { pollDone: done, pollRunningAt: new Date() } })
          .catch(() => {});
      }
    });
  } finally {
    await prisma.appSettings
      .update({
        where: { id: "singleton" },
        data: { pollDone: done, pollFinishedAt: new Date(), pollRunningAt: null },
      })
      .catch(() => {});
  }
  return { started: true, total: due.length };
}

/** Backfill every account still missing history (safety net / manual). */
export async function backfillPending(concurrency = 3): Promise<PollRunSummary> {
  const settings = await getSettings();
  const accounts = await prisma.account.findMany({
    where: { status: "active", backfilledAt: null },
  });
  const capturedAt = new Date();
  const results = await pool(accounts, concurrency, (a) => backfillAccount(a.id, settings));
  return {
    startedAt: capturedAt.toISOString(),
    accountsConsidered: accounts.length,
    accountsRun: results.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    posts: results.reduce((s, r) => s + r.posts, 0),
    snapshots: results.reduce((s, r) => s + r.snapshots, 0),
    credits: results.reduce((s, r) => s + r.credits, 0),
    dueBefore: accounts.length,
    remaining: 0,
    results,
  };
}

// ---------------------------------------------------------------------------
function blankResult(
  accountId: string,
  username: string,
  mode: "poll" | "backfill",
  error: string,
): AccountRunResult {
  return { accountId, username, ok: false, mode, posts: 0, snapshots: 0, credits: 0, error };
}

async function pool<T, R>(
  items: T[],
  size: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, size), Math.max(1, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}
