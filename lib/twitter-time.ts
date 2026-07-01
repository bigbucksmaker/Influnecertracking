/**
 * Parse the `createdAt` string twitterapi.io returns.
 * It usually comes as the classic Twitter format ("Tue Dec 10 07:00:00 +0000 2024"),
 * which V8's Date can parse, but we also accept ISO-8601 and epoch values defensively.
 */
export function parseTwitterDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  if (typeof value === "number") {
    // epoch seconds or ms
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    // numeric string?
    const n = Number(s);
    if (Number.isFinite(n)) return parseTwitterDate(n);
    return null;
  }

  return null;
}

/** Unix seconds — used for advanced_search since_time / until_time operators. */
export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
