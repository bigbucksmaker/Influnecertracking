"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AppSettings } from "@prisma/client";
import { PLAN_TIERS } from "@/lib/cost";
import { Card } from "./ui";
import { formatCredits, formatUsd } from "@/lib/format";

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const router = useRouter();
  const wSum = settings.reachWeight + settings.engagementWeight || 1;
  const [reachPct, setReachPct] = useState(Math.round((settings.reachWeight / wSum) * 100));
  const [planCap, setPlanCap] = useState(settings.planCapCredits);
  const [activeWindowHours, setAWH] = useState(settings.activeWindowHours);
  const [activePollHours, setAPH] = useState(settings.activePollHours);
  const [dormantPollHours, setDPH] = useState(settings.dormantPollHours);
  const [freezeAgeDays, setFAD] = useState(settings.freezeAgeDays);
  const [backfillDays, setBFD] = useState(settings.backfillDays);
  const [normalization, setNorm] = useState(settings.normalization);
  const [includeReplies, setIncludeReplies] = useState(settings.includeReplies);
  const [minPostsForConfidence, setMinPosts] = useState(settings.minPostsForConfidence);
  const [stalePollHours, setStalePoll] = useState(settings.stalePollHours);
  const [fallingPct, setFallingPct] = useState(Math.round(settings.fallingThreshold * 100));
  const [commissionedFreezeDays, setCFD] = useState(settings.commissionedFreezeDays);
  const [underdeliverPct, setUnderdeliverPct] = useState(Math.round(settings.underdeliverThreshold * 100));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const isPreset = PLAN_TIERS.some((t) => t.credits === planCap);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reachWeight: reachPct / 100,
          engagementWeight: (100 - reachPct) / 100,
          planCapCredits: planCap,
          activeWindowHours,
          activePollHours,
          dormantPollHours,
          freezeAgeDays,
          backfillDays,
          normalization,
          includeReplies,
          minPostsForConfidence,
          stalePollHours,
          fallingThreshold: fallingPct / 100,
          commissionedFreezeDays,
          underdeliverThreshold: underdeliverPct / 100,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMsg("Settings saved.");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-fg">Performance Score weights</h2>
        <p className="mt-1 text-xs text-subtle">
          Reach = avg views/post. Engagement = engagements ÷ impressions. Both are normalized across
          the tracked set before blending. Follower growth is tracked but excluded from the score.
        </p>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium text-accent-400">Reach {reachPct}%</span>
            <span className="font-medium text-pos">Engagement {100 - reachPct}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={reachPct}
            onChange={(e) => setReachPct(Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div className="mt-3">
          <label className="text-sm text-muted">Normalization</label>
          <select
            value={normalization}
            onChange={(e) => setNorm(e.target.value)}
            className="ml-2 rounded-lg border border-line px-3 py-1.5 text-sm"
          >
            <option value="percentile">Percentile rank</option>
            <option value="zscore">Z-score</option>
          </select>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-fg">Budget & plan cap</h2>
        <p className="mt-1 text-xs text-subtle">
          The dashboard warns you when projected month-end spend exceeds this cap.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select
            value={isPreset ? planCap : "custom"}
            onChange={(e) => {
              if (e.target.value !== "custom") setPlanCap(Number(e.target.value));
            }}
            className="rounded-lg border border-line px-3 py-1.5 text-sm"
          >
            {PLAN_TIERS.map((t) => (
              <option key={t.name} value={t.credits}>
                {t.name} — {formatCredits(t.credits)} ({formatUsd(t.usd)}/mo)
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-muted">
            Cap (credits)
            <input
              type="number"
              value={planCap}
              min={1}
              onChange={(e) => setPlanCap(Number(e.target.value))}
              className="w-40 rounded-lg border border-line px-3 py-1.5 text-sm tabular-nums"
            />
          </label>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-fg">Adaptive polling & freezing</h2>
        <p className="mt-1 text-xs text-subtle">
          These control your bill. Active accounts (posted within the window) poll often; dormant ones
          poll rarely. Posts older than the freeze age get one final snapshot, then stop costing credits.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField label="“Active” window (hours)" value={activeWindowHours} onChange={setAWH} hint="Posted within → active tier" />
          <NumberField label="Active poll interval (hours)" value={activePollHours} onChange={setAPH} />
          <NumberField label="Dormant poll interval (hours)" value={dormantPollHours} onChange={setDPH} />
          <NumberField label="Freeze posts older than (days)" value={freezeAgeDays} onChange={setFAD} hint="Stop re-polling stale posts" />
          <NumberField label="Backfill window (days)" value={backfillDays} onChange={setBFD} hint="History pulled on add" />
          <label className="flex items-end gap-2 pb-1 text-sm text-muted">
            <input type="checkbox" checked={includeReplies} onChange={(e) => setIncludeReplies(e.target.checked)} />
            Include replies in tracking
          </label>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-fg">Confidence & movers</h2>
        <p className="mt-1 text-xs text-subtle">
          Scores built on thin or stale data are flagged <b>low-confidence</b> (dimmed on the
          leaderboard) rather than hidden. Falling threshold mirrors the +25% rising rule for
          week-over-week declines.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label="Min posts for confidence"
            value={minPostsForConfidence}
            onChange={setMinPosts}
            hint="Fewer authored posts in 7d → low confidence"
          />
          <NumberField
            label="Stale poll threshold (hours)"
            value={stalePollHours}
            onChange={setStalePoll}
            hint="Last poll older than this → low confidence"
          />
          <NumberField
            label="Falling threshold (%)"
            value={fallingPct}
            onChange={setFallingPct}
            hint="WoW drop ≥ this flags a “falling” account"
          />
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-fg">Commissioned posts</h2>
        <p className="mt-1 text-xs text-subtle">
          Commissioned posts in an active campaign keep updating for longer than normal posts, and are
          flagged when they underdeliver against the creator&apos;s organic median. Prices are stored
          for reference only and never enter a metric.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label="Commissioned freeze (days)"
            value={commissionedFreezeDays}
            onChange={setCFD}
            hint="Extended tracking window for paid posts"
          />
          <NumberField
            label="Underdeliver threshold (%)"
            value={underdeliverPct}
            onChange={setUnderdeliverPct}
            hint="Delivery below this % of baseline = underdelivered"
          />
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {msg && <span className="text-sm text-subtle">{msg}</span>}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm text-muted">{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-line px-3 py-1.5 text-sm tabular-nums"
      />
      {hint && <span className="mt-0.5 block text-xs text-subtle">{hint}</span>}
    </label>
  );
}
