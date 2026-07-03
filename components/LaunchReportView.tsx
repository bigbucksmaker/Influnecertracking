"use client";

import Link from "next/link";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LaunchReportView as ReportData } from "@/lib/launch-report";
import { Card, StatCard, Badge } from "./ui";
import { TOOLTIP_STYLE } from "./InfluencerCharts";
import { formatNumber, formatSignedPct, relativeTime } from "@/lib/format";

function hhmm(t: string): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function LaunchReportView({ report }: { report: ReportData }) {
  const { stats, narrative } = report;
  const rosterMarkers = stats.qtMarkers.filter((m) => m.isRoster);
  const otherMarkers = stats.qtMarkers.filter((m) => !m.isRoster).slice(0, 40);
  const measurable = stats.impacts.filter((i) => !i.insufficientData);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <Link href={`/live/${report.trackerId}`} className="text-sm text-subtle hover:text-muted">
          ← Back to tracker
        </Link>
        <h1 className="text-gradient mt-2 text-2xl font-semibold tracking-[-0.02em]">{report.headline}</h1>
        <p className="mt-1.5 text-sm text-subtle">
          {stats.label} · @{stats.author} · {hhmm(stats.windowStart)}–{hhmm(stats.windowEnd)} ({stats.durationMin}m window)
          · generated {relativeTime(report.createdAt)}
          {report.createdBy && <> by {report.createdBy.split("@")[0]}</>}
          {stats.postUrl && (
            <>
              {" · "}
              <a href={stats.postUrl} target="_blank" rel="noreferrer" className="text-accent-400 hover:underline">
                open post on X →
              </a>
            </>
          )}
        </p>
      </div>

      {/* Headline stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Views gained" value={formatNumber(stats.viewsGained)} sub={`${formatNumber(stats.startViews)} → ${formatNumber(stats.endViews)}`} accent="accent" />
        <StatCard label="Peak pace" value={`${formatNumber(stats.peakPaceVpm)}/min`} sub={stats.peakPaceAt ? `at ${hhmm(stats.peakPaceAt)}` : "—"} accent="accent" />
        <StatCard label="Quote tweets" value={stats.qtCount} sub={`${stats.rosterQtCount} from the roster`} />
        <StatCard
          label="Roster excess views"
          value={formatNumber(stats.rosterExcessViews)}
          sub="above baseline in QT windows"
          accent="money"
        />
      </div>

      {/* Narrative */}
      {narrative ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-fg">What happened</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{narrative.summary}</p>
            {narrative.keyMoments.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {narrative.keyMoments.map((m, i) => (
                  <li key={i} className="flex gap-2 text-sm text-muted">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent-400" />
                    {m}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="relative overflow-hidden p-5">
            <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-money/60 via-money/20 to-transparent" />
            <h2 className="text-sm font-semibold text-fg">Amplifier insights</h2>
            <ul className="mt-2 space-y-1.5">
              {narrative.amplifierInsights.map((m, i) => (
                <li key={i} className="flex gap-2 text-sm text-muted">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-money-400" />
                  {m}
                </li>
              ))}
            </ul>
            {narrative.recommendations.length > 0 && (
              <>
                <h3 className="mt-4 text-xs font-semibold uppercase tracking-[0.08em] text-subtle">Next launch</h3>
                <ul className="mt-1.5 space-y-1.5">
                  {narrative.recommendations.map((m, i) => (
                    <li key={i} className="flex gap-2 text-sm text-fg">
                      <span className="mt-0.5 shrink-0 font-mono text-xs text-money-400">{i + 1}.</span>
                      {m}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>
      ) : (
        <Card className="p-4 text-sm text-subtle">
          Narrative unavailable for this report (model call failed or key unset) — the measurements below stand on their own.
        </Card>
      )}

      {/* The money visual — curve with QT event markers */}
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between text-xs font-medium text-subtle">
          <span>Views over the launch window · vertical lines = quote tweets (teal = roster)</span>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={stats.series}>
            <defs>
              <linearGradient id="reportViews" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7C6DF7" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#7C6DF7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#23272F" />
            <XAxis dataKey="t" tickFormatter={hhmm} minTickGap={48} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => formatNumber(v)} width={56} tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => formatNumber(v)} labelFormatter={hhmm} />
            {otherMarkers.map((m) => (
              <ReferenceLine key={`${m.t}-${m.username}`} x={m.t} stroke="#3A4150" strokeDasharray="2 3" />
            ))}
            {rosterMarkers.map((m) => (
              <ReferenceLine
                key={`${m.t}-${m.username}`}
                x={m.t}
                stroke="#2AC8B5"
                strokeDasharray="4 3"
                label={{ value: `@${m.username}`, angle: -90, position: "insideTopRight", fill: "#54DCCB", fontSize: 10 }}
              />
            ))}
            <Area type="linear" dataKey="views" stroke="#7C6DF7" strokeWidth={2} fill="url(#reportViews)" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* Measured impacts */}
      <Card className="overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">
            Measured QT impacts{" "}
            <span className="font-normal text-subtle">
              · pace before vs after each quote tweet · {measurable.length} measurable of {stats.impacts.length}
            </span>
          </h2>
        </div>
        <div className="scroll-thin overflow-x-auto">
          <table className="data w-full text-sm">
            <thead className="border-b border-line bg-surface-2">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Creator</th>
                <th className="px-3 py-2 text-right">QT views</th>
                <th className="px-3 py-2 text-right" title="Main-post views/min in the 10 min before">Pre pace</th>
                <th className="px-3 py-2 text-right" title="Main-post views/min in the 15 min after">Post pace</th>
                <th className="px-3 py-2 text-right">Uplift</th>
                <th className="px-3 py-2 text-right" title="Views above the pre-QT baseline within 15 min">Excess views</th>
                <th className="px-3 py-2 text-left">Flags</th>
              </tr>
            </thead>
            <tbody>
              {stats.impacts.map((i) => (
                <tr key={i.quoteTweetId} className={`border-b border-line-soft last:border-0 hover:bg-surface-2 ${i.insufficientData ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2 font-mono text-xs tabular-nums text-subtle">{hhmm(i.qtPostedAt)}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium text-fg">@{i.authorUsername}</span>
                      {i.isRoster && <Badge color="teal">roster</Badge>}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(i.qtViews)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-subtle">{i.insufficientData ? "—" : `${formatNumber(i.prePaceVpm)}/m`}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{i.insufficientData ? "—" : `${formatNumber(i.postPaceVpm)}/m`}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {i.upliftPct == null ? (
                      <span className="text-subtle">—</span>
                    ) : (
                      <span className={i.upliftPct > 0 ? "text-pos" : "text-neg"}>{formatSignedPct(i.upliftPct)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-money-400">
                    {i.insufficientData ? "—" : formatNumber(i.excessViews)}
                  </td>
                  <td className="px-3 py-2">
                    {i.contested && (
                      <span title="Another QT landed within ±5 min — credit is shared">
                        <Badge color="amber">contested</Badge>
                      </span>
                    )}
                    {i.insufficientData && (
                      <span title="Too few snapshots around this QT to measure">
                        <Badge>no data</Badge>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {stats.impacts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-subtle">
                    No quote tweets were discovered during this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Long-term memory */}
      {stats.profiles.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold text-fg">
              Amplifier track records{" "}
              <span className="font-normal text-subtle">· accumulated across every tracked launch</span>
            </h2>
          </div>
          <div className="scroll-thin overflow-x-auto">
            <table className="data w-full text-sm">
              <thead className="border-b border-line bg-surface-2">
                <tr>
                  <th className="px-3 py-2 text-left">Creator</th>
                  <th className="px-3 py-2 text-right">Launches</th>
                  <th className="px-3 py-2 text-right">QTs</th>
                  <th className="px-3 py-2 text-right" title="Median pace uplift across clean (uncontested) measurements">Median uplift</th>
                  <th className="px-3 py-2 text-right">Total excess views</th>
                  <th className="px-3 py-2 text-right" title="Uncontested, measurable QTs">Clean n</th>
                </tr>
              </thead>
              <tbody>
                {stats.profiles.map((p) => (
                  <tr key={p.username} className="border-b border-line-soft last:border-0 hover:bg-surface-2">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <Link href={`/influencer/${p.username}`} className="font-medium text-fg hover:underline">
                          @{p.username}
                        </Link>
                        {p.isRoster && <Badge color="teal">roster</Badge>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.launches}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.qts}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {p.medianUpliftPct == null ? <span className="text-subtle">—</span> : formatSignedPct(p.medianUpliftPct)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-money-400">{formatNumber(p.totalExcessViews)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-subtle">{p.cleanMeasurements}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line-soft px-5 py-2.5 text-xs text-subtle">
            These profiles sharpen with every tracked launch — the more launches you run through the tracker, the
            better the next report&apos;s recommendations get.
          </p>
        </Card>
      )}
    </div>
  );
}
