"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LivePayload, LiveSeriesPoint, LiveQuoteView } from "@/lib/live";
import { Card, Badge, Avatar } from "./ui";
import { TOOLTIP_STYLE } from "./InfluencerCharts";
import { formatNumber, formatPct, relativeTime } from "@/lib/format";

const REFRESH_MS = 30_000;

function hhmm(t: string): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function elapsed(fromIso: string, toIso?: string | null): string {
  const ms = (toIso ? new Date(toIso).getTime() : Date.now()) - new Date(fromIso).getTime();
  const m = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(m / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

/** Delta of a metric over the trailing `windowMin` minutes of the series. */
function windowDelta(series: LiveSeriesPoint[], key: keyof LiveSeriesPoint, windowMin: number): number | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const target = new Date(last.t).getTime() - windowMin * 60_000;
  let ref = series[0];
  for (const p of series) {
    if (new Date(p.t).getTime() <= target) ref = p;
    else break;
  }
  const spanMin = (new Date(last.t).getTime() - new Date(ref.t).getTime()) / 60_000;
  if (spanMin <= 0) return null;
  return (Number(last[key]) - Number(ref[key])) as number;
}

/** Per-minute pace over the trailing window. */
function pace(series: LiveSeriesPoint[], key: keyof LiveSeriesPoint, windowMin: number): number | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const target = new Date(last.t).getTime() - windowMin * 60_000;
  let ref = series[0];
  for (const p of series) {
    if (new Date(p.t).getTime() <= target) ref = p;
    else break;
  }
  const spanMin = (new Date(last.t).getTime() - new Date(ref.t).getTime()) / 60_000;
  if (spanMin <= 0) return null;
  return (Number(last[key]) - Number(ref[key])) / spanMin;
}

export function LivePanel({ initial, publicToken }: { initial: LivePayload; publicToken?: string }) {
  const router = useRouter();
  const isPublic = !!publicToken;
  const [data, setData] = useState<LivePayload>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { tracker, series, quotes, quoteTotals } = data;
  const live = tracker.status === "live";

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Public viewers READ the latest stored beats; only the owner's panel
      // (and the cron) trigger provider fetches.
      const r = isPublic
        ? await fetch(`/api/share/live/${publicToken}`)
        : await fetch(`/api/live/${tracker.id}/tick`, { method: "POST" });
      if (r.ok) {
        setData(await r.json());
        setErr(null);
      } else {
        const d = await r.json().catch(() => ({}));
        setErr(d.error ?? `Refresh failed (${r.status})`);
      }
    } catch {
      setErr("Refresh failed — network error.");
    } finally {
      setRefreshing(false);
    }
  }, [tracker.id, isPublic, publicToken]);

  // Auto-refresh while live; pause when the tab is hidden.
  useEffect(() => {
    if (!live) return;
    const start = () => {
      if (!timer.current) timer.current = setInterval(() => {
        if (document.visibilityState === "visible") void refresh();
      }, REFRESH_MS);
    };
    start();
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [live, refresh]);

  async function setStatus(status: "live" | "stopped") {
    setBusy(true);
    try {
      await fetch(`/api/live/${tracker.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await refresh();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setInterval_(intervalSec: number) {
    setBusy(true);
    try {
      await fetch(`/api/live/${tracker.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intervalSec }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this tracker? Collected snapshots on the post are kept.")) return;
    setBusy(true);
    try {
      await fetch(`/api/live/${tracker.id}`, { method: "DELETE" });
      router.push("/live");
    } finally {
      setBusy(false);
    }
  }

  async function copyShareLink(token: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/share/live/${token}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr("Could not copy — copy it from the address bar of the share page instead.");
    }
  }

  async function createShareLink() {
    setBusy(true);
    try {
      const r = await fetch(`/api/live/${tracker.id}/share`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.shareToken) {
        setData((prev) => ({ ...prev, tracker: { ...prev.tracker, shareToken: d.shareToken } }));
        await copyShareLink(d.shareToken);
      } else {
        setErr(d.error ?? "Could not create the share link.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function revokeShareLink() {
    if (!confirm("Revoke the public link? Anyone holding it loses access immediately.")) return;
    setBusy(true);
    try {
      await fetch(`/api/live/${tracker.id}/share`, { method: "DELETE" });
      setData((prev) => ({ ...prev, tracker: { ...prev.tracker, shareToken: null } }));
    } finally {
      setBusy(false);
    }
  }

  const latest = tracker.latest ?? (series.length ? series[series.length - 1] : null);

  // Pulse series — the heartbeat. Per-tick deltas NORMALISED to a per-minute
  // rate, so 30s panel ticks and 60s cron ticks read on the same scale.
  const pulse = useMemo(() => {
    const out: { t: string; viewsPerMin: number; engPerMin: number }[] = [];
    for (let i = 1; i < series.length; i++) {
      const dtMin = (new Date(series[i].t).getTime() - new Date(series[i - 1].t).getTime()) / 60_000;
      if (dtMin <= 0) continue;
      out.push({
        t: series[i].t,
        viewsPerMin: Math.max(0, Math.round((series[i].views - series[i - 1].views) / dtMin)),
        engPerMin: Math.max(0, Math.round(((series[i].engagements - series[i - 1].engagements) / dtMin) * 10) / 10),
      });
    }
    return out.slice(-180);
  }, [series]);
  const lastPulse = pulse.length ? pulse[pulse.length - 1] : null;

  const viewsPace5 = pace(series, "views", 5);
  const viewsPace15 = pace(series, "views", 15);
  const engPace5 = pace(series, "engagements", 5);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {isPublic ? (
            <div className="flex items-center gap-2 text-sm text-subtle">
              <span className="grid h-5 w-5 place-items-center rounded-md bg-gradient-to-br from-accent to-accent-700 text-[10px] font-bold text-white">
                V
              </span>
              virality.studio · live share
            </div>
          ) : (
            <Link href="/live" className="text-sm text-subtle hover:text-muted">
              ← All live trackers
            </Link>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <span
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em]",
                live ? "bg-neg-soft text-neg" : "bg-surface-2 text-subtle",
              )}
            >
              <span className={clsx("h-1.5 w-1.5 rounded-full", live ? "animate-pulse-soft bg-neg" : "bg-subtle")} />
              {live ? "Live" : "Stopped"}
            </span>
            <h1 className="text-xl font-semibold tracking-[-0.015em] text-fg">
              {tracker.label || `@${tracker.post.author.username} launch post`}
            </h1>
            {tracker.campaignName && <Badge color="purple">{tracker.campaignName}</Badge>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-subtle">
            <Avatar src={tracker.post.author.profilePicture} alt={tracker.post.author.username} size={18} />
            <span className="text-muted">@{tracker.post.author.username}</span>
            <span>· posted {relativeTime(tracker.post.postedAt)}</span>
            <span>· tracking for {elapsed(tracker.startedAt, tracker.stoppedAt)}</span>
            <span>· every {tracker.intervalSec}s</span>
            <a
              href={tracker.post.url ?? `https://x.com/${tracker.post.author.username}/status/${tracker.post.id}`}
              target="_blank"
              rel="noreferrer"
              className="text-accent-400 hover:underline"
            >
              open on X →
            </a>
          </div>
          {tracker.post.text && (
            <p className="mt-2 line-clamp-2 max-w-2xl text-sm text-muted">{tracker.post.text}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-subtle" title="Panel refresh cadence">
            <span className={clsx("h-1.5 w-1.5 rounded-full", refreshing ? "animate-pulse-soft bg-accent" : "bg-line")} />
            {refreshing ? "refreshing" : live ? "auto 30s" : "paused"}
          </span>
          {!isPublic && (
            <div className="flex overflow-hidden rounded-lg border border-line text-[11px]" title="How often the server fetches fresh metrics. 30s needs the panel open — the fallback cron ticks once a minute.">
              {[
                { sec: 30, label: "30s" },
                { sec: 60, label: "60s" },
                { sec: 120, label: "2m" },
              ].map((o) => (
                <button
                  key={o.sec}
                  onClick={() => setInterval_(o.sec)}
                  disabled={busy || !live}
                  className={clsx(
                    "px-2.5 py-1.5 transition-colors disabled:opacity-50",
                    tracker.intervalSec === o.sec ? "bg-pos-soft font-semibold text-pos" : "bg-surface text-muted hover:text-fg",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => refresh()}
            disabled={refreshing}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Refresh now
          </button>
          {!isPublic && (
            <>
              {tracker.shareToken ? (
                <>
                  <button
                    onClick={() => copyShareLink(tracker.shareToken!)}
                    className="rounded-lg border border-money/40 bg-money-soft px-3 py-1.5 text-sm font-medium text-money-400 transition-colors hover:bg-money-soft"
                    title="Public read-only link — no login needed, can't spend credits"
                  >
                    {copied ? "✓ Copied" : "Copy share link"}
                  </button>
                  <button
                    onClick={revokeShareLink}
                    disabled={busy}
                    className="rounded-lg border border-line px-3 py-1.5 text-sm text-subtle hover:text-neg"
                    title="Anyone holding the link loses access immediately"
                  >
                    Revoke
                  </button>
                </>
              ) : (
                <button
                  onClick={createShareLink}
                  disabled={busy}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2"
                  title="Create a public read-only link — no login needed, can't spend credits"
                >
                  Share
                </button>
              )}
              {live ? (
                <button
                  onClick={() => setStatus("stopped")}
                  disabled={busy}
                  className="rounded-lg border border-neg/40 px-3 py-1.5 text-sm text-neg hover:bg-neg-soft"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => setStatus("live")}
                  disabled={busy}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-600"
                >
                  Resume
                </button>
              )}
              <button onClick={remove} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-sm text-subtle hover:text-neg">
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {err && <p className="text-sm text-neg">{err}</p>}

      {/* Ticker */}
      <Card className="overflow-x-auto p-0">
        <div className="flex min-w-[900px] items-stretch">
          <Tick label="Views" value={latest?.views} delta={windowDelta(series, "views", 5)} big />
          <Tick label="Engagements" value={latest?.engagements} delta={windowDelta(series, "engagements", 5)} big />
          <Tick label="Likes" value={latest?.likes} delta={windowDelta(series, "likes", 5)} />
          <Tick label="Reposts" value={latest?.retweets} delta={windowDelta(series, "retweets", 5)} />
          <Tick label="Replies" value={latest?.replies} delta={windowDelta(series, "replies", 5)} />
          <Tick label="Quotes" value={latest?.quotes} delta={windowDelta(series, "quotes", 5)} />
          <Tick label="Bookmarks" value={latest?.bookmarks} delta={windowDelta(series, "bookmarks", 5)} />
          <Tick
            label="ER"
            value={latest && latest.views > 0 ? latest.engagements / latest.views : null}
            fmt={(v) => formatPct(v)}
          />
        </div>
      </Card>

      {/* Pace strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        <PaceCard label="Views / min" v5={viewsPace5} v15={viewsPace15} />
        <PaceCard label="Engagements / min" v5={engPace5} v15={pace(series, "engagements", 15)} />
        <Card className="relative overflow-hidden p-4">
          <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-money/60 via-money/20 to-transparent" />
          <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-subtle">Amplification</div>
          <div className="mt-1 font-mono text-2xl font-medium tabular-nums text-fg">
            {quoteTotals.count} <span className="text-sm text-subtle">QTs</span>
          </div>
          <div className="mt-1 text-xs text-subtle">
            <b className="text-money-400">{quoteTotals.rosterCount} roster</b> ·{" "}
            {formatNumber(quoteTotals.totalViews)} combined QT views
          </div>
        </Card>
      </div>

      {/* Pulse — the heartbeat monitor (hero) */}
      <Card className="relative overflow-hidden p-4">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-pos/60 via-pos/20 to-transparent" />
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-medium text-subtle">
            <span className={clsx("h-1.5 w-1.5 rounded-full bg-pos", live && "animate-pulse-soft")} />
            Pulse — views per minute
            <span className="text-subtle/70">· teal line = engagements/min</span>
          </div>
          {lastPulse && (
            <div className="font-mono text-lg font-semibold tabular-nums text-pos">
              {formatNumber(lastPulse.viewsPerMin)}
              <span className="ml-1 text-xs font-normal text-subtle">/min now</span>
            </div>
          )}
        </div>
        {pulse.length < 2 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={pulse}>
              <defs>
                <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#37C08A" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#37C08A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1A1D24" />
              <XAxis dataKey="t" tickFormatter={hhmm} minTickGap={48} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => formatNumber(v)} width={48} tick={{ fontSize: 11 }} />
              <Tooltip
                {...TOOLTIP_STYLE}
                formatter={(v: number, name: string) => [
                  formatNumber(v) + "/min",
                  name === "viewsPerMin" ? "views" : "engagements",
                ]}
                labelFormatter={hhmm}
              />
              {/* Sharp linear segments — ECG, not a smoothed curve. */}
              <Area
                type="linear"
                dataKey="viewsPerMin"
                stroke="#37C08A"
                strokeWidth={2}
                fill="url(#pulseFill)"
                isAnimationActive={false}
                dot={false}
              />
              <Line
                type="linear"
                dataKey="engPerMin"
                stroke="#2AC8B5"
                strokeWidth={1.2}
                strokeOpacity={0.75}
                dot={false}
                isAnimationActive={false}
              />
              {lastPulse && (
                <>
                  <ReferenceDot x={lastPulse.t} y={lastPulse.viewsPerMin} r={7} fill="rgba(55,192,138,0.25)" stroke="none" />
                  <ReferenceDot x={lastPulse.t} y={lastPulse.viewsPerMin} r={3.5} fill="#37C08A" stroke="#07080A" strokeWidth={1.5} />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Cumulative charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 text-xs font-medium text-subtle">Views since tracking started</div>
          {series.length < 2 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="liveViews" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7C6DF7" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#7C6DF7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#23272F" />
                <XAxis dataKey="t" tickFormatter={hhmm} minTickGap={40} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => formatNumber(v)} width={48} tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => formatNumber(v)} labelFormatter={hhmm} />
                <Area type="monotone" dataKey="views" stroke="#7C6DF7" strokeWidth={2} fill="url(#liveViews)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-2 text-xs font-medium text-subtle">Engagements since tracking started</div>
          {series.length < 2 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="liveEng" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2AC8B5" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#2AC8B5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#23272F" />
                <XAxis dataKey="t" tickFormatter={hhmm} minTickGap={40} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => formatNumber(v)} width={48} tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => formatNumber(v)} labelFormatter={hhmm} />
                <Area type="monotone" dataKey="engagements" stroke="#2AC8B5" strokeWidth={2} fill="url(#liveEng)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Quote feed */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">
            Quote-tweet feed{" "}
            <span className="font-normal text-subtle">· newest first · roster creators highlighted</span>
          </h2>
          <span className="text-xs text-subtle">
            checked every ~4 min · {quoteTotals.count} found
          </span>
        </div>
        {quotes.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-subtle">
            No quote tweets discovered yet. They appear here as the roster starts amplifying.
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {quotes.slice(0, 60).map((q) => (
              <QuoteRow key={q.tweetId} q={q} external={isPublic} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Tick({
  label,
  value,
  delta,
  big = false,
  fmt = (v: number) => formatNumber(v),
}: {
  label: string;
  value: number | null | undefined;
  delta?: number | null;
  big?: boolean;
  fmt?: (v: number) => string;
}) {
  return (
    <div className="flex flex-1 flex-col gap-0.5 border-l border-line-soft px-4 py-3 first:border-l-0">
      <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-subtle">{label}</span>
      <span className={clsx("font-mono font-medium tabular-nums text-fg", big ? "text-2xl" : "text-lg")}>
        {value != null ? fmt(value) : "—"}
      </span>
      {delta != null && delta !== 0 && (
        <span className={clsx("font-mono text-[11px] tabular-nums", delta > 0 ? "text-pos" : "text-neg")}>
          {delta > 0 ? "+" : ""}
          {formatNumber(delta)} <span className="text-subtle">5m</span>
        </span>
      )}
    </div>
  );
}

function PaceCard({ label, v5, v15 }: { label: string; v5: number | null; v15: number | null }) {
  return (
    <Card className="relative overflow-hidden p-4">
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-accent/60 via-accent/20 to-transparent" />
      <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-subtle">{label}</div>
      <div className="mt-1 font-mono text-2xl font-medium tabular-nums text-fg">
        {v5 != null ? formatNumber(Math.round(v5)) : "—"}
        <span className="ml-1 text-sm text-subtle">/min</span>
      </div>
      <div className="mt-1 text-xs text-subtle">
        trailing 5m · {v15 != null ? `${formatNumber(Math.round(v15))}/min over 15m` : "15m pending"}
      </div>
    </Card>
  );
}

function QuoteRow({ q, external = false }: { q: LiveQuoteView; external?: boolean }) {
  return (
    <li className={clsx("flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2", q.isRoster && "bg-money-soft")}>
      <Avatar src={null} alt={q.authorUsername} size={26} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          {external ? (
            // Public share view — internal pages are login-gated, so link to X.
            <a href={`https://x.com/${q.authorUsername}`} target="_blank" rel="noreferrer" className="font-medium text-fg hover:underline">
              @{q.authorUsername}
            </a>
          ) : (
            <Link href={`/influencer/${q.authorUsername}`} className="font-medium text-fg hover:underline">
              @{q.authorUsername}
            </Link>
          )}
          {q.isRoster && <Badge color="teal">roster</Badge>}
          <span className="text-xs text-subtle">· {relativeTime(q.postedAt)}</span>
        </div>
        <a href={q.url ?? undefined} target="_blank" rel="noreferrer" className="line-clamp-1 text-xs text-muted hover:underline">
          {q.text || "(no text)"}
        </a>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm font-semibold tabular-nums text-fg">{formatNumber(q.views)}</div>
        <div className="text-[10.5px] text-subtle">{formatNumber(q.engagements)} eng</div>
      </div>
    </li>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[230px] items-center justify-center text-center text-xs text-subtle">
      Charts build within the first couple of minutes of tracking.
    </div>
  );
}
