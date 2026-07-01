import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api";
import { addShortlistItem } from "@/lib/shortlists";
import { revalidateTag } from "next/cache";
import { CACHE_TAG } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  account: z.string().trim().min(1), // username or account id
  note: z.string().trim().max(500).nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid item" }, { status: 400 });
  }
  const result = await addShortlistItem(id, parsed.data.account, parsed.data.note);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  revalidateTag(CACHE_TAG);
  return NextResponse.json({ ok: true });
}
