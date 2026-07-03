import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { getTrackerPayload, setTrackerStatus, setTrackerInterval, deleteTracker } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const payload = await getTrackerPayload(id);
  if (!payload) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(payload);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { status?: string; intervalSec?: number };

  let changed = false;
  if (body.status === "live" || body.status === "stopped") {
    await setTrackerStatus(id, body.status);
    changed = true;
  }
  if (typeof body.intervalSec === "number" && Number.isFinite(body.intervalSec)) {
    if (body.intervalSec < 5 || body.intervalSec > 3600) {
      return NextResponse.json({ error: "intervalSec must be 5–3600" }, { status: 400 });
    }
    await setTrackerInterval(id, body.intervalSec);
    changed = true;
  }
  if (!changed) {
    return NextResponse.json({ error: "Provide status (live|stopped) and/or intervalSec" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  await deleteTracker(id);
  return NextResponse.json({ ok: true });
}
