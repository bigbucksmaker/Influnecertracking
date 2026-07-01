"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";

type Inv = {
  toolCallId: string;
  toolName: string;
  state: "partial-call" | "call" | "result";
  args?: Record<string, unknown>;
  result?: unknown;
};

const EXAMPLES = [
  "Top 5 AI creators by median views",
  "Who's rising this week in crypto?",
  "Compare @levelsio and @nikitabier",
  "Creators with >50k median and steady consistency",
];

const READ_LABELS: Record<string, string> = {
  queryLeaderboard: "searched the leaderboard",
  getCreator: "looked up a creator",
  compareCreators: "compared creators",
  listMovers: "checked movers",
  listNiches: "listed niches",
  listCampaigns: "checked campaigns",
  listShortlists: "listed shortlists",
  costSummary: "checked spend",
  runSql: "ran a SQL query",
};

// Render [label](url) as links; everything else as plain text.
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => {
        const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (!m) return <span key={i}>{p}</span>;
        const external = /^https?:\/\//.test(m[2]);
        return (
          <a
            key={i}
            href={m[2]}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="text-accent-400 hover:underline"
          >
            {m[1]}
          </a>
        );
      })}
    </span>
  );
}

export function AskWidget() {
  const [open, setOpen] = useState(false);
  const { messages, input, handleInputChange, handleSubmit, addToolResult, append, status, error, reload } = useChat({
    api: "/api/chat",
    maxSteps: 6,
  });
  const busy = status === "submitted" || status === "streaming";

  async function confirmAction(inv: Inv) {
    try {
      if (inv.toolName === "runPoll") {
        const r = await fetch("/api/poll", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        addToolResult({ toolCallId: inv.toolCallId, result: r.ok ? { started: true } : { error: "Poll failed to start." } });
      } else if (inv.toolName === "addToShortlist") {
        const r = await fetch("/api/chat/act", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "addToShortlist", ...(inv.args ?? {}) }),
        });
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        addToolResult({ toolCallId: inv.toolCallId, result: r.ok ? d : { error: d.error ?? "Failed to add." } });
      }
    } catch {
      addToolResult({ toolCallId: inv.toolCallId, result: { error: "Action failed." } });
    }
  }

  function cancelAction(inv: Inv) {
    addToolResult({ toolCallId: inv.toolCallId, result: { cancelled: true } });
  }

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Ask the data assistant"
        className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-[0_8px_28px_rgba(124,109,247,0.45)] transition-transform hover:scale-105"
      >
        {open ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-50 flex h-[70vh] max-h-[640px] w-[400px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-accent-soft text-accent-400">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-fg">Ask</div>
              <div className="text-[10.5px] text-subtle">Grounded in your live data</div>
            </div>
          </div>

          {/* Messages */}
          <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="pt-2">
                <p className="text-sm text-subtle">Ask about the leaderboard, movers, campaigns, or spend. Try:</p>
                <div className="mt-2 flex flex-col gap-1.5">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => append({ role: "user", content: ex })}
                      className="rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-left text-[13px] text-muted hover:border-line hover:text-fg"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => {
              const invs = ((m as unknown as { toolInvocations?: Inv[] }).toolInvocations ?? []) as Inv[];
              return (
                <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-br-sm bg-accent-soft px-3 py-2 text-[13px] text-fg"
                        : "max-w-[92%] text-[13px] text-fg"
                    }
                  >
                    {m.content && <RichText text={m.content} />}

                    {invs.map((inv) => {
                      const isWrite = inv.toolName === "addToShortlist" || inv.toolName === "runPoll";
                      if (isWrite && inv.state === "call") {
                        const a = inv.args ?? {};
                        const label =
                          inv.toolName === "runPoll"
                            ? "Refresh all tracked accounts now?"
                            : `Add @${String(a.username ?? "")} to ${String(a.shortlistName ?? "the shortlist")}?`;
                        return (
                          <div key={inv.toolCallId} className="mt-2 rounded-xl border border-line bg-surface-2 p-3">
                            <div className="text-[13px] text-fg">{label}</div>
                            <div className="mt-2 flex gap-2">
                              <button onClick={() => confirmAction(inv)} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600">
                                Confirm
                              </button>
                              <button onClick={() => cancelAction(inv)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted hover:text-fg">
                                Cancel
                              </button>
                            </div>
                          </div>
                        );
                      }
                      if (isWrite && inv.state === "result") {
                        const res = (inv.result ?? {}) as { cancelled?: boolean; error?: string };
                        return (
                          <div key={inv.toolCallId} className="mt-1.5 text-[11.5px] text-subtle">
                            {res.cancelled ? "Cancelled." : res.error ? `Failed: ${res.error}` : "Done."}
                          </div>
                        );
                      }
                      // read tools — subtle activity chip
                      if (inv.state !== "result") return null;
                      return (
                        <div key={inv.toolCallId} className="mt-1.5 flex items-center gap-1.5 text-[11px] text-subtle">
                          <span className="h-1 w-1 rounded-full bg-accent-400" />
                          {READ_LABELS[inv.toolName] ?? inv.toolName}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {busy && <div className="text-[11.5px] text-subtle">Thinking…</div>}

            {error && (
              <div className="rounded-xl border border-neg/40 bg-neg-soft px-3 py-2 text-[12.5px] text-neg">
                <div className="font-medium">Something went wrong</div>
                <div className="mt-0.5 break-words text-[11.5px] opacity-90">{error.message || "Unknown error."}</div>
                <button onClick={() => reload()} className="mt-1.5 text-[11.5px] font-medium underline hover:no-underline">
                  Retry
                </button>
              </div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="border-t border-line-soft p-2.5">
            <div className="flex items-end gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 focus-within:border-accent">
              <input
                value={input}
                onChange={handleInputChange}
                placeholder="Ask about your creators…"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-fg placeholder:text-subtle focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
