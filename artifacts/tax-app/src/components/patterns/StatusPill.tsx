/**
 * UX 2.0 (T2.3 D6) — one status-pill vocabulary for workflow states:
 * engagement status, document-request status, diagnostic severity. A small
 * fixed tone palette (semantic tokens only) keeps the firm's busy-season views
 * legible at a glance.
 */
import { cn } from "@/lib/utils";

export type PillTone = "neutral" | "info" | "warn" | "success" | "danger" | "brand";

const toneClass: Record<PillTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-powder/25 text-brand-ink",
  warn: "bg-gold/15 text-gold-foreground",
  success: "bg-success/12 text-success",
  danger: "bg-destructive/10 text-destructive",
  brand: "bg-brand/12 text-brand-ink",
};

export function StatusPill({
  tone,
  label,
  dot = true,
  className,
}: {
  tone: PillTone;
  label: string;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        toneClass[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />}
      {label}
    </span>
  );
}

/** Engagement status → pill tone + human label (T2.2 ENGAGEMENT_STATUSES). */
export const engagementStatusMeta: Record<string, { tone: PillTone; label: string }> = {
  not_started: { tone: "neutral", label: "Not started" },
  awaiting_documents: { tone: "warn", label: "Awaiting docs" },
  in_preparation: { tone: "info", label: "In preparation" },
  in_review: { tone: "brand", label: "In review" },
  ready_to_file: { tone: "success", label: "Ready to file" },
  filed: { tone: "success", label: "Filed" },
};

/** Client-organizer item status → pill tone + label. */
export const organizerStatusMeta: Record<string, { tone: PillTone; label: string }> = {
  missing: { tone: "warn", label: "Missing" },
  received: { tone: "success", label: "Received" },
  question: { tone: "info", label: "Question" },
};
