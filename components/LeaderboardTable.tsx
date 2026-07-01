"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import type { LeaderboardRow } from "@/lib/scoring";
import { Avatar, Badge, Sparkline } from "./ui";
import { RatesEditor, type Rates } from "./RatesEditor";
import { AddToShortlist } from "./AddToShortlist";
import { formatNumber, formatPct, formatSignedPct, relativeTime } from "@/lib/format";

type SortDir = "asc" | "desc";

interface Column {
  key: string;
  label: string;
  numeric?: boolean;
  sortVal: (r: LeaderboardRow) => number | string | null;
  render: (r: LeaderboardRow) => React.ReactNode;
  title?: string;
}

const COLUMNS: Column[] = [
  { key: "rank", label: "#", numeric: true, sortVal: (r) => r.rank, render: (r) => r.rank },
  {
    key: "score",
    label: "Score",
    numeric: true,
    title: "Performance Score (0–100): blend of normalized MEDIAN reach + engagement rate",
    sortVal: (r) => r.performanceScore,
    render: (r) => (
      <span className="inline-flex items-center gap-1">
        <span className="font-semibold text-fg">{r.performanceScore}</span>
        {r.lowConfidence && (
          <span title={"Low confidence: " + r.lowConfidenceReasons.join("; ")}>
            <Badge color="amber">⚠</Badge>
          </span>
        )}
      </span>
    ),
  },
  {
    key: "followers",
    label: "Followers",
    numeric: true,
    sortVal: (r) => r.currentFollowers,
    render: (r) => formatNumber(r.currentFollowers),
  },
  {
    key: "fg7",
    label: "Follower Δ 7d",
    numeric: true,
    sortVal: (r) => r.followerGrowth7d,
    render: (r) => <Delta abs={r.followerGrowth7d} pct={r.followerGrowth7dPct} />,
  },
  {
    key: "fg30",
    label: "Follower Δ 30d",
    numeric: true,
    sortVal: (r) => r.followerGrowth30d,
    render: (r) => <Delta abs={r.followerGrowth30d} pct={r.followerGrowth30dPct} />,
  },
  {
    key: "median",
    label: "Median views",
    numeric: true,
    title:
      "Reach — MEDIAN views/post over the trailing 7 days (robust to viral spikes). Sub-value: p25 floor.",
    sortVal: (r) => r.medianViews,
    render: (r) => (
      <div className="leading-tight">
        <div>{formatNumber(r.medianViews)}</div>
        <div className="text-[10px] text-subtle" title="25th-percentile views/post (floor)">
          p25 {formatNumber(r.p25Views)}
        </div>
      </div>
    ),
  },
  {
    key: "consistency",
    label: "Steadiness",
    title: "IQR ÷ median — lower is steadier. Steady < 0.5 · Spiky ≥ 1.0",
    sortVal: (r) => r.consistency,
    render: (r) => <Steadiness c={r.consistency} />,
  },
  {
    key: "erImp",
    label: "ER (impr.)",
    numeric: true,
    title: "Engagements ÷ impressions (7d)",
    sortVal: (r) => r.erImpressions,
    render: (r) => formatPct(r.erImpressions),
  },
  {
    key: "erFol",
    label: "ER (foll.)",
    numeric: true,
    title: "Avg engagements per post ÷ followers",
    sortVal: (r) => r.erFollowers,
    render: (r) => formatPct(r.erFollowers),
  },
  {
    key: "posts7",
    label: "Posts 7d",
    numeric: true,
    sortVal: (r) => r.postCount7d,
    render: (r) => r.postCount7d,
  },
  {
    key: "qtRate",
    label: "QT Rate",
    numeric: true,
    title: "Quote-tweet campaign rate (USD) — reference only, never used in scoring",
    sortVal: (r) => r.rateQuoteTweet,
    render: (r) => (r.rateQuoteTweet != null ? `$${r.rateQuoteTweet}` : "—"),
  },
  {
    key: "wow",
    label: "WoW views",
    numeric: true,
    title: "Week-over-week change in average views/post",
    sortVal: (r) => r.wowViewsPct,
    render: (r) => (
      <span className="flex items-center justify-end gap-1">
        {r.rising && (
          <span title="Rising ≥ threshold WoW">
            <Badge color="green">▲</Badge>
          </span>
        )}
        {r.falling && (
          <span title="Falling ≥ threshold WoW">
            <Badge color="red">▼</Badge>
          </span>
        )}
        <Signed pct={r.wowViewsPct} />
      </span>
    ),
  },
  {
    key: "trend",
    label: "4wk trend",
    title: "Weekly-median views/post over the last 4 weeks",
    sortVal: (r) => r.viewsSparkline[r.viewsSparkline.length - 1] ?? null,
    render: (r) => <Sparkline values={r.viewsSparkline} />,
  },
  {
    key: "tier",
    label: "Tier",
    sortVal: (r) => r.pollingTier,
    render: (r) => (
      <Badge color={r.pollingTier === "active" ? "blue" : "slate"}>{r.pollingTier}</Badge>
    ),
  },
  {
    key: "polled",
    label: "Last poll",
    sortVal: (r) => r.lastPolledAt,
    render: (r) => <span className="text-subtle">{r.lastPolledAt ? relativeTime(r.lastPolledAt) : "never"}</span>,
  },
];

interface InitialFilters {
  direction?: string;
  tier?: string;
  rising?: boolean;
  q?: string;
  tag?: string;
}

export function LeaderboardTable({
  rows: initialRows,
  allTags,
  initialFilters,
}: {
  rows: LeaderboardRow[];
  allTags: string[];
  initialFilters?: InitialFilters;
}) {
  const [rows, setRows] = useState(initialRows);
  useEffect(() => setRows(initialRows), [initialRows]);
  const [editing, setEditing] = useState<LeaderboardRow | null>(null);
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [q, setQ] = useState(initialFilters?.q ?? "");
  const [tag, setTag] = useState(initialFilters?.tag ?? "");
  const [tier, setTier] = useState(initialFilters?.tier ?? "");
  const [direction, setDirection] = useState(initialFilters?.direction ?? "");
  const [risingOnly, setRisingOnly] = useState(initialFilters?.rising ?? false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (needle && !r.username.includes(needle) && !(r.displayName ?? "").toLowerCase().includes(needle))
        return false;
      if (tag && !r.tags.includes(tag)) return false;
      if (tier && r.pollingTier !== tier) return false;
      if (direction && r.direction !== direction) return false;
      if (risingOnly && !r.rising) return false;
      return true;
    });
    const col = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[1];
    out = [...out].sort((a, b) => cmp(col.sortVal(a), col.sortVal(b), sortDir));
    return out;
  }, [rows, q, tag, tier, direction, risingOnly, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "rank" ? "asc" : "desc");
    }
  }

  async function saveRates(accountId: string, r: Rates) {
    await fetch(`/api/accounts/${accountId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(r),
    });
    setRows((prev) => prev.map((row) => (row.accountId === accountId ? { ...row, ...r } : row)));
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search handle or name…"
          className="w-56 rounded-lg border border-line px-3 py-1.5 text-sm"
        />
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="rounded-lg border border-line px-3 py-1.5 text-sm"
        >
          <option value="">All niches</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className="rounded-lg border border-line px-3 py-1.5 text-sm"
        >
          <option value="">All tiers</option>
          <option value="active">Active</option>
          <option value="dormant">Dormant</option>
        </select>
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          className="rounded-lg border border-line px-3 py-1.5 text-sm"
          title="Filter by week-over-week direction"
        >
          <option value="">All directions</option>
          <option value="rising">Rising ▲</option>
          <option value="falling">Falling ▼</option>
          <option value="flat">Flat</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" checked={risingOnly} onChange={(e) => setRisingOnly(e.target.checked)} />
          Rising only
        </label>
        <span className="ml-auto text-xs text-subtle">{filtered.length} shown</span>
        <button
          onClick={() => downloadCsv(filtered)}
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
        >
          Export CSV
        </button>
      </div>

      <div className="scroll-thin overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="data w-full text-sm">
          <thead className="border-b border-line bg-surface-2">
            <tr>
              <th className="sticky left-0 z-10 bg-surface-2 px-3 py-2">Account</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  title={c.title}
                  className={clsx(
                    "cursor-pointer px-3 py-2 hover:text-muted",
                    c.numeric ? "text-right" : "text-left",
                  )}
                >
                  {c.label}
                  {sortKey === c.key && <span className="ml-1 text-subtle">{sortDir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Edit</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.accountId}
                className={clsx(
                  "border-b border-line-soft last:border-0 hover:bg-surface-2",
                  r.lowConfidence && "opacity-55",
                )}
              >
                <td className="sticky left-0 z-10 bg-surface px-3 py-2">
                  <Link href={`/influencer/${r.username}`} className="flex items-center gap-2">
                    <Avatar src={r.profilePicture} alt={r.username} size={28} />
                    <span className="min-w-0">
                      <span className="block max-w-[180px] truncate font-medium text-fg">
                        {r.displayName ?? r.username}
                      </span>
                      <span className="flex items-center gap-1 truncate text-xs text-subtle">
                        @{r.username}
                        {r.lowConfidence && (
                          <span title={"Low confidence: " + r.lowConfidenceReasons.join("; ")}>
                            <Badge color="amber">low-confidence</Badge>
                          </span>
                        )}
                      </span>
                    </span>
                  </Link>
                </td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className={clsx("px-3 py-2", c.numeric ? "text-right tabular-nums" : "text-left")}>
                    {c.render(r)}
                  </td>
                ))}
                <td className="px-3 py-2 text-right">
                  <span className="inline-flex items-center gap-2">
                    <AddToShortlist username={r.username} />
                    <button
                      onClick={() => setEditing(r)}
                      className="text-xs text-accent-400 hover:underline"
                      title="Edit rates"
                    >
                      ✎ rates
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 2} className="px-3 py-10 text-center text-subtle">
                  No accounts match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <RatesEditor
          username={editing.username}
          initial={{
            rateQuoteTweet: editing.rateQuoteTweet,
            ratePost: editing.ratePost,
            rateRetweet: editing.rateRetweet,
            rateThread: editing.rateThread,
          }}
          onSave={(r) => saveRates(editing.accountId, r)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function Delta({ abs, pct }: { abs: number | null; pct: number | null }) {
  if (abs == null) return <span className="text-subtle">—</span>;
  const tone = abs > 0 ? "text-pos" : abs < 0 ? "text-neg" : "text-subtle";
  return (
    <span className={tone}>
      {abs > 0 ? "+" : ""}
      {formatNumber(abs)}
      {pct != null && <span className="ml-1 text-xs opacity-70">({formatSignedPct(pct)})</span>}
    </span>
  );
}

function Signed({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-subtle">—</span>;
  return <span className={pct > 0 ? "text-pos" : pct < 0 ? "text-neg" : "text-subtle"}>{formatSignedPct(pct)}</span>;
}

function Steadiness({ c }: { c: number | null }) {
  if (c == null) return <span className="text-subtle">—</span>;
  if (c < 0.5) return <span title={`IQR/median = ${c.toFixed(2)}`}><Badge color="green">steady</Badge></span>;
  if (c < 1.0) return <span title={`IQR/median = ${c.toFixed(2)}`}><Badge color="slate">normal</Badge></span>;
  return <span title={`IQR/median = ${c.toFixed(2)}`}><Badge color="amber">spiky</Badge></span>;
}

function cmp(a: number | string | null, b: number | string | null, dir: SortDir): number {
  const nullRank = (v: number | string | null) => (v == null ? 1 : 0);
  if (nullRank(a) !== nullRank(b)) return nullRank(a) - nullRank(b); // nulls always last
  let res = 0;
  if (typeof a === "number" && typeof b === "number") res = a - b;
  else res = String(a).localeCompare(String(b));
  return dir === "asc" ? res : -res;
}

function downloadCsv(rows: LeaderboardRow[]) {
  const headers = [
    "rank", "username", "displayName", "performanceScore", "lowConfidence", "followers",
    "rateQuoteTweet", "ratePost", "rateRetweet", "rateThread",
    "followerGrowth7d", "followerGrowth7dPct", "followerGrowth30d",
    "medianViews", "p25Views", "avgViews", "consistency", "erImpressions", "erFollowers",
    "postsInWindow", "wowViewsPct", "direction", "tags", "pollingTier", "lastPolledAt",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.rank, r.username, r.displayName ?? "", r.performanceScore, r.lowConfidence, r.currentFollowers ?? "",
        r.rateQuoteTweet ?? "", r.ratePost ?? "", r.rateRetweet ?? "", r.rateThread ?? "",
        r.followerGrowth7d ?? "", r.followerGrowth7dPct ?? "", r.followerGrowth30d ?? "",
        Math.round(r.medianViews), Math.round(r.p25Views), Math.round(r.avgViews),
        r.consistency ?? "", r.erImpressions, r.erFollowers,
        r.postsInWindow, r.wowViewsPct ?? "", r.direction, r.tags.join("|"), r.pollingTier, r.lastPolledAt ?? "",
      ].map(esc).join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leaderboard-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
