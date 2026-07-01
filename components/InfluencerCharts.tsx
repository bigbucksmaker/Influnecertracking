"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FollowerPoint, ReachPoint, ViewDistribution } from "@/lib/metrics";
import { Card } from "./ui";
import { formatNumber, formatPct } from "@/lib/format";

const DAY_MS = 24 * 60 * 60 * 1000;

export function InfluencerCharts({
  followerSeries,
  reachSeries,
  distribution,
}: {
  followerSeries: FollowerPoint[];
  reachSeries: ReachPoint[];
  distribution: ViewDistribution;
}) {
  const [range, setRange] = useState<7 | 30>(30);

  const cutoff = Date.now() - range * DAY_MS;
  const followers = useMemo(
    () => followerSeries.filter((p) => new Date(p.t).getTime() >= cutoff),
    [followerSeries, cutoff],
  );
  const reach = useMemo(
    () => reachSeries.filter((p) => new Date(p.t).getTime() >= cutoff),
    [reachSeries, cutoff],
  );

  const tick = (t: string) => {
    const d = new Date(t);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg">Trends</h2>
        <div className="flex rounded-lg border border-line p-0.5 text-xs">
          {([7, 30] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1 ${
                range === r ? "bg-accent text-white" : "text-muted hover:bg-surface-2"
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Follower growth" empty={followers.length < 2}>
          <LineChart data={followers}>
            <CartesianGrid strokeDasharray="3 3" stroke="#23272F" />
            <XAxis dataKey="t" tickFormatter={tick} minTickGap={24} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => formatNumber(v)} width={44} tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
            <Tooltip formatter={(v: number) => formatNumber(v)} labelFormatter={tick} />
            <Line type="monotone" dataKey="followers" stroke="#7C6DF7" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartCard>

        <ChartCard title="Post views (cumulative)" empty={reach.length < 2}>
          <AreaChart data={reach}>
            <defs>
              <linearGradient id="views" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7C6DF7" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#7C6DF7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#23272F" />
            <XAxis dataKey="t" tickFormatter={tick} minTickGap={24} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => formatNumber(v)} width={44} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => formatNumber(v)} labelFormatter={tick} />
            <Area type="monotone" dataKey="views" stroke="#7C6DF7" strokeWidth={2} fill="url(#views)" />
          </AreaChart>
        </ChartCard>

        <ChartCard title="Engagement rate" empty={reach.length < 2}>
          <LineChart data={reach}>
            <CartesianGrid strokeDasharray="3 3" stroke="#23272F" />
            <XAxis dataKey="t" tickFormatter={tick} minTickGap={24} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => formatPct(v, 0)} width={44} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => formatPct(v)} labelFormatter={tick} />
            <Line type="monotone" dataKey="engagementRate" stroke="#37C08A" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartCard>
      </div>

      <div className="mt-4">
        <ViewDistributionChart distribution={distribution} />
      </div>
    </div>
  );
}

function ViewDistributionChart({ distribution }: { distribution: ViewDistribution }) {
  const { points, median, p25, mean, maxViews, commissionedMarkers, domainDays } = distribution;
  const maxPoint = points.find((p) => p.isMax) ?? null;
  const hasCommissioned = commissionedMarkers.length > 0;
  return (
    <Card className="p-4">
      <div className="mb-1 text-xs font-medium text-subtle">
        View distribution · trailing-7d posts
      </div>
      <p className="mb-3 max-w-3xl text-xs text-subtle">
        Each blue dot is one organic post. The Performance Score ranks by the{" "}
        <b className="text-pos">median</b> ({formatNumber(median)}), not the mean (
        {formatNumber(mean)}) — so a single viral post doesn&apos;t inflate a creator&apos;s reach.
        The <b className="text-warn">p25 floor</b> ({formatNumber(p25)}) is the level 75% of
        posts clear.
        {hasCommissioned && (
          <>
            {" "}
            <b className="text-accent-400">Purple ◆</b> markers are commissioned posts, positioned
            against the creator&apos;s normal band (× = delivery vs their organic median).
          </>
        )}
      </p>
      {points.length < 2 && !hasCommissioned ? (
        <div className="flex h-[220px] items-center justify-center text-center text-xs text-subtle">
          Not enough in-window posts yet to show a distribution.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <ScatterChart margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#23272F" />
            <XAxis
              type="number"
              dataKey="ageDays"
              name="days ago"
              domain={[0, domainDays]}
              reversed
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `${Math.round(v)}d`}
            />
            <YAxis
              type="number"
              dataKey="views"
              name="views"
              tickFormatter={(v) => formatNumber(v)}
              width={48}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              formatter={(v: number, name: string) =>
                name === "views" ? formatNumber(v) : `${Math.round(v)}d ago`
              }
            />
            <ReferenceLine
              y={median}
              stroke="#37C08A"
              strokeDasharray="5 4"
              label={{ value: `median ${formatNumber(median)}`, position: "insideTopLeft", fill: "#37C08A", fontSize: 11 }}
            />
            <ReferenceLine
              y={p25}
              stroke="#E7B23C"
              strokeDasharray="5 4"
              label={{ value: `p25 ${formatNumber(p25)}`, position: "insideBottomLeft", fill: "#E7B23C", fontSize: 11 }}
            />
            <Scatter data={points} fill="#7C6DF7" name="organic">
              {points.map((p) => (
                <Cell key={p.id} fill={p.isMax ? "#F0616D" : "#7C6DF7"} />
              ))}
            </Scatter>
            {hasCommissioned && (
              <Scatter data={commissionedMarkers} fill="#9B8FFA" shape="diamond" name="commissioned">
                {commissionedMarkers.map((m) => (
                  <Cell key={m.id} fill={m.underdelivered ? "#F0616D" : "#9B8FFA"} />
                ))}
                <LabelList
                  dataKey="deliveryRatioViews"
                  position="top"
                  fontSize={11}
                  fill="#9B8FFA"
                  formatter={(v: number | null) => (v != null ? `${v.toFixed(1)}×` : "")}
                />
              </Scatter>
            )}
            {maxPoint && (
              <ReferenceDot
                x={maxPoint.ageDays}
                y={maxViews}
                r={5}
                fill="#F0616D"
                stroke="#fff"
                isFront
                label={{ value: `max ${formatNumber(maxViews)}`, position: "top", fill: "#F0616D", fontSize: 11 }}
              />
            )}
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

function ChartCard({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: React.ReactElement;
}) {
  return (
    <Card className="p-4">
      <div className="mb-2 text-xs font-medium text-subtle">{title}</div>
      {empty ? (
        <div className="flex h-[200px] items-center justify-center text-center text-xs text-subtle">
          Not enough history yet — builds up as polls accumulate.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          {children}
        </ResponsiveContainer>
      )}
    </Card>
  );
}
