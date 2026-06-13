/**
 * UX 2.0 (T2.3 D1) — a Card with the standard iconed header (chip + title +
 * description) and an actions slot. Collapses the repeated CardHeader markup
 * across the planning/firm surfaces into one consistent pattern.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function SectionCard({
  icon: Icon,
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {Icon && (
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand-ink">
                <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              </span>
            )}
            <CardTitle className="text-lg">{title}</CardTitle>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {description && <p className="mt-1.5 text-xs text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent className={cn(contentClassName)}>{children}</CardContent>
    </Card>
  );
}
