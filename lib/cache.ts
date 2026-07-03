import { unstable_cache } from "next/cache";
import { computeLeaderboard } from "./scoring";
import { getCostSummary } from "./cost-summary";
import { getAccountsOverview } from "./accounts";
import { getInfluencerDetail } from "./metrics";
import { getCampaignsOverview, getCampaignDetail } from "./placements";
import { getShortlists } from "./shortlists";

// The heavy read aggregations only change when a poll/backfill or a mutation
// runs. Cache them so page navigations are served instantly instead of
// re-scanning Postgres every time. Mutations call revalidateTag(CACHE_TAG).
export const CACHE_TAG = "app-data";
const OPTS = { revalidate: 120, tags: [CACHE_TAG] };

// Cache-key version. Vercel's Data Cache PERSISTS across deployments, so if a
// cached function's return SHAPE changes, bump this — otherwise a new build can
// read a stale, old-shaped entry written by a previous deploy (e.g. a
// LeaderboardRow missing viewsSparkline → `undefined.filter` at render time).
// v3: economics fields (value layer) on leaderboard/shortlists/campaigns.
const V = "v3";

export const cachedLeaderboard = unstable_cache(() => computeLeaderboard(), ["leaderboard", V], OPTS);
export const cachedCostSummary = unstable_cache(() => getCostSummary(), ["cost-summary", V], OPTS);
export const cachedAccountsOverview = unstable_cache(
  () => getAccountsOverview(),
  ["accounts-overview", V],
  OPTS,
);
export const cachedInfluencerDetail = unstable_cache(
  (username: string) => getInfluencerDetail(username),
  ["influencer-detail", V],
  OPTS,
);
export const cachedCampaigns = unstable_cache(() => getCampaignsOverview(), ["campaigns", V], OPTS);
export const cachedCampaignDetail = unstable_cache(
  (id: string) => getCampaignDetail(id),
  ["campaign-detail", V],
  OPTS,
);
export const cachedShortlists = unstable_cache(() => getShortlists(), ["shortlists", V], OPTS);
