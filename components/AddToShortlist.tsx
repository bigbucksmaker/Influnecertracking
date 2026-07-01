"use client";

import { useState } from "react";

// Module-level cache so opening the picker on many rows only fetches once.
let listsCache: { id: string; name: string }[] | null = null;

export function AddToShortlist({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<{ id: string; name: string }[] | null>(listsCache);
  const [state, setState] = useState<"idle" | "added" | "error">("idle");

  async function load() {
    if (listsCache) {
      setLists(listsCache);
      return;
    }
    try {
      const r = await fetch("/api/shortlists");
      const j = await r.json();
      listsCache = (j.shortlists ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }));
      setLists(listsCache);
    } catch {
      setLists([]);
    }
  }

  async function add(id: string) {
    setState("idle");
    try {
      const r = await fetch(`/api/shortlists/${id}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: username }),
      });
      setState(r.ok ? "added" : "error");
    } catch {
      setState("error");
    }
    setOpen(false);
    setTimeout(() => setState("idle"), 1500);
  }

  return (
    <span className="relative inline-block">
      <button
        onClick={() => {
          setOpen((o) => !o);
          load();
        }}
        title="Add to shortlist"
        className="text-xs text-subtle hover:text-accent-400"
      >
        {state === "added" ? "★" : "☆"}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-line bg-surface py-1 text-left shadow-lg">
            {lists == null ? (
              <div className="px-3 py-2 text-xs text-subtle">Loading…</div>
            ) : lists.length === 0 ? (
              <div className="px-3 py-2 text-xs text-subtle">
                No shortlists yet. Create one on the Shortlists page.
              </div>
            ) : (
              lists.map((l) => (
                <button
                  key={l.id}
                  onClick={() => add(l.id)}
                  className="block w-full truncate px-3 py-1.5 text-left text-sm text-muted hover:bg-surface-2"
                >
                  {l.name}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </span>
  );
}
