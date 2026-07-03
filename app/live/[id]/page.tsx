import { notFound } from "next/navigation";
import { getTrackerPayload } from "@/lib/live";
import { LivePanel } from "@/components/LivePanel";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // headroom for Neon cold-starts (see lib/db.ts retry)

export default async function LiveTrackerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = await getTrackerPayload(id);
  if (!payload) notFound();
  return <LivePanel initial={payload} />;
}
