"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RunPollButton({ force = false, label }: { force?: boolean; label?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Poll failed");
      const s = data.summary;
      setMsg(
        `Polled ${s.accountsRun} account(s): ${s.ok} ok, ${s.failed} failed · ${s.snapshots} snapshots · ${s.credits.toLocaleString()} credits`,
      );
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Poll failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={loading}
        className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
      >
        {loading ? "Polling…" : label ?? (force ? "Poll all now" : "Run poll now")}
      </button>
      {msg && <span className="max-w-xs text-right text-xs text-slate-500">{msg}</span>}
    </div>
  );
}
