"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import type { LiveTrackerSummary } from "@/lib/live";
import { Card, Badge, Avatar } from "./ui";
import { formatNumber, relativeTime } from "@/lib/format";

const CONTROL =
  "rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-subtle focus:border-accent focus:outline-none";

interface CampaignOpt {
  id: string;
  name: string;
}

export function LiveTrackersManager({
  trackers,
  campaigns,
}: {
  trackers: LiveTrackerSummary[];
  campaigns: CampaignOpt[];
}) {
  const router = useRouter();
  const [tweet, setTweet] = useState("");
  const [label, setLabel] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [maxHours, setMaxHours] = useState("24");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    if (!tweet.trim()) {
      setErr("Paste the launch post's URL or id.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tweet,
          label: label || null,
          campaignId: campaignId || null,
          maxDurationMin: maxHours ? Math.round(Number(maxHours) * 60) : null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not start the tracker");
      setTweet("");
      setLabel("");
      router.push(`/live/${d.trackerId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start the tracker");
      setBusy(false);
    }
  }

  const liveOnes = trackers.filter((t) => t.status === "live");
  const stopped = trackers.filter((t) => t.status !== "live");

  return (
    <div className="space-y-5">
      {/* Start form */}
      <Card className="relative overflow-hidden p-5">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-neg/50 via-neg/15 to-transparent" />
        <h2 className="text-sm font-semibold text-fg">Track a launch post</h2>
        <p className="mt-1 text-xs text-subtle">
          Paste the post the moment it goes live. Minute-by-minute snapshots, pace, and the
          quote-tweet amplification feed — auto-stops after the window below so credits stay capped.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block min-w-[260px] flex-1">
            <span className="text-xs text-subtle">Tweet URL or id</span>
            <input value={tweet} onChange={(e) => setTweet(e.target.value)} onKeyDown={(e) => e.key === "Enter" && start()} placeholder="https://x.com/founder/status/123…" className={clsx(CONTROL, "mt-1 block w-full")} />
          </label>
          <label className="block">
            <span className="text-xs text-subtle">Label (optional)</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Acme launch" className={clsx(CONTROL, "mt-1 block w-44")} />
          </label>
          <label className="block">
            <span className="text-xs text-subtle">Campaign (optional)</span>
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className={clsx(CONTROL, "mt-1 block")}>
              <option value="">— none —</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-subtle">Auto-stop after (h)</span>
            <input value={maxHours} onChange={(e) => setMaxHours(e.target.value)} type="number" min={1} max={168} className={clsx(CONTROL, "mt-1 block w-24 font-mono")} />
          </label>
          <button
            onClick={start}
            disabled={busy}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-600 disabled:opacity-60"
          >
            {busy ? "Starting…" : "▶ Go live"}
          </button>
        </div>
        {err && <p className="mt-2 text-sm text-neg">{err}</p>}
      </Card>

      {/* Live now */}
      {liveOnes.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-subtle">Live now</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {liveOnes.map((t) => (
              <TrackerCard key={t.id} t={t} />
            ))}
          </div>
        </div>
      )}

      {/* History */}
      {stopped.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-subtle">Past trackers</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {stopped.map((t) => (
              <TrackerCard key={t.id} t={t} />
            ))}
          </div>
        </div>
      )}

      {trackers.length === 0 && (
        <Card className="p-10 text-center text-sm text-subtle">
          No trackers yet. Paste a launch post above the moment it ships.
        </Card>
      )}
    </div>
  );
}

function TrackerCard({ t }: { t: LiveTrackerSummary }) {
  const live = t.status === "live";
  return (
    <Link href={`/live/${t.id}`}>
      <Card interactive className="p-4">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]",
              live ? "bg-neg-soft text-neg" : "bg-surface-2 text-subtle",
            )}
          >
            <span className={clsx("h-1.5 w-1.5 rounded-full", live ? "animate-pulse-soft bg-neg" : "bg-subtle")} />
            {live ? "Live" : "Stopped"}
          </span>
          <span className="truncate text-sm font-semibold text-fg">
            {t.label || `@${t.post.author.username}`}
          </span>
          {t.campaignName && <Badge color="purple">{t.campaignName}</Badge>}
          <span className="ml-auto text-xs text-subtle">{relativeTime(t.startedAt)}</span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-subtle">
          <Avatar src={t.post.author.profilePicture} alt={t.post.author.username} size={18} />
          <span className="line-clamp-1 text-muted">{t.post.text || `@${t.post.author.username}'s post`}</span>
        </div>
        <div className="mt-3 flex items-center gap-5 font-mono text-sm tabular-nums">
          <span className="text-fg">
            {formatNumber(t.latest?.views ?? null)} <span className="text-[10px] text-subtle">views</span>
          </span>
          <span className="text-fg">
            {formatNumber(t.latest?.engagements ?? null)} <span className="text-[10px] text-subtle">eng</span>
          </span>
          <span className="text-fg">
            {t.quoteCount} <span className="text-[10px] text-subtle">QTs</span>
          </span>
          <span className="text-money-400">
            {t.rosterQuoteCount} <span className="text-[10px] text-subtle">roster</span>
          </span>
        </div>
      </Card>
    </Link>
  );
}
