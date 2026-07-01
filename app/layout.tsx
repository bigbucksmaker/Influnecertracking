import "./globals.css";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { auth } from "@/auth";
import { Nav } from "@/components/Nav";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "virality.studio — Atomik Growth",
  description: "Track and vet X (Twitter) influencers for client campaigns.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        {session?.user ? (
          <div className="flex min-h-screen">
            <Nav email={session.user.email ?? ""} />
            <main className="min-w-0 flex-1">
              <div className="mx-auto max-w-[1440px] px-6 py-7 lg:px-9">{children}</div>
            </main>
          </div>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
