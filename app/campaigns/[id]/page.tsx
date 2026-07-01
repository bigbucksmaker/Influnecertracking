import { notFound } from "next/navigation";
import { cachedCampaignDetail } from "@/lib/cache";
import { getSettings } from "@/lib/settings";
import { CampaignDetail } from "@/components/CampaignDetail";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [campaign, settings] = await Promise.all([cachedCampaignDetail(id), getSettings()]);
  if (!campaign) notFound();
  return <CampaignDetail campaign={campaign} underdeliverThreshold={settings.underdeliverThreshold} />;
}
