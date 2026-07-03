import { prisma } from "./db";
import { computeLeaderboard } from "./scoring";

// Shortlist views carry performance AND economics. Rates were historically
// excluded here because they were unreliable; they're maintained now, so a
// shortlist reads as a slate you can price: per-creator rate + implied CPM,
// and roll-ups (total cost, expected views, blended CPM) for the whole list.
export interface ShortlistItemView {
  itemId: string;
  accountId: string;
  username: string;
  displayName: string | null;
  profilePicture: string | null;
  note: string | null;
  performanceScore: number | null;
  medianViews: number | null;
  p25Views: number | null;
  consistency: number | null;
  erImpressions: number | null;
  currentFollowers: number | null;
  direction: string | null;
  lowConfidence: boolean;
  medianEng: number | null;
  // Economics (basis = QT rate, falling back to post rate; see lib/value.ts)
  rateQuoteTweet: number | null;
  ratePost: number | null;
  rateThread: number | null;
  valueBasis: string | null;
  basisRate: number | null;
  cpm: number | null; // implied $ per 1K median views at the basis rate
  valueScore: number | null;
  pricePosition: string | null;
}

export interface ShortlistTotals {
  pricedCount: number; // items with a basis rate
  unpricedCount: number;
  totalCost: number; // Σ basis rates
  expectedViews: number; // Σ median views of priced items
  expectedEngagements: number; // Σ median engagements of priced items
  blendedCpm: number | null; // totalCost ÷ expectedViews × 1K
}

export interface ShortlistView {
  id: string;
  name: string;
  campaignId: string | null;
  campaignName: string | null;
  createdBy: string | null;
  createdAt: string;
  items: ShortlistItemView[];
  totals: ShortlistTotals;
}

function computeTotals(items: ShortlistItemView[]): ShortlistTotals {
  const priced = items.filter((it) => it.basisRate != null && it.basisRate > 0);
  const totalCost = priced.reduce((s, it) => s + (it.basisRate ?? 0), 0);
  const expectedViews = priced.reduce((s, it) => s + Math.round(it.medianViews ?? 0), 0);
  const expectedEngagements = priced.reduce((s, it) => s + Math.round(it.medianEng ?? 0), 0);
  return {
    pricedCount: priced.length,
    unpricedCount: items.length - priced.length,
    totalCost,
    expectedViews,
    expectedEngagements,
    blendedCpm: expectedViews > 0 ? Math.round((totalCost / expectedViews) * 1000 * 100) / 100 : null,
  };
}

export async function getShortlists(): Promise<ShortlistView[]> {
  const [shortlists, board] = await Promise.all([
    prisma.shortlist.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        campaign: { select: { name: true } },
        items: {
          orderBy: { createdAt: "asc" },
          include: {
            account: { select: { id: true, username: true, displayName: true, profilePicture: true } },
          },
        },
      },
    }),
    computeLeaderboard(),
  ]);
  const byAccount = new Map(board.map((r) => [r.accountId, r]));

  return shortlists.map((s) => {
    const items = s.items.map((it) => {
      const r = byAccount.get(it.accountId);
      return {
        itemId: it.id,
        accountId: it.accountId,
        username: it.account.username,
        displayName: it.account.displayName,
        profilePicture: it.account.profilePicture,
        note: it.note,
        performanceScore: r?.performanceScore ?? null,
        medianViews: r?.medianViews ?? null,
        p25Views: r?.p25Views ?? null,
        consistency: r?.consistency ?? null,
        erImpressions: r?.erImpressions ?? null,
        currentFollowers: r?.currentFollowers ?? null,
        direction: r?.direction ?? null,
        lowConfidence: r?.lowConfidence ?? false,
        rateQuoteTweet: r?.rateQuoteTweet ?? null,
        ratePost: r?.ratePost ?? null,
        rateThread: r?.rateThread ?? null,
        valueBasis: r?.valueBasis ?? null,
        basisRate: r?.basisRate ?? null,
        cpm: r?.valueBasis === "qt" ? (r?.cpmQuote ?? null) : r?.valueBasis === "post" ? (r?.cpmPost ?? null) : null,
        valueScore: r?.valueScore ?? null,
        pricePosition: r?.pricePosition ?? null,
        medianEng: r?.medianEng ?? null,
      } satisfies ShortlistItemView;
    });
    return {
      id: s.id,
      name: s.name,
      campaignId: s.campaignId,
      campaignName: s.campaign?.name ?? null,
      createdBy: s.createdBy,
      createdAt: s.createdAt.toISOString(),
      items,
      totals: computeTotals(items),
    };
  });
}

export async function createShortlist(name: string, campaignId?: string | null, createdBy?: string) {
  return prisma.shortlist.create({
    data: { name, campaignId: campaignId || null, createdBy: createdBy ?? null },
  });
}

/** Add an account (by username or id) to a shortlist. Idempotent. */
export async function addShortlistItem(
  shortlistId: string,
  accountRef: string,
  note?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const ref = accountRef.trim().replace(/^@/, "").toLowerCase();
  const account =
    (await prisma.account.findUnique({ where: { username: ref } })) ??
    (await prisma.account.findUnique({ where: { id: accountRef } }));
  if (!account) return { ok: false, error: `No tracked account matches "${accountRef}"` };
  await prisma.shortlistItem.upsert({
    where: { shortlistId_accountId: { shortlistId, accountId: account.id } },
    update: note != null ? { note } : {},
    create: { shortlistId, accountId: account.id, note: note ?? null },
  });
  return { ok: true };
}

export async function removeShortlistItem(itemId: string): Promise<void> {
  await prisma.shortlistItem.delete({ where: { id: itemId } }).catch(() => null);
}

export async function deleteShortlist(id: string): Promise<void> {
  await prisma.shortlist.delete({ where: { id } }).catch(() => null);
}
