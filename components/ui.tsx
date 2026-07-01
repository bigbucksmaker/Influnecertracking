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
    <div className={clsx("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
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
    default: "text-slate-900",
    good: "text-emerald-600",
    warn: "text-amber-600",
    bad: "text-red-600",
  }[tone];
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={clsx("mt-1 text-2xl font-semibold", toneCls)}>{value}</div>
      {sub != null && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
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
    slate: "bg-slate-100 text-slate-700",
    blue: "bg-blue-100 text-blue-700",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
    purple: "bg-purple-100 text-purple-700",
  }[color];
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", map)}>
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
    blue: "bg-brand-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
    green: "bg-emerald-500",
  }[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
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
        className="rounded-full bg-slate-100 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const initial = alt.replace(/^@/, "").charAt(0).toUpperCase();
  return (
    <div
      className="flex items-center justify-center rounded-full bg-slate-200 text-slate-600"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {initial}
    </div>
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
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
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
      <div className="text-lg font-medium text-slate-800">{title}</div>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-slate-500">{children}</div>}
      {href && cta && (
        <Link
          href={href}
          className="mt-4 inline-flex rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          {cta}
        </Link>
      )}
    </Card>
  );
}
