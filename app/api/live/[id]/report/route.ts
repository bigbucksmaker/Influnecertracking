import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { generateLaunchReport, listLaunchReports } from "@/lib/launch-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // attribution + narrative generation headroom

/** Generate a launch recap ON DEMAND — never automatic. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const result = await generateLaunchReport(id, gate.email);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ ok: true, ...result });
}

/** List a tracker's generated reports. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  return NextResponse.json({ reports: await listLaunchReports(id) });
}
