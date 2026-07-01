"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ShortlistView, ShortlistItemView } from "@/lib/shortlists";
import { Card, Badge, Avatar } from "./ui";
import { formatNumber, formatPct, relativeTime } from "@/lib/format";

interface CampaignOpt {
  id: string;
  name: string;
}

export function ShortlistsManager({
  shortlists,
  campaigns,
}: {
  shortlists: ShortlistView[];
  campaigns: CampaignOpt[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) {
      setErr("Name is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/shortlists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, campaignId: campaignId || null }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      setName("");
      setCampaignId("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-900">New shortlist</h2>
        <p className="mt-1 text-xs text-slate-500">
          Save candidate creators for a campaign. Metrics shown are reach, engagement, median &
          consistency only — campaign rates are never included.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs text-slate-500">Shortlist name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Q3 AI creators"
              className="mt-1 block w-56 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Campaign (optional)</span>
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="">— none —</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={create}
            disabled={busy}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
          >
            Create shortlist
          </button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </Card>

      {shortlists.length === 0 ? (
        <Card className="p-10 text-center text-sm text-slate-500">
          No shortlists yet. Create one above, then add creators from the{" "}
          <Link href="/leaderboard" className="text-brand-600 hover:underline">
            leaderboard
          </Link>{" "}
          (☆ button) or by handle below.
        </Card>
      ) : (
        shortlists.map((s) => <ShortlistCard key={s.id} shortlist={s} />)
      )}
    </div>
  );
}

function ShortlistCard({ shortlist }: { shortlist: ShortlistView }) {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function addByHandle() {
    if (!handle.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/shortlists/${shortlist.id}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: handle }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      setHandle("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(itemId: string) {
    setBusy(true);
    try {
      await fetch(`/api/shortlists/items/${itemId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!confirm(`Delete shortlist "${shortlist.name}"?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/shortlists/${shortlist.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900">{shortlist.name}</h3>
          {shortlist.campaignName && <Badge color="purple">{shortlist.campaignName}</Badge>}
          <span className="text-xs text-slate-400">{shortlist.items.length} creators</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addByHandle()}
              placeholder="add @handle"
              className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
            <button
              onClick={addByHandle}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
            >
              ＋
            </button>
          </div>
          <button
            onClick={() => downloadCsv(shortlist)}
            className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
          >
            Export CSV
          </button>
          <button onClick={del} className="rounded-lg border border-red-200 px-3 py-1 text-sm text-red-600 hover:bg-red-50">
            Delete
          </button>
        </div>
      </div>
      {err && <p className="px-5 py-2 text-sm text-red-600">{err}</p>}
      <div className="scroll-thin overflow-x-auto">
        <table className="data w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">Creator</th>
              <th className="px-3 py-2 text-right">Score</th>
              <th className="px-3 py-2 text-right">Followers</th>
              <th className="px-3 py-2 text-right">Median views</th>
              <th className="px-3 py-2 text-left">Steadiness</th>
              <th className="px-3 py-2 text-right">ER (impr.)</th>
              <th className="px-3 py-2 text-left">Note</th>
              <th className="px-3 py-2 text-right">Remove</th>
            </tr>
          </thead>
          <tbody>
            {shortlist.items.map((it) => (
              <ItemRow key={it.itemId} it={it} onRemove={() => removeItem(it.itemId)} busy={busy} />
            ))}
            {shortlist.items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  No creators yet. Add by handle above, or use the ☆ button on the leaderboard.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function steadiness(c: number | null) {
  if (c == null) return <span className="text-slate-300">—</span>;
  if (c < 0.5) return <Badge color="green">steady</Badge>;
  if (c < 1.0) return <Badge color="slate">normal</Badge>;
  return <Badge color="amber">spiky</Badge>;
}

function ItemRow({ it, onRemove, busy }: { it: ShortlistItemView; onRemove: () => void; busy: boolean }) {
  return (
    <tr className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${it.lowConfidence ? "opacity-60" : ""}`}>
      <td className="px-3 py-2">
        <Link href={`/influencer/${it.username}`} className="flex items-center gap-2">
          <Avatar src={it.profilePicture} alt={it.username} size={24} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-slate-900">{it.displayName ?? it.username}</span>
            <span className="block truncate text-xs text-slate-500">@{it.username}</span>
          </span>
        </Link>
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-semibold">{it.performanceScore ?? "—"}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(it.currentFollowers)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(it.medianViews)}</td>
      <td className="px-3 py-2">{steadiness(it.consistency)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatPct(it.erImpressions)}</td>
      <td className="px-3 py-2 text-slate-500">{it.note ?? ""}</td>
      <td className="px-3 py-2 text-right">
        <button onClick={onRemove} disabled={busy} className="text-xs text-red-600 hover:underline">
          remove
        </button>
      </td>
    </tr>
  );
}

function downloadCsv(shortlist: ShortlistView) {
  // reach/engagement/median/consistency columns ONLY — no rate-derived columns.
  const headers = [
    "username", "displayName", "performanceScore", "followers",
    "medianViews", "p25Views", "consistency", "erImpressions", "direction", "note",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const it of shortlist.items) {
    lines.push(
      [
        it.username, it.displayName ?? "", it.performanceScore ?? "", it.currentFollowers ?? "",
        it.medianViews != null ? Math.round(it.medianViews) : "",
        it.p25Views != null ? Math.round(it.p25Views) : "",
        it.consistency ?? "", it.erImpressions ?? "", it.direction ?? "", it.note ?? "",
      ].map(esc).join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shortlist-${shortlist.name.replace(/\s+/g, "-").toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
