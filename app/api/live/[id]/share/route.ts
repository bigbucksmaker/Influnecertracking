import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { enableShare, disableShare } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create or rotate the public read-only link for a tracker. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  try {
    const shareToken = await enableShare(id);
    return NextResponse.json({ ok: true, shareToken });
  } catch {
    return NextResponse.json({ error: "Tracker not found" }, { status: 404 });
  }
}

/** Revoke the public link. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  await disableShare(id).catch(() => null);
  return NextResponse.json({ ok: true });
}
