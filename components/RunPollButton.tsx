"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface PollStatus {
  total: number;
  backfilled: number;
  pending: number;
  running: boolean;
  done: number;
  pollTotal: number;
  startedAt: string | null;
  lastPollAt: string | null;
}

export function RunPollButton() {
  const router = useRouter();
  const [status, setStatus] = useState<PollStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async (): Promise<PollStatus | null> => {
    try {
      const r = await fetch("/api/poll/status", { cache: "no-store" });
      if (!r.ok) return null;
      const s: PollStatus = await r.json();
      setStatus(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (timer.current) return;
    timer.current = setInterval(async () => {
      const s = await fetchStatus();
      if (s && !s.running) {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        router.refresh(); // pull fresh data into the tables when the job ends
      }
    }, 2500);
  }, [fetchStatus, router]);

  // On mount, adopt any in-progress run (survives refresh; shared across tabs/users).
  useEffect(() => {
    fetchStatus().then((s) => {
      if (s?.running) startPolling();
    });
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [fetchStatus, startPolling]);

  async function run() {
    setStarting(true);
    setErr(null);
    try {
      const r = await fetch("/api/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed to start poll");
      await fetchStatus();
      startPolling();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to start poll");
    } finally {
      setStarting(false);
    }
  }

  const running = !!status?.running;
  const done = running ? status!.done : (status?.backfilled ?? 0);
  const total = running ? status!.pollTotal : (status?.total ?? 0);
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  const eta = (() => {
    if (!running || !status?.startedAt || status.done <= 0) return null;
    const elapsed = (Date.now() - new Date(status.startedAt).getTime()) / 1000;
    const remaining = status.pollTotal - status.done;
    if (remaining <= 0) return 0;
    return Math.round((elapsed / status.done) * remaining);
  })();

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={starting || running}
        className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
      >
        {running
          ? `Polling… ${status!.done}/${status!.pollTotal}`
          : starting
            ? "Starting…"
            : "Run poll now"}
      </button>

      {running && (
        <div className="w-60">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-brand-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-0.5 text-right text-xs text-slate-500">
            {status!.done}/{status!.pollTotal}
            {eta != null && eta > 0 ? ` · ~${fmtEta(eta)} left` : ""} · runs in background
          </div>
        </div>
      )}

      {!running && status && status.pending > 0 && (
        <span className="text-xs text-slate-500">
          {status.backfilled}/{status.total} backfilled
        </span>
      )}
      {err && <span className="max-w-xs text-right text-xs text-red-600">{err}</span>}
    </div>
  );
}

function fmtEta(s: number): string {
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
