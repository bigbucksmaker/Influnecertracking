"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import type { LeaderboardRow } from "@/lib/scoring";
import { Avatar, Badge } from "./ui";
import { formatNumber, formatFull, formatPct, formatSignedPct, relativeTime } from "@/lib/format";

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
    title: "Performance Score (0–100): blend of normalized reach + engagement rate",
    sortVal: (r) => r.performanceScore,
    render: (r) => <span className="font-semibold text-slate-900">{r.performanceScore}</span>,
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
    key: "views",
    label: "Avg views/post",
    numeric: true,
    title: "Reach — average views per post over the trailing 7 days",
    sortVal: (r) => r.avgViews,
    render: (r) => formatNumber(r.avgViews),
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
    key: "wow",
    label: "WoW views",
    numeric: true,
    title: "Week-over-week change in average views/post",
    sortVal: (r) => r.wowViewsPct,
    render: (r) => (
      <span className="flex items-center justify-end gap-1">
        {r.rising && <Badge color="green">▲</Badge>}
        <Signed pct={r.wowViewsPct} />
      </span>
    ),
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
    render: (r) => <span className="text-slate-500">{r.lastPolledAt ? relativeTime(r.lastPolledAt) : "never"}</span>,
  },
];

export function LeaderboardTable({
  rows,
  allTags,
}: {
  rows: LeaderboardRow[];
  allTags: string[];
}) {
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [tier, setTier] = useState("");
  const [risingOnly, setRisingOnly] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (needle && !r.username.includes(needle) && !(r.displayName ?? "").toLowerCase().includes(needle))
        return false;
      if (tag && !r.tags.includes(tag)) return false;
      if (tier && r.pollingTier !== tier) return false;
      if (risingOnly && !r.rising) return false;
      return true;
    });
    const col = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[1];
    out = [...out].sort((a, b) => cmp(col.sortVal(a), col.sortVal(b), sortDir));
    return out;
  }, [rows, q, tag, tier, risingOnly, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "rank" ? "asc" : "desc");
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search handle or name…"
          className="w-56 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
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
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All tiers</option>
          <option value="active">Active</option>
          <option value="dormant">Dormant</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={risingOnly} onChange={(e) => setRisingOnly(e.target.checked)} />
          Rising only
        </label>
        <span className="ml-auto text-xs text-slate-500">{filtered.length} shown</span>
        <button
          onClick={() => downloadCsv(filtered)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          Export CSV
        </button>
      </div>

      <div className="scroll-thin overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="data w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2">Account</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  title={c.title}
                  className={clsx(
                    "cursor-pointer px-3 py-2 hover:text-slate-700",
                    c.numeric ? "text-right" : "text-left",
                  )}
                >
                  {c.label}
                  {sortKey === c.key && <span className="ml-1 text-slate-400">{sortDir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.accountId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="sticky left-0 z-10 bg-white px-3 py-2">
                  <Link href={`/influencer/${r.username}`} className="flex items-center gap-2">
                    <Avatar src={r.profilePicture} alt={r.username} size={28} />
                    <span className="min-w-0">
                      <span className="block max-w-[180px] truncate font-medium text-slate-900">
                        {r.displayName ?? r.username}
                      </span>
                      <span className="block truncate text-xs text-slate-500">@{r.username}</span>
                    </span>
                  </Link>
                </td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className={clsx("px-3 py-2", c.numeric ? "text-right tabular-nums" : "text-left")}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-3 py-10 text-center text-slate-500">
                  No accounts match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Delta({ abs, pct }: { abs: number | null; pct: number | null }) {
  if (abs == null) return <span className="text-slate-400">—</span>;
  const tone = abs > 0 ? "text-emerald-600" : abs < 0 ? "text-red-600" : "text-slate-500";
  return (
    <span className={tone}>
      {abs > 0 ? "+" : ""}
      {formatNumber(abs)}
      {pct != null && <span className="ml-1 text-xs opacity-70">({formatSignedPct(pct)})</span>}
    </span>
  );
}

function Signed({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-slate-400">—</span>;
  return <span className={pct > 0 ? "text-emerald-600" : pct < 0 ? "text-red-600" : "text-slate-500"}>{formatSignedPct(pct)}</span>;
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
    "rank", "username", "displayName", "performanceScore", "followers",
    "followerGrowth7d", "followerGrowth7dPct", "followerGrowth30d",
    "avgViews", "erImpressions", "erFollowers", "postCount7d", "wowViewsPct",
    "rising", "tags", "pollingTier", "lastPolledAt",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.rank, r.username, r.displayName ?? "", r.performanceScore, r.currentFollowers ?? "",
        r.followerGrowth7d ?? "", r.followerGrowth7dPct ?? "", r.followerGrowth30d ?? "",
        Math.round(r.avgViews), r.erImpressions, r.erFollowers, r.postCount7d, r.wowViewsPct ?? "",
        r.rising, r.tags.join("|"), r.pollingTier, r.lastPolledAt ?? "",
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
