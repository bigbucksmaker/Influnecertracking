"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { doSignOut } from "@/app/actions/auth";

const I = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  leaderboard: (
    <>
      <line x1="6" y1="20" x2="6" y2="12" />
      <line x1="12" y1="20" x2="12" y2="5" />
      <line x1="18" y1="20" x2="18" y2="9" />
    </>
  ),
  campaigns: (
    <>
      <path d="M3 11l15-6v14L3 13z" />
      <path d="M7 12v4a2 2 0 0 0 4 0" />
    </>
  ),
  shortlists: (
    <>
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <path d="M4 6l1 1 1.5-1.5" />
      <path d="M4 12l1 1 1.5-1.5" />
      <path d="M4 18l1 1 1.5-1.5" />
    </>
  ),
  watchlist: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  niches: (
    <>
      <path d="M20 12l-8 8-8-8 8-8h8z" />
      <circle cx="15" cy="9" r="1.3" />
    </>
  ),
  cost: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.6 9.4c0-1.1 1.1-1.9 2.4-1.9s2.4.8 2.4 1.9-1.1 1.9-2.4 1.9-2.4.9-2.4 2 1.1 2 2.4 2 2.4-.9 2.4-2" />
    </>
  ),
  settings: (
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="9" cy="7" r="2.4" />
      <circle cx="15" cy="17" r="2.4" />
    </>
  ),
} as const;

const LINKS: { href: string; label: string; icon: keyof typeof I }[] = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/leaderboard", label: "Leaderboard", icon: "leaderboard" },
  { href: "/campaigns", label: "Campaigns", icon: "campaigns" },
  { href: "/shortlists", label: "Shortlists", icon: "shortlists" },
  { href: "/accounts", label: "Watchlist", icon: "watchlist" },
  { href: "/niches", label: "Niches", icon: "niches" },
  { href: "/cost", label: "Cost", icon: "cost" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function Nav({ email }: { email: string }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <aside className="sticky top-0 flex h-screen w-60 flex-col border-r border-line-soft bg-surface px-3 py-4">
      <Link href="/" className="mb-4 flex items-center gap-2.5 px-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-700 text-sm font-bold text-white shadow-[0_0_0_1px_rgba(124,109,247,0.35)]">
          V
        </span>
        <span className="leading-tight">
          <span className="block text-[13.5px] font-semibold tracking-[-0.01em] text-fg">virality.studio</span>
          <span className="block text-[10.5px] text-subtle">Atomik Growth</span>
        </span>
      </Link>

      <nav className="flex flex-col gap-0.5">
        {LINKS.map((l) => {
          const active = isActive(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={clsx(
                "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                active ? "bg-accent-soft text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={clsx("h-[18px] w-[18px] shrink-0", active ? "stroke-accent-400" : "stroke-current")}
              >
                {I[l.icon]}
              </svg>
              {l.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2 pt-4">
        <div className="flex items-center gap-2.5 px-1">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-fg">
            {(email || "?").charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[12px] font-medium text-fg">{email.split("@")[0] || "account"}</span>
            <span className="block truncate text-[10.5px] text-subtle">@{email.split("@")[1] || "atomikgrowth.com"}</span>
          </span>
        </div>
        <form action={doSignOut}>
          <button className="w-full rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:border-line hover:text-fg">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
