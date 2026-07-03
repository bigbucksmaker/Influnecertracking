import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api";
import { upsertTags, parseRateInput, deleteAccountCascade } from "@/lib/accounts";
import { revalidateTag } from "next/cache";
import { CACHE_TAG } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const body = await req.json().catch(() => ({}) as any);

  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: {
    status?: string;
    rateQuoteTweet?: number | null;
    ratePost?: number | null;
    rateRetweet?: number | null;
    rateThread?: number | null;
    ratesUpdatedAt?: Date;
  } = {};
  if (body.status === "active" || body.status === "paused") data.status = body.status;

  // Rates: apply changes, stamp freshness, and write the negotiation audit trail.
  const rateChanges: { field: string; oldValue: number | null; newValue: number | null }[] = [];
  for (const key of ["rateQuoteTweet", "ratePost", "rateRetweet", "rateThread"] as const) {
    if (key in body) {
      const next = parseRateInput(body[key]);
      data[key] = next;
      if (next !== account[key]) rateChanges.push({ field: key, oldValue: account[key], newValue: next });
    }
  }
  if (rateChanges.length) data.ratesUpdatedAt = new Date();

  if (Object.keys(data).length) await prisma.account.update({ where: { id }, data });

  if (rateChanges.length) {
    // Best-effort: an un-migrated RateEvent table must never block a rate save.
    try {
      await prisma.rateEvent.createMany({
        data: rateChanges.map((c) => ({ ...c, accountId: id, changedBy: gate.email })),
      });
    } catch {
      /* table may not exist yet (pre-`prisma db push`) — the rate change itself is saved */
    }
  }

  // Replace the full tag set if `tags` is provided.
  if (Array.isArray(body.tags)) {
    const tagIds = await upsertTags(body.tags);
    await prisma.accountTag.deleteMany({ where: { accountId: id } });
    for (const tagId of tagIds) {
      await prisma.accountTag.create({ data: { accountId: id, tagId } });
    }
  }

  revalidateTag(CACHE_TAG);
  const updated = await prisma.account.findUnique({
    where: { id },
    include: { tags: { include: { tag: true } } },
  });
  return NextResponse.json({
    ok: true,
    account: updated && {
      id: updated.id,
      username: updated.username,
      status: updated.status,
      tags: updated.tags.map((t) => t.tag.name),
      rateQuoteTweet: updated.rateQuoteTweet,
      ratePost: updated.ratePost,
      rateRetweet: updated.rateRetweet,
      rateThread: updated.rateThread,
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const existing = await prisma.account.findUnique({ where: { id }, select: { username: true } });
  if (!existing) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  try {
    await deleteAccountCascade(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Could not remove @${existing.username}: ${message}` },
      { status: 500 },
    );
  }
  revalidateTag(CACHE_TAG);
  return NextResponse.json({ ok: true, deleted: existing.username });
}
