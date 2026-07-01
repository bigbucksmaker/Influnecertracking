"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CampaignDetail as Detail, PlacementDetail } from "@/lib/placements";
import { Card, StatCard, Badge, Avatar } from "./ui";
import { formatNumber, formatRatio, formatUsd, relativeTime } from "@/lib/format";

const TYPES = ["post", "quote", "thread", "retweet"] as const;

export function CampaignDetail({
  campaign,
  underdeliverThreshold,
}: {
  campaign: Detail;
  underdeliverThreshold: number;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [type, setType] = useState<string>("post");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function addPlacement() {
    if (!input.trim()) {
      setErr("Paste a tweet URL or id.");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await fetch("/api/placements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campaignId: campaign.id,
          input,
          type,
          priceUsd: price ? Number(price) : null,
          note: note || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed to attach placement");
      setInput("");
      setPrice("");
      setNote("");
      setMsg(d.warning ?? "Placement attached.");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to attach placement");
    } finally {
      setBusy(false);
    }
  }

  async function removePlacement(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/placements/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: "active" | "closed") {
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete campaign "${campaign.name}"? Its placements are removed; the underlying posts and accounts are kept.`))
      return;
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaign.id}`, { method: "DELETE" });
      router.push("/campaigns");
    } finally {
      setBusy(false);
    }
  }

  const maxRatio = Math.max(1.2, ...campaign.deliveryDistribution);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/campaigns" className="text-sm text-slate-500 hover:text-slate-700">
            ← All campaigns
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-slate-900">{campaign.name}</h1>
            <Badge color={campaign.status === "active" ? "green" : "slate"}>{campaign.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {campaign.client} · started {relativeTime(campaign.startDate)}
            {campaign.endDate && ` · ends ${relativeTime(campaign.endDate)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status === "active" ? (
            <button
              onClick={() => setStatus("closed")}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Close campaign
            </button>
          ) : (
            <button
              onClick={() => setStatus("active")}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Reopen
            </button>
          )}
          <button
            onClick={remove}
            disabled={busy}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Roll-up — reach & engagement only, never price */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Placements" value={campaign.placementCount} sub={`${campaign.linkedCount} linked`} />
        <StatCard label="Views delivered" value={formatNumber(campaign.totalViews)} />
        <StatCard label="Engagements" value={formatNumber(campaign.totalEngagements)} />
        <StatCard
          label="Median delivery"
          value={formatRatio(campaign.medianDeliveryRatio)}
          sub="vs organic median"
          tone={
            campaign.medianDeliveryRatio == null
              ? "default"
              : campaign.medianDeliveryRatio >= 1
                ? "good"
                : campaign.medianDeliveryRatio < underdeliverThreshold
                  ? "bad"
                  : "warn"
          }
        />
        <StatCard
          label="Underdelivering"
          value={campaign.underdeliverCount}
          sub={`< ${formatRatio(underdeliverThreshold)} of baseline`}
          tone={campaign.underdeliverCount > 0 ? "bad" : "good"}
        />
      </div>

      {/* Add placement */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-900">Attach a commissioned post</h2>
        <p className="mt-1 text-xs text-slate-500">
          Paste the tweet URL or id. It&apos;s ingested once and tracked on an extended window. Price
          is stored for reference only and is never used in any delivery metric.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block flex-1">
            <span className="text-xs text-slate-500">Tweet URL or id</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://x.com/creator/status/123…"
              className="mt-1 block w-full min-w-[220px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Price USD (ref only)</span>
            <input
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="—"
              className="mt-1 block w-28 rounded-lg border border-slate-300 px-3 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Note</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="optional"
              className="mt-1 block w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <button
            onClick={addPlacement}
            disabled={busy}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
          >
            {busy ? "Working…" : "Attach"}
          </button>
        </div>
        {msg && <p className="mt-2 text-sm text-emerald-600">{msg}</p>}
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </Card>

      {/* Delivery distribution */}
      {campaign.deliveryDistribution.length > 0 && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-slate-900">Delivery distribution</h2>
          <p className="mt-1 text-xs text-slate-500">
            Each bar is a placement&apos;s views ÷ that creator&apos;s organic median. 1.0× = on par
            with their normal; below {formatRatio(underdeliverThreshold)} is flagged underdelivered.
          </p>
          <div className="mt-3 space-y-1.5">
            {campaign.placements
              .filter((p) => p.deliveryRatioViews != null)
              .map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-xs text-slate-500">
                    @{p.account.username}
                  </span>
                  <div className="relative h-3 flex-1 rounded bg-slate-100">
                    <div
                      className={`h-full rounded ${p.underdelivered ? "bg-red-400" : "bg-emerald-400"}`}
                      style={{ width: `${Math.min(100, ((p.deliveryRatioViews ?? 0) / maxRatio) * 100)}%` }}
                    />
                    <div
                      className="absolute top-[-2px] h-[16px] w-px bg-slate-400"
                      style={{ left: `${Math.min(100, (1 / maxRatio) * 100)}%` }}
                      title="1.0× (organic median)"
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-600">
                    {formatRatio(p.deliveryRatioViews)}
                  </span>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Placement table */}
      <div className="scroll-thin overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="data w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">Creator</th>
              <th className="px-3 py-2 text-left">Post</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-right">Views</th>
              <th className="px-3 py-2 text-right">Engagements</th>
              <th className="px-3 py-2 text-right" title="Views ÷ the creator's organic median">
                Delivery
              </th>
              <th className="px-3 py-2 text-right" title="Reference only — never used in any metric">
                Price (ref)
              </th>
              <th className="px-3 py-2 text-right">Remove</th>
            </tr>
          </thead>
          <tbody>
            {campaign.placements.map((p) => (
              <PlacementRow key={p.id} p={p} onRemove={() => removePlacement(p.id)} busy={busy} />
            ))}
            {campaign.placements.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                  No placements yet. Attach a commissioned tweet above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlacementRow({ p, onRemove, busy }: { p: PlacementDetail; onRemove: () => void; busy: boolean }) {
  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
      <td className="px-3 py-2">
        <Link href={`/influencer/${p.account.username}`} className="flex items-center gap-2">
          <Avatar src={p.account.profilePicture} alt={p.account.username} size={24} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-slate-900">
              {p.account.displayName ?? p.account.username}
            </span>
            <span className="block truncate text-xs text-slate-500">@{p.account.username}</span>
          </span>
        </Link>
      </td>
      <td className="px-3 py-2">
        {p.post ? (
          <a
            href={p.post.url ?? `https://x.com/${p.account.username}/status/${p.post.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-brand-600 hover:underline"
          >
            {relativeTime(p.post.postedAt)}
            {p.post.isFrozen && <span className="ml-1"><Badge>frozen</Badge></span>}
          </a>
        ) : (
          <span className="text-slate-400" title={p.note ?? undefined}>
            not linked
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <Badge color="purple">{p.type}</Badge>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{p.post ? formatNumber(p.post.views) : "—"}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {p.post ? formatNumber(p.post.engagements) : "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {p.deliveryRatioViews == null ? (
          <span className="text-slate-400" title={p.baselineN === 0 ? "No organic baseline yet" : undefined}>
            —
          </span>
        ) : (
          <span
            className={p.underdelivered ? "font-medium text-red-600" : "text-slate-700"}
            title={`baseline median ${formatNumber(p.baselineMedianViews)} views (${p.baselineN} organic posts)`}
          >
            {formatRatio(p.deliveryRatioViews)}
            {p.underdelivered && <span className="ml-1"><Badge color="red">under</Badge></span>}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-400">
        {p.priceUsd != null ? formatUsd(p.priceUsd) : "—"}
      </td>
      <td className="px-3 py-2 text-right">
        <button onClick={onRemove} disabled={busy} className="text-xs text-red-600 hover:underline">
          remove
        </button>
      </td>
    </tr>
  );
}
