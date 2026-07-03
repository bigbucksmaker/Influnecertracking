import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api";
import { getShortlists, createShortlist, addShortlistItem } from "@/lib/shortlists";
import { revalidateTag } from "next/cache";
import { CACHE_TAG } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  campaignId: z.string().nullable().optional(),
  // Optional bulk seed — used by the budget planner's "save as shortlist".
  items: z
    .array(
      z.object({
        account: z.string().trim().min(1),
        note: z.string().trim().max(300).nullable().optional(),
      }),
    )
    .max(100)
    .optional(),
});

export async function GET() {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  return NextResponse.json({ shortlists: await getShortlists() });
}

export async function POST(req: Request) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid shortlist" }, { status: 400 });
  }
  const shortlist = await createShortlist(parsed.data.name, parsed.data.campaignId, gate.email);
  const failed: string[] = [];
  for (const item of parsed.data.items ?? []) {
    const res = await addShortlistItem(shortlist.id, item.account, item.note ?? null);
    if (!res.ok) failed.push(item.account);
  }
  revalidateTag(CACHE_TAG);
  return NextResponse.json({ shortlist, added: (parsed.data.items?.length ?? 0) - failed.length, failed });
}
