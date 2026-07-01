import { prisma } from "./db";
import type { AppSettings } from "@prisma/client";

export const DEFAULT_SETTINGS = {
  reachWeight: 0.5,
  engagementWeight: 0.5,
  planCapCredits: 25_070_000,
  activeWindowHours: 48,
  activePollHours: 3,
  dormantPollHours: 24,
  freezeAgeDays: 3,
  backfillDays: 7,
  normalization: "percentile",
  includeReplies: false,
  minPostsForConfidence: 3,
  stalePollHours: 12,
  fallingThreshold: 0.25,
  commissionedFreezeDays: 14,
  underdeliverThreshold: 0.7,
};

/** Read the singleton settings row, creating it with defaults if missing. */
export async function getSettings(): Promise<AppSettings> {
  const existing = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  if (existing) return existing;
  return prisma.appSettings.create({ data: { id: "singleton", ...DEFAULT_SETTINGS } });
}

export type SettingsUpdate = Partial<Omit<AppSettings, "id" | "updatedAt">>;

export async function updateSettings(patch: SettingsUpdate): Promise<AppSettings> {
  return prisma.appSettings.upsert({
    where: { id: "singleton" },
    update: patch,
    create: { id: "singleton", ...DEFAULT_SETTINGS, ...patch },
  });
}
