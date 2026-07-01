import { tool } from "ai";
import { z } from "zod";
import {
  cachedLeaderboard,
  cachedCampaigns,
  cachedCostSummary,
  cachedShortlists,
} from "@/lib/cache";
import { getAllTags } from "@/lib/accounts";
import { topMovers, topDecliners, type LeaderboardRow } from "@/lib/scoring";
import { runReadOnlySql, SqlGuardError } from "./sql";

const norm = (u: string) => u.trim().replace(/^@/, "").toLowerCase();

/** The fields worth handing the model — reach/engagement/median/confidence only, never rate math. */
function slimRow(r: LeaderboardRow) {
  return {
    rank: r.rank,
    username: r.username,
    name: r.displayName,
    medianViews: r.medianViews,
    p25Views: r.p25Views,
    avgViews: r.avgViews,
    consistency: r.consistency,
    erImpressions: r.erImpressions,
    postsLast7d: r.postCount7d,
    followers: r.currentFollowers,
    wowViewsPct: r.wowViewsPct,
    direction: r.direction,
    rising: r.rising,
    falling: r.falling,
    niches: r.tags,
    tier: r.pollingTier,
    performanceScore: r.performanceScore,
    lowConfidence: r.lowConfidence,
    confidenceNotes: r.lowConfidenceReasons,
    profileUrl: `/influencer/${r.username}`,
  };
}

const SORTABLE = ["performanceScore", "medianViews", "wowViewsPct", "erImpressions", "postCount7d", "currentFollowers"] as const;

export const assistantTools = {
  queryLeaderboard: tool({
    description:
      "Rank and filter tracked creators. Use for questions like 'top AI creators by median views' or 'rising creators in crypto'. Ranks on MEDIAN reach, not mean.",
    parameters: z.object({
      niche: z.string().optional().describe("Niche/tag to filter by, e.g. 'AI Agents & Productivity Tools'. Use listNiches to see options."),
      minMedianViews: z.number().optional(),
      direction: z.enum(["rising", "falling", "flat"]).optional(),
      tier: z.enum(["active", "dormant"]).optional(),
      sortBy: z.enum(SORTABLE).optional().describe("Default performanceScore."),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    execute: async ({ niche, minMedianViews, direction, tier, sortBy = "performanceScore", limit = 10 }) => {
      let rows = await cachedLeaderboard();
      if (niche) rows = rows.filter((r) => r.tags.some((t) => t.toLowerCase() === niche.toLowerCase()));
      if (typeof minMedianViews === "number") rows = rows.filter((r) => r.medianViews >= minMedianViews);
      if (direction) rows = rows.filter((r) => r.direction === direction);
      if (tier) rows = rows.filter((r) => r.pollingTier === tier);
      const key = sortBy as keyof LeaderboardRow;
      rows = [...rows].sort((a, b) => Number(b[key] ?? -Infinity) - Number(a[key] ?? -Infinity));
      return { matched: rows.length, showing: Math.min(rows.length, limit), rows: rows.slice(0, limit).map(slimRow) };
    },
  }),

  getCreator: tool({
    description: "Full stats for one creator by handle.",
    parameters: z.object({ username: z.string() }),
    execute: async ({ username }) => {
      const rows = await cachedLeaderboard();
      const r = rows.find((x) => x.username === norm(username));
      return r ? slimRow(r) : { error: `@${norm(username)} is not tracked.` };
    },
  }),

  compareCreators: tool({
    description: "Compare two or more creators side by side.",
    parameters: z.object({ usernames: z.array(z.string()).min(2).max(6) }),
    execute: async ({ usernames }) => {
      const rows = await cachedLeaderboard();
      const wanted = usernames.map(norm);
      const found = wanted.map((u) => {
        const r = rows.find((x) => x.username === u);
        return r ? slimRow(r) : { username: u, error: "not tracked" };
      });
      return { creators: found };
    },
  }),

  listMovers: tool({
    description: "This week's biggest risers or decliners by week-over-week views.",
    parameters: z.object({
      direction: z.enum(["rising", "falling"]).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    execute: async ({ direction = "rising", limit = 5 }) => {
      const rows = await cachedLeaderboard();
      const picked = direction === "rising" ? topMovers(rows, limit) : topDecliners(rows, limit);
      return { direction, rows: picked.map(slimRow) };
    },
  }),

  listNiches: tool({
    description: "List the niche tags creators are categorised into.",
    parameters: z.object({}),
    execute: async () => ({ niches: await getAllTags() }),
  }),

  listCampaigns: tool({
    description: "List campaigns with delivery-vs-baseline roll-ups (no cost figures).",
    parameters: z.object({}),
    execute: async () => ({ campaigns: await cachedCampaigns() }),
  }),

  listShortlists: tool({
    description: "List shortlists with their ids — call this before addToShortlist so you know which shortlist to target.",
    parameters: z.object({}),
    execute: async () => ({
      shortlists: (await cachedShortlists()).map((s) => ({ id: s.id, name: s.name, items: s.items.length, campaign: s.campaignName })),
    }),
  }),

  costSummary: tool({
    description: "twitterapi.io credit spend this month, projection, and top spenders.",
    parameters: z.object({}),
    execute: async () => {
      const c = await cachedCostSummary();
      return {
        month: c.monthLabel,
        usedCredits: c.usedThisMonth,
        usedUsd: c.usedUsd,
        projectedCredits: c.projectedMonth,
        projectedUsd: c.projectedUsd,
        planCapCredits: c.planCapCredits,
        pctOfCap: c.pctOfCap,
        projectedPctOfCap: c.projectedPctOfCap,
        overBudget: c.overBudget,
        topSpenders: c.byInfluencer.slice(0, 5),
      };
    },
  }),

  runSql: tool({
    description:
      "Read-only SQL (SELECT only) against Postgres for analytics the other tools can't express. Prefer the curated tools first. If unsure of exact columns, SELECT from information_schema.columns to introspect. A LIMIT is enforced.",
    parameters: z.object({
      sql: z.string().describe("A single SELECT/WITH statement."),
      purpose: z.string().optional().describe("One line: what this answers."),
    }),
    execute: async ({ sql }) => {
      try {
        const rows = await runReadOnlySql(sql);
        return { rowCount: rows.length, rows };
      } catch (e) {
        const msg = e instanceof SqlGuardError || e instanceof Error ? e.message : "SQL failed";
        return { error: msg };
      }
    },
  }),

  // ---- Write actions: NO execute → surfaced to the widget for explicit confirmation ----
  addToShortlist: tool({
    description:
      "Propose adding a creator to a shortlist. Call listShortlists first to get a valid shortlistId. This does NOT run until the user clicks Confirm in the UI.",
    parameters: z.object({
      username: z.string(),
      shortlistId: z.string(),
      shortlistName: z.string().optional().describe("For display in the confirmation."),
      note: z.string().optional(),
    }),
  }),

  runPoll: tool({
    description:
      "Propose refreshing all tracked accounts now (a poll). This does NOT run until the user clicks Confirm in the UI.",
    parameters: z.object({}),
  }),
};

export const WRITE_TOOLS = ["addToShortlist", "runPoll"] as const;
