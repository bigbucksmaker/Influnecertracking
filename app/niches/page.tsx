import { NicheManager } from "@/components/NicheManager";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

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
