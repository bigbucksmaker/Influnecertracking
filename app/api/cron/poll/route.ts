import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/api";
import { pollAllDue } from "@/lib/polling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Note: Vercel Hobby caps functions at 60s; Pro/Enterprise allow up to 300s.
export const maxDuration = 300;

// Vercel Cron hits this on a schedule (see vercel.json). Adaptive tiering lives
// in pollAllDue(): it only polls accounts actually due per their tier, so this
// can run frequently without re-polling everything each time.
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await pollAllDue();
  return NextResponse.json({ ok: true, summary });
}
