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

export const cachedLeaderboard = unstable_cache(() => computeLeaderboard(), ["leaderboard"], OPTS);
export const cachedCostSummary = unstable_cache(() => getCostSummary(), ["cost-summary"], OPTS);
export const cachedAccountsOverview = unstable_cache(
  () => getAccountsOverview(),
  ["accounts-overview"],
  OPTS,
);
export const cachedInfluencerDetail = unstable_cache(
  (username: string) => getInfluencerDetail(username),
  ["influencer-detail"],
  OPTS,
);
export const cachedCampaigns = unstable_cache(() => getCampaignsOverview(), ["campaigns"], OPTS);
export const cachedCampaignDetail = unstable_cache(
  (id: string) => getCampaignDetail(id),
  ["campaign-detail"],
  OPTS,
);
export const cachedShortlists = unstable_cache(() => getShortlists(), ["shortlists"], OPTS);
