import { NicheManager } from "@/components/NicheManager";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // headroom for Neon cold-starts (see lib/db.ts retry)

export default function NichesPage() {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  return (
    <>
      <PageHeader
        title="Niches"
        description="Derive niche categories from tracked post content with AI, then auto-tag every influencer. Uses stored posts — no twitterapi.io credits."
      />
      <NicheManager hasKey={hasKey} />
    </>
  );
}
