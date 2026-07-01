import Link from "next/link";
import { clsx } from "clsx";

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("rounded-xl border border-line bg-surface shadow-panel", className)}>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneCls = {
    default: "text-fg",
    good: "text-pos",
    warn: "text-warn",
    bad: "text-neg",
  }[tone];
  return (
    <Card className="p-4">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-subtle">{label}</div>
      <div className={clsx("mt-1 font-mono text-2xl font-medium tabular-nums tracking-tight", toneCls)}>{value}</div>
      {sub != null && <div className="mt-1 text-xs text-subtle">{sub}</div>}
    </Card>
  );
}

export function Badge({
  children,
  color = "slate",
}: {
  children: React.ReactNode;
  color?: "slate" | "blue" | "green" | "amber" | "red" | "purple";
}) {
  const map = {
    slate: "bg-surface-2 text-muted",
    blue: "bg-accent-soft text-accent-400",
    green: "bg-pos-soft text-pos",
    amber: "bg-warn-soft text-warn",
    red: "bg-neg-soft text-neg",
    purple: "bg-accent-soft text-accent-400",
  }[color];
  return (
    <span className={clsx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", map)}>
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  max,
  tone = "blue",
}: {
  value: number;
  max: number;
  tone?: "blue" | "amber" | "red" | "green";
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const bar = {
    blue: "bg-accent",
    amber: "bg-warn",
    red: "bg-neg",
    green: "bg-pos",
  }[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={clsx("h-full rounded-full", bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Avatar({
  src,
  alt,
  size = 32,
}: {
  src: string | null;
  alt: string;
  size?: number;
}) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        className="rounded-full bg-surface-2 object-cover ring-1 ring-line-soft"
        style={{ width: size, height: size }}
      />
    );
  }
  const initial = alt.replace(/^@/, "").charAt(0).toUpperCase();
  return (
    <div
      className="flex items-center justify-center rounded-full bg-surface-2 font-medium text-muted ring-1 ring-line-soft"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initial}
    </div>
  );
}

/** Tiny dependency-free trend sparkline (inline SVG). Colored by first→last trend. */
export function Sparkline({
  values,
  width = 68,
  height = 20,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const pts = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v));
  const nonZero = pts.some((v) => v > 0);
  if (pts.length < 2 || !nonZero) {
    return <span className="text-xs text-subtle">—</span>;
  }
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const span = max - min || 1;
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const coords = pts.map((v, i) => {
    const x = pad + (i / (pts.length - 1)) * w;
    const y = pad + h - ((v - min) / span) * h;
    return [x, y] as const;
  });
  const d = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const first = pts[0];
  const last = pts[pts.length - 1];
  const stroke = last > first ? "#37C08A" : last < first ? "#F0616D" : "#616772";
  const [lx, ly] = coords[coords.length - 1];
  return (
    <svg width={width} height={height} className={clsx("inline-block align-middle", className)} aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={1.8} fill={stroke} />
    </svg>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.015em] text-fg">{title}</h1>
        {description && <p className="mt-1 text-sm text-subtle">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  href,
  cta,
}: {
  title: string;
  children?: React.ReactNode;
  href?: string;
  cta?: string;
}) {
  return (
    <Card className="p-10 text-center">
      <div className="text-lg font-medium text-fg">{title}</div>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-subtle">{children}</div>}
      {href && cta && (
        <Link
          href={href}
          className="mt-4 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-600"
        >
          {cta}
        </Link>
      )}
    </Card>
  );
}
