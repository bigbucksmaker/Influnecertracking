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
