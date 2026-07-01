"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FollowerPoint, ReachPoint } from "@/lib/metrics";
import { Card } from "./ui";
import { formatNumber, formatPct } from "@/lib/format";

const DAY_MS = 24 * 60 * 60 * 1000;

export function InfluencerCharts({
  followerSeries,
  reachSeries,
}: {
  followerSeries: FollowerPoint[];
  reachSeries: ReachPoint[];
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
        <h2 className="text-sm font-semibold text-slate-900">Trends</h2>
        <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
          {([7, 30] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1 ${
                range === r ? "bg-brand-500 text-white" : "text-slate-600 hover:bg-slate-100"
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
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
            <XAxis dataKey="t" tickFormatter={tick} minTickGap={24} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => formatNumber(v)} width={44} tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
            <Tooltip formatter={(v: number) => formatNumber(v)} labelFormatter={tick} />
            <Line type="monotone" dataKey="followers" stroke="#2f5ae6" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartCard>

        <ChartCard title="Post views (cumulative)" empty={reach.length < 2}>
          <AreaChart data={reach}>
            <defs>
              <linearGradient id="views" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2f5ae6" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#2f5ae6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
            <XAxis dataKey="t" tickFormatter={tick} minTickGap={24} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => formatNumber(v)} width={44} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => formatNumber(v)} labelFormatter={tick} />
            <Area type="monotone" dataKey="views" stroke="#2f5ae6" strokeWidth={2} fill="url(#views)" />
          </AreaChart>
        </ChartCard>

        <ChartCard title="Engagement rate" empty={reach.length < 2}>
          <LineChart data={reach}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
            <XAxis dataKey="t" tickFormatter={tick} minTickGap={24} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => formatPct(v, 0)} width={44} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => formatPct(v)} labelFormatter={tick} />
            <Line type="monotone" dataKey="engagementRate" stroke="#059669" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartCard>
      </div>
    </div>
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
      <div className="mb-2 text-xs font-medium text-slate-500">{title}</div>
      {empty ? (
        <div className="flex h-[200px] items-center justify-center text-center text-xs text-slate-400">
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
