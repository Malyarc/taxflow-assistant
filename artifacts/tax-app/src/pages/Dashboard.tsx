/**
 * UX 2.0 (T2.3 D2/D6) — "Today", the daily landing.
 *
 * Firm KPIs, the soonest engagement deadlines (busy-season triage), and a peek
 * at the top planning opportunities (full list lives on /planning). Rebuilt on
 * the design-system patterns (PageHeader / StatTile / SectionCard / StatusPill).
 */
import { Link } from "wouter";
import {
  useGetDashboardSummary,
  useGetPlanningHitList,
  useGetSettings,
  useListEngagements,
  getGetPlanningHitListQueryKey,
  getGetSettingsQueryKey,
  getListEngagementsQueryKey,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/patterns/PageHeader";
import { StatTile } from "@/components/patterns/StatTile";
import { SectionCard } from "@/components/patterns/SectionCard";
import { StatusPill, engagementStatusMeta } from "@/components/patterns/StatusPill";
import { Money } from "@/components/patterns/Money";
import { money } from "@/lib/format";
import { Users, FileClock, Banknote, Receipt, Target, CalendarClock, ChevronRight, ArrowRight } from "lucide-react";

interface EngagementEntry {
  clientId: number; firstName: string; lastName: string; taxYear: number;
  engagementStatus: string; effectiveDeadline: string; daysUntilDeadline: number;
}
interface EngagementsResponse { entries: EngagementEntry[]; statusCounts: Record<string, number> }

function urgency(days: number): { tone: "danger" | "warn" | "info" | "neutral"; label: string } {
  if (days < 0) return { tone: "danger", label: `${Math.abs(days)}d overdue` };
  if (days <= 14) return { tone: "warn", label: `${days}d left` };
  if (days <= 45) return { tone: "info", label: `${days}d left` };
  return { tone: "neutral", label: `${days}d left` };
}

export default function Dashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary();
  const { data: settings } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const planningGated = settings?.proTierEnabled === false;

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-8">
      <PageHeader
        eyebrow="Firm overview"
        title="Today"
        subtitle="Where the firm stands and what needs attention next."
        actions={<Link href="/clients/new"><Button>New client</Button></Link>}
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : summary ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={Users} label="Total clients" value={summary.totalClients} tone="brand" />
          <StatTile icon={FileClock} label="Pending returns" value={summary.pendingReturns} tone="muted" />
          <StatTile icon={Banknote} label="Total refunds" value={money(summary.totalRefunds)} tone="success" />
          <StatTile icon={Receipt} label="Avg refund" value={summary.averageRefund != null ? money(summary.averageRefund) : "—"} tone="brand" />
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">No data available.</div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <UpcomingDeadlines />
        {planningGated ? null : <PlanningPeek />}
      </div>
    </div>
  );
}

function UpcomingDeadlines() {
  const { data, isLoading } = useListEngagements(undefined, { query: { queryKey: getListEngagementsQueryKey() } });
  const resp = data as unknown as EngagementsResponse | undefined;
  const entries = (resp?.entries ?? []).slice(0, 6);

  return (
    <SectionCard
      icon={CalendarClock}
      title="Upcoming deadlines"
      description="The next returns due across the firm, soonest first."
      actions={<Link href="/firm" className="text-xs text-brand-ink underline-offset-2 hover:underline">Board →</Link>}
      contentClassName="space-y-2"
    >
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : entries.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">No engagements yet.</p>
      ) : (
        entries.map((e) => {
          const u = urgency(e.daysUntilDeadline);
          const meta = engagementStatusMeta[e.engagementStatus] ?? { tone: "neutral" as const, label: e.engagementStatus };
          return (
            <Link key={e.clientId} href={`/clients/${e.clientId}/review`}>
              <div className="group flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:border-brand/40 hover:bg-accent">
                <div className="min-w-0">
                  <div className="truncate font-medium">{e.firstName} {e.lastName}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusPill tone={meta.tone} label={meta.label} dot={false} />
                    <span className="text-xs text-muted-foreground">{e.effectiveDeadline}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusPill tone={u.tone} label={u.label} />
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50 transition-colors group-hover:text-brand" />
                </div>
              </div>
            </Link>
          );
        })
      )}
    </SectionCard>
  );
}

function PlanningPeek() {
  const { data, isLoading } = useGetPlanningHitList({ limit: 5 }, { query: { queryKey: getGetPlanningHitListQueryKey({ limit: 5 }) } });
  return (
    <SectionCard
      icon={Target}
      title="Top planning opportunities"
      description="Highest-value tax-saving opportunities across the roster."
      actions={<Link href="/planning" className="inline-flex items-center gap-1 text-xs text-brand-ink underline-offset-2 hover:underline">All <ArrowRight className="h-3 w-3" /></Link>}
      contentClassName="space-y-2"
    >
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !data || data.entries.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">No planning opportunities detected yet.</p>
      ) : (
        data.entries.slice(0, 5).map((entry, idx) => (
          <Link key={entry.clientId} href={`/clients/${entry.clientId}`}>
            <div className="group flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:border-brand/40 hover:bg-accent">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary text-xs font-bold tabular-nums text-secondary-foreground">{idx + 1}</div>
                <div className="min-w-0">
                  <div className="truncate font-medium">{entry.firstName} {entry.lastName}</div>
                  <div className="truncate text-xs text-muted-foreground">{entry.state} · TY{entry.taxYear} · {entry.numHits} opportunit{entry.numHits === 1 ? "y" : "ies"}</div>
                </div>
              </div>
              <Money value={entry.totalEstSavings} tone="success" className="shrink-0 font-semibold" />
            </div>
          </Link>
        ))
      )}
    </SectionCard>
  );
}
