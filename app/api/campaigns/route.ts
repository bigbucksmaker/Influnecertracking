import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api";
import { getCampaignsOverview } from "@/lib/placements";
import { revalidateTag } from "next/cache";
import { CACHE_TAG } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  client: z.string().trim().min(1).max(120),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  status: z.enum(["active", "closed"]).optional(),
});

export async function GET() {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  return NextResponse.json({ campaigns: await getCampaignsOverview() });
}

export async function POST(req: Request) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid campaign", details: parsed.error.flatten() }, { status: 400 });
  }
  const { name, client, startDate, endDate, status } = parsed.data;
  const campaign = await prisma.campaign.create({
    data: {
      name,
      client,
      startDate: startDate ?? new Date(),
      endDate: endDate ?? null,
      status: status ?? "active",
      createdBy: gate.email,
    },
  });
  revalidateTag(CACHE_TAG);
  return NextResponse.json({ campaign });
}
