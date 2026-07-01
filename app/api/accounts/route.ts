import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/api";
import { parseHandles } from "@/lib/handles";
import { getAccountsOverview, upsertTags } from "@/lib/accounts";
import { backfillAccount } from "@/lib/polling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;
  const accounts = await getAccountsOverview();
  return NextResponse.json({ accounts });
}

export async function POST(req: Request) {
  const gate = await requireUser();
  if ("error" in gate) return gate.error;

  const body = await req.json().catch(() => ({}) as any);
  const rawInput = [
    typeof body.input === "string" ? body.input : "",
    ...(Array.isArray(body.usernames) ? body.usernames : []),
  ]
    .filter(Boolean)
    .join("\n");

  const handles = parseHandles(rawInput);
  if (handles.length === 0) {
    return NextResponse.json({ error: "No valid X handles found." }, { status: 400 });
  }

  const tagIds = await upsertTags(Array.isArray(body.tags) ? body.tags : []);
  const doBackfill = body.backfill !== false;

  const created: { id: string; username: string }[] = [];
  const skipped: string[] = [];

  for (const username of handles) {
    const existing = await prisma.account.findUnique({ where: { username } });
    if (existing) {
      for (const tagId of tagIds) {
        await prisma.accountTag.upsert({
          where: { accountId_tagId: { accountId: existing.id, tagId } },
          update: {},
          create: { accountId: existing.id, tagId },
        });
      }
      skipped.push(username);
      continue;
    }
    const acct = await prisma.account.create({
      data: {
        username,
        addedBy: gate.email,
        status: "active",
        tags: { create: tagIds.map((id) => ({ tag: { connect: { id } } })) },
      },
    });
    created.push({ id: acct.id, username });
  }

  // Backfill on add: pull last N days of posts for each new handle.
  const backfill = [];
  if (doBackfill && created.length > 0) {
    for (const c of created) {
      backfill.push(await backfillAccount(c.id));
    }
  }

  const accounts = await getAccountsOverview();
  return NextResponse.json({
    created: created.map((c) => c.username),
    skipped,
    backfill,
    accounts,
  });
}
