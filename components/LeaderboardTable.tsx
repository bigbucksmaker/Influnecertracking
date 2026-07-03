"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import type { LeaderboardRow } from "@/lib/scoring";
import { Avatar, Badge, Sparkline, ScoreRing } from "./ui";
import { RatesEditor, type Rates } from "./RatesEditor";
import { AddToShortlist } from "./AddToShortlist";
import { formatNumber, formatPct, formatSignedPct, relativeTime } from "@/lib/format";

type SortDir = "asc" | "desc";

interface Column {
  key: string;
  label: string;
  group: string;
  numeric?: boolean;
  defaultHidden?: boolean;
  sortVal: (r: LeaderboardRow) => number | string | null;
  render: (r: LeaderboardRow) => React.ReactNode;
  title?: string;
}

// Order matters: columns are contiguous within their group for the grouped header.
const COLUMNS: Column[] = [
  { key: "rank", label: "#", group: "Rank", numeric: true, sortVal: (r) => r.rank, render: (r) => r.rank },
  {
    key: "score",
    label: "Score",
    group: "Rank",
    numeric: true,
    title: "Performance Score (0–100): blend of normalized MEDIAN reach + engagement rate",
    sortVal: (r) => r.performanceScore,
    render: (r) => (
      <span className="inline-flex items-center justify-end gap-1.5">
        <span className="font-semibold text-fg">{r.performanceScore}</span>
        {r.lowConfidence && (
          <span
            className="h-1.5 w-1.5 rounded-full bg-warn"
            title={"Low confidence: " + r.lowConfidenceReasons.join("; ")}
          />
        )}
      </span>
    ),
  },
  {
    key: "median",
    label: "Median views",
    group: "Reach",
    numeric: true,
    title: "Reach — MEDIAN views/post over the trailing 7 days (robust to viral spikes). Sub-value: p25 floor.",
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
    group: "Reach",
    title: "IQR ÷ median — lower is steadier. Steady < 0.5 · Spiky ≥ 1.0",
    sortVal: (r) => r.consistency,
    render: (r) => <Steadiness c={r.consistency} />,
  },
  {
    key: "erImp",
    label: "ER (impr.)",
    group: "Engagement",
    numeric: true,
    title: "Engagements ÷ impressions (7d)",
    sortVal: (r) => r.erImpressions,
    render: (r) => formatPct(r.erImpressions),
  },
  {
    key: "erFol",
    label: "ER (foll.)",
    group: "Engagement",
    numeric: true,
    defaultHidden: true,
    title: "Avg engagements per post ÷ followers",
    sortVal: (r) => r.erFollowers,
    render: (r) => formatPct(r.erFollowers),
  },
  {
    key: "followers",
    label: "Followers",
    group: "Audience",
    numeric: true,
    sortVal: (r) => r.currentFollowers,
    render: (r) => formatNumber(r.currentFollowers),
  },
  {
    key: "fg7",
    label: "Δ 7d",
    group: "Audience",
    numeric: true,
    defaultHidden: true,
    title: "Follower growth, last 7 days",
    sortVal: (r) => r.followerGrowth7d,
    render: (r) => <Delta abs={r.followerGrowth7d} pct={r.followerGrowth7dPct} />,
  },
  {
    key: "fg30",
    label: "Δ 30d",
    group: "Audience",
    numeric: true,
    defaultHidden: true,
    title: "Follower growth, last 30 days",
    sortVal: (r) => r.followerGrowth30d,
    render: (r) => <Delta abs={r.followerGrowth30d} pct={r.followerGrowth30dPct} />,
  },
  {
    key: "posts7",
    label: "Posts 7d",
    group: "Momentum",
    numeric: true,
    sortVal: (r) => r.postCount7d,
    render: (r) => r.postCount7d,
  },
  {
    key: "wow",
    label: "WoW",
    group: "Momentum",
    numeric: true,
    title: "Week-over-week change in average views/post",
    sortVal: (r) => r.wowViewsPct,
    render: (r) => (
      <span className="flex items-center justify-end gap-1">
        {r.rising && <span className="text-pos" title="Rising ≥ threshold WoW">▲</span>}
        {r.falling && <span className="text-neg" title="Falling ≥ threshold WoW">▼</span>}
        <Signed pct={r.wowViewsPct} />
      </span>
    ),
  },
  {
    key: "trend",
    label: "4wk",
    group: "Momentum",
    title: "Weekly-median views/post over the last 4 weeks",
    sortVal: (r) => r.viewsSparkline[r.viewsSparkline.length - 1] ?? null,
    render: (r) => <Sparkline values={r.viewsSparkline} />,
  },
  {
    key: "qtRate",
    label: "QT Rate",
    group: "Economics",
    numeric: true,
    title: "Quote-tweet campaign rate (USD). Feeds the value layer; never the Performance Score.",
    sortVal: (r) => r.rateQuoteTweet,
    render: (r) => (r.rateQuoteTweet != null ? `$${r.rateQuoteTweet}` : <span className="text-subtle">—</span>),
  },
  {
    key: "postRate",
    label: "Post Rate",
    group: "Economics",
    numeric: true,
    defaultHidden: true,
    title: "Post campaign rate (USD)",
    sortVal: (r) => r.ratePost,
    render: (r) => (r.ratePost != null ? `$${r.ratePost}` : <span className="text-subtle">—</span>),
  },
  {
    key: "cpm",
    label: "Est. CPM",
    group: "Economics",
    numeric: true,
    title: "Implied $ per 1K views: basis rate ÷ median organic views × 1,000. Arrow = vs niche peers.",
    sortVal: (r) => basisCpm(r),
    render: (r) => <CpmCell r={r} />,
  },
  {
    key: "value",
    label: "Value",
    group: "Economics",
    numeric: true,
    title: "Value Score (0–100): percentile blend of views/$ and engagement/$ across priced creators",
    sortVal: (r) => r.valueScore,
    render: (r) =>
      r.valueScore == null ? (
        <span className="text-subtle">—</span>
      ) : (
        <span className="inline-flex items-center justify-end gap-1.5">
          <ScoreRing
            score={r.valueScore}
            size={30}
            kind="value"
            dim={r.lowConfidence}
            title={`Value rank #${r.valueRank}${r.valueBasis === "post" ? " (post-rate basis)" : ""}`}
          />
        </span>
      ),
  },
  {
    key: "pricePos",
    label: "Pricing",
    group: "Economics",
    defaultHidden: true,
    title: "Implied CPM vs niche peers: ≤0.70× underpriced · ≥1.40× overpriced",
    sortVal: (r) => r.priceVsPeersPct,
    render: (r) => <PricePosition r={r} />,
  },
  {
    key: "tier",
    label: "Tier",
    group: "Status",
    sortVal: (r) => r.pollingTier,
    render: (r) => <Badge color={r.pollingTier === "active" ? "blue" : "slate"}>{r.pollingTier}</Badge>,
  },
  {
    key: "polled",
    label: "Last poll",
    group: "Status",
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
  preset?: string;
}

const CONTROL =
  "rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-subtle focus:border-accent focus:outline-none";

/** The CPM the value layer computed on (QT, falling back to post). */
function basisCpm(r: LeaderboardRow): number | null {
  return r.valueBasis === "qt" ? r.cpmQuote : r.valueBasis === "post" ? r.cpmPost : null;
}

const PRESETS: { key: string; label: string; money?: boolean }[] = [
  { key: "performance", label: "Top performance" },
  { key: "value", label: "Best value", money: true },
  { key: "rising", label: "Rising" },
  { key: "falling", label: "Falling" },
];

export function LeaderboardTable({
  rows: initialRows,
  allTags,
  initialFilters,
}: {
  rows: LeaderboardRow[];
  allTags: string[];
  initialFilters?: InitialFilters;
}) {
  const initialPreset = initialFilters?.preset || "performance";
  const [rows, setRows] = useState(initialRows);
  useEffect(() => setRows(initialRows), [initialRows]);
  const [editing, setEditing] = useState<LeaderboardRow | null>(null);
  const [preset, setPreset] = useState(initialPreset);
  const [sortKey, setSortKey] = useState(initialPreset === "value" ? "value" : "score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [q, setQ] = useState(initialFilters?.q ?? "");
  const [tag, setTag] = useState(initialFilters?.tag ?? "");
  const [tier, setTier] = useState(initialFilters?.tier ?? "");
  const [direction, setDirection] = useState(
    initialFilters?.direction || (initialPreset === "rising" ? "rising" : initialPreset === "falling" ? "falling" : ""),
  );
  const [risingOnly, setRisingOnly] = useState(initialFilters?.rising ?? false);
  const [pricedOnly, setPricedOnly] = useState(initialPreset === "value");
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(COLUMNS.filter((c) => c.defaultHidden).map((c) => c.key)),
  );
  const [showCols, setShowCols] = useState(false);

  function applyPreset(key: string) {
    setPreset(key);
    if (key === "value") {
      setSortKey("value");
      setSortDir("desc");
      setPricedOnly(true);
      setDirection("");
    } else if (key === "rising" || key === "falling") {
      setSortKey("wow");
      setSortDir(key === "rising" ? "desc" : "asc");
      setDirection(key);
      setPricedOnly(false);
    } else {
      setSortKey("score");
      setSortDir("desc");
      setDirection("");
      setPricedOnly(false);
    }
  }

  const visibleColumns = useMemo(() => COLUMNS.filter((c) => !hidden.has(c.key)), [hidden]);
  const groupStarts = useMemo(() => {
    const s = new Set<string>();
    let prev = "";
    for (const c of visibleColumns) {
      if (c.group !== prev) s.add(c.key);
      prev = c.group;
    }
    return s;
  }, [visibleColumns]);
  const groupSpans = useMemo(() => {
    const out: { label: string; span: number }[] = [];
    for (const c of visibleColumns) {
      const last = out[out.length - 1];
      if (last && last.label === c.group) last.span++;
      else out.push({ label: c.group, span: 1 });
    }
    return out;
  }, [visibleColumns]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (needle && !r.username.includes(needle) && !(r.displayName ?? "").toLowerCase().includes(needle))
        return false;
      if (tag && !r.tags.includes(tag)) return false;
      if (tier && r.pollingTier !== tier) return false;
      if (direction && r.direction !== direction) return false;
      if (risingOnly && !r.rising) return false;
      if (pricedOnly && r.basisRate == null) return false;
      return true;
    });
    const col = COLUMNS.find((c) => c.key === sortKey) ?? COLUMNS[1];
    out = [...out].sort((a, b) => cmp(col.sortVal(a), col.sortVal(b), sortDir));
    return out;
  }, [rows, q, tag, tier, direction, risingOnly, pricedOnly, sortKey, sortDir]);

  const anyFilter = q || tag || tier || direction || risingOnly || pricedOnly;
  function resetFilters() {
    setQ("");
    setTag("");
    setTier("");
    setDirection("");
    setRisingOnly(false);
    setPricedOnly(false);
    setPreset("performance");
  }

  function toggleSort(key: string) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "rank" ? "asc" : "desc");
    }
  }

  function toggleCol(key: string) {
    setHidden((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
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
      {/* Presets */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => {
          const active = preset === p.key;
          return (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              className={clsx(
                "rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-all",
                active
                  ? p.money
                    ? "border-money/50 bg-money-soft text-money-400 shadow-glow-money"
                    : "border-accent/50 bg-accent-soft text-accent-400 shadow-glow-accent"
                  : "border-line bg-surface text-muted hover:border-line hover:text-fg",
              )}
            >
              {p.label}
            </button>
          );
        })}
        <label className="ml-2 flex items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" checked={pricedOnly} onChange={(e) => setPricedOnly(e.target.checked)} className="accent-accent" />
          Priced only
        </label>
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search handle or name…" className={clsx(CONTROL, "w-56")} />
        <select value={tag} onChange={(e) => setTag(e.target.value)} className={CONTROL}>
          <option value="">All niches</option>
          {allTags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select value={tier} onChange={(e) => setTier(e.target.value)} className={CONTROL}>
          <option value="">All tiers</option>
          <option value="active">Active</option>
          <option value="dormant">Dormant</option>
        </select>
        <select value={direction} onChange={(e) => setDirection(e.target.value)} className={CONTROL} title="Filter by week-over-week direction">
          <option value="">All directions</option>
          <option value="rising">Rising ▲</option>
          <option value="falling">Falling ▼</option>
          <option value="flat">Flat</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input type="checkbox" checked={risingOnly} onChange={(e) => setRisingOnly(e.target.checked)} className="accent-accent" />
          Rising only
        </label>
        {anyFilter && (
          <button onClick={resetFilters} className="text-xs text-subtle hover:text-fg">
            Reset
          </button>
        )}

        <span className="ml-auto text-xs text-subtle">{filtered.length} shown</span>

        {/* Column visibility */}
        <div className="relative">
          <button
            onClick={() => setShowCols((s) => !s)}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
          >
            Columns ▾
          </button>
          {showCols && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowCols(false)} />
              <div className="absolute right-0 z-40 mt-1 w-52 rounded-lg border border-line bg-surface p-1.5 shadow-pop">
                {COLUMNS.filter((c) => c.key !== "rank" && c.key !== "score").map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-2">
                    <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleCol(c.key)} className="accent-accent" />
                    <span className="text-fg">{c.label}</span>
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-subtle">{c.group}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          onClick={() => downloadCsv(filtered)}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
        >
          Export CSV
        </button>
      </div>

      {/* Table — bounded scroll region so both the header (top) and identity column (left) stay pinned. */}
      <div className="scroll-thin max-h-[72vh] overflow-auto rounded-xl border border-line bg-surface">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            {/* group row */}
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 top-0 z-30 border-b border-r border-line bg-surface-2 px-3 py-2 text-left align-bottom text-[10px] font-medium uppercase tracking-wide text-subtle"
              >
                Account
              </th>
              {groupSpans.map((g, i) => (
                <th
                  key={`${g.label}-${i}`}
                  colSpan={g.span}
                  className="sticky top-0 z-20 h-8 border-b border-l border-line-soft bg-surface-2 px-3 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-subtle"
                >
                  {g.label}
                </th>
              ))}
              <th rowSpan={2} className="sticky top-0 z-20 border-b border-line bg-surface-2 px-3 py-2 text-right align-bottom text-[10px] font-medium uppercase tracking-wide text-subtle">
                Actions
              </th>
            </tr>
            {/* label row */}
            <tr>
              {visibleColumns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  title={c.title}
                  className={clsx(
                    "sticky top-8 z-20 cursor-pointer border-b border-line bg-surface-2 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-subtle transition-colors hover:text-fg",
                    c.numeric ? "text-right" : "text-left",
                    groupStarts.has(c.key) && "border-l border-line-soft",
                  )}
                >
                  {c.label}
                  {sortKey === c.key && <span className="ml-1 text-accent-400">{sortDir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.accountId} className={clsx("group hover:bg-surface-2", r.lowConfidence && "opacity-60")}>
                <td className="sticky left-0 z-10 border-b border-r border-line-soft bg-surface px-3 py-2 group-hover:bg-surface-2">
                  <Link href={`/influencer/${r.username}`} className="flex items-center gap-2.5">
                    <Avatar src={r.profilePicture} alt={r.username} size={28} />
                    <span className="min-w-0">
                      <span className="block max-w-[170px] truncate font-medium text-fg">{r.displayName ?? r.username}</span>
                      <span className="flex items-center gap-1 truncate text-xs text-subtle">
                        @{r.username}
                        {r.lowConfidence && (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn"
                            title={"Low confidence: " + r.lowConfidenceReasons.join("; ")}
                          />
                        )}
                      </span>
                    </span>
                  </Link>
                </td>
                {visibleColumns.map((c) => (
                  <td
                    key={c.key}
                    className={clsx(
                      "border-b border-line-soft px-3 py-2",
                      c.numeric ? "text-right font-mono tabular-nums" : "text-left",
                      groupStarts.has(c.key) && "border-l border-line-soft",
                    )}
                  >
                    {c.render(r)}
                  </td>
                ))}
                <td className="border-b border-line-soft px-3 py-2 text-right">
                  <span className="inline-flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <AddToShortlist username={r.username} />
                    <button onClick={() => setEditing(r)} className="text-xs text-accent-400 hover:underline" title="Edit rates">
                      ✎ rates
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 2} className="px-3 py-10 text-center text-subtle">
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

function CpmCell({ r }: { r: LeaderboardRow }) {
  const cpm = basisCpm(r);
  if (cpm == null) return <span className="text-subtle">—</span>;
  const arrow =
    r.pricePosition === "underpriced" ? (
      <span className="text-money-400" title={`${Math.abs(Math.round((r.priceVsPeersPct ?? 0) * 100))}% cheaper than ${r.peerGroup === "niche" ? "niche peers" : "the tracked set"}`}>
        ↓
      </span>
    ) : r.pricePosition === "overpriced" ? (
      <span className="text-neg" title={`${Math.round((r.priceVsPeersPct ?? 0) * 100)}% dearer than ${r.peerGroup === "niche" ? "niche peers" : "the tracked set"}`}>
        ↑
      </span>
    ) : null;
  return (
    <span className={clsx("inline-flex items-center justify-end gap-1", r.valueBasis === "post" && "opacity-80")}>
      {arrow}
      <span title={r.valueBasis === "post" ? "Post-rate basis (no QT rate set)" : "QT-rate basis"}>${cpm}</span>
    </span>
  );
}

function PricePosition({ r }: { r: LeaderboardRow }) {
  if (r.pricePosition == null) return <span className="text-subtle">—</span>;
  const pct = r.priceVsPeersPct != null ? `${r.priceVsPeersPct > 0 ? "+" : ""}${Math.round(r.priceVsPeersPct * 100)}%` : "";
  const title = `Implied CPM vs ${r.peerGroup === "niche" ? "niche peers" : "all priced creators"} (${r.peerCount ?? 0})`;
  if (r.pricePosition === "underpriced")
    return <span title={title}><Badge color="teal">under {pct}</Badge></span>;
  if (r.pricePosition === "overpriced")
    return <span title={title}><Badge color="red">over {pct}</Badge></span>;
  return <span title={title}><Badge color="slate">fair {pct}</Badge></span>;
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
    "impliedCpm", "valueBasis", "valueScore", "valueRank", "pricePosition", "priceVsPeersPct", "costPerKEng",
    "followerGrowth7d", "followerGrowth7dPct", "followerGrowth30d",
    "medianViews", "p25Views", "avgViews", "medianEngagements", "consistency", "erImpressions", "erFollowers",
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
        basisCpm(r) ?? "", r.valueBasis ?? "", r.valueScore ?? "", r.valueRank ?? "",
        r.pricePosition ?? "", r.priceVsPeersPct ?? "", r.costPerKEng ?? "",
        r.followerGrowth7d ?? "", r.followerGrowth7dPct ?? "", r.followerGrowth30d ?? "",
        Math.round(r.medianViews), Math.round(r.p25Views), Math.round(r.avgViews), Math.round(r.medianEng),
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
