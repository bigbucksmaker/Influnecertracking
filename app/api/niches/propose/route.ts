import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { proposeNiches } from "@/lib/niche";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  try {
    const niches = await proposeNiches();
    return NextResponse.json({ niches });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to propose niches" },
      { status: 500 },
    );
  }
}
