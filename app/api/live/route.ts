import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api";
import { createTracker, listTrackers } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  tweet: z.string().trim().min(3),
  label: z.string().trim().max(140).nullable().optional(),
  campaignId: z.string().nullable().optional(),
  intervalSec: z.number().int().min(30).max(3600).nullable().optional(),
  maxDurationMin: z.number().int().min(10).max(10080).nullable().optional(),
});

export async function GET() {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  return NextResponse.json({ trackers: await listTrackers() });
}

export async function POST(req: Request) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid tracker input" }, { status: 400 });
  }
  try {
    const { trackerId } = await createTracker({ ...parsed.data, createdBy: gate.email });
    return NextResponse.json({ ok: true, trackerId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start the tracker";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
