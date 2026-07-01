import Link from "next/link";
import { getAllTags } from "@/lib/accounts";
import { getSettings } from "@/lib/settings";
import { cachedLeaderboard } from "@/lib/cache";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { PageHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // headroom for Neon cold-starts (see lib/db.ts retry)

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ direction?: string; tier?: string; rising?: string; q?: string; tag?: string }>;
}) {
  const [settings, rows, tags, sp] = await Promise.all([
    getSettings(),
    cachedLeaderboard(),
    getAllTags(),
    searchParams,
  ]);
  const initialFilters = {
    direction: ["rising", "falling", "flat"].includes(sp.direction ?? "") ? sp.direction! : "",
    tier: ["active", "dormant"].includes(sp.tier ?? "") ? sp.tier! : "",
    rising: sp.rising === "1" || sp.rising === "true",
    q: sp.q ?? "",
    tag: sp.tag ?? "",
  };

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title="Leaderboard" />
        <EmptyState title="No influencers tracked yet" href="/accounts" cta="Add influencers">
          Add handles to your watchlist to start ranking them.
        </EmptyState>
      </>
    );
  }

  const wSum = settings.reachWeight + settings.engagementWeight || 1;
  const reachPct = Math.round((settings.reachWeight / wSum) * 100);
  const engPct = 100 - reachPct;

  return (
    <>
      <PageHeader
        title="Leaderboard"
        description={`Performance Score = ${reachPct}% median reach + ${engPct}% engagement rate, ${settings.normalization}-normalized over the trailing 7 days. Sort or filter by any column.`}
        actions={
          <Link href="/settings" className="text-sm text-brand-600 hover:underline">
            Adjust weights →
          </Link>
        }
      />
      <LeaderboardTable rows={rows} allTags={tags} initialFilters={initialFilters} />
    </>
  );
}
