import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTrackerPayloadByToken } from "@/lib/live";
import { LivePanel } from "@/components/LivePanel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Live post tracker — virality.studio",
  description: "Real-time views and engagement telemetry for a launch post.",
  robots: { index: false, follow: false }, // unguessable link — keep it out of search
};

/**
 * PUBLIC read-only view of a live tracker. No login — the unguessable token in
 * the URL is the credential. Rendered read-only: no controls, no internal
 * links, and refreshes never trigger provider calls.
 */
export default async function SharedLiveTrackerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const payload = await getTrackerPayloadByToken(token);
  if (!payload) notFound();
  return (
    <div className="mx-auto max-w-[1280px] px-5 py-8">
      <LivePanel initial={payload} publicToken={token} />
    </div>
  );
}
