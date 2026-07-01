"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "./ui";

interface NicheRow {
  name: string;
  description: string;
}

export function NicheManager({ hasKey }: { hasKey: boolean }) {
  const router = useRouter();
  const [niches, setNiches] = useState<NicheRow[]>([]);
  const [proposing, setProposing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function suggest() {
    setProposing(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await fetch("/api/niches/propose", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed to suggest niches");
      setNiches(d.niches ?? []);
      if (!(d.niches ?? []).length) setMsg("No niches returned — backfill more posts and retry.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to suggest niches");
    } finally {
      setProposing(false);
    }
  }

  const update = (i: number, field: keyof NicheRow, val: string) =>
    setNiches((prev) => prev.map((n, idx) => (idx === i ? { ...n, [field]: val } : n)));
  const remove = (i: number) => setNiches((prev) => prev.filter((_, idx) => idx !== i));
  const add = () => setNiches((prev) => [...prev, { name: "", description: "" }]);

  async function apply() {
    const names = niches.map((n) => n.name.trim()).filter(Boolean);
    if (!names.length) {
      setErr("Add at least one niche first.");
      return;
    }
    if (!confirm(`Classify every influencer into these ${names.length} niches? This calls the Claude API (~$1–4 one-time).`))
      return;

    setApplying(true);
    setErr(null);
    setMsg(null);
    setDone(0);
    setTotal(0);
    try {
      let offset = 0;
      let processedTotal = 0;
      while (true) {
        const r = await fetch("/api/niches/apply", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ niches: names, offset, limit: 20 }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Failed to classify");
        processedTotal += d.processed;
        offset += d.processed;
        setDone(processedTotal);
        setTotal(d.total);
        if (d.remaining <= 0 || d.processed === 0) break;
      }
      setMsg(`Done — tagged ${processedTotal} influencers across ${names.length} niches. They're now filterable on the leaderboard.`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to classify");
    } finally {
      setApplying(false);
    }
  }

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-6">
      {!hasKey && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Set <code className="rounded bg-amber-100 px-1">ANTHROPIC_API_KEY</code> in your env (and
          in Vercel) to use this feature.
        </div>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">1 · Generate niche suggestions</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Analyzes stored post text with Claude Sonnet. No twitterapi.io credits. ~5–10s.
            </p>
          </div>
          <button
            onClick={suggest}
            disabled={proposing || applying}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
          >
            {proposing ? "Analyzing…" : "Suggest niches with AI"}
          </button>
        </div>
      </Card>

      {niches.length > 0 && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-900">2 · Review &amp; edit</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Rename, remove, or add categories before applying. Only these exact names get assigned.
          </p>
          <div className="mt-3 space-y-2">
            {niches.map((n, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={n.name}
                  onChange={(e) => update(i, "name", e.target.value)}
                  placeholder="Niche"
                  className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-sm font-medium"
                />
                <input
                  value={n.description}
                  onChange={(e) => update(i, "description", e.target.value)}
                  placeholder="Description"
                  className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                />
                <button
                  onClick={() => remove(i)}
                  className="text-xs text-slate-500 hover:text-red-600"
                >
                  remove
                </button>
              </div>
            ))}
          </div>
          <button onClick={add} className="mt-2 text-xs text-brand-600 hover:underline">
            + add niche
          </button>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <button
              onClick={apply}
              disabled={applying}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
            >
              {applying ? `Applying… ${done}/${total || "…"}` : "3 · Apply to all influencers"}
            </button>
            {applying && total > 0 && (
              <div className="w-56">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-0.5 text-right text-xs text-slate-500">
                  {done}/{total}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {msg && <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{msg}</div>}
      {err && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
    </div>
  );
}
