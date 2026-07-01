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
        <h2 className="text-sm font-semibold text-slate-900">Performance Score weights</h2>
        <p className="mt-1 text-xs text-slate-500">
          Reach = avg views/post. Engagement = engagements ÷ impressions. Both are normalized across
          the tracked set before blending. Follower growth is tracked but excluded from the score.
        </p>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium text-brand-700">Reach {reachPct}%</span>
            <span className="font-medium text-emerald-700">Engagement {100 - reachPct}%</span>
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
          <label className="text-sm text-slate-600">Normalization</label>
          <select
            value={normalization}
            onChange={(e) => setNorm(e.target.value)}
            className="ml-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="percentile">Percentile rank</option>
            <option value="zscore">Z-score</option>
          </select>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-900">Budget & plan cap</h2>
        <p className="mt-1 text-xs text-slate-500">
          The dashboard warns you when projected month-end spend exceeds this cap.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select
            value={isPreset ? planCap : "custom"}
            onChange={(e) => {
              if (e.target.value !== "custom") setPlanCap(Number(e.target.value));
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          >
            {PLAN_TIERS.map((t) => (
              <option key={t.name} value={t.credits}>
                {t.name} — {formatCredits(t.credits)} ({formatUsd(t.usd)}/mo)
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Cap (credits)
            <input
              type="number"
              value={planCap}
              min={1}
              onChange={(e) => setPlanCap(Number(e.target.value))}
              className="w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm tabular-nums"
            />
          </label>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-900">Adaptive polling & freezing</h2>
        <p className="mt-1 text-xs text-slate-500">
          These control your bill. Active accounts (posted within the window) poll often; dormant ones
          poll rarely. Posts older than the freeze age get one final snapshot, then stop costing credits.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField label="“Active” window (hours)" value={activeWindowHours} onChange={setAWH} hint="Posted within → active tier" />
          <NumberField label="Active poll interval (hours)" value={activePollHours} onChange={setAPH} />
          <NumberField label="Dormant poll interval (hours)" value={dormantPollHours} onChange={setDPH} />
          <NumberField label="Freeze posts older than (days)" value={freezeAgeDays} onChange={setFAD} hint="Stop re-polling stale posts" />
          <NumberField label="Backfill window (days)" value={backfillDays} onChange={setBFD} hint="History pulled on add" />
          <label className="flex items-end gap-2 pb-1 text-sm text-slate-600">
            <input type="checkbox" checked={includeReplies} onChange={(e) => setIncludeReplies(e.target.checked)} />
            Include replies in tracking
          </label>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-brand-500 px-5 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {msg && <span className="text-sm text-slate-500">{msg}</span>}
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
      <span className="text-sm text-slate-600">{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm tabular-nums"
      />
      {hint && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
