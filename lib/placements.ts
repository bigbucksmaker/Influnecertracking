import { prisma } from "./db";
import { getProvider } from "./provider";
import { recordCost, recordError } from "./logging";
import { ingestPosts } from "./ingest";
import { getSettings } from "./settings";
import { summarizeViews } from "./scoring";
import { parseTweetId } from "./handles";
import type { AppSettings, Placement } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Organic baseline — the creator's "normal" level, EXCLUDING commissioned posts.
// This is what a commissioned post's delivery is measured against. Price is
// never involved.
// ---------------------------------------------------------------------------
export interface Baseline {
  medianViews: number;
  medianEng: number;
  n: number;
}

export async function computeBaseline(accountId: string, windowDays = 30): Promise<Baseline> {
  const since = new Date(Date.now() - windowDays * DAY_MS);
  const posts = await prisma.post.findMany({
    where: { accountId, commissioned: false, isReply: false, postedAt: { gte: since } },
    select: {
      snapshots: { orderBy: { capturedAt: "desc" }, take: 1, select: { viewCount: true, engagements: true } },
    },
  });
  const views: number[] = [];
  const eng: number[] = [];
  for (const p of posts) {
    const s = p.snapshots[0];
    if (!s) continue;
    views.push(s.viewCount);
    eng.push(s.engagements);
  }
  return {
    medianViews: summarizeViews(views).median,
    medianEng: summarizeViews(eng).median,
    n: views.length,
  };
}

async function baselinesFor(accountIds: string[]): Promise<Map<string, Baseline>> {
  const unique = [...new Set(accountIds)];
  const map = new Map<string, Baseline>();
  await Promise.all(unique.map(async (id) => map.set(id, await computeBaseline(id))));
  return map;
}

// ---------------------------------------------------------------------------
// Delivery metrics (reach/engagement only)
// ---------------------------------------------------------------------------
export interface PlacementDetail {
  id: string;
  type: string;
  priceUsd: number | null; // reference only — not used in any calc
  note: string | null;
  createdAt: string;
  account: { id: string; username: string; displayName: string | null; profilePicture: string | null };
  post: {
    id: string;
    url: string | null;
    postedAt: string;
    views: number;
    engagements: number;
    isFrozen: boolean;
  } | null;
  baselineMedianViews: number;
  baselineMedianEng: number;
  baselineN: number;
  deliveryRatioViews: number | null;
  deliveryRatioEng: number | null;
  underdelivered: boolean;
}

type PlacementWithRels = Placement & {
  account: { id: string; username: string; displayName: string | null; profilePicture: string | null };
  post:
    | (null | {
        id: string;
        url: string | null;
        postedAt: Date;
        isFrozen: boolean;
        snapshots: { viewCount: number; engagements: number }[];
      });
};

function enrich(p: PlacementWithRels, baseline: Baseline, threshold: number): PlacementDetail {
  const snap = p.post?.snapshots[0] ?? null;
  const views = snap?.viewCount ?? null;
  const eng = snap?.engagements ?? null;
  const deliveryRatioViews =
    views != null && baseline.medianViews > 0 ? views / baseline.medianViews : null;
  const deliveryRatioEng =
    eng != null && baseline.medianEng > 0 ? eng / baseline.medianEng : null;
  const underdelivered = deliveryRatioViews != null && deliveryRatioViews < threshold;
  return {
    id: p.id,
    type: p.type,
    priceUsd: p.priceUsd,
    note: p.note,
    createdAt: p.createdAt.toISOString(),
    account: p.account,
    post: p.post
      ? {
          id: p.post.id,
          url: p.post.url,
          postedAt: p.post.postedAt.toISOString(),
          views: views ?? 0,
          engagements: eng ?? 0,
          isFrozen: p.post.isFrozen,
        }
      : null,
    baselineMedianViews: baseline.medianViews,
    baselineMedianEng: baseline.medianEng,
    baselineN: baseline.n,
    deliveryRatioViews,
    deliveryRatioEng,
    underdelivered,
  };
}

const placementInclude = {
  account: { select: { id: true, username: true, displayName: true, profilePicture: true } },
  post: {
    select: {
      id: true,
      url: true,
      postedAt: true,
      isFrozen: true,
      snapshots: { orderBy: { capturedAt: "desc" as const }, take: 1, select: { viewCount: true, engagements: true } },
    },
  },
};

// ---------------------------------------------------------------------------
// Campaign read models
// ---------------------------------------------------------------------------
export interface CampaignSummary {
  id: string;
  name: string;
  client: string;
  status: string;
  startDate: string;
  endDate: string | null;
  createdBy: string | null;
  createdAt: string;
  placementCount: number;
  linkedCount: number;
  totalViews: number;
  totalEngagements: number;
  medianDeliveryRatio: number | null;
  underdeliverCount: number;
}

export interface CampaignDetail extends CampaignSummary {
  placements: PlacementDetail[];
  deliveryDistribution: number[]; // per-placement deliveryRatioViews (non-null)
}

function rollup(details: PlacementDetail[]) {
  const totalViews = details.reduce((s, d) => s + (d.post?.views ?? 0), 0);
  const totalEngagements = details.reduce((s, d) => s + (d.post?.engagements ?? 0), 0);
  const ratios = details.map((d) => d.deliveryRatioViews).filter((r): r is number => r != null);
  const medianDeliveryRatio = ratios.length ? summarizeViews(ratios).median : null;
  const underdeliverCount = details.filter((d) => d.underdelivered).length;
  const linkedCount = details.filter((d) => d.post != null).length;
  return { totalViews, totalEngagements, ratios, medianDeliveryRatio, underdeliverCount, linkedCount };
}

export async function getCampaignsOverview(): Promise<CampaignSummary[]> {
  const settings = await getSettings();
  const campaigns = await prisma.campaign.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { placements: { include: placementInclude } },
  });
  const allAccountIds = campaigns.flatMap((c) => c.placements.map((p) => p.accountId));
  const baselines = await baselinesFor(allAccountIds);
  return campaigns.map((c) => {
    const details = c.placements.map((p) =>
      enrich(p as PlacementWithRels, baselines.get(p.accountId)!, settings.underdeliverThreshold),
    );
    const r = rollup(details);
    return {
      id: c.id,
      name: c.name,
      client: c.client,
      status: c.status,
      startDate: c.startDate.toISOString(),
      endDate: c.endDate ? c.endDate.toISOString() : null,
      createdBy: c.createdBy,
      createdAt: c.createdAt.toISOString(),
      placementCount: c.placements.length,
      linkedCount: r.linkedCount,
      totalViews: r.totalViews,
      totalEngagements: r.totalEngagements,
      medianDeliveryRatio: r.medianDeliveryRatio,
      underdeliverCount: r.underdeliverCount,
    };
  });
}

export async function getCampaignDetail(id: string): Promise<CampaignDetail | null> {
  const settings = await getSettings();
  const c = await prisma.campaign.findUnique({
    where: { id },
    include: { placements: { orderBy: { createdAt: "asc" }, include: placementInclude } },
  });
  if (!c) return null;
  const baselines = await baselinesFor(c.placements.map((p) => p.accountId));
  const placements = c.placements.map((p) =>
    enrich(p as PlacementWithRels, baselines.get(p.accountId)!, settings.underdeliverThreshold),
  );
  const r = rollup(placements);
  return {
    id: c.id,
    name: c.name,
    client: c.client,
    status: c.status,
    startDate: c.startDate.toISOString(),
    endDate: c.endDate ? c.endDate.toISOString() : null,
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
    placementCount: c.placements.length,
    linkedCount: r.linkedCount,
    totalViews: r.totalViews,
    totalEngagements: r.totalEngagements,
    medianDeliveryRatio: r.medianDeliveryRatio,
    underdeliverCount: r.underdeliverCount,
    placements,
    deliveryDistribution: r.ratios,
  };
}

export interface UnderdeliveringPlacement {
  campaignId: string;
  campaignName: string;
  placementId: string;
  username: string;
  displayName: string | null;
  profilePicture: string | null;
  deliveryRatioViews: number;
  views: number;
}

/** Under-delivering commissioned posts across ACTIVE campaigns (for alerting). */
export async function getUnderdeliveringPlacements(): Promise<UnderdeliveringPlacement[]> {
  const settings = await getSettings();
  const campaigns = await prisma.campaign.findMany({
    where: { status: "active" },
    include: { placements: { include: placementInclude } },
  });
  const baselines = await baselinesFor(campaigns.flatMap((c) => c.placements.map((p) => p.accountId)));
  const out: UnderdeliveringPlacement[] = [];
  for (const c of campaigns) {
    for (const p of c.placements) {
      const d = enrich(p as PlacementWithRels, baselines.get(p.accountId)!, settings.underdeliverThreshold);
      if (d.underdelivered && d.deliveryRatioViews != null) {
        out.push({
          campaignId: c.id,
          campaignName: c.name,
          placementId: d.id,
          username: d.account.username,
          displayName: d.account.displayName,
          profilePicture: d.account.profilePicture,
          deliveryRatioViews: d.deliveryRatioViews,
          views: d.post?.views ?? 0,
        });
      }
    }
  }
  return out.sort((a, b) => a.deliveryRatioViews - b.deliveryRatioViews);
}

// ---------------------------------------------------------------------------
// Attaching a commissioned post (ingests the tweet once if not already stored)
// ---------------------------------------------------------------------------
export interface AttachInput {
  campaignId: string;
  input: string; // tweet URL or id
  type?: string;
  priceUsd?: number | null;
  note?: string | null;
}

export async function attachPlacement(
  args: AttachInput,
  settingsArg?: AppSettings,
): Promise<{ placement: Placement; ingested: boolean; warning?: string }> {
  const settings = settingsArg ?? (await getSettings());
  const campaign = await prisma.campaign.findUnique({ where: { id: args.campaignId } });
  if (!campaign) throw new Error("Campaign not found");

  const tweetId = parseTweetId(args.input);
  if (!tweetId) throw new Error("Could not parse a tweet id or URL from the input");

  let post = await prisma.post.findUnique({ where: { id: tweetId } });
  let accountId: string;
  let warning: string | undefined;

  if (post) {
    accountId = post.accountId;
  } else {
    // Fetch the tweet once via the provider, logged to ApiCallLog as 'placement'.
    const provider = getProvider();
    const start = Date.now();
    let res;
    try {
      res = await provider.getTweetsByIds([tweetId]);
    } catch (err) {
      await recordError("tweets_by_ids", err, { purpose: "placement", durationMs: Date.now() - start });
      throw err;
    }
    const apiCallId = await recordCost(res.cost, { purpose: "placement", durationMs: Date.now() - start });
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
          addedBy: campaign.createdBy ?? undefined,
        },
      });
    }
    accountId = account.id;

    await ingestPosts(
      accountId,
      [raw],
      { capturedAt: new Date(), source: "placement", apiCallId },
      {
        freezeAgeDays: settings.freezeAgeDays,
        includeReplies: true,
        commissionedFreezeDays: settings.commissionedFreezeDays,
        commissionedIds: new Set([tweetId]),
      },
    );
    post = await prisma.post.findUnique({ where: { id: tweetId } });
    if (!post) {
      warning = "Tweet could not be stored (it may be a retweet); placement saved without metrics.";
    }
  }

  if (post) {
    // Flag commissioned + un-freeze so polling keeps tracking it (see 2c).
    await prisma.post.update({
      where: { id: post.id },
      data: { commissioned: true, isFrozen: false, frozenAt: null },
    });
  }

  const placement = await prisma.placement.create({
    data: {
      campaignId: args.campaignId,
      accountId,
      postId: post?.id ?? null,
      type: args.type ?? "post",
      priceUsd: args.priceUsd ?? null,
      note: args.note ?? null,
    },
  });
  return { placement, ingested: !!post, warning };
}

/** Detach a placement. If no other active-campaign placement references the post,
 *  clear its commissioned flag so it reverts to the normal freeze window. */
export async function detachPlacement(placementId: string): Promise<void> {
  const placement = await prisma.placement.findUnique({ where: { id: placementId } });
  if (!placement) return;
  await prisma.placement.delete({ where: { id: placementId } });
  if (placement.postId) {
    const others = await prisma.placement.count({
      where: { postId: placement.postId, campaign: { status: "active" } },
    });
    if (others === 0) {
      await prisma.post.update({ where: { id: placement.postId }, data: { commissioned: false } });
    }
  }
}
