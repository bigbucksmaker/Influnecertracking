export function formatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(abs >= 1e10 ? 0 : 1) + "B";
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(abs >= 1e7 ? 0 : 1) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(abs >= 1e4 ? 0 : 1) + "K";
  return String(Math.round(n));
}

export function formatFull(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function formatPct(ratio: number | null | undefined, digits = 2): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return (ratio * 100).toFixed(digits) + "%";
}

export function formatSignedPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  const v = ratio * 100;
  const sign = v > 0 ? "+" : "";
  return sign + v.toFixed(digits) + "%";
}

export function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function formatCredits(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US") + " cr";
}

export function relativeTime(date: Date | string | null | undefined): string {
  if (!date) return "never";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}
