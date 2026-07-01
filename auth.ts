import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

const allowedDomain = (process.env.ALLOWED_EMAIL_DOMAIN ?? "atomikgrowth.com").toLowerCase();
const devBypass = process.env.DEV_AUTH_BYPASS === "true";

const providers = [
  Google({
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
  }),
];

// Local-only escape hatch so the app is usable before Google creds are wired up.
if (devBypass) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev login",
      credentials: {},
      async authorize() {
        return {
          id: "dev-user",
          name: "Dev User",
          email: `dev@${allowedDomain}`,
        };
      },
    }) as any,
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  callbacks: {
    async signIn({ user, account }) {
      if (devBypass && account?.provider === "dev") return true;
      const email = (user?.email ?? "").toLowerCase();
      // Restrict to the company Google Workspace domain.
      return email.endsWith("@" + allowedDomain);
    },
    async session({ session, token }) {
      if (session.user && token.sub) (session.user as { id?: string }).id = token.sub;
      return session;
    },
  },
});
