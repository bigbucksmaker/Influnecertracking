import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { pollAllDue } from "@/lib/polling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Manual "run poll now" trigger from the dashboard.
export async function POST(req: Request) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const body = await req.json().catch(() => ({}) as any);
  const force = body?.force === true;
  const summary = await pollAllDue({ force });
  return NextResponse.json({ summary });
}
