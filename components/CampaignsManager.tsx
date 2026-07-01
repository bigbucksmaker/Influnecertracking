"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CampaignSummary } from "@/lib/placements";
import { Card, Badge } from "./ui";
import { formatNumber, formatRatio, relativeTime } from "@/lib/format";

export function CampaignsManager({ campaigns }: { campaigns: CampaignSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(campaigns.length === 0);
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [startDate, setStartDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    if (!name.trim() || !client.trim()) {
      setErr("Name and client are required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, client, startDate: startDate || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed to create campaign");
      setName("");
      setClient("");
      setStartDate("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create campaign");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">New campaign</h2>
          <button onClick={() => setOpen((o) => !o)} className="text-xs text-accent-400 hover:underline">
            {open ? "Hide" : "＋ Add campaign"}
          </button>
        </div>
        {open && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-xs text-subtle">Campaign name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Q3 Launch push"
                className="mt-1 block w-56 rounded-lg border border-line px-3 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-subtle">Client</span>
              <input
                value={client}
                onChange={(e) => setClient(e.target.value)}
                placeholder="Acme Inc"
                className="mt-1 block w-48 rounded-lg border border-line px-3 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-subtle">Start date</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block rounded-lg border border-line px-3 py-1.5 text-sm"
              />
            </label>
            <button
              onClick={create}
              disabled={saving}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-60"
            >
              {saving ? "Creating…" : "Create campaign"}
            </button>
            {err && <span className="text-sm text-neg">{err}</span>}
          </div>
        )}
      </Card>

      <div className="scroll-thin overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="data w-full text-sm">
          <thead className="border-b border-line bg-surface-2">
            <tr>
              <th className="px-3 py-2 text-left">Campaign</th>
              <th className="px-3 py-2 text-left">Client</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Placements</th>
              <th className="px-3 py-2 text-right">Views delivered</th>
              <th className="px-3 py-2 text-right" title="Median delivery vs each creator's organic median">
                Median delivery
              </th>
              <th className="px-3 py-2 text-right">Underdelivering</th>
              <th className="px-3 py-2 text-right">Created</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className="border-b border-line-soft last:border-0 hover:bg-surface-2">
                <td className="px-3 py-2">
                  <Link href={`/campaigns/${c.id}`} className="font-medium text-accent-400 hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted">{c.client}</td>
                <td className="px-3 py-2">
                  <Badge color={c.status === "active" ? "green" : "slate"}>{c.status}</Badge>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {c.placementCount}
                  {c.linkedCount < c.placementCount && (
                    <span className="ml-1 text-xs text-subtle">({c.linkedCount} linked)</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.totalViews)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatRatio(c.medianDeliveryRatio)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {c.underdeliverCount > 0 ? (
                    <Badge color="red">{c.underdeliverCount}</Badge>
                  ) : (
                    <span className="text-subtle">0</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-subtle">{relativeTime(c.createdAt)}</td>
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-subtle">
                  No campaigns yet. Create one above, then attach commissioned tweets to measure
                  delivery against each creator&apos;s organic baseline.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
