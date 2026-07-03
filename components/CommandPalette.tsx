"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";

type Creator = { username: string; displayName: string | null; profilePicture: string | null };
type Campaign = { id: string; name: string; client: string };

type Item = {
  key: string;
  kind: "Creators" | "Campaigns" | "Actions";
  label: string;
  sub?: string;
  avatar?: string | null;
  glyph?: string;
  onSelect: () => void;
};

const NAV: { label: string; href: string }[] = [
  { label: "Open Leaderboard", href: "/leaderboard" },
  { label: "Open Planner", href: "/planner" },
  { label: "Open Live tracking", href: "/live" },
  { label: "Open Campaigns", href: "/campaigns" },
  { label: "Open Shortlists", href: "/shortlists" },
  { label: "Open Watchlist", href: "/accounts" },
  { label: "Open Niches", href: "/niches" },
  { label: "Open Cost", href: "/cost" },
  { label: "Open Settings", href: "/settings" },
];

export function CommandPalette({
  creators,
  campaigns,
  variant = "bar",
}: {
  creators: Creator[];
  campaigns: Campaign[];
  /** "bar" = full-width dashboard trigger · "nav" = compact sidebar trigger */
  variant?: "bar" | "nav";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setActive(0);
  }, []);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const runPoll = useCallback(async () => {
    close();
    try {
      await fetch("/api/poll", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      router.refresh();
    } catch {
      /* no-op — the dashboard poll button surfaces errors */
    }
  }, [close, router]);

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();
    const has = (s: string) => s.toLowerCase().includes(needle);

    const creatorItems: Item[] = creators
      .filter((c) => !needle || has(c.username) || has(c.displayName ?? ""))
      .slice(0, 6)
      .map((c) => ({
        key: `c-${c.username}`,
        kind: "Creators",
        label: c.displayName ?? c.username,
        sub: `@${c.username}`,
        avatar: c.profilePicture,
        onSelect: () => go(`/influencer/${c.username}`),
      }));

    const campaignItems: Item[] = campaigns
      .filter((c) => !needle || has(c.name) || has(c.client))
      .slice(0, 5)
      .map((c) => ({
        key: `p-${c.id}`,
        kind: "Campaigns",
        label: c.name,
        sub: c.client,
        glyph: "◆",
        onSelect: () => go(`/campaigns/${c.id}`),
      }));

    const actionItems: Item[] = [
      { key: "a-poll", kind: "Actions" as const, label: "Run poll now", glyph: "⟳", onSelect: runPoll },
      ...NAV.map((n) => ({ key: `a-${n.href}`, kind: "Actions" as const, label: n.label, glyph: "→", onSelect: () => go(n.href) })),
    ].filter((a) => !needle || has(a.label));

    return [...creatorItems, ...campaignItems, ...actionItems];
  }, [q, creators, campaigns, go, runPoll]);

  useEffect(() => setActive(0), [q]);

  // Global ⌘K / Ctrl+K to open; arrows + enter + escape while open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (!open) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        items[active]?.onSelect();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, active, close]);

  // Focus the input + lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  let lastKind: string | null = null;

  return (
    <>
      {/* Trigger — full bar (dashboard) or compact sidebar row (global nav) */}
      {variant === "bar" ? (
        <button
          onClick={() => setOpen(true)}
          className="mb-5 flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left text-sm text-subtle transition-colors hover:border-accent/50 hover:bg-surface-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="h-4 w-4 shrink-0">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          Search creators, campaigns, actions…
          <kbd className="ml-auto rounded-md border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-subtle">⌘K</kbd>
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-2.5 py-1.5 text-left text-[12.5px] text-subtle transition-colors hover:border-accent/40 hover:text-muted"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="h-3.5 w-3.5 shrink-0">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.5" y2="16.5" />
          </svg>
          Search
          <kbd className="ml-auto rounded border border-line px-1 py-px font-mono text-[9.5px] text-subtle">⌘K</kbd>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="mt-[13vh] w-[560px] max-w-full overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
            <div className="flex items-center gap-2.5 border-b border-line-soft px-4">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="h-4 w-4 shrink-0 text-subtle">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.5" y2="16.5" />
              </svg>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Jump to a creator, campaign, or action…"
                className="w-full bg-transparent py-3.5 text-[15px] text-fg placeholder:text-subtle focus:outline-none"
              />
              <kbd className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-subtle">esc</kbd>
            </div>

            <div className="max-h-[46vh] overflow-y-auto p-1.5">
              {items.length === 0 && (
                <div className="px-3 py-8 text-center text-sm text-subtle">No matches for “{q}”.</div>
              )}
              {items.map((it, i) => {
                const header = it.kind !== lastKind ? it.kind : null;
                lastKind = it.kind;
                return (
                  <div key={it.key}>
                    {header && (
                      <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-subtle">
                        {header}
                      </div>
                    )}
                    <button
                      onMouseMove={() => setActive(i)}
                      onClick={it.onSelect}
                      className={clsx(
                        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm",
                        i === active ? "bg-accent-soft text-fg" : "text-muted",
                      )}
                    >
                      {it.avatar !== undefined ? (
                        it.avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.avatar} alt="" className="h-6 w-6 rounded-full object-cover ring-1 ring-line-soft" />
                        ) : (
                          <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-[11px] font-medium text-muted ring-1 ring-line-soft">
                            {it.label.charAt(0).toUpperCase()}
                          </span>
                        )
                      ) : (
                        <span className="grid h-6 w-6 place-items-center rounded-md bg-surface-2 font-mono text-xs text-subtle">
                          {it.glyph}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-fg">{it.label}</span>
                      {it.sub && <span className="truncate font-mono text-xs text-subtle">{it.sub}</span>}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-3 border-t border-line-soft px-4 py-2 text-[11px] text-subtle">
              <span><kbd className="font-mono">↑↓</kbd> navigate</span>
              <span><kbd className="font-mono">↵</kbd> select</span>
              <span><kbd className="font-mono">esc</kbd> close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
