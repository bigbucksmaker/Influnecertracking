import "./globals.css";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { auth } from "@/auth";
import { Nav } from "@/components/Nav";
import { AskWidget } from "@/components/AskWidget";
import { CommandPalette } from "@/components/CommandPalette";
import { cachedLeaderboard, cachedCampaigns } from "@/lib/cache";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "virality.studio — Atomik Growth",
  description: "Track, price, and vet X (Twitter) influencers for client campaigns.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  // Palette data — cached reads (120s TTL), shared with the pages themselves.
  let palette: React.ReactNode = null;
  if (session?.user) {
    const [board, campaigns] = await Promise.all([
      cachedLeaderboard().catch(() => []),
      cachedCampaigns().catch(() => []),
    ]);
    palette = (
      <CommandPalette
        variant="nav"
        creators={board.map((r) => ({
          username: r.username,
          displayName: r.displayName,
          profilePicture: r.profilePicture,
        }))}
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name, client: c.client }))}
      />
    );
  }

  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <div className="ambient" aria-hidden />
        {session?.user ? (
          <>
            <div className="flex min-h-screen">
              <Nav email={session.user.email ?? ""} search={palette} />
              <main className="min-w-0 flex-1">
                <div className="mx-auto max-w-[1440px] px-6 py-7 lg:px-9">{children}</div>
              </main>
            </div>
            <AskWidget />
          </>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
