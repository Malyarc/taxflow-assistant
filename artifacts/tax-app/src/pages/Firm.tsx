/**
 * UX 2.0 (T2.3 D6) — the Firm workspace: a deadline-sorted engagement board for
 * busy season. Every current-year return with its status (inline-editable),
 * §6072/§6081 deadline, days remaining (urgency-colored), extension flag, and
 * refund/owed. Rows expand to the per-client document-request tracker, tying the
 * two D6 workflow surfaces together. Built on the design-system patterns.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEngagements,
  useUpdateEngagement,
  getListEngagementsQueryKey,
  type UpdateEngagementBodyEngagementStatus,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/patterns/PageHeader";
import { StatTile } from "@/components/patterns/StatTile";
import { StatusPill, engagementStatusMeta } from "@/components/patterns/StatusPill";
import { Money } from "@/components/patterns/Money";
import { DocRequestTracker } from "@/components/patterns/DocRequestTracker";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { CalendarClock, ClipboardList, CheckCircle2, AlarmClock, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

const STATUS_ORDER = ["not_started", "awaiting_documents", "in_preparation", "in_review", "ready_to_file", "filed"] as const;

interface EngagementEntry {
  clientId: number; firstName: string; lastName: string; taxYear: number;
  engagementStatus: string; extensionFiled: boolean;
  effectiveDeadline: string; daysUntilDeadline: number; federalRefundOrOwed: number | null;
}
interface EngagementsResponse { asOf: string; entries: EngagementEntry[]; statusCounts: Record<string, number> }

/** Urgency tone for a days-remaining count. */
function urgency(days: number): { tone: "danger" | "warn" | "info" | "neutral"; label: string } {
  if (days < 0) return { tone: "danger", label: `${Math.abs(days)}d overdue` };
  if (days <= 14) return { tone: "warn", label: `${days}d left` };
  if (days <= 45) return { tone: "info", label: `${days}d left` };
  return { tone: "neutral", label: `${days}d left` };
}

export default function Firm() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const params = statusFilter === "all" ? undefined : { status: statusFilter };
  const { data, isLoading, isError } = useListEngagements(params, {
    query: { queryKey: getListEngagementsQueryKey(params) },
  });
  const resp = data as unknown as EngagementsResponse | undefined;
  const counts = resp?.statusCounts ?? {};
  const total = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-8">
      <PageHeader
        eyebrow="Firm workflow"
        title="Engagement board"
        subtitle={resp ? `Busy-season view · ${total} returns · as of ${resp.asOf}` : "Busy-season view of every return's status and deadline."}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={ClipboardList} label="Total returns" value={total} tone="brand" />
        <StatTile icon={AlarmClock} label="Awaiting docs" value={counts.awaiting_documents ?? 0} tone="warn" />
        <StatTile icon={CalendarClock} label="In review" value={counts.in_review ?? 0} tone="brand" />
        <StatTile icon={CheckCircle2} label="Ready / filed" value={(counts.ready_to_file ?? 0) + (counts.filed ?? 0)} tone="success" />
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")} label="All" count={total} />
        {STATUS_ORDER.map((s) => (
          <FilterChip
            key={s}
            active={statusFilter === s}
            onClick={() => setStatusFilter(s)}
            label={engagementStatusMeta[s].label}
            count={counts[s] ?? 0}
          />
        ))}
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          Couldn't load the engagement board.
        </div>
      ) : !resp || resp.entries.length === 0 ? (
        <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">
          No returns match this filter.
        </div>
      ) : (
        <EngagementTable entries={resp.entries} />
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active ? "border-brand/40 bg-brand/12 text-brand-ink" : "border-border text-muted-foreground hover:bg-accent",
      )}
    >
      {label}
      <span className="t-num tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function EngagementTable({ entries }: { entries: EngagementEntry[] }) {
  const qc = useQueryClient();
  const update = useUpdateEngagement();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const onStatusChange = (e: EngagementEntry, status: string) => {
    setSavingId(e.clientId);
    update.mutate(
      { clientId: e.clientId, data: { engagementStatus: status as UpdateEngagementBodyEngagementStatus }, params: { taxYear: e.taxYear } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["listEngagements"] });
          // The generated key is param-specific; invalidate the broad prefix too.
          qc.invalidateQueries({ queryKey: getListEngagementsQueryKey() });
          toast({ title: "Status updated", description: `${e.firstName} ${e.lastName} → ${engagementStatusMeta[status]?.label ?? status}` });
        },
        onError: () => toast({ title: "Update failed", variant: "destructive" }),
        onSettled: () => setSavingId(null),
      },
    );
  };

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className="w-8 px-2 py-3" />
            <th className="t-eyebrow px-4 py-3 text-left text-muted-foreground">Client</th>
            <th className="t-eyebrow px-4 py-3 text-left text-muted-foreground">Status</th>
            <th className="t-eyebrow px-4 py-3 text-left text-muted-foreground">Deadline</th>
            <th className="t-eyebrow px-4 py-3 text-left text-muted-foreground">Time left</th>
            <th className="t-eyebrow px-4 py-3 text-right text-muted-foreground">Refund / Owed</th>
            <th className="w-10 px-2 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {entries.map((e) => {
            const u = urgency(e.daysUntilDeadline);
            const isOpen = expanded === e.clientId;
            const ro = e.federalRefundOrOwed;
            return (
              <FragmentRow key={e.clientId}>
                <tr className="transition-colors hover:bg-muted/20">
                  <td className="px-2 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : e.clientId)}
                      aria-label={isOpen ? "Collapse document requests" : "Expand document requests"}
                      className="rounded p-1 text-muted-foreground hover:bg-accent"
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{e.firstName} {e.lastName}</div>
                    <div className="text-xs text-muted-foreground">TY{e.taxYear}{e.extensionFiled ? " · extension filed" : ""}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Select value={e.engagementStatus} onValueChange={(v) => onStatusChange(e, v)} disabled={savingId === e.clientId}>
                      <SelectTrigger className="h-8 w-[168px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUS_ORDER.map((s) => (
                          <SelectItem key={s} value={s}>{engagementStatusMeta[s].label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3 t-num tabular-nums text-muted-foreground">{e.effectiveDeadline}</td>
                  <td className="px-4 py-3"><StatusPill tone={u.tone} label={u.label} /></td>
                  <td className="px-4 py-3 text-right">
                    {ro == null ? <span className="text-muted-foreground">—</span>
                      : <Money value={Math.abs(ro)} tone={ro >= 0 ? "success" : "destructive"} />}
                  </td>
                  <td className="px-2 py-3 text-center">
                    <Link href={`/clients/${e.clientId}/review`}>
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Open review workspace">
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </Link>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-muted/10">
                    <td />
                    <td colSpan={6} className="px-4 py-4">
                      <div className="rounded-lg border bg-card p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="t-eyebrow text-brand-ink">Document requests</div>
                          <Link href={`/clients/${e.clientId}`} className="text-xs text-brand-ink underline-offset-2 hover:underline">Open client →</Link>
                        </div>
                        <DocRequestTracker clientId={e.clientId} compact />
                      </div>
                    </td>
                  </tr>
                )}
              </FragmentRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A keyed fragment so each engagement renders two <tr> rows. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
