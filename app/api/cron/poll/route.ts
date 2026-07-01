import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/api";
import { runBackgroundPoll } from "@/lib/polling";
import { revalidateTag } from "next/cache";
import { CACHE_TAG } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Note: Vercel Hobby caps functions at 60s; Pro/Enterprise allow up to 300s.
export const maxDuration = 300;

// Vercel Cron hits this on a schedule (see vercel.json). runBackgroundPoll only
// polls accounts actually due per their tier, and takes the shared job lock so
// it won't collide with a manual run.
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runBackgroundPoll();
  revalidateTag(CACHE_TAG);
  return NextResponse.json({ ok: true, ...result });
}
