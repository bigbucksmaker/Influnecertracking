import { prisma } from "./db";
import { computeLeaderboard } from "./scoring";

// Shortlist views surface reach/engagement/median/consistency ONLY. Campaign
// rate fields are deliberately never included here.
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
}

export interface ShortlistView {
  id: string;
  name: string;
  campaignId: string | null;
  campaignName: string | null;
  createdBy: string | null;
  createdAt: string;
  items: ShortlistItemView[];
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

  return shortlists.map((s) => ({
    id: s.id,
    name: s.name,
    campaignId: s.campaignId,
    campaignName: s.campaign?.name ?? null,
    createdBy: s.createdBy,
    createdAt: s.createdAt.toISOString(),
    items: s.items.map((it) => {
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
      };
    }),
  }));
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
