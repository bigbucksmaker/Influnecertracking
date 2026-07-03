import type { LeaderboardRow } from "./scoring";
import type { UnderdeliveringPlacement } from "./placements";

export type AttentionKind = "underdelivering" | "falling" | "lowConfidence" | "dormant";

export interface AttentionItem {
  kind: AttentionKind;
  severity: "high" | "medium" | "low";
  username: string;
  displayName: string | null;
  profilePicture: string | null;
  title: string;
  detail: string;
  href: string;
}

const KIND_META: Record<AttentionKind, { label: string; severity: AttentionItem["severity"] }> = {
  underdelivering: { label: "Underdelivering", severity: "high" },
  falling: { label: "Falling", severity: "high" },
  lowConfidence: { label: "Low confidence", severity: "medium" },
  dormant: { label: "Dormant", severity: "low" },
};

/**
 * Build the "Needs attention" feed. Each account appears once, at its highest-
 * severity reason. Pure so it's cheap to compute from the cached leaderboard.
 */
export function buildAttention(
  rows: LeaderboardRow[],
  underdelivering: UnderdeliveringPlacement[],
  limitPerKind = 6,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const seen = new Set<string>();
  const take = (username: string) => {
    if (seen.has(username)) return false;
    seen.add(username);
    return true;
  };

  // 1) Under-delivering commissioned posts (highest priority)
  for (const u of underdelivering.slice(0, limitPerKind)) {
    if (!take(u.username)) continue;
    items.push({
      kind: "underdelivering",
      severity: "high",
      username: u.username,
      displayName: u.displayName,
      profilePicture: u.profilePicture,
      title: `${(u.deliveryRatioViews).toFixed(1)}× delivery in ${u.campaignName}`,
      detail:
        u.priceUsd != null && u.priceUsd > 0
          ? `$${Math.round(u.priceUsd)} paid · below baseline`
          : "commissioned post below baseline",
      href: `/campaigns/${u.campaignId}`,
    });
  }

  // 2) Falling accounts (big WoW drops)
  const falling = rows
    .filter((r) => r.falling)
    .sort((a, b) => (a.wowViewsPct ?? 0) - (b.wowViewsPct ?? 0))
    .slice(0, limitPerKind);
  for (const r of falling) {
    if (!take(r.username)) continue;
    items.push({
      kind: "falling",
      severity: "high",
      username: r.username,
      displayName: r.displayName,
      profilePicture: r.profilePicture,
      title: `views ${pct(r.wowViewsPct)} WoW`,
      detail: `median ${abbr(r.medianViews)}`,
      href: `/leaderboard?direction=falling`,
    });
  }

  // 3) Low-confidence scores (thin/stale data)
  const lowConf = rows.filter((r) => r.lowConfidence).slice(0, limitPerKind * 2);
  for (const r of lowConf) {
    if (!take(r.username)) continue;
    items.push({
      kind: "lowConfidence",
      severity: "medium",
      username: r.username,
      displayName: r.displayName,
      profilePicture: r.profilePicture,
      title: "low-confidence score",
      detail: r.lowConfidenceReasons[0] ?? "thin data",
      href: `/influencer/${r.username}`,
    });
    if (items.filter((i) => i.kind === "lowConfidence").length >= limitPerKind) break;
  }

  // 4) Dormant accounts (biggest first)
  const dormant = rows
    .filter((r) => r.pollingTier === "dormant")
    .sort((a, b) => (b.currentFollowers ?? 0) - (a.currentFollowers ?? 0))
    .slice(0, limitPerKind * 2);
  for (const r of dormant) {
    if (!take(r.username)) continue;
    items.push({
      kind: "dormant",
      severity: "low",
      username: r.username,
      displayName: r.displayName,
      profilePicture: r.profilePicture,
      title: "dormant — no recent posts",
      detail: r.lastPolledAt ? "last polled " + rel(r.lastPolledAt) : "never polled",
      href: `/influencer/${r.username}`,
    });
    if (items.filter((i) => i.kind === "dormant").length >= limitPerKind) break;
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export const ATTENTION_LABELS = KIND_META;

function pct(r: number | null): string {
  if (r == null) return "—";
  return (r > 0 ? "+" : "") + (r * 100).toFixed(0) + "%";
}
function abbr(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}
function rel(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
