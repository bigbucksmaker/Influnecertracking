import { NextResponse, after } from "next/server";
import { requireUser } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { runBackgroundPoll } from "@/lib/polling";
import { revalidateTag } from "next/cache";
import { CACHE_TAG } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Manual "run poll now": kicks off a server-side background job that continues
// even if the user refreshes/closes the tab. Returns immediately; the client
// tracks progress via GET /api/poll/status.
export async function POST(req: Request) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;

  const body = await req.json().catch(() => ({}) as any);
  const force = body?.force === true;

  const settings = await getSettings();
  const running =
    !!settings.pollRunningAt && Date.now() - settings.pollRunningAt.getTime() < 5 * 60 * 1000;
  if (running) return NextResponse.json({ started: false, reason: "already-running" });

  after(async () => {
    try {
      await runBackgroundPoll({ force });
    } finally {
      revalidateTag(CACHE_TAG);
    }
  });

  return NextResponse.json({ started: true });
}
