import { notFound } from "next/navigation";
import { cachedCampaignDetail, cachedShortlists } from "@/lib/cache";
import { getSettings } from "@/lib/settings";
import { listTrackers } from "@/lib/live";
import { CampaignDetail } from "@/components/CampaignDetail";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // headroom for Neon cold-starts (see lib/db.ts retry)

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [campaign, settings, shortlists, trackers] = await Promise.all([
    cachedCampaignDetail(id),
    getSettings(),
    cachedShortlists(),
    listTrackers(id),
  ]);
  if (!campaign) notFound();
  return (
    <CampaignDetail
      campaign={campaign}
      underdeliverThreshold={settings.underdeliverThreshold}
      rosterShortlists={shortlists.filter((s) => s.campaignId === id)}
      trackers={trackers}
    />
  );
}
