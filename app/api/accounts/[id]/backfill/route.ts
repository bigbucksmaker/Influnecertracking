import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { backfillAccount } from "@/lib/polling";
import { revalidateTag } from "next/cache";
import { CACHE_TAG } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const result = await backfillAccount(id);
  revalidateTag(CACHE_TAG);
  return NextResponse.json({ result });
}
