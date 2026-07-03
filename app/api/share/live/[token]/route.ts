import { NextResponse } from "next/server";
import { getTrackerPayloadByToken } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * PUBLIC read-only payload for a shared live tracker. No session required —
 * the unguessable token is the credential. Never ticks: public viewers read
 * the latest stored beats and can't trigger provider calls or spend credits.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = await getTrackerPayloadByToken(token);
  if (!payload) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(payload);
}
