import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api";
import { cachedLeaderboard } from "@/lib/cache";
import { ratesAreStale } from "@/lib/value";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Per-handle metrics for the Chrome extension's X-profile overlay.
 * Returns one of three states:
 *   tracked  — full slim metrics row (performance + economics)
 *   pending  — account exists but isn't scored yet (backfill in flight / paused)
 *   untracked
 */
export async function GET(req: Request) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;

  const { searchParams } = new URL(req.url);
  const username = (searchParams.get("username") ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(username)) {
    return NextResponse.json({ error: "Invalid username" }, { status: 400 });
  }

  const board = await cachedLeaderboard();
  const row = board.find((r) => r.username === username);

  if (row) {
    return NextResponse.json({
      state: "tracked",
      totalTracked: board.length,
      account: {
        username: row.username,
        displayName: row.displayName,
        profilePicture: row.profilePicture,
        tags: row.tags,
        pollingTier: row.pollingTier,
        lastPolledAt: row.lastPolledAt,
        performanceScore: row.performanceScore,
        rank: row.rank,
        valueScore: row.valueScore,
        valueRank: row.valueRank,
        medianViews: Math.round(row.medianViews),
        p25Views: Math.round(row.p25Views),
        erImpressions: row.erImpressions,
        currentFollowers: row.currentFollowers,
        followerGrowth7dPct: row.followerGrowth7dPct,
        postCount7d: row.postCount7d,
        wowViewsPct: row.wowViewsPct,
        direction: row.direction,
        lowConfidence: row.lowConfidence,
        lowConfidenceReasons: row.lowConfidenceReasons,
        viewsSparkline: row.viewsSparkline,
        rateQuoteTweet: row.rateQuoteTweet,
        ratePost: row.ratePost,
        rateThread: row.rateThread,
        cpm: row.valueBasis === "qt" ? row.cpmQuote : row.valueBasis === "post" ? row.cpmPost : null,
        valueBasis: row.valueBasis,
        pricePosition: row.pricePosition,
        priceVsPeersPct: row.priceVsPeersPct,
        ratesStale: ratesAreStale(row.ratesUpdatedAt),
      },
    });
  }

  // In the DB but not on the board: pending backfill, paused, or just added.
  const account = await prisma.account.findUnique({
    where: { username },
    select: { username: true, status: true, backfilledAt: true, lastPolledAt: true },
  });
  if (account) {
    return NextResponse.json({
      state: "pending",
      account: {
        username: account.username,
        status: account.status,
        backfilled: account.backfilledAt != null,
        lastPolledAt: account.lastPolledAt ? account.lastPolledAt.toISOString() : null,
      },
    });
  }

  return NextResponse.json({ state: "untracked", username });
}
