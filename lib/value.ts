// ---------------------------------------------------------------------------
// The value layer — performance per dollar.
//
// Rates were historically unreliable, so every metric in the app deliberately
// excluded them. The roster's rates are now maintained and trusted, so this
// module computes the economics the team actually trades on:
//
//   Implied CPM (format)  = rate ÷ median organic views × 1,000
//   Cost per 1K eng       = basis rate ÷ median organic engagements × 1,000
//   Views per dollar      = median views ÷ basis rate
//   Value Score (0–100)   = ½·pct(views/$) + ½·pct(eng/$), percentile-ranked
//                           across all priced accounts on the same basis
//   Price position        = implied CPM vs the median CPM of niche peers
//                           (≥3 sharing a tag, else the whole priced set):
//                           ≤0.70× underpriced · ≥1.40× overpriced · else fair
//
// Basis: the quote-tweet rate is the roster's primary trading format; accounts
// priced only for posts fall back to the post rate (flagged via valueBasis).
//
// Boundaries that keep the rest of the app honest:
//  • The Performance Score is untouched — reach/engagement only.
//  • Campaign delivery ratios stay price-free (views vs organic baseline).
//  • Everything here is an ESTIMATE from organic medians; low-confidence rows
//    (thin/stale data) carry their flag through so a flattering CPM built on
//    one post is never presented as solid.
// ---------------------------------------------------------------------------

import { percentileRanks, median } from "./stats";

export const UNDERPRICED_MAX = 0.7; // CPM ≤ 0.70× peer median → underpriced
export const OVERPRICED_MIN = 1.4; // CPM ≥ 1.40× peer median → overpriced
export const MIN_NICHE_PEERS = 3; // fewer → fall back to the whole priced set
export const RATE_STALE_DAYS = 90; // ratesUpdatedAt older than this → hint

export type ValueBasis = "qt" | "post";
export type PricePosition = "underpriced" | "fair" | "overpriced";

/** What the engine needs from each row (LeaderboardRow satisfies this). */
export interface EconomicsInput {
  medianViews: number;
  medianEng: number;
  postCount7d: number;
  lowConfidence: boolean;
  tags: string[];
  rateQuoteTweet: number | null;
  ratePost: number | null;
  rateThread: number | null;
}

export interface Economics {
  /** Implied $ per 1K median organic views, per format. */
  cpmQuote: number | null;
  cpmPost: number | null;
  cpmThread: number | null;
  /** $ per 1K median organic engagements at the basis rate. */
  costPerKEng: number | null;
  /** Which rate the value metrics are computed on. */
  valueBasis: ValueBasis | null;
  basisRate: number | null;
  /** Median organic views bought per basis-rate dollar. */
  viewsPerDollar: number | null;
  /** 0–100 percentile blend of views/$ and eng/$ across priced accounts. */
  valueScore: number | null;
  /** 1..n rank among priced accounts (1 = best value). */
  valueRank: number | null;
  /** Implied CPM vs peer-median CPM − 1 (−0.35 = 35% cheaper than peers). */
  priceVsPeersPct: number | null;
  pricePosition: PricePosition | null;
  /** "niche" when ≥3 tag-sharing priced peers existed, else "all". */
  peerGroup: "niche" | "all" | null;
  peerCount: number | null;
}

const EMPTY: Economics = {
  cpmQuote: null,
  cpmPost: null,
  cpmThread: null,
  costPerKEng: null,
  valueBasis: null,
  basisRate: null,
  viewsPerDollar: null,
  valueScore: null,
  valueRank: null,
  priceVsPeersPct: null,
  pricePosition: null,
  peerGroup: null,
  peerCount: null,
};

function cpm(rate: number | null, medianViews: number): number | null {
  if (rate == null || rate <= 0 || medianViews <= 0) return null;
  return Math.round((rate / medianViews) * 1000 * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Enrich rows with the economics block. Pure; returns new objects. Rows with
 * no basis rate or no in-window posts get null value fields (never zeros).
 */
export function applyEconomics<T extends EconomicsInput>(rows: T[]): (T & Economics)[] {
  // Pass 1: per-row basics.
  const enriched = rows.map((r) => {
    const hasPosts = r.postCount7d > 0 && r.medianViews > 0;
    const valueBasis: ValueBasis | null =
      r.rateQuoteTweet != null && r.rateQuoteTweet > 0
        ? "qt"
        : r.ratePost != null && r.ratePost > 0
          ? "post"
          : null;
    const basisRate = valueBasis === "qt" ? r.rateQuoteTweet : valueBasis === "post" ? r.ratePost : null;
    const viewsPerDollar =
      hasPosts && basisRate != null && basisRate > 0 ? r.medianViews / basisRate : null;
    const engPerDollar =
      basisRate != null && basisRate > 0 && r.medianEng > 0 ? r.medianEng / basisRate : null;
    const costPerKEng =
      basisRate != null && basisRate > 0 && r.medianEng > 0
        ? Math.round((basisRate / r.medianEng) * 1000 * 100) / 100
        : null;
    return {
      ...r,
      ...EMPTY,
      cpmQuote: hasPosts ? cpm(r.rateQuoteTweet, r.medianViews) : null,
      cpmPost: hasPosts ? cpm(r.ratePost, r.medianViews) : null,
      cpmThread: hasPosts ? cpm(r.rateThread, r.medianViews) : null,
      costPerKEng,
      valueBasis,
      basisRate,
      viewsPerDollar,
      _engPerDollar: engPerDollar as number | null,
    };
  });

  // Pass 2: Value Score — percentile blend across priced accounts (any basis;
  // views/$ and eng/$ are basis-agnostic "what a dollar buys" measures).
  const priced = enriched.filter((r) => r.viewsPerDollar != null);
  const vpdRanks = percentileRanks(priced.map((r) => r.viewsPerDollar as number));
  const epdValues = priced.map((r) => r._engPerDollar ?? 0);
  const epdRanks = percentileRanks(epdValues);
  priced.forEach((r, i) => {
    r.valueScore = round1(0.5 * vpdRanks[i] + 0.5 * epdRanks[i]);
  });
  const byValue = [...priced].sort((a, b) => (b.valueScore ?? 0) - (a.valueScore ?? 0));
  byValue.forEach((r, i) => (r.valueRank = i + 1));

  // Pass 3: price position — implied basis CPM vs peer-median CPM.
  const basisCpm = (r: (typeof enriched)[number]) =>
    r.valueBasis === "qt" ? r.cpmQuote : r.valueBasis === "post" ? r.cpmPost : null;
  const withCpm = enriched.filter((r) => basisCpm(r) != null);
  const allCpms = withCpm.map((r) => basisCpm(r) as number);
  for (const r of withCpm) {
    const own = basisCpm(r) as number;
    const nichePeers = withCpm.filter(
      (o) => o !== r && o.tags.some((t) => r.tags.includes(t)),
    );
    const useNiche = nichePeers.length >= MIN_NICHE_PEERS;
    const peerCpms = useNiche
      ? nichePeers.map((o) => basisCpm(o) as number)
      : allCpms.filter((_, i) => withCpm[i] !== r);
    if (peerCpms.length === 0) continue;
    const peerMedian = median(peerCpms);
    if (peerMedian <= 0) continue;
    const ratio = own / peerMedian;
    r.priceVsPeersPct = Math.round((ratio - 1) * 1000) / 1000;
    r.pricePosition = ratio <= UNDERPRICED_MAX ? "underpriced" : ratio >= OVERPRICED_MIN ? "overpriced" : "fair";
    r.peerGroup = useNiche ? "niche" : "all";
    r.peerCount = peerCpms.length;
  }

  // Strip the working field.
  return enriched.map(({ _engPerDollar, ...rest }) => rest) as (T & Economics)[];
}

/** True when ratesUpdatedAt is set and older than RATE_STALE_DAYS. */
export function ratesAreStale(ratesUpdatedAt: string | Date | null | undefined): boolean {
  if (!ratesUpdatedAt) return false; // unknown age — don't cry wolf on legacy imports
  const t = typeof ratesUpdatedAt === "string" ? new Date(ratesUpdatedAt).getTime() : ratesUpdatedAt.getTime();
  return Number.isFinite(t) && Date.now() - t > RATE_STALE_DAYS * 24 * 60 * 60 * 1000;
}
