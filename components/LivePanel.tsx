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
import { formatNumber, formatFull, formatPct, relativeTime } from "@/lib/format";

/** Adaptive Y-axis label: when the visible range is narrow relative to the
 *  magnitude, compact labels all round to the same value (32K, 32K, 32K…) —
 *  switch to full numbers so the axis stays honest. */
function axisFormatter(values: number[]): (v: number) => string {
  if (values.length === 0) return (v) => formatNumber(v);
  const max = Math.max(...values);
  const min = Math.min(...values);
  return max - min < Math.max(1000, max * 0.02) ? (v) => formatFull(v) : (v) => formatNumber(v);
}

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

/** rAF ease-out tween towards a target number (for readouts that jump per refresh). */
function useAnimatedNumber(target: number | null): number | null {
  const [display, setDisplay] = useState<number | null>(target);
  const fromRef = useRef<number | null>(target);
  useEffect(() => {
    if (target == null) {
      setDisplay(null);
      fromRef.current = null;
      return;
    }
    const from = fromRef.current ?? target;
    if (from === target) {
      setDisplay(target);
      fromRef.current = target;
      return;
    }
    const start = performance.now();
    const dur = 700;
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      setDisplay(v);
      fromRef.current = v;
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return display;
}

/** The blip on the newest beat — radiating SMIL ring, no JS per frame. */
function PulseDot({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx == null || cy == null) return <g />;
  return (
    <g>
      <circle cx={cx} cy={cy} r={4} fill="#37C08A" stroke="#07080A" strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={4} fill="none" stroke="#37C08A" strokeWidth={1.5}>
        <animate attributeName="r" from="4" to="17" dur="1.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" from="0.8" to="0" dur="1.4s" repeatCount="indefinite" />
      </circle>
    </g>
  );
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
  const [reporting, setReporting] = useState(false);
  const [reports, setReports] = useState<{ id: string; headline: string }[]>([]);
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

  // Auto-refresh while live at the tracker's own cadence (floor 5s);
  // pause when the tab is hidden.
  const refreshMs = Math.max(5, tracker.intervalSec) * 1000;
  useEffect(() => {
    if (!live) return;
    timer.current = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, refreshMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [live, refresh, refreshMs]);

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

  // Existing recaps (owner only) — surfaced as a link when present.
  useEffect(() => {
    if (isPublic) return;
    fetch(`/api/live/${tracker.id}/report`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.reports && setReports(d.reports))
      .catch(() => null);
  }, [isPublic, tracker.id]);

  async function generateReport() {
    setReporting(true);
    setErr(null);
    try {
      const r = await fetch(`/api/live/${tracker.id}/report`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.reportId) throw new Error(d.error ?? "Report generation failed");
      router.push(`/live/${tracker.id}/report/${d.reportId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Report generation failed");
      setReporting(false);
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

  // Smooth the pace readout between real beats — no simulated counting.
  const animatedPulse = useAnimatedNumber(lastPulse?.viewsPerMin ?? null);

  // Honest axes for the cumulative charts (micro-ranges get full numbers).
  const viewsAxisFmt = useMemo(() => axisFormatter(series.map((p) => p.views)), [series]);
  const engAxisFmt = useMemo(() => axisFormatter(series.map((p) => p.engagements)), [series]);

  // The tab itself becomes a ticker while live.
  useEffect(() => {
    if (!live || viewsPace5 == null) return;
    const orig = document.title;
    document.title = `▲ ${formatNumber(Math.round(viewsPace5))}/min · ${tracker.label ?? "@" + tracker.post.author.username}`;
    return () => {
      document.title = orig;
    };
  }, [live, viewsPace5, tracker.label, tracker.post.author.username]);

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
            {refreshing ? "refreshing" : live ? `auto ${tracker.intervalSec}s` : "paused"}
          </span>
          {!isPublic && (
            <div className="flex overflow-hidden rounded-lg border border-line text-[11px]" title="How often the server fetches fresh metrics. Sub-minute cadences need the panel open — the fallback cron ticks once a minute.">
              {[
                { sec: 5, label: "5s" },
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
              <button
                onClick={generateReport}
                disabled={reporting}
                className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent-400 transition-colors hover:bg-accent-soft disabled:opacity-60"
                title="Analyse the window so far: pace inflections attributed per quote tweet, amplifier track records, and a written recap. On demand only."
              >
                {reporting ? "Analysing…" : "⚡ Generate report"}
              </button>
              {reports.length > 0 && (
                <Link
                  href={`/live/${tracker.id}/report/${reports[0].id}`}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2"
                  title={reports[0].headline}
                >
                  Reports ({reports.length})
                </Link>
              )}
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
              {formatNumber(Math.round(animatedPulse ?? lastPulse.viewsPerMin))}
              <span className="ml-1 text-xs font-normal text-subtle">/min now</span>
            </div>
          )}
        </div>
        {pulse.length < 2 ? (
          <EmptyChart />
        ) : (
          <div className="pulse-chart relative overflow-hidden rounded-lg bg-black/25">
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
                <ReferenceDot
                  x={lastPulse.t}
                  y={lastPulse.viewsPerMin}
                  shape={(p: { cx?: number; cy?: number }) => <PulseDot cx={p.cx} cy={p.cy} />}
                />
              )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
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
                <YAxis tickFormatter={viewsAxisFmt} width={70} tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => formatFull(v)} labelFormatter={hhmm} />
                <Area type="linear" dataKey="views" stroke="#7C6DF7" strokeWidth={2} fill="url(#liveViews)" isAnimationActive={false} />
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
                <YAxis tickFormatter={engAxisFmt} width={70} tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => formatFull(v)} labelFormatter={hhmm} />
                <Area type="linear" dataKey="engagements" stroke="#2AC8B5" strokeWidth={2} fill="url(#liveEng)" isAnimationActive={false} />
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
  fmt = (v: number) => formatNumber(Math.round(v)),
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
