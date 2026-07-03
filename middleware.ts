import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Gate every page behind auth. API routes do their own checks (session or
// CRON_SECRET), so they're excluded from the matcher below.
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/share/"); // token-gated public views (e.g. live tracker shares)
  if (!req.auth && !isPublic) {
    const url = new URL("/login", req.nextUrl.origin);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
