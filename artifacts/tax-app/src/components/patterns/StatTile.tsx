/**
 * UX 2.0 (T2.3 D1/D6) — KPI tile. The dashboard's stat pattern, generalized:
 * an iconed chip, an uppercase label, a metric value, and an optional footnote
 * slot (a delta, a context line). Used on Today and Firm.
 */
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export type StatTone = "brand" | "success" | "muted" | "warn" | "danger";

const chipClass: Record<StatTone, string> = {
  brand: "bg-brand/10 text-brand-ink",
  success: "bg-success/10 text-success",
  muted: "bg-muted text-muted-foreground",
  warn: "bg-gold/15 text-gold-foreground",
  danger: "bg-destructive/10 text-destructive",
};
const valueClass: Record<StatTone, string> = {
  brand: "text-foreground",
  success: "text-success",
  muted: "text-foreground",
  warn: "text-foreground",
  danger: "text-destructive",
};

export function StatTile({
  icon: Icon,
  label,
  value,
  tone = "brand",
  footnote,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  tone?: StatTone;
  footnote?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="flex items-center gap-4 p-5">
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", chipClass[tone])}>
          <Icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="t-eyebrow text-muted-foreground">{label}</div>
          <div className={cn("t-metric text-2xl", valueClass[tone])}>{value}</div>
          {footnote && <div className="mt-0.5 text-xs text-muted-foreground">{footnote}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
