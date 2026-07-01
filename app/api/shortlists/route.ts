import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api";
import { getShortlists, createShortlist } from "@/lib/shortlists";
import { revalidateTag } from "next/cache";
import { CACHE_TAG } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  campaignId: z.string().nullable().optional(),
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
  revalidateTag(CACHE_TAG);
  return NextResponse.json({ shortlist });
}
