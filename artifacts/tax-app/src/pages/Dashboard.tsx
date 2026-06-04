import {
  useGetDashboardSummary,
  useGetPlanningHitList,
  useGetSettings,
  getGetPlanningHitListQueryKey,
  getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { UpgradeProCard } from "@/components/UpgradeProCard";
import { Users, FileClock, Banknote, Receipt, Target, ChevronRight, type LucideIcon } from "lucide-react";

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

type Tone = "brand" | "success" | "muted";
const toneChip: Record<Tone, string> = {
  brand: "bg-brand/10 text-brand-ink",
  success: "bg-success/10 text-success",
  muted: "bg-muted text-muted-foreground",
};
const toneValue: Record<Tone, string> = {
  brand: "text-foreground",
  success: "text-success",
  muted: "text-foreground",
};

function StatCard({ icon: Icon, label, value, tone = "brand" }: { icon: LucideIcon; label: string; value: string | number; tone?: Tone }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${toneChip[tone]}`}>
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className={`text-2xl font-bold tabular-nums ${toneValue[tone]}`}>{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary();
  const { data: settings } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey() },
  });
  // Hide the planning widget only when settings explicitly says off.
  // While loading we render the widget — falling back to the prior behavior
  // and avoiding a flash of "Upgrade to Pro" for an existing Pro firm.
  const planningGated = settings?.proTierEnabled === false;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">Firm overview</div>
        <h2 className="mt-1.5 text-3xl font-bold tracking-tight text-foreground">Terminal Overview</h2>
        <p className="mt-1.5 text-muted-foreground">System status and firm performance metrics.</p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : summary ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Users} label="Total Clients" value={summary.totalClients} tone="brand" />
          <StatCard icon={FileClock} label="Pending Returns" value={summary.pendingReturns} tone="muted" />
          <StatCard icon={Banknote} label="Total Refunds" value={fmt(summary.totalRefunds)} tone="success" />
          <StatCard icon={Receipt} label="Avg Refund" value={summary.averageRefund != null ? fmt(summary.averageRefund) : "—"} tone="brand" />
        </div>
      ) : (
        <div>No data available</div>
      )}

      {planningGated ? <UpgradeProCard variant="widget" /> : <PlanningHitListWidget />}
    </div>
  );
}

function PlanningHitListWidget() {
  const { data, isLoading, isError, refetch } = useGetPlanningHitList(
    { limit: 10 },
    { query: { queryKey: getGetPlanningHitListQueryKey({ limit: 10 }) } },
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand/10 text-brand-ink">
            <Target className="h-4 w-4" strokeWidth={2} />
          </span>
          <CardTitle className="text-lg">Top 10 planning targets</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          Ranked by PlanningScore (estSavings × confidence × marginal-rate weight ×
          engagement complexity × stickiness). Click a client to open their Planning tab.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : isError ? (
          <div className="text-sm text-destructive py-4">
            Couldn't load planning targets — the server returned an error. This is a
            system problem, not an empty roster, so the data below may be missing.{" "}
            <button
              type="button"
              onClick={() => refetch()}
              className="underline underline-offset-2 hover:text-destructive/80"
            >
              Retry
            </button>
          </div>
        ) : !data || data.entries.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">
            No planning opportunities detected across the client roster yet.
            Seed clients with `pnpm --filter @workspace/scripts exec tsx src/seed-dummy-clients.ts`
            for demo data, or wait for real client returns to be ingested.
          </div>
        ) : (
          <div className="space-y-2">
            {data.entries.map((entry, idx) => (
              <Link key={entry.clientId} href={`/clients/${entry.clientId}`}>
                <div className="group flex items-center justify-between gap-3 rounded-lg border border-border p-3 cursor-pointer transition-colors hover:border-brand/40 hover:bg-accent">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary text-xs font-bold tabular-nums text-secondary-foreground">{idx + 1}</div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{entry.firstName} {entry.lastName}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {entry.state} · TY{entry.taxYear} · AGI {fmt(entry.agi)} · {(entry.federalMarginalRate * 100).toFixed(0)}% marginal
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        {entry.numHits} opportunit{entry.numHits === 1 ? "y" : "ies"}: {entry.topHits.slice(0, 3).map((h) => h.strategyId).join(", ")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <div className="text-base font-semibold tabular-nums text-success">{fmt(entry.totalEstSavings)}</div>
                      <Badge variant="outline" className="text-xs mt-0.5">
                        score {entry.planningScore.toLocaleString()}
                      </Badge>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 transition-colors group-hover:text-brand" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
