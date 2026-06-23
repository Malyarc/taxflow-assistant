/**
 * UX 2.0 (T2.3 D2/D6) — firm-wide Planning workspace.
 *
 * The planning hit-list and campaign cohorts moved here off the dashboard so
 * "Planning" is a first-class nav destination (Today / Clients / Planning /
 * Firm). Rebuilt on the design-system patterns (PageHeader / SectionCard /
 * Money / StatTile) as a demo of the token + pattern layer.
 */
import { useState } from "react";
import { Link } from "wouter";
import {
  useGetPlanningHitList,
  useGetSettings,
  useListPlanningCampaigns,
  useGetFirmBenchmarking,
  getGetPlanningHitListQueryKey,
  getGetSettingsQueryKey,
  getListPlanningCampaignsQueryKey,
  getGetFirmBenchmarkingQueryKey,
  useDraftCampaignEmail,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UpgradeProCard } from "@/components/UpgradeProCard";
import { PageHeader } from "@/components/patterns/PageHeader";
import { SectionCard } from "@/components/patterns/SectionCard";
import { StatTile } from "@/components/patterns/StatTile";
import { Money } from "@/components/patterns/Money";
import { money, pctScaled } from "@/lib/format";
import { Target, Megaphone, ChevronRight, Banknote, Users, BarChart3, Gauge, Layers } from "lucide-react";

export default function Planning() {
  const { data: settings } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const gated = settings?.proTierEnabled === false;

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-8">
      <PageHeader
        eyebrow="Firm planning"
        title="Planning opportunities"
        subtitle="Ranked tax-saving opportunities across the roster, and batch-outreach cohorts by strategy."
      />
      {gated ? (
        <UpgradeProCard variant="widget" />
      ) : (
        <>
          <HitListSummary />
          <BookBenchmarking />
          <HitList />
          <Campaigns />
        </>
      )}
    </div>
  );
}

function HitListSummary() {
  const { data } = useGetPlanningHitList({ limit: 50 }, { query: { queryKey: getGetPlanningHitListQueryKey({ limit: 50 }) } });
  if (!data || data.entries.length === 0) return null;
  const total = data.entries.reduce((a, e) => a + (e.totalEstSavings ?? 0), 0);
  const withOpps = data.entries.filter((e) => e.numHits > 0).length;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatTile icon={Users} label="Clients with opportunities" value={withOpps} tone="brand" />
      <StatTile icon={Banknote} label="Identified savings (top 50)" value={money(total)} tone="success" />
      <StatTile icon={Target} label="Top opportunity" value={money(data.entries[0]?.totalEstSavings)} tone="success"
        footnote={`${data.entries[0]?.firstName ?? ""} ${data.entries[0]?.lastName ?? ""}`.trim()} />
    </div>
  );
}

// ── G-9 Firm benchmarking ("your book vs. opportunity") ─────────────────────
interface BenchRate { min: number; p25: number; median: number; p75: number; p90: number; max: number; mean: number }
interface BenchBand { label: string; clientCount: number }
interface BenchStrategy {
  strategyId: string; name: string; category?: string;
  clientsWithOpportunity: number; reachPct: number; totalEstSavings: number; medianEstSavings: number;
}
interface BenchReport {
  clientsEvaluated: number; clientCount: number;
  effectiveRatePct: BenchRate; agiBands: BenchBand[]; strategyAdoption: BenchStrategy[];
  firmOpportunity: { totalEstSavings: number; clientsWithAnyOpportunity: number; avgSavingsPerOpportunityClient: number };
}

/** Percentages from the engine are already scaled (e.g. 16.4 = 16.4%). */
const pctLabel = (n: number) => `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;

function BookBenchmarking() {
  const { data, isLoading, isError } = useGetFirmBenchmarking(
    { limit: 100 },
    { query: { queryKey: getGetFirmBenchmarkingQueryKey({ limit: 100 }), staleTime: 5 * 60 * 1000 } },
  );
  const r = data as unknown as BenchReport | undefined;

  return (
    <SectionCard
      icon={BarChart3}
      title="Book benchmarking"
      description="Anonymized practice-management view across your top planning-opportunity clients — effective-rate spread, AGI mix, and where the unrealized strategy dollars are. Counts + $100-rounded aggregates only."
    >
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : isError ? (
        <div className="py-4 text-sm text-muted-foreground">Benchmarking is unavailable right now.</div>
      ) : !r || r.clientCount === 0 ? (
        <div className="py-4 text-sm text-muted-foreground">No benchmarkable clients yet — add returns with planning opportunities to populate the book view.</div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile icon={Gauge} label="Median effective rate" value={pctLabel(r.effectiveRatePct.median)} tone="brand"
              footnote={`book ${pctLabel(r.effectiveRatePct.min)}–${pctLabel(r.effectiveRatePct.max)}`} />
            <StatTile icon={Banknote} label="Unrealized opportunity" value={money(r.firmOpportunity.totalEstSavings)} tone="success"
              footnote={`${r.firmOpportunity.clientsWithAnyOpportunity} clients · avg ${money(r.firmOpportunity.avgSavingsPerOpportunityClient)}`} />
            <StatTile icon={Users} label="Clients benchmarked" value={r.clientCount} tone="muted"
              footnote={r.strategyAdoption.length > 0 ? `${r.strategyAdoption.length} strategies in play` : undefined} />
          </div>

          {/* Effective-rate distribution */}
          <div>
            <div className="t-eyebrow mb-2 text-muted-foreground">Effective-rate distribution</div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {([["p25", r.effectiveRatePct.p25], ["median", r.effectiveRatePct.median], ["p75", r.effectiveRatePct.p75], ["p90", r.effectiveRatePct.p90]] as const).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border bg-secondary/40 p-2">
                  <div className="t-num text-lg font-semibold tabular-nums">{pctLabel(v)}</div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{k}</div>
                </div>
              ))}
            </div>
          </div>

          {/* AGI-band histogram */}
          <div>
            <div className="t-eyebrow mb-2 text-muted-foreground">AGI mix</div>
            <div className="space-y-1.5">
              {(() => {
                const maxBand = Math.max(1, ...r.agiBands.map((b) => b.clientCount));
                return r.agiBands.map((b) => (
                  <div key={b.label} className="flex items-center gap-3">
                    <div className="w-28 shrink-0 text-xs text-muted-foreground">{b.label}</div>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-brand/70" style={{ width: `${(b.clientCount / maxBand) * 100}%` }} />
                    </div>
                    <div className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{b.clientCount}</div>
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* Strategy-adoption "opportunity gap" table */}
          <div>
            <div className="t-eyebrow mb-2 flex items-center gap-1.5 text-muted-foreground"><Layers className="h-3.5 w-3.5" /> Opportunity gap by strategy</div>
            <div className="space-y-1.5">
              {r.strategyAdoption.slice(0, 8).map((s) => (
                <div key={s.strategyId} className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{s.clientsWithOpportunity} client{s.clientsWithOpportunity === 1 ? "" : "s"} · {pctLabel(s.reachPct)} of book</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <Money value={s.totalEstSavings} tone="success" className="text-sm font-semibold" />
                    <div className="text-xs text-muted-foreground">~{money(s.medianEstSavings)}/client</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function HitList() {
  const { data, isLoading, isError, refetch } = useGetPlanningHitList(
    { limit: 25 },
    { query: { queryKey: getGetPlanningHitListQueryKey({ limit: 25 }) } },
  );
  return (
    <SectionCard
      icon={Target}
      title="Top planning targets"
      description="Ranked by PlanningScore (estSavings × confidence × marginal-rate weight × engagement complexity × stickiness). Click a client to open their Planning tab."
    >
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : isError ? (
        <div className="py-4 text-sm text-destructive">
          Couldn't load planning targets — the server returned an error.{" "}
          <button type="button" onClick={() => refetch()} className="underline underline-offset-2 hover:text-destructive/80">Retry</button>
        </div>
      ) : !data || data.entries.length === 0 ? (
        <div className="py-4 text-sm text-muted-foreground">No planning opportunities detected across the roster yet.</div>
      ) : (
        <div className="space-y-2">
          {data.entries.map((entry, idx) => (
            <Link key={entry.clientId} href={`/clients/${entry.clientId}`}>
              <div className="group flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:border-brand/40 hover:bg-accent">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary text-xs font-bold tabular-nums text-secondary-foreground">{idx + 1}</div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{entry.firstName} {entry.lastName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {entry.state} · TY{entry.taxYear} · AGI {money(entry.agi)} · {pctScaled(entry.federalMarginalRate * 100)} marginal
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {entry.numHits} opportunit{entry.numHits === 1 ? "y" : "ies"}: {entry.topHits.slice(0, 3).map((h) => h.strategyId).join(", ")}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    <Money value={entry.totalEstSavings} tone="success" className="text-base font-semibold" />
                    <Badge variant="outline" className="mt-0.5 text-xs">score {entry.planningScore.toLocaleString()}</Badge>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50 transition-colors group-hover:text-brand" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

interface CampaignStats { clientCount: number; minSavings: number; medianSavings: number; maxSavings: number }
interface CampaignMember { clientId: number; firstName: string; lastName: string; estSavings: number }
interface Campaign {
  strategyId: string; name: string; clientCount: number; totalEstSavings: number;
  medianEstSavings: number; clients: CampaignMember[]; stats: CampaignStats;
}

function Campaigns() {
  const { data, isLoading, isError } = useListPlanningCampaigns(
    { limit: 25 },
    { query: { queryKey: getListPlanningCampaignsQueryKey({ limit: 25 }), staleTime: 5 * 60 * 1000 } },
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ strategyId: string; template: string; aiUsed: boolean } | null>(null);
  const draftEmail = useDraftCampaignEmail();

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (isError || !data) return null;
  const campaigns = ((data as unknown as { campaigns: Campaign[] }).campaigns ?? []).slice(0, 8);
  if (campaigns.length === 0) return null;

  const onDraft = async (c: Campaign) => {
    setDraft(null);
    setPendingId(c.strategyId);
    try {
      const r = (await draftEmail.mutateAsync({ data: { strategyId: c.strategyId, cohortStats: c.stats } })) as unknown as { template: string; aiUsed: boolean };
      setDraft({ strategyId: c.strategyId, template: r.template, aiUsed: r.aiUsed });
    } catch {
      setDraft({ strategyId: c.strategyId, template: "Draft failed — try again.", aiUsed: false });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <SectionCard
      icon={Megaphone}
      title="Planning campaigns"
      description={`Clients grouped by strategy. "Draft email" writes a {{firstName}}/{{estSavings}} mail-merge template — no client data is sent to the AI; the merge happens locally.`}
      contentClassName="space-y-2"
    >
      {campaigns.map((c) => (
        <div key={c.strategyId} className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-medium">{c.name}</div>
              <div className="text-xs text-muted-foreground">{c.strategyId} · {c.clientCount} client{c.clientCount === 1 ? "" : "s"} · median {money(c.medianEstSavings)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Money value={c.totalEstSavings} tone="success" className="text-base font-semibold" />
              <Button size="sm" variant="outline" onClick={() => setOpenId(openId === c.strategyId ? null : c.strategyId)}>{openId === c.strategyId ? "Hide" : "Cohort"}</Button>
              <Button size="sm" onClick={() => void onDraft(c)} disabled={draftEmail.isPending}>{pendingId === c.strategyId ? "Drafting…" : "Draft email"}</Button>
            </div>
          </div>
          {openId === c.strategyId && (
            <div className="mt-2 space-y-1 border-t pt-2">
              {c.clients.slice(0, 10).map((m) => (
                <Link key={m.clientId} href={`/clients/${m.clientId}`}>
                  <div className="flex cursor-pointer items-center justify-between rounded px-2 py-1 text-sm hover:bg-accent">
                    <span>{m.firstName} {m.lastName}</span>
                    <Money value={m.estSavings} tone="success" />
                  </div>
                </Link>
              ))}
              {c.clients.length > 10 && <div className="px-2 text-xs text-muted-foreground">+{c.clients.length - 10} more</div>}
            </div>
          )}
          {draft?.strategyId === c.strategyId && (
            <div className="mt-2 rounded border bg-muted/30 p-3">
              <pre className="whitespace-pre-wrap font-sans text-xs">{draft.template}</pre>
              <p className="mt-2 t-eyebrow text-muted-foreground">{draft.aiUsed ? "AI-drafted template — review before sending." : "Deterministic template (AI off)."}</p>
            </div>
          )}
        </div>
      ))}
    </SectionCard>
  );
}
