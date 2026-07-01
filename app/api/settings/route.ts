import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api";
import { getSettings, updateSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    reachWeight: z.coerce.number().min(0).max(1),
    engagementWeight: z.coerce.number().min(0).max(1),
    planCapCredits: z.coerce.number().int().min(1),
    activeWindowHours: z.coerce.number().int().min(1).max(720),
    activePollHours: z.coerce.number().int().min(1).max(168),
    dormantPollHours: z.coerce.number().int().min(1).max(720),
    freezeAgeDays: z.coerce.number().int().min(1).max(60),
    backfillDays: z.coerce.number().int().min(1).max(90),
    normalization: z.enum(["percentile", "zscore"]),
    includeReplies: z.boolean(),
  })
  .partial();

export async function GET() {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  return NextResponse.json({ settings: await getSettings() });
}

export async function PATCH(req: Request) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings", details: parsed.error.flatten() }, { status: 400 });
  }
  const settings = await updateSettings(parsed.data);
  return NextResponse.json({ settings });
}
