"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge } from "./ui";
import { RatesEditor, type Rates } from "./RatesEditor";
import { formatNumber, relativeTime } from "@/lib/format";

export interface RateCardProps {
  accountId: string;
  username: string;
  rates: Rates;
  cpmQuote: number | null;
  cpmPost: number | null;
  cpmThread: number | null;
  costPerKEng: number | null;
  valueBasis: string | null;
  valueScore: number | null;
  valueRank: number | null;
  pricedCount: number; // how many priced accounts the rank is out of
  pricePosition: string | null;
  priceVsPeersPct: number | null;
  peerGroup: string | null;
  peerCount: number | null;
  ratesUpdatedAt: string | null;
  ratesStale: boolean;
  medianViews: number;
}

function Fmt({ label, rate, cpm, basis }: { label: string; rate: number | null; cpm: number | null; basis: boolean }) {
  return (
    <div className={`rounded-lg border px-3.5 py-2.5 ${basis ? "border-money/40 bg-money-soft" : "border-line-soft bg-surface-2/50"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-subtle">{label}</span>
        {basis && <span className="text-[9px] font-semibold uppercase tracking-wide text-money-400">basis</span>}
      </div>
      <div className="mt-0.5 font-mono text-lg font-medium tabular-nums text-fg">
        {rate != null ? `$${rate}` : <span className="text-subtle">—</span>}
      </div>
      <div className="text-[11px] text-subtle">
        {cpm != null ? (
          <>
            <span className="font-mono tabular-nums text-money-400">${cpm}</span> / 1K views
          </>
        ) : (
          "no CPM"
        )}
      </div>
    </div>
  );
}

export function RateCard(p: RateCardProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  async function saveRates(r: Rates) {
    await fetch(`/api/accounts/${p.accountId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(r),
    });
    router.refresh();
  }

  const peersLabel = p.peerGroup === "niche" ? "niche peers" : "all priced creators";

  return (
    <Card className="relative overflow-hidden p-5">
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-money/60 via-money/20 to-transparent" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">
          Rates &amp; value{" "}
          <span className="font-normal text-subtle">· est. from {formatNumber(p.medianViews)} median organic views</span>
        </h2>
        <div className="flex items-center gap-2">
          {p.pricePosition === "underpriced" && (
            <span title={`Implied CPM ${Math.abs(Math.round((p.priceVsPeersPct ?? 0) * 100))}% below ${peersLabel} (${p.peerCount ?? 0})`}>
              <Badge color="teal">underpriced</Badge>
            </span>
          )}
          {p.pricePosition === "overpriced" && (
            <span title={`Implied CPM ${Math.round((p.priceVsPeersPct ?? 0) * 100)}% above ${peersLabel} (${p.peerCount ?? 0})`}>
              <Badge color="red">overpriced</Badge>
            </span>
          )}
          {p.pricePosition === "fair" && (
            <span title={`Implied CPM within the fair band vs ${peersLabel} (${p.peerCount ?? 0})`}>
              <Badge color="slate">fairly priced</Badge>
            </span>
          )}
          <button
            onClick={() => setEditing(true)}
            className="rounded-lg border border-line px-3 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            ✎ Edit rates
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Fmt label="Quote tweet" rate={p.rates.rateQuoteTweet} cpm={p.cpmQuote} basis={p.valueBasis === "qt"} />
        <Fmt label="Post" rate={p.rates.ratePost} cpm={p.cpmPost} basis={p.valueBasis === "post"} />
        <Fmt label="Thread" rate={p.rates.rateThread} cpm={p.cpmThread} basis={false} />
        <Fmt label="Retweet" rate={p.rates.rateRetweet} cpm={null} basis={false} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-subtle">
        {p.valueScore != null && (
          <span>
            Value Score <b className="font-mono tabular-nums text-money-400">{p.valueScore}</b>
            {p.valueRank != null && (
              <>
                {" "}
                · rank <b className="font-mono tabular-nums text-fg">#{p.valueRank}</b> of {p.pricedCount} priced
              </>
            )}
          </span>
        )}
        {p.costPerKEng != null && (
          <span>
            <b className="font-mono tabular-nums text-money-400">${p.costPerKEng}</b> / 1K engagements
          </span>
        )}
        <span className={p.ratesStale ? "text-warn" : undefined}>
          {p.ratesUpdatedAt
            ? `rates updated ${relativeTime(p.ratesUpdatedAt)}${p.ratesStale ? " — consider re-confirming" : ""}`
            : "rate age unknown (pre-audit import)"}
        </span>
      </div>

      {editing && (
        <RatesEditor
          username={p.username}
          initial={p.rates}
          onSave={saveRates}
          onClose={() => setEditing(false)}
        />
      )}
    </Card>
  );
}
