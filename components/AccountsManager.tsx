"use client";

import { useState } from "react";
import Link from "next/link";
import type { AccountOverview } from "@/lib/accounts";
import { Card, Avatar, Badge } from "./ui";
import { formatNumber, relativeTime } from "@/lib/format";

export function AccountsManager({
  initialAccounts,
  allTags,
}: {
  initialAccounts: AccountOverview[];
  allTags: string[];
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [input, setInput] = useState("");
  const [tags, setTags] = useState("");
  const [backfill, setBackfill] = useState(true);
  const [rateQt, setRateQt] = useState("");
  const [ratePost, setRatePost] = useState("");
  const [rateRt, setRateRt] = useState("");
  const [rateTh, setRateTh] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/accounts");
    if (res.ok) setAccounts((await res.json()).accounts);
  }

  async function addAccounts(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          backfill,
          rateQuoteTweet: rateQt || null,
          ratePost: ratePost || null,
          rateRetweet: rateRt || null,
          rateThread: rateTh || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add");
      const credits = (data.backfill ?? []).reduce((s: number, b: any) => s + (b.credits ?? 0), 0);
      const failed = (data.backfill ?? []).filter((b: any) => !b.ok);
      setMsg(
        `Added ${data.created.length}, skipped ${data.skipped.length} (already tracked). ` +
          (backfill ? `Backfill used ${credits.toLocaleString()} credits.` : "") +
          (failed.length ? ` ${failed.length} backfill error(s): ${failed.map((f: any) => f.username + " — " + f.error).join("; ")}` : ""),
      );
      setAccounts(data.accounts);
      setInput("");
      setTags("");
      setRateQt("");
      setRatePost("");
      setRateRt("");
      setRateTh("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, fn: () => Promise<Response>) {
    setBusyId(id);
    try {
      const res = await fn();
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setMsg(d.error ?? "Action failed.");
      }
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusyId(null);
    }
  }

  const toggleStatus = (a: AccountOverview) =>
    act(a.id, () =>
      fetch(`/api/accounts/${a.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: a.status === "active" ? "paused" : "active" }),
      }),
    );

  const runBackfill = (a: AccountOverview) =>
    act(a.id, () => fetch(`/api/accounts/${a.id}/backfill`, { method: "POST" }));

  const remove = async (a: AccountOverview) => {
    if (
      !confirm(
        `Remove @${a.username}?\n\nThis permanently deletes its snapshot history and removes it from any campaigns and shortlists. This cannot be undone.`,
      )
    )
      return;
    setBusyId(a.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/accounts/${a.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(d.error ?? `Failed to remove @${a.username}.`);
        return;
      }
      setAccounts((prev) => prev.filter((x) => x.id !== a.id)); // optimistic
      setMsg(`Removed @${a.username}.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : `Failed to remove @${a.username}.`);
    } finally {
      setBusyId(null);
    }
  };

  const editTags = (a: AccountOverview) => {
    const val = window.prompt("Niche tags (comma separated):", a.tags.join(", "));
    if (val == null) return;
    const t = val.split(",").map((s) => s.trim()).filter(Boolean);
    return act(a.id, () =>
      fetch(`/api/accounts/${a.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tags: t }),
      }),
    );
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-fg">Add influencers</h2>
        <p className="mt-1 text-xs text-subtle">
          Paste handles, @mentions, or profile URLs — separated by commas, spaces, or newlines. Each
          new handle is backfilled with the last 7 days of posts.
        </p>
        <form onSubmit={addAccounts} className="mt-3 space-y-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            placeholder="elonmusk, @naval&#10;https://x.com/paulg"
            className="w-full rounded-lg border border-line px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-subtle">Rates ($, optional):</span>
            <input type="number" min={0} value={rateQt} onChange={(e) => setRateQt(e.target.value)} placeholder="Quote tweet" className="w-28 rounded-lg border border-line px-2 py-1 text-sm" />
            <input type="number" min={0} value={ratePost} onChange={(e) => setRatePost(e.target.value)} placeholder="Post" className="w-20 rounded-lg border border-line px-2 py-1 text-sm" />
            <input type="number" min={0} value={rateRt} onChange={(e) => setRateRt(e.target.value)} placeholder="Retweet" className="w-24 rounded-lg border border-line px-2 py-1 text-sm" />
            <input type="number" min={0} value={rateTh} onChange={(e) => setRateTh(e.target.value)} placeholder="Thread" className="w-24 rounded-lg border border-line px-2 py-1 text-sm" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Niche tags (e.g. AI, Crypto)"
              className="w-64 rounded-lg border border-line px-3 py-1.5 text-sm"
              list="tag-suggestions"
            />
            <datalist id="tag-suggestions">
              {allTags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <label className="flex items-center gap-1.5 text-sm text-muted">
              <input type="checkbox" checked={backfill} onChange={(e) => setBackfill(e.target.checked)} />
              Backfill last 7 days now
            </label>
            <button
              type="submit"
              disabled={busy}
              className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-60"
            >
              {busy ? "Adding…" : "Add to watchlist"}
            </button>
          </div>
          {msg && <div className="rounded-lg bg-surface-2 p-2 text-xs text-muted">{msg}</div>}
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">
            Watchlist <span className="text-subtle">· {accounts.length}</span>
          </h2>
        </div>
        <div className="scroll-thin overflow-x-auto">
          <table className="data w-full text-sm">
            <thead className="border-b border-line bg-surface-2">
              <tr>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2 text-left">Niches</th>
                <th className="px-4 py-2 text-right">Followers</th>
                <th className="px-4 py-2 text-right">Posts</th>
                <th className="px-4 py-2 text-left">Tier</th>
                <th className="px-4 py-2 text-left">Backfill</th>
                <th className="px-4 py-2 text-left">Last poll</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/influencer/${a.username}`} className="flex items-center gap-2">
                      <Avatar src={a.profilePicture} alt={a.username} size={28} />
                      <span>
                        <span className="block font-medium text-fg">
                          {a.displayName ?? a.username}
                        </span>
                        <span className="block text-xs text-subtle">@{a.username}</span>
                      </span>
                      {a.status === "paused" && <Badge color="amber">paused</Badge>}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {a.tags.map((t) => (
                        <Badge key={t} color="purple">
                          {t}
                        </Badge>
                      ))}
                      <button onClick={() => editTags(a)} className="text-xs text-accent-400 hover:underline">
                        edit
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNumber(a.currentFollowers)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatNumber(a.postCount)}</td>
                  <td className="px-4 py-2">
                    <Badge color={a.pollingTier === "active" ? "blue" : "slate"}>{a.pollingTier}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    {a.backfilledAt ? (
                      <Badge color="green">done</Badge>
                    ) : (
                      <Badge color="amber">pending</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-subtle">
                    {a.lastPolledAt ? relativeTime(a.lastPolledAt) : "never"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-2 text-xs">
                      <button
                        onClick={() => runBackfill(a)}
                        disabled={busyId === a.id}
                        className="text-muted hover:text-accent-400 disabled:opacity-50"
                      >
                        Backfill
                      </button>
                      <button
                        onClick={() => toggleStatus(a)}
                        disabled={busyId === a.id}
                        className="text-muted hover:text-warn disabled:opacity-50"
                      >
                        {a.status === "active" ? "Pause" : "Resume"}
                      </button>
                      <button
                        onClick={() => remove(a)}
                        disabled={busyId === a.id}
                        className="rounded-md border border-neg/40 px-2 py-1 font-medium text-neg hover:bg-neg-soft disabled:opacity-50"
                        title={`Delete @${a.username} and all its data`}
                      >
                        {busyId === a.id ? "Removing…" : "Remove"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-subtle">
                    No accounts yet — add some above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
