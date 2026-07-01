import Link from "next/link";
import { cachedCostSummary } from "@/lib/cache";
import { PLAN_TIERS } from "@/lib/cost";
import { CostWidget } from "@/components/CostWidget";
import { CostDailyChart } from "@/components/CostDailyChart";
import { Card, PageHeader, Badge } from "@/components/ui";
import { formatCredits, formatUsd, formatNumber, formatPct } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // headroom for Neon cold-starts (see lib/db.ts retry)

const ENDPOINT_LABELS: Record<string, string> = {
  user_info: "Profile (user/info)",
  user_last_tweets: "Recent tweets (last_tweets)",
  advanced_search: "Backfill (advanced_search)",
  tweets_by_ids: "Refresh (tweets by id)",
  balance: "Balance check",
};

export default async function CostPage() {
  const cost = await cachedCostSummary();

  return (
    <>
      <PageHeader
        title="Cost tracking"
        description="Every provider call is logged. Credits shown at 100,000 credits = $1."
        actions={
          <Link href="/settings" className="text-sm text-brand-600 hover:underline">
            Adjust cap & cadence →
          </Link>
        }
      />

      <CostWidget summary={cost} />

      <Card className="mt-4 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Daily spend (last 30 days)</h2>
        <CostDailyChart data={cost.byDay} />
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">By endpoint (this month)</h2>
          <table className="data w-full text-sm">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="py-2 text-left">Endpoint</th>
                <th className="py-2 text-right">Requests</th>
                <th className="py-2 text-right">Credits</th>
                <th className="py-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {cost.byEndpoint.map((e) => (
                <tr key={e.endpoint} className="border-b border-slate-100 last:border-0">
                  <td className="py-2">{ENDPOINT_LABELS[e.endpoint] ?? e.endpoint}</td>
                  <td className="py-2 text-right tabular-nums">{formatNumber(e.requests)}</td>
                  <td className="py-2 text-right tabular-nums">{formatCredits(e.credits)}</td>
                  <td className="py-2 text-right tabular-nums">{formatUsd(e.usd)}</td>
                </tr>
              ))}
              {cost.byEndpoint.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-500">
                    No API calls yet this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Top spend by influencer</h2>
          <table className="data w-full text-sm">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="py-2 text-left">Account</th>
                <th className="py-2 text-right">Requests</th>
                <th className="py-2 text-right">Credits</th>
                <th className="py-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {cost.byInfluencer.map((i) => (
                <tr key={i.accountId ?? "none"} className="border-b border-slate-100 last:border-0">
                  <td className="py-2">
                    {i.accountId ? (
                      <Link href={`/influencer/${i.username}`} className="text-brand-600 hover:underline">
                        @{i.username}
                      </Link>
                    ) : (
                      <span className="text-slate-500">{i.username}</span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatNumber(i.requests)}</td>
                  <td className="py-2 text-right tabular-nums">{formatCredits(i.credits)}</td>
                  <td className="py-2 text-right tabular-nums">{formatUsd(i.usd)}</td>
                </tr>
              ))}
              {cost.byInfluencer.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-500">
                    No attributed spend yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Plan tiers</h2>
        <p className="mb-3 text-xs text-slate-500">
          Based on your projected month-end spend of{" "}
          <b>{formatCredits(cost.projectedMonth)}</b>, the recommended plan is highlighted.
        </p>
        <table className="data w-full text-sm">
          <thead className="border-b border-slate-200">
            <tr>
              <th className="py-2 text-left">Plan</th>
              <th className="py-2 text-right">Monthly credits</th>
              <th className="py-2 text-right">Price</th>
              <th className="py-2 text-right">Projected use</th>
              <th className="py-2 text-left"></th>
            </tr>
          </thead>
          <tbody>
            {PLAN_TIERS.map((t) => {
              const isCurrent = t.credits === cost.planCapCredits;
              const isRecommended = cost.recommendedPlan?.name === t.name;
              return (
                <tr key={t.name} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 font-medium">{t.name}</td>
                  <td className="py-2 text-right tabular-nums">{formatCredits(t.credits)}</td>
                  <td className="py-2 text-right tabular-nums">{formatUsd(t.usd)}/mo</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatPct(cost.projectedMonth / t.credits, 0)}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1">
                      {isCurrent && <Badge color="blue">current</Badge>}
                      {isRecommended && <Badge color="green">recommended</Badge>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
