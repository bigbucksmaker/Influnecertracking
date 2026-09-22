import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { computeLeaderboard } from "@/lib/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** TEMPORARY: run computeLeaderboard and return the full error stack. Remove after diagnosis. */
export async function GET() {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  try {
    const rows = await computeLeaderboard();
    return NextResponse.json({ ok: true, count: rows.length });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        name: e instanceof Error ? e.name : "unknown",
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      },
      { status: 200 },
    );
  }
}
