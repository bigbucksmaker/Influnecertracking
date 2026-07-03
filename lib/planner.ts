// ---------------------------------------------------------------------------
// Budget planner — "I have $X for this niche; what's the best slate?"
//
// Greedy allocation on views-per-dollar for the chosen format: rank every
// candidate by median organic views ÷ format rate, then walk down the list
// taking one slot per creator while the budget allows. This is the classic
// greedy knapsack approximation — near-optimal here because slot prices are
// small relative to typical budgets and expected views scale linearly.
//
// Estimates only: "expected views" is the creator's trailing-7d MEDIAN organic
// views — what a typical post does, before any paid-post uplift or decay.
// Low-confidence creators (thin/stale data) are excluded by default.
// ---------------------------------------------------------------------------

import type { LeaderboardRow } from "./scoring";

export type PlanFormat = "qt" | "post" | "thread";

export const PLAN_FORMAT_LABEL: Record<PlanFormat, string> = {
  qt: "Quote tweet",
  post: "Post",
  thread: "Thread",
};

export interface PlanInput {
  budgetUsd: number;
  format: PlanFormat;
  niche?: string | null;
  includeLowConfidence?: boolean;
  minMedianViews?: number | null;
  maxCreators?: number | null;
}

export interface PlanPick {
  accountId: string;
  username: string;
  displayName: string | null;
  profilePicture: string | null;
  tags: string[];
  rate: number;
  medianViews: number;
  medianEng: number;
  erImpressions: number;
  viewsPerDollar: number;
  cpm: number; // $ per 1K expected views at this rate
  valueScore: number | null;
  performanceScore: number;
  lowConfidence: boolean;
}

export interface PlanResult {
  input: Required<Pick<PlanInput, "budgetUsd" | "format">> &
    Pick<PlanInput, "niche" | "includeLowConfidence" | "minMedianViews" | "maxCreators">;
  picks: PlanPick[];
  totalCost: number;
  leftover: number;
  expectedViews: number;
  expectedEngagements: number;
  blendedCpm: number | null; // total cost ÷ expected views × 1K
  consideredCount: number; // candidates that survived the filters
  excluded: { noRate: number; lowConfidence: number; noRecentPosts: number; belowMinViews: number; offNiche: number };
}

function rateFor(r: LeaderboardRow, format: PlanFormat): number | null {
  const v = format === "qt" ? r.rateQuoteTweet : format === "post" ? r.ratePost : r.rateThread;
  return v != null && v > 0 ? v : null;
}

export function buildPlan(rows: LeaderboardRow[], input: PlanInput): PlanResult {
  const budget = Math.max(0, Math.floor(input.budgetUsd));
  const excluded = { noRate: 0, lowConfidence: 0, noRecentPosts: 0, belowMinViews: 0, offNiche: 0 };
  const niche = input.niche?.trim() || null;
  const minViews = input.minMedianViews ?? null;
  const maxCreators = input.maxCreators && input.maxCreators > 0 ? input.maxCreators : Infinity;

  const candidates: (PlanPick & { _vpd: number })[] = [];
  for (const r of rows) {
    if (niche && !r.tags.some((t) => t.toLowerCase() === niche.toLowerCase())) {
      excluded.offNiche++;
      continue;
    }
    const rate = rateFor(r, input.format);
    if (rate == null) {
      excluded.noRate++;
      continue;
    }
    if (r.postCount7d === 0 || r.medianViews <= 0) {
      excluded.noRecentPosts++;
      continue;
    }
    if (!input.includeLowConfidence && r.lowConfidence) {
      excluded.lowConfidence++;
      continue;
    }
    if (minViews != null && r.medianViews < minViews) {
      excluded.belowMinViews++;
      continue;
    }
    const vpd = r.medianViews / rate;
    candidates.push({
      accountId: r.accountId,
      username: r.username,
      displayName: r.displayName,
      profilePicture: r.profilePicture,
      tags: r.tags,
      rate,
      medianViews: Math.round(r.medianViews),
      medianEng: Math.round(r.medianEng),
      erImpressions: r.erImpressions,
      viewsPerDollar: Math.round(vpd * 10) / 10,
      cpm: Math.round((rate / r.medianViews) * 1000 * 100) / 100,
      valueScore: r.valueScore,
      performanceScore: r.performanceScore,
      lowConfidence: r.lowConfidence,
      _vpd: vpd,
    });
  }

  candidates.sort((a, b) => b._vpd - a._vpd);

  const picks: PlanPick[] = [];
  let spent = 0;
  for (const c of candidates) {
    if (picks.length >= maxCreators) break;
    if (spent + c.rate > budget) continue; // too dear — keep walking down the list
    const { _vpd, ...pick } = c;
    picks.push(pick);
    spent += c.rate;
  }

  const expectedViews = picks.reduce((s, p) => s + p.medianViews, 0);
  const expectedEngagements = picks.reduce((s, p) => s + p.medianEng, 0);

  return {
    input: {
      budgetUsd: budget,
      format: input.format,
      niche,
      includeLowConfidence: input.includeLowConfidence ?? false,
      minMedianViews: minViews,
      maxCreators: Number.isFinite(maxCreators) ? (maxCreators as number) : null,
    },
    picks,
    totalCost: spent,
    leftover: budget - spent,
    expectedViews,
    expectedEngagements,
    blendedCpm: expectedViews > 0 ? Math.round((spent / expectedViews) * 1000 * 100) / 100 : null,
    consideredCount: candidates.length,
    excluded,
  };
}
