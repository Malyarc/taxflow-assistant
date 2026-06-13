/**
 * UX 2.0 (T2.3 D1) — the standard page header: an uppercase eyebrow, a display
 * title, an optional subtitle, and a right-aligned actions slot. One header
 * pattern across Today / Clients / Planning / Firm so pages feel like one app.
 */
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="t-eyebrow text-brand-ink">{eyebrow}</div>}
        <h1 className="t-display mt-1.5 text-foreground">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
