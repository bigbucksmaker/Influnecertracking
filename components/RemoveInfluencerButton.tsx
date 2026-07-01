"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RemoveInfluencerButton({ id, username }: { id: string; username: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    if (
      !confirm(
        `Remove @${username}?\n\nThis permanently deletes its snapshot history and removes it from any campaigns and shortlists. This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(d.error ?? "Failed to remove.");
        setBusy(false);
        return;
      }
      router.push("/accounts");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to remove.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end">
      <button
        onClick={remove}
        disabled={busy}
        className="rounded-lg border border-neg/40 px-3 py-1.5 text-sm font-medium text-neg hover:bg-neg-soft disabled:opacity-60"
        title={`Delete @${username} from the watchlist`}
      >
        {busy ? "Removing…" : "Remove from watchlist"}
      </button>
      {err && <span className="mt-1 max-w-xs text-right text-xs text-neg">{err}</span>}
    </div>
  );
}
