import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/api";
import { tickAllLive } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Per-minute cron: keeps live trackers ticking when nobody has the panel open. */
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await tickAllLive();
  return NextResponse.json({ ok: true, ...result });
}
