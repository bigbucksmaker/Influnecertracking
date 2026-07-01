import { prisma } from "./db";
import { engagementsOf } from "./engagement";
import type { RawPostMetrics, RawUserProfile } from "./provider/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface IngestContext {
  capturedAt: Date;
  source: string; // poll | backfill | manual | refresh
  apiCallId?: string | null;
}

/** Persist a profile snapshot and refresh the account's cached profile fields. */
export async function ingestProfile(
  accountId: string,
  profile: RawUserProfile,
  ctx: IngestContext,
): Promise<void> {
  await prisma.account.update({
    where: { id: accountId },
    data: {
      xUserId: profile.xUserId || undefined,
      displayName: profile.name ?? undefined,
      profilePicture: profile.profilePicture ?? undefined,
      description: profile.description ?? undefined,
      isBlueVerified: profile.isBlueVerified,
      verifiedType: profile.verifiedType ?? undefined,
      xCreatedAt: profile.createdAt ?? undefined,
    },
  });

  await prisma.accountSnapshot.upsert({
    where: { accountId_capturedAt: { accountId, capturedAt: ctx.capturedAt } },
    update: {},
    create: {
      accountId,
      capturedAt: ctx.capturedAt,
      followers: profile.followers,
      following: profile.following,
      statusesCount: profile.statusesCount,
      mediaCount: profile.mediaCount,
      favouritesCount: profile.favouritesCount,
      source: ctx.source,
      apiCallId: ctx.apiCallId ?? null,
    },
  });
}

export interface IngestPostsResult {
  postsSeen: number;
  snapshotsCreated: number;
  frozen: number;
  maxPostedAt: Date | null;
}

/**
 * Persist post snapshots. Posts older than `freezeAgeDays` get this one final
 * snapshot and are then frozen (skipped on future polls to stop re-paying credits).
 */
export async function ingestPosts(
  accountId: string,
  posts: RawPostMetrics[],
  ctx: IngestContext,
  opts: {
    freezeAgeDays: number;
    includeReplies: boolean;
    // Commissioned posts (in an active campaign) get an extended freeze window so
    // they keep updating past the normal freezeAgeDays. Any id in `commissionedIds`
    // uses `commissionedFreezeDays` instead of `freezeAgeDays`.
    commissionedFreezeDays?: number;
    commissionedIds?: Set<string>;
  },
): Promise<IngestPostsResult> {
  const freezeBefore = new Date(ctx.capturedAt.getTime() - opts.freezeAgeDays * DAY_MS);
  const commissionedFreezeBefore =
    opts.commissionedFreezeDays != null
      ? new Date(ctx.capturedAt.getTime() - opts.commissionedFreezeDays * DAY_MS)
      : freezeBefore;
  let snapshotsCreated = 0;
  let frozen = 0;
  let maxPostedAt: Date | null = null;
  let postsSeen = 0;

  for (const p of posts) {
    if (!p.tweetId) continue;
    // Never store retweets — their metrics belong to the original author, and a
    // self-retweet would double-count the influencer's own post.
    if (p.isRetweet) continue;
    if (p.isReply && !opts.includeReplies) continue;
    postsSeen++;
    if (!maxPostedAt || p.postedAt > maxPostedAt) maxPostedAt = p.postedAt;

    const cutoff = opts.commissionedIds?.has(p.tweetId) ? commissionedFreezeBefore : freezeBefore;
    const shouldFreeze = p.postedAt.getTime() < cutoff.getTime();
    const engagements = engagementsOf(p);

    await prisma.post.upsert({
      where: { id: p.tweetId },
      update: {
        text: p.text,
        lang: p.lang,
        url: p.url,
        lastMetricsAt: ctx.capturedAt,
        ...(shouldFreeze ? { isFrozen: true, frozenAt: ctx.capturedAt } : {}),
      },
      create: {
        id: p.tweetId,
        accountId,
        text: p.text,
        postedAt: p.postedAt,
        lang: p.lang,
        isReply: p.isReply,
        url: p.url,
        firstSeenAt: ctx.capturedAt,
        lastMetricsAt: ctx.capturedAt,
        isFrozen: shouldFreeze,
        frozenAt: shouldFreeze ? ctx.capturedAt : null,
      },
    });
    if (shouldFreeze) frozen++;

    const created = await prisma.postSnapshot.upsert({
      where: { postId_capturedAt: { postId: p.tweetId, capturedAt: ctx.capturedAt } },
      update: {},
      create: {
        postId: p.tweetId,
        accountId,
        capturedAt: ctx.capturedAt,
        viewCount: p.viewCount,
        likeCount: p.likeCount,
        retweetCount: p.retweetCount,
        replyCount: p.replyCount,
        quoteCount: p.quoteCount,
        bookmarkCount: p.bookmarkCount,
        engagements,
        source: ctx.source,
        apiCallId: ctx.apiCallId ?? null,
      },
    });
    if (created) snapshotsCreated++;
  }

  return { postsSeen, snapshotsCreated, frozen, maxPostedAt };
}
