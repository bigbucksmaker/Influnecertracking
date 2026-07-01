import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api";
import { attachPlacement } from "@/lib/placements";
import { revalidateTag } from "next/cache";
import { CACHE_TAG } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  campaignId: z.string().min(1),
  input: z.string().trim().min(1), // tweet URL or id
  type: z.enum(["post", "quote", "thread", "retweet"]).optional(),
  priceUsd: z.coerce.number().min(0).nullable().optional(), // stored, never computed on
  note: z.string().trim().max(500).nullable().optional(),
});

export async function POST(req: Request) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid placement", details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const result = await attachPlacement(parsed.data);
    revalidateTag(CACHE_TAG);
    return NextResponse.json({
      ok: true,
      placement: result.placement,
      ingested: result.ingested,
      warning: result.warning ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to attach placement";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
