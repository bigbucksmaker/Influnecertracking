import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shared, DB-backed poll status — so progress is consistent across tabs/users
// and survives a page refresh.
export async function GET() {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;

  const [settings, total, backfilled, latest] = await Promise.all([
    getSettings(),
    prisma.account.count({ where: { status: "active" } }),
    prisma.account.count({ where: { status: "active", backfilledAt: { not: null } } }),
    prisma.account.aggregate({ where: { status: "active" }, _max: { lastPolledAt: true } }),
  ]);

  const running =
    !!settings.pollRunningAt && Date.now() - settings.pollRunningAt.getTime() < 5 * 60 * 1000;

  return NextResponse.json({
    total,
    backfilled,
    pending: total - backfilled,
    running,
    done: settings.pollDone,
    pollTotal: settings.pollTotal,
    startedAt: settings.pollRunningAt ? settings.pollRunningAt.toISOString() : null,
    lastPollAt: latest._max.lastPolledAt ? latest._max.lastPolledAt.toISOString() : null,
  });
}
