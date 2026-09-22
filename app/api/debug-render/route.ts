import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { cachedAccountsOverview, cachedLeaderboard, cachedCostSummary, cachedCampaigns, cachedInfluencerDetail } from "@/lib/cache";
import { getUnderdeliveringPlacements } from "@/lib/placements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** TEMPORARY diagnostic: run each dashboard dependency in isolation to find the thrower. */
export async function GET() {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;

  const out: Record<string, { ok: boolean; ms?: number; error?: string; size?: number }> = {};
  const probe = async (name: string, fn: () => Promise<unknown>) => {
    const t = Date.now();
    try {
      const v = await fn();
      out[name] = { ok: true, ms: Date.now() - t, size: JSON.stringify(v)?.length ?? 0 };
    } catch (e) {
      out[name] = { ok: false, ms: Date.now() - t, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
    }
  };

  await probe("accountsOverview", () => cachedAccountsOverview());
  await probe("leaderboard", () => cachedLeaderboard());
  await probe("costSummary", () => cachedCostSummary());
  await probe("campaigns", () => cachedCampaigns());
  await probe("underdelivering", () => getUnderdeliveringPlacements());
  await probe("influencerDetail", () => cachedInfluencerDetail("scobleizer"));

  return NextResponse.json(out, { status: 200 });
}
