import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { removeShortlistItem } from "@/lib/shortlists";
import { revalidateTag } from "next/cache";
import { CACHE_TAG } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { itemId } = await params;
  await removeShortlistItem(itemId);
  revalidateTag(CACHE_TAG);
  return NextResponse.json({ ok: true });
}
