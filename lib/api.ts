import { auth } from "@/auth";
import { NextResponse } from "next/server";

/** Returns the signed-in user's email, or a 401 Response to return early. */
export async function requireUser(): Promise<
  { email: string } | { error: NextResponse }
> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { email };
}

/** Validate a Vercel Cron / manual trigger request against CRON_SECRET. */
export function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret;
}
