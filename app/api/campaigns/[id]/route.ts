import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api";
import { getCampaignDetail } from "@/lib/placements";
import { revalidateTag } from "next/cache";
import { CACHE_TAG } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    client: z.string().trim().min(1).max(120),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().nullable(),
    status: z.enum(["active", "closed"]),
  })
  .partial();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const campaign = await getCampaignDetail(id);
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ campaign });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update", details: parsed.error.flatten() }, { status: 400 });
  }
  const existing = await prisma.campaign.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const campaign = await prisma.campaign.update({ where: { id }, data: parsed.data });
  revalidateTag(CACHE_TAG);
  return NextResponse.json({ campaign });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  // Deleting a campaign cascades to its placements (never the Post/Account).
  await prisma.campaign.delete({ where: { id } }).catch(() => null);
  revalidateTag(CACHE_TAG);
  return NextResponse.json({ ok: true });
}
