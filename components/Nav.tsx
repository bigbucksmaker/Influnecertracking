"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { doSignOut } from "@/app/actions/auth";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/accounts", label: "Watchlist" },
  { href: "/cost", label: "Cost" },
  { href: "/settings", label: "Settings" },
];

export function Nav({ email }: { email: string }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-500 text-sm text-white">
            A
          </span>
          <span className="hidden sm:inline">Influencer Tracking</span>
        </Link>
        <nav className="flex flex-1 items-center gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={clsx(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                isActive(l.href)
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-slate-500 md:inline">{email}</span>
          <form action={doSignOut}>
            <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
