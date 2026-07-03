"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import type { PlanResult, PlanFormat } from "@/lib/planner";
import { Card, StatCard, Badge, Avatar, ScoreRing } from "./ui";
import { formatNumber, formatPct, formatUsd } from "@/lib/format";

const CONTROL =
  "rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-subtle focus:border-money focus:outline-none";

const FORMATS: { key: PlanFormat; label: string }[] = [
  { key: "qt", label: "Quote tweet" },
  { key: "post", label: "Post" },
  { key: "thread", label: "Thread" },
];

interface CampaignOpt {
  id: string;
  name: string;
}

export function BudgetPlanner({ allTags, campaigns }: { allTags: string[]; campaigns: CampaignOpt[] }) {
  const router = useRouter();
  const [budget, setBudget] = useState("2000");
  const [format, setFormat] = useState<PlanFormat>("qt");
  const [niche, setNiche] = useState("");
  const [minViews, setMinViews] = useState("");
  const [maxCreators, setMaxCreators] = useState("");
  const [includeLowConf, setIncludeLowConf] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);

  // Save-as-shortlist state
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveCampaign, setSaveCampaign] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  async function run() {
    const budgetUsd = Number(budget);
    if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
      setErr("Enter a budget in USD.");
      return;
    }
    setBusy(true);
    setErr(null);
    setSavedId(null);
    try {
      const r = await fetch("/api/planner", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          budgetUsd,
          format,
          niche: niche || null,
          includeLowConfidence: includeLowConf,
          minMedianViews: minViews ? Number(minViews) : null,
          maxCreators: maxCreators ? Number(maxCreators) : null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Planner failed");
      setPlan(d.plan);
      setSaveName(`${niche || "Roster"} · $${budgetUsd} ${format.toUpperCase()} plan`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Planner failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveAsShortlist() {
    if (!plan || !saveName.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/shortlists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: saveName,
          campaignId: saveCampaign || null,
          items: plan.picks.map((p) => ({
            account: p.username,
            note: `planner: $${p.rate} ${plan.input.format.toUpperCase()} · ~${formatNumber(p.medianViews)} views`,
          })),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not save shortlist");
      setSavedId(d.shortlist?.id ?? "ok");
      setSaveOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save shortlist");
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    if (!plan) return;
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ["username", "displayName", "rate", "expectedViews", "expectedEngagements", "viewsPerDollar", "cpm", "valueScore", "erImpressions", "niches"].join(","),
      ...plan.picks.map((p) =>
        [p.username, p.displayName ?? "", p.rate, p.medianViews, p.medianEng, p.viewsPerDollar, p.cpm, p.valueScore ?? "", p.erImpressions, p.tags.join("|")]
          .map(esc)
          .join(","),
      ),
      "",
      `total,,${plan.totalCost},${plan.expectedViews},${plan.expectedEngagements},,${plan.blendedCpm ?? ""},,,`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `plan-${plan.input.format}-${plan.input.budgetUsd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const excludedTotal = plan
    ? plan.excluded.noRate + plan.excluded.lowConfidence + plan.excluded.noRecentPosts + plan.excluded.belowMinViews
    : 0;

  return (
    <div className="space-y-5">
      {/* Controls */}
      <Card className="relative overflow-hidden p-5">
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-money/60 via-money/20 to-transparent" />
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs text-subtle">Budget (USD)</span>
            <input value={budget} onChange={(e) => setBudget(e.target.value)} type="number" min={1} className={clsx(CONTROL, "mt-1 block w-32 font-mono")} />
          </label>
          <div className="block">
            <span className="text-xs text-subtle">Format</span>
            <div className="mt-1 flex overflow-hidden rounded-lg border border-line">
              {FORMATS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFormat(f.key)}
                  className={clsx(
                    "px-3 py-1.5 text-sm transition-colors",
                    format === f.key ? "bg-money-soft font-medium text-money-400" : "bg-surface text-muted hover:text-fg",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-xs text-subtle">Niche</span>
            <select value={niche} onChange={(e) => setNiche(e.target.value)} className={clsx(CONTROL, "mt-1 block")}>
              <option value="">All niches</option>
              {allTags.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-subtle">Min median views</span>
            <input value={minViews} onChange={(e) => setMinViews(e.target.value)} type="number" min={0} placeholder="—" className={clsx(CONTROL, "mt-1 block w-32 font-mono")} />
          </label>
          <label className="block">
            <span className="text-xs text-subtle">Max creators</span>
            <input value={maxCreators} onChange={(e) => setMaxCreators(e.target.value)} type="number" min={1} placeholder="—" className={clsx(CONTROL, "mt-1 block w-28 font-mono")} />
          </label>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm text-muted">
            <input type="checkbox" checked={includeLowConf} onChange={(e) => setIncludeLowConf(e.target.checked)} className="accent-accent" />
            Include low-confidence
          </label>
          <button
            onClick={run}
            disabled={busy}
            className="rounded-lg bg-money-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-money disabled:opacity-60"
          >
            {busy ? "Allocating…" : "Build plan"}
          </button>
        </div>
        <p className="mt-3 text-xs text-subtle">
          Greedy allocation on <b className="text-muted">views per dollar</b> (median organic views ÷ rate), one slot per
          creator. Expected views = each creator&apos;s trailing-7d median — an estimate, before any paid-post uplift or decay.
        </p>
        {err && <p className="mt-2 text-sm text-neg">{err}</p>}
      </Card>

      {/* Result */}
      {plan && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 animate-fade-up">
            <StatCard label="Slate" value={plan.picks.length} sub={`of ${plan.consideredCount} candidates`} />
            <StatCard label="Total cost" value={formatUsd(plan.totalCost)} sub={`${formatUsd(plan.leftover)} left over`} accent="money" />
            <StatCard label="Expected views" value={formatNumber(plan.expectedViews)} sub="Σ median organic views" accent="money" />
            <StatCard label="Blended CPM" value={plan.blendedCpm != null ? `$${plan.blendedCpm}` : "—"} sub="cost ÷ expected views × 1K" accent="money" />
            <StatCard label="Expected eng." value={formatNumber(plan.expectedEngagements)} sub="Σ median engagements" />
          </div>

          <Card className="overflow-hidden animate-fade-up">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
              <h2 className="text-sm font-semibold text-fg">
                Proposed slate{" "}
                <span className="font-normal text-subtle">
                  · {plan.input.niche ?? "all niches"} · {plan.input.format.toUpperCase()} · {formatUsd(plan.input.budgetUsd)}
                </span>
              </h2>
              <div className="flex items-center gap-2">
                <button onClick={exportCsv} className="rounded-lg border border-line px-3 py-1 text-sm text-muted transition-colors hover:bg-surface-2">
                  Export CSV
                </button>
                <button
                  onClick={() => setSaveOpen(true)}
                  disabled={plan.picks.length === 0}
                  className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-accent-600 disabled:opacity-60"
                >
                  Save as shortlist
                </button>
              </div>
            </div>

            {savedId && (
              <p className="border-b border-line-soft bg-pos-soft px-5 py-2 text-sm text-pos">
                Saved.{" "}
                <Link href="/shortlists" className="underline">
                  View shortlists →
                </Link>
              </p>
            )}

            <div className="scroll-thin overflow-x-auto">
              <table className="data w-full text-sm">
                <thead className="border-b border-line bg-surface-2">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Creator</th>
                    <th className="px-3 py-2 text-right">Rate</th>
                    <th className="px-3 py-2 text-right">Expected views</th>
                    <th className="px-3 py-2 text-right" title="Median organic views per dollar">Views / $</th>
                    <th className="px-3 py-2 text-right">Est. CPM</th>
                    <th className="px-3 py-2 text-right">ER</th>
                    <th className="px-3 py-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.picks.map((p, i) => (
                    <tr key={p.accountId} className="border-b border-line-soft last:border-0 transition-colors hover:bg-surface-2">
                      <td className="px-3 py-2 text-subtle">{i + 1}</td>
                      <td className="px-3 py-2">
                        <Link href={`/influencer/${p.username}`} className="flex items-center gap-2">
                          <Avatar src={p.profilePicture} alt={p.username} size={24} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-fg">
                              {p.displayName ?? p.username}
                              {p.lowConfidence && (
                                <span className="ml-1.5 align-middle"><Badge color="amber">low-conf</Badge></span>
                              )}
                            </span>
                            <span className="block truncate text-xs text-subtle">@{p.username}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-fg">${p.rate}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{formatNumber(p.medianViews)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-money-400">{p.viewsPerDollar}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">${p.cpm}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{formatPct(p.erImpressions)}</td>
                      <td className="px-3 py-2 text-right">
                        <ScoreRing score={p.valueScore} size={28} kind="value" dim={p.lowConfidence} />
                      </td>
                    </tr>
                  ))}
                  {plan.picks.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-10 text-center text-subtle">
                        Nothing fits this budget with the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {excludedTotal > 0 && (
              <p className="border-t border-line-soft px-5 py-2.5 text-xs text-subtle">
                Excluded: {plan.excluded.noRate} without a {plan.input.format.toUpperCase()} rate ·{" "}
                {plan.excluded.lowConfidence} low-confidence · {plan.excluded.noRecentPosts} without recent posts
                {plan.excluded.belowMinViews > 0 && <> · {plan.excluded.belowMinViews} below the view floor</>}
                {plan.excluded.offNiche > 0 && <> · {plan.excluded.offNiche} outside the niche</>}
              </p>
            )}
          </Card>
        </>
      )}

      {/* Save dialog */}
      {saveOpen && plan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setSaveOpen(false)}>
          <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-fg">Save plan as shortlist</h3>
            <p className="mt-0.5 text-xs text-subtle">{plan.picks.length} creators · {formatUsd(plan.totalCost)}</p>
            <label className="mt-3 block">
              <span className="text-xs text-subtle">Shortlist name</span>
              <input value={saveName} onChange={(e) => setSaveName(e.target.value)} className={clsx(CONTROL, "mt-1 block w-full")} />
            </label>
            <label className="mt-3 block">
              <span className="text-xs text-subtle">Link to campaign (optional)</span>
              <select value={saveCampaign} onChange={(e) => setSaveCampaign(e.target.value)} className={clsx(CONTROL, "mt-1 block w-full")}>
                <option value="">— none —</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setSaveOpen(false)} className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-2">
                Cancel
              </button>
              <button
                onClick={saveAsShortlist}
                disabled={saving || !saveName.trim()}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save shortlist"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
