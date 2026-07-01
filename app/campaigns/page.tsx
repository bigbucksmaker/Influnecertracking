import { cachedCampaigns } from "@/lib/cache";
import { CampaignsManager } from "@/components/CampaignsManager";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // headroom for Neon cold-starts (see lib/db.ts retry)

export default async function CampaignsPage() {
  const campaigns = await cachedCampaigns();
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Track commissioned posts and whether creators deliver against their own organic baseline. Reach & engagement only — rates are never scored."
      />
      <CampaignsManager campaigns={campaigns} />
    </>
  );
}
