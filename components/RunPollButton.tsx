"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Drain the due-queue in small batches: never hits the serverless time limit,
// and lets us show a progress bar + ETA. Each polled account stops being "due",
// so successive batches naturally work through the whole list.
const BATCH = 15;

export function RunPollButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [eta, setEta] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setMsg(null);
    setDone(0);
    setTotal(0);
    setEta(null);
    const start = Date.now();
    let processed = 0;
    let credits = 0;
    let failed = 0;

    try {
      while (true) {
        const res = await fetch("/api/poll", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit: BATCH }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Poll failed");

        const s = data.summary;
        processed += s.accountsRun;
        credits += s.credits;
        failed += s.failed;
        const remaining = s.remaining ?? 0;

        setDone(processed);
        setTotal(processed + remaining);
        const elapsed = (Date.now() - start) / 1000;
        setEta(processed > 0 && remaining > 0 ? Math.round((elapsed / processed) * remaining) : 0);
        router.refresh(); // stream results into the tables as we go

        if (remaining <= 0 || s.accountsRun === 0) break;
      }
      setMsg(
        `Done — ${processed} account(s) polled${failed ? `, ${failed} failed` : ""} · ${credits.toLocaleString()} credits`,
      );
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Poll failed");
    } finally {
      setRunning(false);
      setEta(null);
    }
  }

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={running}
        className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
      >
        {running ? `Polling… ${done}/${total || "…"}` : "Run poll now"}
      </button>
      {running && total > 0 && (
        <div className="w-56">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-brand-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-0.5 text-right text-xs text-slate-500">
            {done}/{total}
            {eta != null && eta > 0 ? ` · ~${fmtEta(eta)} left` : ""}
          </div>
        </div>
      )}
      {!running && msg && <span className="max-w-xs text-right text-xs text-slate-500">{msg}</span>}
    </div>
  );
}

function fmtEta(s: number): string {
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
