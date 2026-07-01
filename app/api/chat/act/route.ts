import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireUser } from "@/lib/api";
import { addShortlistItem } from "@/lib/shortlists";
import { CACHE_TAG } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Executes an assistant-proposed write action AFTER the user clicks Confirm in
 * the widget. The model never triggers these directly — the confirm click does.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if ("error" in user) return user.error;

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    username?: string;
    shortlistId?: string;
    note?: string;
  };

  if (body.action === "addToShortlist") {
    if (!body.shortlistId || !body.username) {
      return NextResponse.json({ ok: false, error: "shortlistId and username are required." }, { status: 400 });
    }
    const res = await addShortlistItem(body.shortlistId, body.username, body.note ?? null);
    if (!res.ok) return NextResponse.json(res, { status: 400 });
    revalidateTag(CACHE_TAG);
    return NextResponse.json({ ok: true, username: body.username, shortlistId: body.shortlistId });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
}
