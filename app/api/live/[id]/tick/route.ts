import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { tickTracker, getTrackerPayload } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One measurement cycle + fresh payload. The panel calls this on its refresh
 * interval; server-side rate-limiting in tickTracker means any number of open
 * tabs cost at most one provider call per tracker interval.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const tick = await tickTracker(id);
  const payload = await getTrackerPayload(id);
  if (!payload) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...payload, tick });
}
