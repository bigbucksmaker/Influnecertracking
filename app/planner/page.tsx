import Link from "next/link";
import { getAllTags } from "@/lib/accounts";
import { cachedLeaderboard, cachedCampaigns } from "@/lib/cache";
import { BudgetPlanner } from "@/components/BudgetPlanner";
import { PageHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // headroom for Neon cold-starts (see lib/db.ts retry)

export default async function PlannerPage() {
  const [rows, tags, campaigns] = await Promise.all([
    cachedLeaderboard(),
    getAllTags(),
    cachedCampaigns(),
  ]);

  const priced = rows.filter((r) => r.basisRate != null).length;

  if (rows.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Value layer" title="Budget planner" />
        <EmptyState title="No influencers tracked yet" href="/accounts" cta="Add influencers">
          Track some creators first — the planner allocates a budget across the roster.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Value layer"
        title="Budget planner"
        description={`Turn a budget into a slate: allocation by expected views per dollar across ${priced} priced creator${priced === 1 ? "" : "s"}.`}
        actions={
          <Link href="/leaderboard?preset=value" className="text-sm text-money-400 hover:underline">
            Best-value ranking →
          </Link>
        }
      />
      {priced === 0 ? (
        <EmptyState title="No rates set yet" href="/leaderboard" cta="Open leaderboard">
          The planner needs campaign rates. Set them from the leaderboard (✎ rates) or import the
          roster CSV, then come back.
        </EmptyState>
      ) : (
        <BudgetPlanner
          allTags={tags}
          campaigns={campaigns.filter((c) => c.status === "active").map((c) => ({ id: c.id, name: c.name }))}
        />
      )}
    </>
  );
}
