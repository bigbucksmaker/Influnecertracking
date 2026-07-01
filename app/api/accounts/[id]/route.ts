import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api";
import { upsertTags } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const body = await req.json().catch(() => ({}) as any);

  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: { status?: string } = {};
  if (body.status === "active" || body.status === "paused") data.status = body.status;
  if (Object.keys(data).length) await prisma.account.update({ where: { id }, data });

  // Replace the full tag set if `tags` is provided.
  if (Array.isArray(body.tags)) {
    const tagIds = await upsertTags(body.tags);
    await prisma.accountTag.deleteMany({ where: { accountId: id } });
    for (const tagId of tagIds) {
      await prisma.accountTag.create({ data: { accountId: id, tagId } });
    }
  }

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
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  await prisma.account.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
