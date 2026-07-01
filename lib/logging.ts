import { prisma } from "./db";
import { creditsToUsd } from "./cost";
import type { ApiEndpoint, CostInfo } from "./provider/types";
import { ProviderError } from "./provider/types";

export interface CallContext {
  accountId?: string | null;
  purpose?: string; // poll | backfill | manual | refresh | add
  durationMs?: number;
  httpStatus?: number;
}

/** Record a successful (or empty-but-charged) provider call. Returns the log id. */
export async function recordCost(cost: CostInfo, ctx: CallContext = {}): Promise<string> {
  const row = await prisma.apiCallLog.create({
    data: {
      endpoint: cost.endpoint,
      accountId: ctx.accountId ?? null,
      purpose: ctx.purpose ?? "poll",
      itemsReturned: cost.itemsReturned,
      creditsCharged: cost.creditsCharged,
      estimatedCostUsd: creditsToUsd(cost.creditsCharged),
      ok: true,
      httpStatus: ctx.httpStatus ?? 200,
      durationMs: ctx.durationMs ?? null,
    },
  });
  return row.id;
}

/** Record a failed provider call (0 credits — most 4xx errors are not billed). */
export async function recordError(
  endpoint: ApiEndpoint,
  err: unknown,
  ctx: CallContext = {},
): Promise<string> {
  const status = err instanceof ProviderError ? err.status : ctx.httpStatus ?? 0;
  const message = err instanceof Error ? err.message : String(err);
  const row = await prisma.apiCallLog.create({
    data: {
      endpoint,
      accountId: ctx.accountId ?? null,
      purpose: ctx.purpose ?? "poll",
      itemsReturned: 0,
      creditsCharged: 0,
      estimatedCostUsd: 0,
      ok: false,
      httpStatus: status,
      errorMessage: message.slice(0, 500),
      durationMs: ctx.durationMs ?? null,
    },
  });
  return row.id;
}
