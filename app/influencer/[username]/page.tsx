import { notFound } from "next/navigation";
import Link from "next/link";
import { cachedInfluencerDetail, cachedLeaderboard } from "@/lib/cache";
import { InfluencerCharts } from "@/components/InfluencerCharts";
import { RemoveInfluencerButton } from "@/components/RemoveInfluencerButton";
import { Card, StatCard, Badge, Avatar } from "@/components/ui";
import { formatNumber, formatFull, formatPct, formatSignedPct, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InfluencerPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const uname = decodeURIComponent(username);
  const [detail, board] = await Promise.all([cachedInfluencerDetail(uname), cachedLeaderboard()]);
  if (!detail) notFound();

  const { account, followerSeries, reachSeries, recentPosts, distribution } = detail;
  const row = board.find((r) => r.accountId === account.id) ?? null;
  const directionLabel = row?.direction === "rising" ? "▲ rising" : row?.direction === "falling" ? "▼ falling" : "flat";

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <Link href="/leaderboard" className="text-sm text-subtle hover:text-muted">
          ← Back to leaderboard
        </Link>
        <RemoveInfluencerButton id={account.id} username={account.username} />
      </div>

      <Card className="mt-3 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar src={account.profilePicture} alt={account.username} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-fg">
                {account.displayName ?? account.username}
              </h1>
              {account.isBlueVerified && <Badge color="blue">Verified</Badge>}
              <Badge color={account.pollingTier === "active" ? "blue" : "slate"}>
                {account.pollingTier}
              </Badge>
              {account.status === "paused" && <Badge color="amber">paused</Badge>}
              {row?.lowConfidence && (
                <span title={row.lowConfidenceReasons.join("; ")}>
                  <Badge color="amber">⚠ low-confidence</Badge>
                </span>
              )}
            </div>
            <a
              href={`https://x.com/${account.username}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-subtle hover:underline"
            >
              @{account.username}
            </a>
            {account.description && (
              <p className="mt-2 max-w-2xl text-sm text-muted">{account.description}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {account.tags.map((t) => (
                <Badge key={t} color="purple">
                  {t}
                </Badge>
              ))}
            </div>
            <div className="mt-2 text-xs text-subtle">
              {row?.currentFollowers != null && (
                <>
                  <b className="text-muted">{formatFull(row.currentFollowers)}</b> followers ·{" "}
                </>
              )}
              {row?.following != null && <>{formatFull(row.following)} following · </>}
              Last polled {account.lastPolledAt ? relativeTime(account.lastPolledAt) : "never"}
              {!account.backfilledAt && " · backfill pending"}
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Perf. Score"
          value={row ? row.performanceScore : "—"}
          sub={row ? `Rank #${row.rank}` : undefined}
        />
        <StatCard
          label="Followers"
          value={formatNumber(row?.currentFollowers ?? null)}
          sub={row?.followerGrowth7d != null ? `${formatSignedPct(row.followerGrowth7dPct)} 7d` : "—"}
          tone={row && row.followerGrowth7d != null && row.followerGrowth7d > 0 ? "good" : "default"}
        />
        <StatCard
          label="Median views"
          value={formatNumber(row?.medianViews ?? 0)}
          sub={row ? `p25 ${formatNumber(row.p25Views)} · trailing 7d` : "trailing 7d"}
        />
        <StatCard label="ER (impr.)" value={formatPct(row?.erImpressions ?? 0)} sub="eng ÷ impressions" />
        <StatCard label="ER (foll.)" value={formatPct(row?.erFollowers ?? 0)} sub="eng ÷ followers" />
        <StatCard
          label="WoW views"
          value={row ? formatSignedPct(row.wowViewsPct) : "—"}
          sub={row ? directionLabel : "week over week"}
          tone={
            row?.direction === "rising" ? "good" : row?.direction === "falling" ? "bad" : "default"
          }
        />
      </div>

      <div className="mt-6">
        <InfluencerCharts
          followerSeries={followerSeries}
          reachSeries={reachSeries}
          distribution={distribution}
        />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">
            Recent posts <span className="text-subtle">· ranked by views</span>
          </h2>
        </div>
        <div className="scroll-thin overflow-x-auto">
          <table className="data w-full text-sm">
            <thead className="border-b border-line bg-surface-2">
              <tr>
                <th className="px-4 py-2 text-left">Post</th>
                <th className="px-4 py-2 text-left">Posted</th>
                <th className="px-4 py-2 text-right">Views</th>
                <th className="px-4 py-2 text-right">Likes</th>
                <th className="px-4 py-2 text-right">Reposts</th>
                <th className="px-4 py-2 text-right">Replies</th>
                <th className="px-4 py-2 text-right">Quotes</th>
                <th className="px-4 py-2 text-right">Bookmarks</th>
                <th className="px-4 py-2 text-right">ER</th>
              </tr>
            </thead>
            <tbody>
              {recentPosts.map((p) => (
                <tr key={p.id} className="border-b border-line-soft last:border-0 align-top">
                  <td className="max-w-md px-4 py-2">
                    <a
                      href={p.url ?? `https://x.com/${account.username}/status/${p.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="line-clamp-2 text-muted hover:underline"
                    >
                      {p.text || "(no text)"}
                    </a>
                    {p.isFrozen && (
                      <span className="ml-1 align-middle">
                        <Badge>frozen</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-subtle">{relativeTime(p.postedAt)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNumber(p.views)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNumber(p.likes)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNumber(p.retweets)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNumber(p.replies)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNumber(p.quotes)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNumber(p.bookmarks)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatPct(p.erImpressions)}</td>
                </tr>
              ))}
              {recentPosts.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-subtle">
                    No posts stored yet. Run a poll or backfill this account.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
