import Link from "next/link";
import { getAllTags } from "@/lib/accounts";
import { getSettings } from "@/lib/settings";
import { cachedLeaderboard } from "@/lib/cache";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { PageHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const [settings, rows, tags] = await Promise.all([getSettings(), cachedLeaderboard(), getAllTags()]);

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
        description={`Performance Score = ${reachPct}% reach + ${engPct}% engagement rate, ${settings.normalization}-normalized over the trailing 7 days. Sort or filter by any column.`}
        actions={
          <Link href="/settings" className="text-sm text-brand-600 hover:underline">
            Adjust weights →
          </Link>
        }
      />
      <LeaderboardTable rows={rows} allTags={tags} />
    </>
  );
}
