"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import type { CampaignDetail as Detail, PlacementDetail } from "@/lib/placements";
import type { ShortlistView } from "@/lib/shortlists";
import type { LiveTrackerSummary } from "@/lib/live";
import { Card, StatCard, Badge, Avatar } from "./ui";
import { formatNumber, formatRatio, formatUsd, relativeTime } from "@/lib/format";

const TYPES = ["post", "quote", "thread", "retweet"] as const;
const CONTROL =
  "rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-subtle focus:border-accent focus:outline-none";

export function CampaignDetail({
  campaign,
  underdeliverThreshold,
  rosterShortlists = [],
  trackers = [],
}: {
  campaign: Detail;
  underdeliverThreshold: number;
  rosterShortlists?: ShortlistView[];
  trackers?: LiveTrackerSummary[];
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
          <Link href="/campaigns" className="text-sm text-subtle hover:text-muted">
            ← All campaigns
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-fg">{campaign.name}</h1>
            <Badge color={campaign.status === "active" ? "green" : "slate"}>{campaign.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-subtle">
            {campaign.client} · started {relativeTime(campaign.startDate)}
            {campaign.endDate && ` · ends ${relativeTime(campaign.endDate)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status === "active" ? (
            <button
              onClick={() => setStatus("closed")}
              disabled={busy}
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
            >
              Close campaign
            </button>
          ) : (
            <button
              onClick={() => setStatus("active")}
              disabled={busy}
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
            >
              Reopen
            </button>
          )}
          <button
            onClick={remove}
            disabled={busy}
            className="rounded-lg border border-neg/40 px-3 py-1.5 text-sm text-neg hover:bg-neg-soft"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Roll-up — delivery (price-free) + economics (actuals) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          label="Spend"
          value={campaign.totalSpendUsd > 0 ? formatUsd(campaign.totalSpendUsd) : "—"}
          sub={`${campaign.pricedCount} priced placement${campaign.pricedCount === 1 ? "" : "s"}`}
          accent="money"
        />
        <StatCard
          label="Actual CPM"
          value={campaign.blendedCpm != null ? `$${campaign.blendedCpm}` : "—"}
          sub="spend ÷ delivered views × 1K"
          accent="money"
        />
        <StatCard
          label="Cost / engagement"
          value={campaign.costPerEngagement != null ? formatUsd(campaign.costPerEngagement) : "—"}
          sub="priced placements only"
          accent="money"
        />
        <StatCard
          label="Underdelivering"
          value={campaign.underdeliverCount}
          sub={`< ${formatRatio(underdeliverThreshold)} of baseline`}
          tone={campaign.underdeliverCount > 0 ? "bad" : "good"}
        />
      </div>

      {/* The launch workflow: roster → launch tweet → live tracking */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CampaignRoster campaign={campaign} shortlists={rosterShortlists} />
        <CampaignLaunch campaign={campaign} trackers={trackers} />
      </div>

      {/* Add placement */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-fg">Attach a commissioned post</h2>
        <p className="mt-1 text-xs text-subtle">
          Paste the tweet URL or id. It&apos;s ingested once and tracked on an extended window.
          Delivery ratios stay price-free; the price powers spend and actual-CPM economics.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block flex-1">
            <span className="text-xs text-subtle">Tweet URL or id</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://x.com/creator/status/123…"
              className="mt-1 block w-full min-w-[220px] rounded-lg border border-line px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-subtle">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 block rounded-lg border border-line px-3 py-1.5 text-sm"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-subtle">Price USD</span>
            <input
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="—"
              className="mt-1 block w-28 rounded-lg border border-line px-3 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="block">
            <span className="text-xs text-subtle">Note</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="optional"
              className="mt-1 block w-40 rounded-lg border border-line px-3 py-1.5 text-sm"
            />
          </label>
          <button
            onClick={addPlacement}
            disabled={busy}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-60"
          >
            {busy ? "Working…" : "Attach"}
          </button>
        </div>
        {msg && <p className="mt-2 text-sm text-pos">{msg}</p>}
        {err && <p className="mt-2 text-sm text-neg">{err}</p>}
      </Card>

      {/* Delivery distribution */}
      {campaign.deliveryDistribution.length > 0 && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-fg">Delivery distribution</h2>
          <p className="mt-1 text-xs text-subtle">
            Each bar is a placement&apos;s views ÷ that creator&apos;s organic median. 1.0× = on par
            with their normal; below {formatRatio(underdeliverThreshold)} is flagged underdelivered.
          </p>
          <div className="mt-3 space-y-1.5">
            {campaign.placements
              .filter((p) => p.deliveryRatioViews != null)
              .map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-xs text-subtle">
                    @{p.account.username}
                  </span>
                  <div className="relative h-3 flex-1 rounded bg-surface-2">
                    <div
                      className={`h-full rounded ${p.underdelivered ? "bg-neg" : "bg-pos"}`}
                      style={{ width: `${Math.min(100, ((p.deliveryRatioViews ?? 0) / maxRatio) * 100)}%` }}
                    />
                    <div
                      className="absolute top-[-2px] h-[16px] w-px bg-subtle"
                      style={{ left: `${Math.min(100, (1 / maxRatio) * 100)}%` }}
                      title="1.0× (organic median)"
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted">
                    {formatRatio(p.deliveryRatioViews)}
                  </span>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Placement table */}
      <div className="scroll-thin overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="data w-full text-sm">
          <thead className="border-b border-line bg-surface-2">
            <tr>
              <th className="px-3 py-2 text-left">Creator</th>
              <th className="px-3 py-2 text-left">Post</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-right">Views</th>
              <th className="px-3 py-2 text-right">Engagements</th>
              <th className="px-3 py-2 text-right" title="Views ÷ the creator's organic median">
                Delivery
              </th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right" title="Price ÷ delivered views × 1K">
                Actual CPM
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
                <td colSpan={9} className="px-3 py-10 text-center text-subtle">
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

/** Campaign roster — the creators booked for THIS campaign (its linked shortlists). */
function CampaignRoster({ campaign, shortlists }: { campaign: Detail; shortlists: ShortlistView[] }) {
  const router = useRouter();
  const [handles, setHandles] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const items = shortlists.flatMap((s) => s.items);
  const totalCost = shortlists.reduce((s, l) => s + l.totals.totalCost, 0);
  const expectedViews = shortlists.reduce((s, l) => s + l.totals.expectedViews, 0);

  async function addCreators() {
    const parsed = handles
      .split(/[\s,]+/)
      .map((h) => h.trim().replace(/^@/, "").toLowerCase())
      .filter(Boolean);
    if (parsed.length === 0) {
      setErr("Enter one or more @handles.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (shortlists.length === 0) {
        const r = await fetch("/api/shortlists", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: `${campaign.name} — roster`,
            campaignId: campaign.id,
            items: parsed.map((h) => ({ account: h })),
          }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "Could not create the roster");
        if (d.failed?.length) setErr(`Not on the watchlist: ${d.failed.join(", ")} — add them there first.`);
      } else {
        const target = shortlists[0];
        const failed: string[] = [];
        for (const h of parsed) {
          const r = await fetch(`/api/shortlists/${target.id}/items`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ account: h }),
          });
          if (!r.ok) failed.push(h);
        }
        if (failed.length) setErr(`Not on the watchlist: ${failed.join(", ")} — add them there first.`);
      }
      setHandles("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add creators");
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

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">
          Roster{" "}
          <span className="font-normal text-subtle">
            · {items.length} creator{items.length === 1 ? "" : "s"}
            {totalCost > 0 && <> · {formatUsd(totalCost)} · ~{formatNumber(expectedViews)} exp. views</>}
          </span>
        </h2>
        <Link href="/shortlists" className="text-xs text-accent-400 hover:underline">
          Manage in Shortlists →
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <input
          value={handles}
          onChange={(e) => setHandles(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addCreators()}
          placeholder="@handle, @handle…"
          className={clsx(CONTROL, "min-w-[220px] flex-1")}
        />
        <button
          onClick={addCreators}
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-600 disabled:opacity-60"
        >
          {busy ? "Adding…" : "Add to roster"}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-subtle">
        Roster creators are highlighted in the launch tracker&apos;s QT feed — you see instantly who delivered.
        Creators must already be on the watchlist.
      </p>
      {err && <p className="mt-1.5 text-sm text-neg">{err}</p>}

      {items.length > 0 && (
        <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto scroll-thin">
          {items.map((it) => (
            <li key={it.itemId} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
              <Avatar src={it.profilePicture} alt={it.username} size={24} />
              <Link href={`/influencer/${it.username}`} className="min-w-0 flex-1 truncate text-sm font-medium text-fg hover:underline">
                {it.displayName ?? it.username}
                <span className="ml-1.5 font-normal text-xs text-subtle">@{it.username}</span>
              </Link>
              {it.basisRate != null && (
                <span className="font-mono text-xs tabular-nums text-muted">${it.basisRate}</span>
              )}
              {it.cpm != null && (
                <span className="font-mono text-xs tabular-nums text-money-400">${it.cpm} CPM</span>
              )}
              <button onClick={() => removeItem(it.itemId)} disabled={busy} className="text-xs text-subtle hover:text-neg">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Launch-day tracking — link the launch tweet, get the live panel, campaign-scoped. */
function CampaignLaunch({ campaign, trackers }: { campaign: Detail; trackers: LiveTrackerSummary[] }) {
  const router = useRouter();
  const [tweet, setTweet] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function goLive() {
    if (!tweet.trim()) {
      setErr("Paste the launch post's URL or id.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tweet, label: campaign.name, campaignId: campaign.id, intervalSec: 5 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Could not start the tracker");
      router.push(`/live/${d.trackerId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start the tracker");
      setBusy(false);
    }
  }

  return (
    <Card className="relative overflow-hidden p-5">
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-neg/50 via-neg/15 to-transparent" />
      <h2 className="text-sm font-semibold text-fg">Launch tracking</h2>
      <p className="mt-1 text-xs text-subtle">
        On launch day, paste the launch post the moment it ships — 5s realtime panel, QT feed with this
        campaign&apos;s roster highlighted, and on-demand recap reports with per-creator attribution.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <input
          value={tweet}
          onChange={(e) => setTweet(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && goLive()}
          placeholder="https://x.com/founder/status/123…"
          className={clsx(CONTROL, "min-w-[220px] flex-1")}
        />
        <button
          onClick={goLive}
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-600 disabled:opacity-60"
        >
          {busy ? "Starting…" : "▶ Go live"}
        </button>
      </div>
      {err && <p className="mt-1.5 text-sm text-neg">{err}</p>}

      {trackers.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {trackers.map((t) => {
            const live = t.status === "live";
            return (
              <li key={t.id}>
                <Link href={`/live/${t.id}`} className="flex items-center gap-2.5 rounded-lg border border-line-soft px-3 py-2 transition-colors hover:bg-surface-2">
                  <span
                    className={clsx(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]",
                      live ? "bg-neg-soft text-neg" : "bg-surface-2 text-subtle",
                    )}
                  >
                    <span className={clsx("h-1 w-1 rounded-full", live ? "animate-pulse-soft bg-neg" : "bg-subtle")} />
                    {live ? "Live" : "Done"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">
                    @{t.post.author.username} · {relativeTime(t.startedAt)}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted">
                    {formatNumber(t.latest?.views ?? null)} views
                  </span>
                  <span className="font-mono text-xs tabular-nums text-money-400">{t.rosterQuoteCount} roster QTs</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function PlacementRow({ p, onRemove, busy }: { p: PlacementDetail; onRemove: () => void; busy: boolean }) {
  return (
    <tr className="border-b border-line-soft last:border-0 hover:bg-surface-2">
      <td className="px-3 py-2">
        <Link href={`/influencer/${p.account.username}`} className="flex items-center gap-2">
          <Avatar src={p.account.profilePicture} alt={p.account.username} size={24} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-fg">
              {p.account.displayName ?? p.account.username}
            </span>
            <span className="block truncate text-xs text-subtle">@{p.account.username}</span>
          </span>
        </Link>
      </td>
      <td className="px-3 py-2">
        {p.post ? (
          <a
            href={p.post.url ?? `https://x.com/${p.account.username}/status/${p.post.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-accent-400 hover:underline"
          >
            {relativeTime(p.post.postedAt)}
            {p.post.isFrozen && <span className="ml-1"><Badge>frozen</Badge></span>}
          </a>
        ) : (
          <span className="text-subtle" title={p.note ?? undefined}>
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
          <span className="text-subtle" title={p.baselineN === 0 ? "No organic baseline yet" : undefined}>
            —
          </span>
        ) : (
          <span
            className={p.underdelivered ? "font-medium text-neg" : "text-muted"}
            title={`baseline median ${formatNumber(p.baselineMedianViews)} views (${p.baselineN} organic posts)`}
          >
            {formatRatio(p.deliveryRatioViews)}
            {p.underdelivered && <span className="ml-1"><Badge color="red">under</Badge></span>}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {p.priceUsd != null ? formatUsd(p.priceUsd) : <span className="text-subtle">—</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {p.actualCpm != null ? (
          <span className="text-money-400" title={p.costPerEng != null ? `${formatUsd(p.costPerEng)} per engagement` : undefined}>
            ${p.actualCpm}
          </span>
        ) : (
          <span className="text-subtle">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <button onClick={onRemove} disabled={busy} className="text-xs text-neg hover:underline">
          remove
        </button>
      </td>
    </tr>
  );
}
