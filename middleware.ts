import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

// Keep middleware independent from the full Auth.js provider configuration.
// It only needs to validate the existing JWT session; loading OAuth providers
// here exhausts the middleware runtime before requests reach the app.
export default async function middleware(req: Request) {
  const { pathname } = new URL(req.url);
  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/share/"); // token-gated public views (e.g. live tracker shares)

  if (isPublic) return NextResponse.next();

  const token = await getToken({ req });
  if (!token) return NextResponse.redirect(new URL("/login", req.url));

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
