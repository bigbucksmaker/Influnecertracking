import { Card, ProgressBar, Badge } from "./ui";
import { formatCredits, formatUsd, formatPct, formatNumber } from "@/lib/format";
import type { CostSummary } from "@/lib/cost-summary";

export function CostWidget({ summary }: { summary: CostSummary }) {
  const tone = summary.overBudget ? "red" : summary.projectedPctOfCap > 0.8 ? "amber" : "blue";

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-fg">Credit usage — {summary.monthLabel}</h2>
          <p className="text-xs text-subtle">
            Day {Math.floor(summary.daysElapsed)} of {summary.daysInMonth} ·{" "}
            {summary.currentPlan ? `${summary.currentPlan.name} plan` : "custom cap"}
          </p>
        </div>
        {summary.overBudget ? (
          <Badge color="red">Over projected cap</Badge>
        ) : summary.projectedPctOfCap > 0.8 ? (
          <Badge color="amber">Approaching cap</Badge>
        ) : (
          <Badge color="green">On track</Badge>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric
          label="Used this month"
          value={formatCredits(summary.usedThisMonth)}
          sub={formatUsd(summary.usedUsd)}
        />
        <Metric
          label="Projected month-end"
          value={formatCredits(summary.projectedMonth)}
          sub={formatUsd(summary.projectedUsd)}
          tone={summary.overBudget ? "bad" : "default"}
        />
        <Metric
          label="Plan cap"
          value={formatCredits(summary.planCapCredits)}
          sub={`${formatPct(summary.pctOfCap, 1)} used`}
        />
        <Metric
          label="Avg / poll"
          value={formatCredits(summary.avgCreditsPerPoll)}
          sub={`${formatNumber(summary.pollsLast7d)} polls / 7d`}
        />
      </div>

      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-subtle">
          <span>Projected {formatPct(summary.projectedPctOfCap, 0)} of cap</span>
          <span>{formatCredits(summary.planCapCredits)}</span>
        </div>
        <ProgressBar value={summary.projectedMonth} max={summary.planCapCredits} tone={tone} />
      </div>

      {summary.overBudget && (
        <div className="mt-4 rounded-lg border border-neg/40 bg-neg-soft p-3 text-sm text-neg">
          Projected spend ({formatCredits(summary.projectedMonth)}) will exceed your cap of{" "}
          {formatCredits(summary.planCapCredits)}.{" "}
          {summary.recommendedPlan
            ? `Consider upgrading to the ${summary.recommendedPlan.name} plan (${formatCredits(
                summary.recommendedPlan.credits,
              )}).`
            : "This exceeds every listed plan — reduce polling frequency in Settings."}
        </div>
      )}
    </Card>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "bad";
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${tone === "bad" ? "text-neg" : "text-fg"}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-subtle">{sub}</div>}
    </div>
  );
}
