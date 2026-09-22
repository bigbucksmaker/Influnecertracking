import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { backfillAccount } from "@/lib/polling";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const result = await backfillAccount(id);
  for (const t of [CACHE_TAGS.data, CACHE_TAGS.leaderboard, CACHE_TAGS.accounts, CACHE_TAGS.influencer, CACHE_TAGS.campaigns]) revalidateTag(t);
  return NextResponse.json({ result });
}
