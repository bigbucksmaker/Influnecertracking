"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DayCost } from "@/lib/cost-summary";
import { formatCredits, formatNumber } from "@/lib/format";

export function CostDailyChart({ data }: { data: DayCost[] }) {
  const tick = (d: string) => d.slice(5); // MM-DD
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
        <XAxis dataKey="date" tickFormatter={tick} minTickGap={16} tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={(v) => formatNumber(v)} width={48} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v: number) => formatCredits(v)} labelFormatter={(l) => `Day ${l}`} />
        <Bar dataKey="credits" fill="#2f5ae6" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
