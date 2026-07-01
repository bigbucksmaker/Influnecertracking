import Link from "next/link";
import { topMovers, topDecliners } from "@/lib/scoring";
import type { LeaderboardRow } from "@/lib/scoring";
import { cachedCostSummary, cachedLeaderboard, cachedAccountsOverview, cachedCampaigns } from "@/lib/cache";
import { getUnderdeliveringPlacements } from "@/lib/placements";
import { buildAttention, type AttentionItem } from "@/lib/alerts";
import { CostWidget } from "@/components/CostWidget";
import { RunPollButton } from "@/components/RunPollButton";
import { Card, Badge, Avatar, EmptyState, PageHeader, Sparkline } from "@/components/ui";
import { formatNumber, formatRatio, formatSignedPct, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // headroom for Neon cold-starts (see lib/db.ts retry)

export default async function DashboardPage() {
  const accounts = await cachedAccountsOverview();

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" description="Shared X influencer watchlist for Atomik Growth." />
        <EmptyState title="No influencers tracked yet" href="/accounts" cta="Add influencers">
          Add X handles to your watchlist. Each one is backfilled with the last 7 days of posts, then
          polled on a schedule so charts build up over time.
        </EmptyState>
      </>
    );
  }

  const [cost, board, campaigns, underdelivering] = await Promise.all([
    cachedCostSummary(),
    cachedLeaderboard(),
    cachedCampaigns(),
    getUnderdeliveringPlacements(),
  ]);

  const topByMedian = [...board].sort((a, b) => b.medianViews - a.medianViews).slice(0, 5);
  const risers = topMovers(board, 4).filter((r) => (r.wowViewsPct ?? 0) > 0);
  const decliners = topDecliners(board, 4);
  const activeCampaigns = campaigns.filter((c) => c.status === "active");
  const attention = buildAttention(board, underdelivering, 5);

  const activeCount = accounts.filter((a) => a.status === "active").length;
  const dormant = accounts.filter((a) => a.status === "active" && a.pollingTier === "dormant").length;
  const lastPollTs = accounts.map((a) => a.lastPolledAt).filter(Boolean).sort().pop();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${activeCount} tracked · ${dormant} dormant · last poll ${lastPollTs ? relativeTime(lastPollTs) : "never"}`}
        actions={<RunPollButton />}
      />

      <CostWidget summary={cost} />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* 1. Top by median reach — shortlisting entry point */}
        <Panel title="Top by median reach" href="/leaderboard" cta="Leaderboard →">
          <ol className="space-y-1.5">
            {topByMedian.map((r, i) => (
              <li key={r.accountId}>
                <Link href={`/influencer/${r.username}`} className="flex items-center gap-3 rounded-lg p-2 hover:bg-slate-50">
                  <span className="w-4 text-xs font-semibold text-slate-400">{i + 1}</span>
                  <Avatar src={r.profilePicture} alt={r.username} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-900">
                      {r.displayName ?? r.username}
                      {r.lowConfidence && (
                        <span title={r.lowConfidenceReasons.join("; ")}><Badge color="amber">⚠</Badge></span>
                      )}
                    </div>
                    <div className="truncate text-xs text-slate-500">@{r.username}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-slate-900">{formatNumber(r.medianViews)}</div>
                    <div className="text-xs text-slate-500">median views</div>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </Panel>

        {/* 2. Movers — risers AND decliners with sparklines */}
        <Panel title="Movers" href="/leaderboard?direction=rising" cta="All movers →">
          <div className="space-y-3">
            <MoverGroup label="Rising" rows={risers} tone="up" empty="No risers this week." />
            <MoverGroup label="Falling" rows={decliners} tone="down" empty="No decliners this week." />
          </div>
        </Panel>

        {/* 3. Active campaigns — delivery vs baseline */}
        <Panel title="Active campaigns" href="/campaigns" cta="All campaigns →">
          {activeCampaigns.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">
              No active campaigns.{" "}
              <Link href="/campaigns" className="text-brand-600 hover:underline">
                Create one →
              </Link>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {activeCampaigns.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link href={`/campaigns/${c.id}`} className="flex items-center gap-3 rounded-lg p-2 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">{c.name}</div>
                      <div className="truncate text-xs text-slate-500">
                        {c.client} · {c.placementCount} placement{c.placementCount === 1 ? "" : "s"} ·{" "}
                        {formatNumber(c.totalViews)} views
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-slate-900">
                        {formatRatio(c.medianDeliveryRatio)}
                      </div>
                      {c.underdeliverCount > 0 ? (
                        <Badge color="red">{c.underdeliverCount} under</Badge>
                      ) : (
                        <span className="text-xs text-slate-500">on track</span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* 4. Needs attention — dormant, stale, low-confidence, underdelivering */}
        <Panel title="Needs attention" href="/leaderboard?direction=falling" cta="Review →">
          {attention.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">Nothing needs attention. 🎉</div>
          ) : (
            <ul className="space-y-1">
              {attention.map((a) => (
                <AttentionRow key={`${a.kind}-${a.username}`} item={a} />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

function Panel({
  title,
  href,
  cta,
  children,
}: {
  title: string;
  href: string;
  cta: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <Link href={href} className="text-xs text-brand-600 hover:underline">
          {cta}
        </Link>
      </div>
      {children}
    </Card>
  );
}

function MoverGroup({
  label,
  rows,
  tone,
  empty,
}: {
  label: string;
  rows: LeaderboardRow[];
  tone: "up" | "down";
  empty: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
        <span className={tone === "up" ? "text-emerald-600" : "text-red-600"}>{tone === "up" ? "▲" : "▼"}</span>
        {label}
      </div>
      {rows.length === 0 ? (
        <p className="px-2 py-1 text-xs text-slate-400">{empty}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.accountId}>
              <Link href={`/influencer/${r.username}`} className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-slate-50">
                <Avatar src={r.profilePicture} alt={r.username} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-800">{r.displayName ?? r.username}</div>
                </div>
                <Sparkline values={r.viewsSparkline} />
                <div className={`w-14 text-right text-sm font-semibold ${tone === "up" ? "text-emerald-600" : "text-red-600"}`}>
                  {formatSignedPct(r.wowViewsPct)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const SEV_COLOR = { high: "red", medium: "amber", low: "slate" } as const;

function AttentionRow({ item }: { item: AttentionItem }) {
  return (
    <li>
      <Link href={item.href} className="flex items-center gap-3 rounded-lg p-2 hover:bg-slate-50">
        <Avatar src={item.profilePicture} alt={item.username} size={24} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-900">{item.title}</div>
          <div className="truncate text-xs text-slate-500">
            @{item.username} · {item.detail}
          </div>
        </div>
        <Badge color={SEV_COLOR[item.severity]}>{item.kind === "underdelivering" ? "under" : item.kind}</Badge>
      </Link>
    </li>
  );
}
