import Link from "next/link";
import { topMovers } from "@/lib/scoring";
import { cachedCostSummary, cachedLeaderboard, cachedAccountsOverview } from "@/lib/cache";
import { CostWidget } from "@/components/CostWidget";
import { RunPollButton } from "@/components/RunPollButton";
import { Card, StatCard, Badge, Avatar, EmptyState, PageHeader } from "@/components/ui";
import { formatNumber, formatPct, formatSignedPct, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const accounts = await cachedAccountsOverview();

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" description="Shared X influencer watchlist for Atomik Growth." />
        <EmptyState
          title="No influencers tracked yet"
          href="/accounts"
          cta="Add influencers"
        >
          Add X handles to your watchlist. Each one is backfilled with the last 7 days of posts, then
          polled on a schedule so charts build up over time.
        </EmptyState>
      </>
    );
  }

  const [cost, board] = await Promise.all([cachedCostSummary(), cachedLeaderboard()]);
  const movers = topMovers(board, 5);
  const performers = board.slice(0, 5);

  const activeCount = accounts.filter((a) => a.status === "active").length;
  const activeTier = accounts.filter((a) => a.status === "active" && a.pollingTier === "active").length;
  const dormantTier = accounts.filter((a) => a.status === "active" && a.pollingTier === "dormant").length;
  const postsTracked = accounts.reduce((s, a) => s + a.postCount, 0);
  const lastPollTs = accounts
    .map((a) => a.lastPolledAt)
    .filter(Boolean)
    .sort()
    .pop();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Shared X influencer watchlist for Atomik Growth."
        actions={<RunPollButton />}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Tracked accounts" value={formatNumber(activeCount)} sub={`${accounts.length} total`} />
        <StatCard
          label="Polling tiers"
          value={`${activeTier} / ${dormantTier}`}
          sub="active / dormant"
        />
        <StatCard label="Posts tracked" value={formatNumber(postsTracked)} />
        <StatCard label="Last poll" value={lastPollTs ? relativeTime(lastPollTs) : "never"} />
      </div>

      <div className="mt-4">
        <CostWidget summary={cost} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Top performers</h2>
            <Link href="/leaderboard" className="text-xs text-brand-600 hover:underline">
              View leaderboard →
            </Link>
          </div>
          <ol className="space-y-2">
            {performers.map((r) => (
              <li key={r.accountId}>
                <Link
                  href={`/influencer/${r.username}`}
                  className="flex items-center gap-3 rounded-lg p-2 hover:bg-slate-50"
                >
                  <span className="w-5 text-sm font-semibold text-slate-400">{r.rank}</span>
                  <Avatar src={r.profilePicture} alt={r.username} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {r.displayName ?? r.username}
                    </div>
                    <div className="truncate text-xs text-slate-500">@{r.username}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-slate-900">{r.performanceScore}</div>
                    <div className="text-xs text-slate-500">{formatNumber(r.avgViews)} views/post</div>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Rising this week</h2>
            <span className="text-xs text-slate-400">WoW views growth</span>
          </div>
          {movers.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Not enough history yet — trends appear after a couple of polls across days.
            </p>
          ) : (
            <ol className="space-y-2">
              {movers.map((r) => (
                <li key={r.accountId}>
                  <Link
                    href={`/influencer/${r.username}`}
                    className="flex items-center gap-3 rounded-lg p-2 hover:bg-slate-50"
                  >
                    <Avatar src={r.profilePicture} alt={r.username} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">
                        {r.displayName ?? r.username}
                      </div>
                      <div className="truncate text-xs text-slate-500">@{r.username}</div>
                    </div>
                    {r.rising && <Badge color="green">Rising</Badge>}
                    <div className="w-16 text-right text-sm font-semibold text-emerald-600">
                      {formatSignedPct(r.wowViewsPct)}
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
