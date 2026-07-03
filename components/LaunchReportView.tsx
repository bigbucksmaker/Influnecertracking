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
          label="Roster attributed views"
          value={formatNumber(stats.rosterAttributedViews)}
          sub="regression-attributed to roster QTs"
          accent="money"
        />
      </div>

      {/* Decomposition — where the views came from */}
      {stats.attribution && (
        <Card className="p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs font-medium text-subtle">
            <span>
              Pace decomposition · v(t) = baseline + Σ βᵢ·kernelᵢ · fit R²{" "}
              <b className={stats.attribution.r2 >= 0.4 ? "text-pos" : "text-warn"}>{stats.attribution.r2}</b>
            </span>
            <span>
              kernels: {stats.attribution.realKernels} measured · {stats.attribution.syntheticKernels} shape-modelled
            </span>
          </div>
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-surface-2">
            {(() => {
              const a = stats.attribution;
              const total = Math.max(1, a.baselineViews + a.excessViews);
              const seg = (v: number) => `${Math.max(0, (v / total) * 100)}%`;
              return (
                <>
                  <div className="h-full bg-accent-700/70" style={{ width: seg(a.baselineViews) }} title={`Organic baseline: ${formatNumber(a.baselineViews)}`} />
                  <div className="h-full bg-money-600" style={{ width: seg(a.attributedViews) }} title={`QT-attributed: ${formatNumber(a.attributedViews)}`} />
                  <div className="h-full bg-warn/60" style={{ width: seg(a.unattributedExcess) }} title={`Unattributed excess: ${formatNumber(a.unattributedExcess)}`} />
                </>
              );
            })()}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-subtle">
            <span><span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-accent-700/70" />organic baseline {formatNumber(stats.attribution.baselineViews)}</span>
            <span><span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-money-600" />QT-attributed {formatNumber(stats.attribution.attributedViews)}</span>
            <span><span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-warn/60" />unattributed excess {formatNumber(stats.attribution.unattributedExcess)}</span>
          </div>
        </Card>
      )}

      {/* Signal mix — engagement counted the way the ranker values it */}
      {stats.signalMix && stats.signalMix.weightedScore > 0 && (
        <Card className="p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs font-medium text-subtle">
            <span>
              Engagement signal mix · counted at the ranker&apos;s relativities{" "}
              <span className="text-subtle/70">(directional — last public weights: reply 13.5 · RT/QT 1 · like 0.5)</span>
            </span>
            <span>
              replies = <b className="text-pos">{Math.round(stats.signalMix.weightedReplyShare * 100)}%</b> of weighted signal
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            {(
              [
                { label: "Replies", n: stats.signalMix.replies, w: 13.5, tone: "text-pos" },
                { label: "Quotes", n: stats.signalMix.quotes, w: 1, tone: "text-money-400" },
                { label: "Reposts", n: stats.signalMix.retweets, w: 1, tone: "text-fg" },
                { label: "Likes", n: stats.signalMix.likes, w: 0.5, tone: "text-subtle" },
              ] as const
            ).map((s) => (
              <div key={s.label} className="rounded-lg border border-line-soft bg-surface-2/50 px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-subtle">
                  {s.label} <span className="text-subtle/60">×{s.w}</span>
                </div>
                <div className={`mt-0.5 font-mono text-lg font-medium tabular-nums ${s.tone}`}>
                  {formatNumber(s.n)}
                </div>
                <div className="text-[10.5px] text-subtle">
                  → {formatNumber(Math.round(s.n * s.w))} weighted
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

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
                <th className="px-3 py-2 text-right" title="Regression-attributed main-post views">Attributed</th>
                <th className="px-3 py-2 text-right" title="Share of all attributed views">Share</th>
                <th className="px-3 py-2 text-right" title="β — main-post views per view on this QT">Transfer</th>
                <th className="px-3 py-2 text-right" title="Main-post pace around this QT's burst (10 min pre → 10 min post) — display context, attribution comes from the regression">Burst pace</th>
                <th className="px-3 py-2 text-left">Method</th>
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
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-money-400">
                    {i.insufficientData ? "—" : formatNumber(i.attributedViews)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {i.creditShare == null ? <span className="text-subtle">—</span> : `${Math.round(i.creditShare * 100)}%`}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {i.transferRate == null ? <span className="text-subtle">—</span> : i.transferRate.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-subtle">
                    {i.insufficientData ? "—" : (
                      <>
                        {formatNumber(i.prePaceVpm)}→{formatNumber(i.postPaceVpm)}/m
                        {i.upliftPct != null && (
                          <span className={i.upliftPct > 0 ? " text-pos" : " text-neg"}> {formatSignedPct(i.upliftPct)}</span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap items-center gap-1">
                      {i.method === "regression" && (
                        <span title={`Separable kernel (${i.kernel === "real" ? "measured QT series" : "modelled shape"})`}>
                          <Badge color="green">regression</Badge>
                        </span>
                      )}
                      {i.method === "cluster-split" && (
                        <span title={`Burst of ${i.clusterSize} QTs within 90s — cluster attribution split by observed QT views`}>
                          <Badge color="amber">burst ÷{i.clusterSize}</Badge>
                        </span>
                      )}
                      {i.insufficientData && (
                        <span title="Too little data to measure — never cited as impact">
                          <Badge>no data</Badge>
                        </span>
                      )}
                      {i.kernel === "synthetic" && !i.insufficientData && (
                        <span title="Exposure kernel modelled (20-min half-life decay) — QT series too sparse">
                          <Badge>modelled</Badge>
                        </span>
                      )}
                    </span>
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
                  <th className="px-3 py-2 text-right" title="Median β across launches — main-post views per view on their QT">Median transfer</th>
                  <th className="px-3 py-2 text-right" title="Regression-attributed main-post views, all launches">Total attributed</th>
                  <th className="px-3 py-2 text-right" title="QTs measured with a separable (regression) kernel">Clean n</th>
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
                      {p.medianTransferRate == null ? <span className="text-subtle">—</span> : p.medianTransferRate.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-money-400">{formatNumber(p.totalAttributedViews)}</td>
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
