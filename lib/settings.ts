import { prisma } from "./db";
import type { AppSettings } from "@prisma/client";

export const DEFAULT_SETTINGS = {
  reachWeight: 0.5,
  engagementWeight: 0.5,
  planCapCredits: 11_290_000,
  activeWindowHours: 48,
  activePollHours: 3,
  dormantPollHours: 24,
  freezeAgeDays: 3,
  backfillDays: 7,
  normalization: "percentile",
  includeReplies: false,
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
