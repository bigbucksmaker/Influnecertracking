import "./globals.css";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Influencer Tracking — Atomik Growth",
  description: "Track and vet X (Twitter) influencers for client campaigns.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="en">
      <body>
        {session?.user ? (
          <div className="min-h-screen">
            <Nav email={session.user.email ?? ""} />
            <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
