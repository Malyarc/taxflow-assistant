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
  getGetPlanningHitListQueryKey,
  getGetSettingsQueryKey,
  getListPlanningCampaignsQueryKey,
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
import { Target, Megaphone, ChevronRight, Banknote, Users } from "lucide-react";

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
