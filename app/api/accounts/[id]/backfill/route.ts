import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { backfillAccount } from "@/lib/polling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const result = await backfillAccount(id);
  return NextResponse.json({ result });
}
