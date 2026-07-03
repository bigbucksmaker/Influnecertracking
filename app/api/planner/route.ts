import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api";
import { cachedLeaderboard } from "@/lib/cache";
import { buildPlan } from "@/lib/planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // headroom for Neon cold-starts

const schema = z.object({
  budgetUsd: z.number().min(1).max(10_000_000),
  format: z.enum(["qt", "post", "thread"]),
  niche: z.string().trim().max(120).nullable().optional(),
  includeLowConfidence: z.boolean().optional(),
  minMedianViews: z.number().min(0).nullable().optional(),
  maxCreators: z.number().int().min(1).max(100).nullable().optional(),
});

export async function POST(req: Request) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid plan input" }, { status: 400 });
  }
  const rows = await cachedLeaderboard();
  return NextResponse.json({ plan: buildPlan(rows, parsed.data) });
}
