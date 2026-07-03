import Link from "next/link";
import { topMovers, topDecliners } from "@/lib/scoring";
import type { LeaderboardRow } from "@/lib/scoring";
import { cachedCostSummary, cachedLeaderboard, cachedAccountsOverview, cachedCampaigns } from "@/lib/cache";
import { getUnderdeliveringPlacements } from "@/lib/placements";
import { buildAttention, type AttentionItem } from "@/lib/alerts";
import { CostWidget } from "@/components/CostWidget";
import { RunPollButton } from "@/components/RunPollButton";
import { Card, Badge, Avatar, EmptyState, PageHeader, Sparkline, ScoreRing } from "@/components/ui";
import { formatNumber, formatRatio, formatSignedPct, formatUsd, relativeTime } from "@/lib/format";

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
  const bestValue = board
    .filter((r) => r.valueScore != null && !r.lowConfidence)
    .sort((a, b) => (a.valueRank ?? Infinity) - (b.valueRank ?? Infinity))
    .slice(0, 5);
  const risers = topMovers(board, 4).filter((r) => (r.wowViewsPct ?? 0) > 0);
  const decliners = topDecliners(board, 4);
  const activeCampaigns = campaigns.filter((c) => c.status === "active");
  const attention = buildAttention(board, underdelivering, 5);

  const activeCount = accounts.filter((a) => a.status === "active").length;
  const dormant = accounts.filter((a) => a.status === "active" && a.pollingTier === "dormant").length;
  const pricedCount = board.filter((r) => r.basisRate != null).length;
  const lastPollTs = accounts.map((a) => a.lastPolledAt).filter(Boolean).sort().pop();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Shared workspace — vet, price, and monitor your X roster."
        actions={<RunPollButton />}
      />

      <StatStrip
        tracked={accounts.length}
        active={activeCount}
        dormant={dormant}
        priced={pricedCount}
        lastPoll={lastPollTs ? relativeTime(lastPollTs) : "never"}
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* 1. Best value — performance per dollar (the booking shortlist) */}
        <Panel title="Best value" href="/leaderboard?preset=value" cta="Full ranking →">
          {bestValue.length === 0 ? (
            <div className="py-6 text-center text-sm text-subtle">
              No priced creators with solid data yet. Set rates from the{" "}
              <Link href="/leaderboard" className="text-accent-400 hover:underline">
                leaderboard
              </Link>{" "}
              (✎ rates).
            </div>
          ) : (
            <ol className="space-y-1.5">
              {bestValue.map((r) => (
                <li key={r.accountId}>
                  <Link href={`/influencer/${r.username}`} className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-surface-2">
                    <ScoreRing score={r.valueScore} kind="value" title="Value Score — views & engagement per dollar, percentile-ranked" />
                    <Avatar src={r.profilePicture} alt={r.username} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-fg">{r.displayName ?? r.username}</div>
                      <div className="truncate text-xs text-subtle">
                        {formatNumber(r.medianViews)} median views · {r.valueBasis === "qt" ? "QT" : "post"} ${r.basisRate}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-semibold tabular-nums text-money-400">
                        {r.valueBasis === "qt" ? (r.cpmQuote != null ? `$${r.cpmQuote}` : "—") : r.cpmPost != null ? `$${r.cpmPost}` : "—"}
                      </div>
                      <div className="text-[10.5px] text-subtle">est. CPM</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        {/* 2. Top by median reach */}
        <Panel title="Top by median reach" href="/leaderboard" cta="Leaderboard →">
          <ol className="space-y-1.5">
            {topByMedian.map((r, i) => (
              <li key={r.accountId}>
                <Link href={`/influencer/${r.username}`} className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-surface-2">
                  <span className="w-4 text-xs font-semibold text-subtle">{i + 1}</span>
                  <Avatar src={r.profilePicture} alt={r.username} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-sm font-medium text-fg">
                      {r.displayName ?? r.username}
                      {r.lowConfidence && (
                        <span title={r.lowConfidenceReasons.join("; ")}><Badge color="amber">⚠</Badge></span>
                      )}
                    </div>
                    <div className="truncate text-xs text-subtle">@{r.username}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-semibold tabular-nums text-fg">{formatNumber(r.medianViews)}</div>
                    <div className="text-xs text-subtle">median views</div>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </Panel>

        {/* 3. Movers — risers AND decliners with sparklines */}
        <Panel title="Movers" href="/leaderboard?direction=rising" cta="All movers →">
          <div className="space-y-3">
            <MoverGroup label="Rising" rows={risers} tone="up" empty="No risers this week." />
            <MoverGroup label="Falling" rows={decliners} tone="down" empty="No decliners this week." />
          </div>
        </Panel>

        {/* 4. Active campaigns — delivery vs baseline + spend */}
        <Panel title="Active campaigns" href="/campaigns" cta="All campaigns →">
          {activeCampaigns.length === 0 ? (
            <div className="py-6 text-center text-sm text-subtle">
              No active campaigns.{" "}
              <Link href="/campaigns" className="text-accent-400 hover:underline">
                Create one →
              </Link>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {activeCampaigns.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link href={`/campaigns/${c.id}`} className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-fg">{c.name}</div>
                      <div className="truncate text-xs text-subtle">
                        {c.client} · {c.placementCount} placement{c.placementCount === 1 ? "" : "s"} ·{" "}
                        {formatNumber(c.totalViews)} views
                        {c.totalSpendUsd > 0 && (
                          <span className="text-money-400"> · {formatUsd(c.totalSpendUsd)} spent</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-semibold tabular-nums text-fg">
                        {formatRatio(c.medianDeliveryRatio)}
                      </div>
                      {c.underdeliverCount > 0 ? (
                        <Badge color="red">{c.underdeliverCount} under</Badge>
                      ) : c.blendedCpm != null ? (
                        <span className="text-xs text-money-400">${c.blendedCpm} CPM</span>
                      ) : (
                        <span className="text-xs text-subtle">on track</span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* 5. Needs attention — underdelivering, falling, low-confidence, dormant */}
        <Panel title="Needs attention" href="/leaderboard?direction=falling" cta="Review →">
          {attention.length === 0 ? (
            <div className="py-6 text-center text-sm text-subtle">Nothing needs attention. 🎉</div>
          ) : (
            <ul className="space-y-1">
              {attention.map((a) => (
                <AttentionRow key={`${a.kind}-${a.username}`} item={a} />
              ))}
            </ul>
          )}
        </Panel>

        {/* 6. Planner cross-link */}
        <Card className="relative flex flex-col justify-center overflow-hidden p-5">
          <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-money/60 via-money/20 to-transparent" />
          <h2 className="text-sm font-semibold text-fg">Plan a budget</h2>
          <p className="mt-1 max-w-md text-sm text-subtle">
            Give the planner a budget, a format, and a niche — it allocates across the roster by
            expected views per dollar and saves the slate as a shortlist.
          </p>
          <div className="mt-4">
            <Link
              href="/planner"
              className="inline-flex items-center gap-1.5 rounded-lg bg-money-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-money"
            >
              Open planner →
            </Link>
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-subtle">Spend</h2>
        <CostWidget summary={cost} />
      </div>
    </>
  );
}

function StatStrip({
  tracked,
  active,
  dormant,
  priced,
  lastPoll,
}: {
  tracked: number;
  active: number;
  dormant: number;
  priced: number;
  lastPoll: string;
}) {
  const cells = [
    { lab: "Tracked", val: String(tracked) },
    { lab: "Active", val: String(active) },
    { lab: "Dormant", val: String(dormant) },
    { lab: "Priced", val: String(priced), money: true },
    { lab: "Last poll", val: lastPoll },
  ];
  return (
    <Card className="flex items-stretch overflow-x-auto p-0">
      {cells.map((c, i) => (
        <div
          key={c.lab}
          className={`flex flex-1 flex-col gap-0.5 px-5 py-3 ${i > 0 ? "border-l border-line-soft" : ""}`}
        >
          <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-subtle">{c.lab}</span>
          <span className={`font-mono text-lg font-medium tabular-nums ${c.money ? "text-money-400" : "text-fg"}`}>
            {c.val}
          </span>
        </div>
      ))}
    </Card>
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
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <Link href={href} className="text-xs text-accent-400 hover:underline">
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
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-subtle">
        <span className={tone === "up" ? "text-pos" : "text-neg"}>{tone === "up" ? "▲" : "▼"}</span>
        {label}
      </div>
      {rows.length === 0 ? (
        <p className="px-2 py-1 text-xs text-subtle">{empty}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.accountId}>
              <Link href={`/influencer/${r.username}`} className="flex items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-surface-2">
                <Avatar src={r.profilePicture} alt={r.username} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-fg">{r.displayName ?? r.username}</div>
                </div>
                <Sparkline values={r.viewsSparkline} />
                <div className={`w-14 text-right font-mono text-sm font-semibold tabular-nums ${tone === "up" ? "text-pos" : "text-neg"}`}>
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
      <Link href={item.href} className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-surface-2">
        <Avatar src={item.profilePicture} alt={item.username} size={24} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg">{item.title}</div>
          <div className="truncate text-xs text-subtle">
            @{item.username} · {item.detail}
          </div>
        </div>
        <Badge color={SEV_COLOR[item.severity]}>{item.kind === "underdelivering" ? "under" : item.kind}</Badge>
      </Link>
    </li>
  );
}
