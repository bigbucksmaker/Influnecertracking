import { prisma } from "./db";

export interface AccountOverview {
  id: string;
  username: string;
  displayName: string | null;
  profilePicture: string | null;
  isBlueVerified: boolean;
  status: string;
  pollingTier: string;
  tags: string[];
  currentFollowers: number | null;
  rateQuoteTweet: number | null;
  ratePost: number | null;
  rateRetweet: number | null;
  rateThread: number | null;
  postCount: number;
  lastPolledAt: string | null;
  backfilledAt: string | null;
  addedBy: string | null;
  createdAt: string;
}

export async function getAccountsOverview(): Promise<AccountOverview[]> {
  const [accounts, latest] = await Promise.all([
    prisma.account.findMany({
      include: { tags: { include: { tag: true } }, _count: { select: { posts: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.accountSnapshot.findMany({
      orderBy: { capturedAt: "desc" },
      distinct: ["accountId"],
      select: { accountId: true, followers: true },
    }),
  ]);
  const followersById = new Map(latest.map((s) => [s.accountId, s.followers]));

  return accounts.map((a) => ({
    id: a.id,
    username: a.username,
    displayName: a.displayName,
    profilePicture: a.profilePicture,
    isBlueVerified: a.isBlueVerified,
    status: a.status,
    pollingTier: a.pollingTier,
    tags: a.tags.map((t) => t.tag.name),
    currentFollowers: followersById.get(a.id) ?? null,
    rateQuoteTweet: a.rateQuoteTweet,
    ratePost: a.ratePost,
    rateRetweet: a.rateRetweet,
    rateThread: a.rateThread,
    postCount: a._count.posts,
    lastPolledAt: a.lastPolledAt ? a.lastPolledAt.toISOString() : null,
    backfilledAt: a.backfilledAt ? a.backfilledAt.toISOString() : null,
    addedBy: a.addedBy,
    createdAt: a.createdAt.toISOString(),
  }));
}

export async function getAllTags(): Promise<string[]> {
  const tags = await prisma.tag.findMany({ orderBy: { name: "asc" }, select: { name: true } });
  return tags.map((t) => t.name);
}

/**
 * Fully remove an account and everything that references it.
 *
 * The schema declares `onDelete: Cascade` for snapshots/posts/tags/placements/
 * shortlist items (and `SetNull` for ApiCallLog), so a plain `account.delete`
 * should cascade. But we delete children explicitly first — best-effort, tolerant
 * of a not-yet-migrated table (Prisma P2021) — so the delete can't be silently
 * blocked by a stale or missing FK cascade on the live DB. Children are removed
 * before parents; the final `account.delete` cleans up anything not listed.
 */
export async function deleteAccountCascade(id: string): Promise<void> {
  const swallowMissingTable = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code !== "P2021" && code !== "P2010") throw e; // table/relation not present yet
    }
  };

  await swallowMissingTable(prisma.placement.deleteMany({ where: { accountId: id } }));
  await swallowMissingTable(prisma.shortlistItem.deleteMany({ where: { accountId: id } }));
  await swallowMissingTable(prisma.postSnapshot.deleteMany({ where: { accountId: id } }));
  await swallowMissingTable(prisma.accountSnapshot.deleteMany({ where: { accountId: id } }));
  await swallowMissingTable(prisma.accountTag.deleteMany({ where: { accountId: id } }));
  await swallowMissingTable(prisma.post.deleteMany({ where: { accountId: id } }));
  // deleteMany (not delete) so a concurrent/retried delete is idempotent — an
  // already-removed row no-ops instead of throwing Prisma P2025 (→ spurious 500).
  // Real DB errors still throw and surface as a 500.
  await prisma.account.deleteMany({ where: { id } });
}

/** Coerce a rate input (string/number/blank) to a non-negative integer USD or null. */
export function parseRateInput(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** Create or connect tags by name, returning their ids. */
export async function upsertTags(names: string[]): Promise<string[]> {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const ids: string[] = [];
  for (const name of clean) {
    const tag = await prisma.tag.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    ids.push(tag.id);
  }
  return ids;
}
