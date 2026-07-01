import Link from "next/link";
import { topMovers, topDecliners } from "@/lib/scoring";
import type { LeaderboardRow } from "@/lib/scoring";
import { cachedCostSummary, cachedLeaderboard, cachedAccountsOverview, cachedCampaigns } from "@/lib/cache";
import { getUnderdeliveringPlacements } from "@/lib/placements";
import { buildAttention, type AttentionItem } from "@/lib/alerts";
import { CostWidget } from "@/components/CostWidget";
import { RunPollButton } from "@/components/RunPollButton";
import { CommandPalette } from "@/components/CommandPalette";
import { Card, Badge, Avatar, EmptyState, PageHeader, Sparkline } from "@/components/ui";
import { formatNumber, formatRatio, formatSignedPct, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

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
      <CommandPalette
        creators={board.map((r) => ({ username: r.username, displayName: r.displayName, profilePicture: r.profilePicture }))}
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name, client: c.client }))}
      />
      <PageHeader
        title="Dashboard"
        description="Shared workspace — vet and monitor your X roster."
        actions={<RunPollButton />}
      />

      <StatStrip
        tracked={accounts.length}
        active={activeCount}
        dormant={dormant}
        lastPoll={lastPollTs ? relativeTime(lastPollTs) : "never"}
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* 1. Top by median reach — shortlisting entry point */}
        <Panel title="Top by median reach" href="/leaderboard" cta="Leaderboard →">
          <ol className="space-y-1.5">
            {topByMedian.map((r, i) => (
              <li key={r.accountId}>
                <Link href={`/influencer/${r.username}`} className="flex items-center gap-3 rounded-lg p-2 hover:bg-surface-2">
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
                    <div className="text-sm font-semibold text-fg">{formatNumber(r.medianViews)}</div>
                    <div className="text-xs text-subtle">median views</div>
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
                  <Link href={`/campaigns/${c.id}`} className="flex items-center gap-3 rounded-lg p-2 hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-fg">{c.name}</div>
                      <div className="truncate text-xs text-subtle">
                        {c.client} · {c.placementCount} placement{c.placementCount === 1 ? "" : "s"} ·{" "}
                        {formatNumber(c.totalViews)} views
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-fg">
                        {formatRatio(c.medianDeliveryRatio)}
                      </div>
                      {c.underdeliverCount > 0 ? (
                        <Badge color="red">{c.underdeliverCount} under</Badge>
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

        {/* 4. Needs attention — dormant, stale, low-confidence, underdelivering */}
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
  lastPoll,
}: {
  tracked: number;
  active: number;
  dormant: number;
  lastPoll: string;
}) {
  const cells = [
    { lab: "Tracked", val: String(tracked) },
    { lab: "Active", val: String(active) },
    { lab: "Dormant", val: String(dormant) },
    { lab: "Last poll", val: lastPoll },
  ];
  return (
    <Card className="flex items-stretch p-0">
      {cells.map((c, i) => (
        <div
          key={c.lab}
          className={`flex flex-1 flex-col gap-0.5 px-5 py-3 ${i > 0 ? "border-l border-line-soft" : ""}`}
        >
          <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-subtle">{c.lab}</span>
          <span className="font-mono text-lg font-medium tabular-nums text-fg">{c.val}</span>
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
              <Link href={`/influencer/${r.username}`} className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-surface-2">
                <Avatar src={r.profilePicture} alt={r.username} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-fg">{r.displayName ?? r.username}</div>
                </div>
                <Sparkline values={r.viewsSparkline} />
                <div className={`w-14 text-right text-sm font-semibold ${tone === "up" ? "text-pos" : "text-neg"}`}>
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
      <Link href={item.href} className="flex items-center gap-3 rounded-lg p-2 hover:bg-surface-2">
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
