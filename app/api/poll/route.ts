import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { pollAllDue } from "@/lib/polling";
import { revalidateTag } from "next/cache";
import { CACHE_TAG } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Manual "run poll now" trigger from the dashboard.
export async function POST(req: Request) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const body = await req.json().catch(() => ({}) as any);
  const force = body?.force === true;
  const limit = Number.isFinite(body?.limit) ? Number(body.limit) : undefined;
  const summary = await pollAllDue({ force, limit });
  revalidateTag(CACHE_TAG);
  return NextResponse.json({ summary });
}
