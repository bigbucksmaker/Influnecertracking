import { cachedShortlists, cachedCampaigns } from "@/lib/cache";
import { ShortlistsManager } from "@/components/ShortlistsManager";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ShortlistsPage() {
  const [shortlists, campaigns] = await Promise.all([cachedShortlists(), cachedCampaigns()]);
  return (
    <>
      <PageHeader
        title="Shortlists"
        description="Saved candidate creators per campaign — reach, engagement, median & consistency only. Add from the leaderboard (☆) or by handle, annotate, and export CSV."
      />
      <ShortlistsManager
        shortlists={shortlists}
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      />
    </>
  );
}
