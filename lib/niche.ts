import { prisma } from "./db";
import { getAnthropic, NICHE_MODEL } from "./anthropic";

// ---------------------------------------------------------------------------
// AI niche categorization. Reads post text already stored in the DB (no
// twitterapi.io calls) and uses Claude to (1) propose a taxonomy and
// (2) classify each influencer into it. Uses structured outputs (json_schema)
// so responses are guaranteed valid JSON.
// ---------------------------------------------------------------------------

export interface Niche {
  name: string;
  description: string;
}

const NICHE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["niches"],
  properties: {
    niches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
        },
      },
    },
  },
} as const;

const ASSIGN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assignments"],
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["username", "niches"],
        properties: {
          username: { type: "string" },
          niches: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

function clip(text: string, n: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, n);
}

function firstText(content: any[]): string {
  for (const b of content) {
    if (b?.type === "text" && typeof b.text === "string") return b.text;
  }
  return "";
}

/** Propose a niche taxonomy from a sample of stored post text. Writes nothing. */
export async function proposeNiches(): Promise<Niche[]> {
  const posts = await prisma.post.findMany({
    where: { account: { status: "active" }, isReply: false, text: { not: "" } },
    orderBy: { postedAt: "desc" },
    take: 700,
    select: { text: true, account: { select: { username: true } } },
  });

  const sample = posts
    .map((p) => `@${p.account.username}: ${clip(p.text, 200)}`)
    .join("\n")
    .slice(0, 60000);

  const client = getAnthropic();
  const res = await client.messages.create({
    model: NICHE_MODEL,
    max_tokens: 6000,
    output_config: { format: { type: "json_schema", schema: NICHE_SCHEMA } },
    messages: [
      {
        role: "user",
        content:
          "We're a marketing agency that tracks X (Twitter) influencers for client campaigns. " +
          "Below are sample posts (one per line, prefixed with the author's handle). " +
          "Propose 8–14 distinct, mostly non-overlapping niche categories that best organize these creators " +
          "by the topic/industry they post about. Use concise, marketer-friendly names (1–3 words each) " +
          "and a one-line description for each.\n\nPOSTS:\n" +
          sample,
      },
    ],
  });

  const parsed = JSON.parse(firstText(res.content) || "{}") as { niches?: Niche[] };
  return parsed.niches ?? [];
}

export interface ApplyBatchResult {
  processed: number;
  total: number;
  remaining: number;
}

/**
 * Classify a batch of influencers (by DB offset) into the confirmed niche list
 * and attach the matching tags. Called repeatedly by the client to drain all
 * accounts with a progress bar.
 */
export async function classifyAndTagBatch(
  niches: string[],
  offset: number,
  limit: number,
): Promise<ApplyBatchResult> {
  const clean = [...new Set(niches.map((n) => n.trim()).filter(Boolean))];
  const total = await prisma.account.count({ where: { status: "active" } });
  if (clean.length === 0) return { processed: 0, total, remaining: 0 };

  const accounts = await prisma.account.findMany({
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
    skip: offset,
    take: limit,
    select: { id: true, username: true },
  });
  if (accounts.length === 0) return { processed: 0, total, remaining: 0 };

  // up to 5 recent posts per account
  const ids = accounts.map((a) => a.id);
  const posts = await prisma.post.findMany({
    where: { accountId: { in: ids }, isReply: false, text: { not: "" } },
    orderBy: { postedAt: "desc" },
    select: { accountId: true, text: true },
  });
  const byAccount = new Map<string, string[]>();
  for (const p of posts) {
    const arr = byAccount.get(p.accountId) ?? [];
    if (arr.length < 5) arr.push(clip(p.text, 180));
    byAccount.set(p.accountId, arr);
  }

  const profiles = accounts
    .map((a) => {
      const snippets = byAccount.get(a.id) ?? [];
      const body = snippets.length ? snippets.map((s) => `- ${s}`).join("\n") : "- (no posts stored)";
      return `@${a.username}\n${body}`;
    })
    .join("\n\n");

  const client = getAnthropic();
  const res = await client.messages.create({
    model: NICHE_MODEL,
    max_tokens: 4000,
    thinking: { type: "disabled" },
    output_config: { format: { type: "json_schema", schema: ASSIGN_SCHEMA } },
    messages: [
      {
        role: "user",
        content:
          "Assign each X influencer 1–3 niches from THIS fixed list. Use the exact names as written; " +
          "do not invent new categories. If none fit well, pick the closest one.\n\nNICHES:\n" +
          clean.map((n) => `- ${n}`).join("\n") +
          "\n\nINFLUENCERS (handle then sample posts):\n\n" +
          profiles,
      },
    ],
  });

  const parsed = JSON.parse(firstText(res.content) || "{}") as {
    assignments?: { username: string; niches: string[] }[];
  };
  const assignments = parsed.assignments ?? [];

  // ensure a tag exists for each confirmed niche
  const tagIdByName = new Map<string, string>();
  for (const name of clean) {
    const tag = await prisma.tag.upsert({ where: { name }, update: {}, create: { name } });
    tagIdByName.set(name.toLowerCase(), tag.id);
  }
  const idByUsername = new Map(accounts.map((a) => [a.username.toLowerCase(), a.id]));

  for (const a of assignments) {
    const accountId = idByUsername.get(String(a.username).replace(/^@/, "").toLowerCase());
    if (!accountId) continue;
    for (const niche of a.niches ?? []) {
      const tagId = tagIdByName.get(String(niche).trim().toLowerCase());
      if (!tagId) continue; // ignore anything not in the confirmed list
      await prisma.accountTag.upsert({
        where: { accountId_tagId: { accountId, tagId } },
        update: {},
        create: { accountId, tagId },
      });
    }
  }

  return { processed: accounts.length, total, remaining: Math.max(0, total - (offset + accounts.length)) };
}
