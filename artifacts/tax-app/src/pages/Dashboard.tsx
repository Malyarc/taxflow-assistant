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

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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
        <h2 className="text-3xl font-bold tracking-tight">Terminal Overview</h2>
        <p className="text-muted-foreground mt-2">System status and firm performance metrics.</p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : summary ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.totalClients}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Returns</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.pendingReturns}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Refunds</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-accent">${(summary.totalRefunds ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Refund</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.averageRefund != null ? `$${summary.averageRefund.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}</div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div>No data available</div>
      )}

      {planningGated ? <UpgradeProCard variant="widget" /> : <PlanningHitListWidget />}
    </div>
  );
}

function PlanningHitListWidget() {
  const { data, isLoading } = useGetPlanningHitList(
    { limit: 10 },
    { query: { queryKey: getGetPlanningHitListQueryKey({ limit: 10 }) } },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Top 10 planning targets</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Ranked by PlanningScore (estSavings × confidence × marginal-rate weight ×
          engagement complexity × stickiness). Click a client to open their Planning tab.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
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
                <div className="flex items-center justify-between p-3 rounded border hover:bg-accent/40 cursor-pointer">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="text-xs text-muted-foreground w-6 text-right font-mono">{idx + 1}</div>
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
                  <div className="text-right shrink-0 ml-2">
                    <div className="text-base font-semibold text-emerald-700">{fmt(entry.totalEstSavings)}</div>
                    <Badge variant="outline" className="text-xs mt-0.5">
                      score {entry.planningScore.toLocaleString()}
                    </Badge>
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
