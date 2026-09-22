"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Redirects signed-out visitors to /login. The server-side auth() check in
 * the root layout still decides what HTML ships (nav and page data only
 * render for a session), so this component is only the redirect — nothing
 * sensitive is streamed to a signed-out visitor.
 *
 * Edge middleware is intentionally unused for auth: importing next-auth
 * (even just next-auth/jwt's getToken) into the edge bundle caused the
 * middleware instance to be killed for running out of memory in production.
 */
export function AuthGate({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!signedIn && pathname !== "/login" && !pathname.startsWith("/share/")) {
      router.replace("/login");
    }
  }, [signedIn, pathname, router]);

  return null;
}
