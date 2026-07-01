import { prisma } from "./db";
import { creditsToUsd, recommendPlan, planForCap, type PlanTier } from "./cost";
import { getSettings } from "./settings";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EndpointCost {
  endpoint: string;
  credits: number;
  usd: number;
  requests: number;
}
export interface DayCost {
  date: string; // YYYY-MM-DD
  credits: number;
  usd: number;
}
export interface InfluencerCost {
  accountId: string | null;
  username: string;
  credits: number;
  usd: number;
  requests: number;
}

export interface CostSummary {
  monthLabel: string;
  monthStart: string;
  daysElapsed: number;
  daysInMonth: number;

  usedThisMonth: number;
  usedUsd: number;
  requestsThisMonth: number;

  projectedMonth: number;
  projectedUsd: number;

  planCapCredits: number;
  currentPlan: PlanTier | null;
  pctOfCap: number; // used / cap
  projectedPctOfCap: number; // projected / cap
  overBudget: boolean;
  recommendedPlan: PlanTier | null;

  avgCreditsPerPoll: number; // per account-poll, trailing 7d
  pollsLast7d: number;

  byEndpoint: EndpointCost[];
  byDay: DayCost[];
  byInfluencer: InfluencerCost[];
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getCostSummary(): Promise<CostSummary> {
  const settings = await getSettings();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = Math.max(
    (now.getTime() - monthStart.getTime()) / DAY_MS,
    0.5, // avoid divide-by-zero / wild projection on day 1
  );
  const thirtyAgo = new Date(now.getTime() - 30 * DAY_MS);
  const sevenAgo = new Date(now.getTime() - 7 * DAY_MS);

  const [monthAgg, byEndpointRaw, byInfluencerRaw, dayLogs, pollCount, windowAgg] =
    await Promise.all([
      prisma.apiCallLog.aggregate({
        where: { requestedAt: { gte: monthStart } },
        _sum: { creditsCharged: true },
        _count: { _all: true },
      }),
      prisma.apiCallLog.groupBy({
        by: ["endpoint"],
        where: { requestedAt: { gte: monthStart } },
        _sum: { creditsCharged: true },
        _count: { _all: true },
      }),
      prisma.apiCallLog.groupBy({
        by: ["accountId"],
        where: { requestedAt: { gte: monthStart } },
        _sum: { creditsCharged: true },
        _count: { _all: true },
      }),
      prisma.apiCallLog.findMany({
        where: { requestedAt: { gte: thirtyAgo } },
        select: { requestedAt: true, creditsCharged: true },
      }),
      prisma.apiCallLog.count({
        where: { requestedAt: { gte: sevenAgo }, endpoint: "user_info", purpose: "poll" },
      }),
      prisma.apiCallLog.aggregate({
        where: { requestedAt: { gte: sevenAgo }, purpose: { in: ["poll", "refresh"] } },
        _sum: { creditsCharged: true },
      }),
    ]);

  const usedThisMonth = monthAgg._sum.creditsCharged ?? 0;
  const requestsThisMonth = monthAgg._count._all ?? 0;
  const projectedMonth = Math.round((usedThisMonth / daysElapsed) * daysInMonth);

  const cap = settings.planCapCredits;
  const currentPlan = planForCap(cap);

  const byEndpoint: EndpointCost[] = byEndpointRaw
    .map((e) => ({
      endpoint: e.endpoint,
      credits: e._sum.creditsCharged ?? 0,
      usd: creditsToUsd(e._sum.creditsCharged ?? 0),
      requests: e._count._all ?? 0,
    }))
    .sort((a, b) => b.credits - a.credits);

  // map accountId → username for the influencer breakdown
  const accountIds = byInfluencerRaw.map((i) => i.accountId).filter((x): x is string => !!x);
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, username: true },
  });
  const nameById = new Map(accounts.map((a) => [a.id, a.username]));
  const byInfluencer: InfluencerCost[] = byInfluencerRaw
    .map((i) => ({
      accountId: i.accountId,
      username: i.accountId ? nameById.get(i.accountId) ?? "(deleted)" : "(unattributed)",
      credits: i._sum.creditsCharged ?? 0,
      usd: creditsToUsd(i._sum.creditsCharged ?? 0),
      requests: i._count._all ?? 0,
    }))
    .sort((a, b) => b.credits - a.credits)
    .slice(0, 20);

  // group day costs in JS (portable across SQLite/Postgres)
  const dayMap = new Map<string, number>();
  for (const l of dayLogs) {
    const key = ymd(l.requestedAt);
    dayMap.set(key, (dayMap.get(key) ?? 0) + l.creditsCharged);
  }
  const byDay: DayCost[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    const key = ymd(d);
    const credits = dayMap.get(key) ?? 0;
    byDay.push({ date: key, credits, usd: creditsToUsd(credits) });
  }

  const windowCredits = windowAgg._sum.creditsCharged ?? 0;
  const avgCreditsPerPoll = pollCount > 0 ? Math.round(windowCredits / pollCount) : 0;

  return {
    monthLabel: now.toLocaleString("en-US", { month: "long", year: "numeric" }),
    monthStart: monthStart.toISOString(),
    daysElapsed: Math.round(daysElapsed * 10) / 10,
    daysInMonth,
    usedThisMonth,
    usedUsd: creditsToUsd(usedThisMonth),
    requestsThisMonth,
    projectedMonth,
    projectedUsd: creditsToUsd(projectedMonth),
    planCapCredits: cap,
    currentPlan,
    pctOfCap: cap > 0 ? usedThisMonth / cap : 0,
    projectedPctOfCap: cap > 0 ? projectedMonth / cap : 0,
    overBudget: projectedMonth > cap,
    recommendedPlan: recommendPlan(projectedMonth),
    avgCreditsPerPoll,
    pollsLast7d: pollCount,
    byEndpoint,
    byDay,
    byInfluencer,
  };
}
