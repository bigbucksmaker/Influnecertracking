import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { classifyAndTagBatch } from "@/lib/niche";
import { revalidateTag } from "next/cache";
import { CACHE_TAG } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Chunked: the client calls this repeatedly with an increasing offset so the
// classification drains all influencers without hitting the function time limit.
export async function POST(req: Request) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;

  const body = await req.json().catch(() => ({}) as any);
  const niches: string[] = Array.isArray(body.niches)
    ? body.niches.filter((n: unknown) => typeof n === "string")
    : [];
  const offset = Number.isFinite(body.offset) ? Number(body.offset) : 0;
  const limit = Number.isFinite(body.limit) ? Number(body.limit) : 20;
  if (niches.length === 0) {
    return NextResponse.json({ error: "No niches provided" }, { status: 400 });
  }

  try {
    const result = await classifyAndTagBatch(niches, offset, Math.min(Math.max(limit, 1), 40));
    if (result.remaining <= 0) revalidateTag(CACHE_TAG);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to classify influencers" },
      { status: 500 },
    );
  }
}
