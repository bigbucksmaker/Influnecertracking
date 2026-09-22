import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { deleteShortlist } from "@/lib/shortlists";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  await deleteShortlist(id);
  for (const t of [CACHE_TAGS.shortlists]) revalidateTag(t);
  return NextResponse.json({ ok: true });
}
