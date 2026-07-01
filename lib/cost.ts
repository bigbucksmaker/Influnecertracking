import type { ApiEndpoint } from "./provider/types";

// ---------------------------------------------------------------------------
// twitterapi.io credit / billing model (hardcoded constants per spec)
// ---------------------------------------------------------------------------
export const COST = {
  CREDITS_PER_USD: 100_000, // $1 = 100,000 credits
  TWEET_READ: 15, // credits per tweet read ($0.15 / 1k)
  USER_PROFILE: 18, // credits per user profile ($0.18 / 1k)
  MIN_PER_REQUEST: 15, // minimum charge per request, even if nothing returns
} as const;

/** Per-item credit cost for each endpoint. */
const PER_ITEM: Record<ApiEndpoint, number> = {
  user_info: COST.USER_PROFILE,
  user_last_tweets: COST.TWEET_READ,
  advanced_search: COST.TWEET_READ,
  tweets_by_ids: COST.TWEET_READ,
  balance: 0, // account/balance endpoint is not billed
};

/**
 * Credits charged for a single request that returned `itemsReturned` items.
 * Enforces the per-request minimum. Balance checks are free.
 */
export function computeCredits(endpoint: ApiEndpoint, itemsReturned: number): number {
  if (endpoint === "balance") return 0;
  const perItem = PER_ITEM[endpoint] ?? COST.TWEET_READ;
  return Math.max(COST.MIN_PER_REQUEST, Math.max(0, itemsReturned) * perItem);
}

export function creditsToUsd(credits: number): number {
  return credits / COST.CREDITS_PER_USD;
}

export function usdToCredits(usd: number): number {
  return Math.round(usd * COST.CREDITS_PER_USD);
}

// ---------------------------------------------------------------------------
// Plan tiers (monthly credit caps). $ value = credits / 100,000.
// ---------------------------------------------------------------------------
export interface PlanTier {
  name: string;
  credits: number;
  usd: number;
}

export const PLAN_TIERS: PlanTier[] = [
  { name: "Starter", credits: 3_130_000, usd: 31.3 },
  { name: "Builder", credits: 11_290_000, usd: 112.9 },
  { name: "Pro", credits: 25_070_000, usd: 250.7 },
  { name: "Scale", credits: 69_860_000, usd: 698.6 },
];

export const DEFAULT_PLAN_CAP = 11_290_000; // Builder

/** Smallest plan whose cap covers `credits`, or null if it exceeds every tier. */
export function recommendPlan(credits: number): PlanTier | null {
  return PLAN_TIERS.find((t) => t.credits >= credits) ?? null;
}

export function planForCap(cap: number): PlanTier | null {
  return PLAN_TIERS.find((t) => t.credits === cap) ?? null;
}
