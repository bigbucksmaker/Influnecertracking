import { listTrackers } from "@/lib/live";
import { cachedCampaigns } from "@/lib/cache";
import { LiveTrackersManager } from "@/components/LiveTrackersManager";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // headroom for Neon cold-starts (see lib/db.ts retry)

export default async function LivePage() {
  const [trackers, campaigns] = await Promise.all([listTrackers(), cachedCampaigns()]);
  return (
    <>
      <PageHeader
        eyebrow="Launch ops"
        title="Live post tracking"
        description="Minute-by-minute telemetry for a launch post — views, engagement pace, and the quote-tweet amplification feed."
      />
      <LiveTrackersManager
        trackers={trackers}
        campaigns={campaigns.filter((c) => c.status === "active").map((c) => ({ id: c.id, name: c.name }))}
      />
    </>
  );
}
