import { unstable_cache } from "next/cache";
import { computeLeaderboard } from "./scoring";
import { getCostSummary } from "./cost-summary";
import { getAccountsOverview } from "./accounts";
import { getInfluencerDetail } from "./metrics";
import { getCampaignsOverview, getCampaignDetail } from "./placements";
import { getShortlists } from "./shortlists";

// The heavy read aggregations only change when a poll/backfill or a mutation
// runs. Cache them so page navigations are served instantly instead of
// re-scanning Postgres every time.
//
// Two tag layers so a write doesn't nuke unrelated surfaces:
//   CACHE_TAGS.data      — post/snapshot/account data changed (poll, backfill,
//                          account add/remove) → leaderboard + influencer detail
//                          + campaigns all derive from it, so they share it.
//   per-surface tags     — a targeted mutation (rate edit, campaign edit,
//                          shortlist edit, settings change) invalidates only
//                          the surfaces that read that data, leaving the rest
//                          of the app on warm cache.
export const CACHE_TAG = "app-data"; // kept for back-compat with any stale callers
export const CACHE_TAGS = {
  data: "app-data",
  leaderboard: "leaderboard",
  accounts: "accounts-overview",
  campaigns: "campaigns",
  shortlists: "shortlists",
  cost: "cost-summary",
  influencer: "influencer-detail",
} as const;

// Cache-key version. Vercel's Data Cache PERSISTS across deployments, so if a
// cached function's return SHAPE changes, bump this — otherwise a new build can
// read a stale, old-shaped entry written by a previous deploy (e.g. a
// LeaderboardRow missing viewsSparkline → `undefined.filter` at render time).
// v3: economics fields (value layer) on leaderboard/shortlists/campaigns.
// v4: dailySeries on influencer detail (median views per day chart).
// v5: force-drop any residual pre-v3 entries — an old-shaped LeaderboardRow
//     (no tags / no lowConfidenceReasons) crashes the dashboard render.
const V = "v5";

export const cachedLeaderboard = unstable_cache(() => computeLeaderboard(), ["leaderboard", V], {
  revalidate: 120,
  tags: [CACHE_TAGS.data, CACHE_TAGS.leaderboard],
});
export const cachedCostSummary = unstable_cache(() => getCostSummary(), ["cost-summary", V], {
  revalidate: 120,
  tags: [CACHE_TAGS.cost],
});
export const cachedAccountsOverview = unstable_cache(
  () => getAccountsOverview(),
  ["accounts-overview", V],
  { revalidate: 120, tags: [CACHE_TAGS.data, CACHE_TAGS.accounts] },
);
export const cachedInfluencerDetail = unstable_cache(
  (username: string) => getInfluencerDetail(username),
  ["influencer-detail", V],
  { revalidate: 120, tags: [CACHE_TAGS.data, CACHE_TAGS.influencer] },
);
export const cachedCampaigns = unstable_cache(() => getCampaignsOverview(), ["campaigns", V], {
  revalidate: 120,
  tags: [CACHE_TAGS.data, CACHE_TAGS.campaigns],
});
export const cachedCampaignDetail = unstable_cache(
  (id: string) => getCampaignDetail(id),
  ["campaign-detail", V],
  { revalidate: 120, tags: [CACHE_TAGS.data, CACHE_TAGS.campaigns] },
);
export const cachedShortlists = unstable_cache(() => getShortlists(), ["shortlists", V], {
  revalidate: 120,
  tags: [CACHE_TAGS.data, CACHE_TAGS.shortlists],
});
