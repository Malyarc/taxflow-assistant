/**
 * T2.2 — CPA Tools tab: tax projection + 1040-ES, MFJ-vs-MFS optimizer,
 * year-over-year + threshold alerts, entity choice (S-corp reasonable comp),
 * engagement tracking, the client organizer, and prior-year roll-forward.
 * Reads the T2.2 endpoints via the generated React Query hooks; types the
 * (permissively-schema'd) responses locally against the api-server lib shapes.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTaxProjection,
  getGetTaxProjectionQueryKey,
  useGetMfjVsMfs,
  getGetMfjVsMfsQueryKey,
  useGetYearOverYear,
  getGetYearOverYearQueryKey,
  useGetEntityChoice,
  getGetEntityChoiceQueryKey,
  useGetClientOrganizer,
  getGetClientOrganizerQueryKey,
  useGetNotificationEvents,
  getGetNotificationEventsQueryKey,
  useGetTaxReturn,
  getGetTaxReturnQueryKey,
  useUpdateEngagement,
  useRollForwardClient,
  type UpdateEngagementBody,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { downloadFile } from "@/lib/download";

// These read-only analyses cost full engine runs server-side (entity-choice
// alone is 4) — keep them fresh for 5 minutes instead of refetching on every
// tab flip during data entry.
const ANALYSIS_STALE_MS = 5 * 60 * 1000;

const usd = (n: number | null | undefined): string =>
  n == null
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const usd2 = (n: number | null | undefined): string =>
  n == null
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number | null | undefined): string => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

// ── Local response shapes (mirror the api-server lib types) ──
interface YearSummary {
  taxYear: number;
  totalIncome: number;
  adjustedGrossIncome: number;
  taxableIncome: number;
  federalTaxLiability: number;
  stateTaxLiability: number;
  effectiveTaxRate: number;
  section6654Tax: number;
  obbbaSchedule1A: number;
}
interface Voucher { quarter: number; dueDate: string; amount: number }
interface ProjectionResp {
  baseline: YearSummary;
  projected: YearSummary;
  yoyDelta: { totalIncome: number; adjustedGrossIncome: number; combinedTax: number; effectiveTaxRate: number };
  incomeGrowth: number;
  estimatedTax: {
    requiredAnnualPayment: number;
    safeHarborBasis: string;
    priorYearSafeHarborPct: number;
    projectedWithholding: number;
    totalEstimatedPayments: number;
    vouchers: Voucher[];
    withholdingCoversSafeHarbor: boolean;
  };
  obbbaImpact: { deductionTotal: number; note: string };
  /** TP-4 — the projection's modeling assumptions (withholding growth, carryforward chaining, law-year clamp, §7503 roll). */
  assumptions?: string[];
}
interface FsSummary {
  filingStatus: string;
  adjustedGrossIncome: number;
  taxableIncome: number;
  netTaxAfterCredits: number;
  itemized: boolean;
}
interface MfsResp {
  applicable: boolean;
  reason?: string;
  mfj?: FsSummary;
  mfs?: { taxpayer: FsSummary; spouse: FsSummary; combinedNetTaxAfterCredits: number };
  recommendation?: "mfj" | "mfs";
  savings?: number;
  assumptions?: { spouseTagsPresent: boolean; itemizedCouplingApplied: boolean; notes: string[] };
}
interface LineDelta { label: string; prior: number; current: number; change: number; pctChange: number | null }
interface Crossing { id: string; label: string; direction: "entered" | "exited"; detail: string }
interface YoyResp {
  priorYear: number;
  currentYear: number;
  deltas: LineDelta[];
  notableSwings: LineDelta[];
  thresholdCrossings: Crossing[];
  obbbaImpact: { priorTotal: number; currentTotal: number; newBenefit: number; note: string };
  priorYearHasData: boolean;
}

function deltaClass(n: number, goodWhenUp = false): string {
  if (Math.abs(n) < 0.5) return "text-muted-foreground";
  const up = n > 0;
  return up === goodWhenUp ? "text-success" : "text-destructive";
}

// ════════════════════════════════════════════════════════════════════════════
// Card 1 — Tax projection + 1040-ES quarterly estimates
// ════════════════════════════════════════════════════════════════════════════
function ProjectionCard({ clientId }: { clientId: number }) {
  const { data, isLoading, error } = useGetTaxProjection(clientId, undefined, {
    query: { queryKey: getGetTaxProjectionQueryKey(clientId), staleTime: ANALYSIS_STALE_MS },
  });
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (error || !data) return null;
  const p = data as unknown as ProjectionResp;
  const est = p.estimatedTax;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Next-year projection &amp; quarterly estimates
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            TY{p.baseline.taxYear} → TY{p.projected.taxYear} · +{Math.round((p.incomeGrowth - 1) * 100)}%/yr
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div />
          <div className="text-right font-medium text-muted-foreground">TY{p.baseline.taxYear}</div>
          <div className="text-right font-medium text-brand-ink">TY{p.projected.taxYear}</div>
          {([
            ["Total income", p.baseline.totalIncome, p.projected.totalIncome],
            ["AGI", p.baseline.adjustedGrossIncome, p.projected.adjustedGrossIncome],
            ["Federal tax", p.baseline.federalTaxLiability, p.projected.federalTaxLiability],
            ["Effective rate", p.baseline.effectiveTaxRate, p.projected.effectiveTaxRate, true],
          ] as Array<[string, number, number, boolean?]>).map(([label, b, pr, isRate]) => (
            <ProjRow key={label} label={label} a={b} b={pr} isRate={isRate} />
          ))}
        </div>

        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-semibold">Quarterly estimated tax (Form 1040-ES)</span>
            <span className="text-xs text-muted-foreground">
              safe harbor: {est.safeHarborBasis === "prior_year" ? `${Math.round(est.priorYearSafeHarborPct * 100)}% of prior year` : "90% of projected"}
            </span>
          </div>
          {est.withholdingCoversSafeHarbor ? (
            <p className="text-sm text-success">
              Projected withholding ({usd(est.projectedWithholding)}) already meets the §6654 safe harbor
              ({usd(est.requiredAnnualPayment)}) — no quarterly estimates required.
            </p>
          ) : (
            <>
              <p className="mb-2 text-sm">
                Pay <strong>{usd(est.totalEstimatedPayments)}</strong> across four installments to meet the
                §6654 safe harbor ({usd(est.requiredAnnualPayment)} − {usd(est.projectedWithholding)} withholding):
              </p>
              <div className="grid grid-cols-4 gap-2">
                {est.vouchers.map((v) => (
                  <div key={v.quarter} className="rounded border bg-background px-2 py-1.5 text-center">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Q{v.quarter} · {v.dueDate}</div>
                    <div className="text-sm font-semibold">{usd(v.amount)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {p.obbbaImpact.deductionTotal > 0 && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-brand-ink">OBBBA:</span> {p.obbbaImpact.note}
          </p>
        )}

        {(p.assumptions?.length ?? 0) > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-brand-ink">
              Assumptions ({p.assumptions!.length})
            </summary>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {p.assumptions!.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
function ProjRow({ label, a, b, isRate }: { label: string; a: number; b: number; isRate?: boolean }) {
  return (
    <>
      <div className="text-muted-foreground">{label}</div>
      <div className="text-right tabular-nums">{isRate ? pct(a) : usd(a)}</div>
      <div className="text-right font-medium tabular-nums">{isRate ? pct(b) : usd(b)}</div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Card 2 — MFJ vs MFS optimizer
// ════════════════════════════════════════════════════════════════════════════
function MfjVsMfsCard({ clientId }: { clientId: number }) {
  const { data, isLoading, error } = useGetMfjVsMfs(clientId, {
    query: { queryKey: getGetMfjVsMfsQueryKey(clientId), staleTime: ANALYSIS_STALE_MS },
  });
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error || !data) return null;
  const m = data as unknown as MfsResp;

  if (!m.applicable) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4 text-xs text-muted-foreground">
          MFJ-vs-MFS optimization applies to Married-Filing-Jointly clients. {m.reason}
        </CardContent>
      </Card>
    );
  }
  const recMfs = m.recommendation === "mfs";
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Filing status: MFJ vs MFS</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={`rounded-lg p-3 text-sm font-medium ${recMfs ? "bg-success/10 text-success" : "bg-muted/40 text-foreground"}`}>
          {recMfs
            ? `Filing separately saves ${usd(m.savings)} — recommend MFS.`
            : `Filing jointly is optimal${(m.savings ?? 0) > 0.5 ? ` (MFS would cost ${usd(m.savings)} more)` : " (MFS is no better)"}.`}
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="text-muted-foreground">Net tax after credits</div>
          <div className={`text-right font-medium ${!recMfs ? "text-success" : ""}`}>MFJ {usd(m.mfj!.netTaxAfterCredits)}</div>
          <div className={`text-right font-medium ${recMfs ? "text-success" : ""}`}>MFS {usd(m.mfs!.combinedNetTaxAfterCredits)}</div>
          <div className="pl-3 text-xs text-muted-foreground">— taxpayer</div>
          <div className="text-right text-xs text-muted-foreground tabular-nums">{usd(m.mfs!.taxpayer.netTaxAfterCredits)}</div>
          <div />
          <div className="pl-3 text-xs text-muted-foreground">— spouse</div>
          <div className="text-right text-xs text-muted-foreground tabular-nums">{usd(m.mfs!.spouse.netTaxAfterCredits)}</div>
          <div />
        </div>
        {m.assumptions && (
          <ul className="space-y-1 border-t pt-2 text-[11px] text-muted-foreground">
            {m.assumptions.notes.map((n, i) => (
              <li key={i}>• {n}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Card 3 — Year-over-year + threshold alerts
// ════════════════════════════════════════════════════════════════════════════
function YearOverYearCard({ clientId }: { clientId: number }) {
  const { data, isLoading, error } = useGetYearOverYear(clientId, undefined, {
    query: { queryKey: getGetYearOverYearQueryKey(clientId), staleTime: ANALYSIS_STALE_MS },
  });
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error || !data) return null;
  const y = data as unknown as YoyResp;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Year-over-year
          <span className="ml-2 text-xs font-normal text-muted-foreground">TY{y.priorYear} → TY{y.currentYear}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!y.priorYearHasData && (
          <p className="rounded bg-muted/30 p-2 text-[11px] text-muted-foreground">
            No income data is persisted for TY{y.priorYear}; this compares the current data at prior-year tax rules
            (a law-change view). Add TY{y.priorYear} W-2/1099 data for a true year-over-year comparison.
          </p>
        )}

        {y.thresholdCrossings.length > 0 && (
          <div className="space-y-2">
            {y.thresholdCrossings.map((c) => (
              <div
                key={c.id}
                className={`rounded-lg border-l-4 p-2 text-xs ${c.direction === "entered" ? "border-l-destructive bg-destructive/5" : "border-l-success bg-success/5"}`}
              >
                <span className="font-semibold">{c.direction === "entered" ? "⚠ Entered" : "✓ Exited"}: {c.label}</span>
                <p className="mt-0.5 text-muted-foreground">{c.detail}</p>
              </div>
            ))}
          </div>
        )}

        {y.notableSwings.length > 0 && (
          <div className="grid grid-cols-4 gap-2 text-sm">
            <div className="col-span-2 font-medium text-muted-foreground">Notable swing</div>
            <div className="text-right font-medium text-muted-foreground">Change</div>
            <div className="text-right font-medium text-muted-foreground">%</div>
            {y.notableSwings.map((d) => {
              const isRate = d.label === "Effective tax rate";
              const taxLike = /tax|owed/i.test(d.label) && !/refund/i.test(d.label);
              return (
                <YoySwingRow key={d.label} d={d} isRate={isRate} taxLike={taxLike} />
              );
            })}
          </div>
        )}

        {y.obbbaImpact.newBenefit > 0 && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-brand-ink">OBBBA:</span> {y.obbbaImpact.note}
          </p>
        )}
        {y.thresholdCrossings.length === 0 && y.notableSwings.length === 0 && (
          <p className="text-xs text-muted-foreground">No material year-over-year swings or threshold crossings.</p>
        )}
      </CardContent>
    </Card>
  );
}
function YoySwingRow({ d, isRate, taxLike }: { d: LineDelta; isRate: boolean; taxLike: boolean }) {
  // Tax/owed up = bad (red); income/refund up = good (green).
  const cls = taxLike ? deltaClass(d.change, false) : deltaClass(d.change, true);
  return (
    <>
      <div className="col-span-2">{d.label}</div>
      <div className={`text-right tabular-nums ${cls}`}>
        {d.change > 0 ? "+" : ""}
        {isRate ? `${(d.change * 100).toFixed(1)} pt` : usd2(d.change)}
      </div>
      <div className="text-right tabular-nums text-muted-foreground">{d.pctChange == null ? "—" : `${d.pctChange > 0 ? "+" : ""}${(d.pctChange * 100).toFixed(0)}%`}</div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Card 4 — Entity choice (sole prop vs S-corp reasonable-comp split)
// ════════════════════════════════════════════════════════════════════════════
interface EntityOption {
  reasonableComp: number;
  sCorpOrdinaryIncome: number;
  employerFica: number;
  futa: number;
  employeeFica: number;
  engineNetTaxAfterCredits: number;
  totalCost: number;
  savingsVsSoleProp: number;
  scenario: { qbiDeduction: number };
}
interface EntityChoiceResp {
  applicable: boolean;
  reason?: string;
  businessProfit: number;
  soleProp: { netTaxAfterCredits: number; selfEmploymentTax: number; qbiDeduction: number };
  options: EntityOption[];
  bestOption: EntityOption | null;
  assumptions: string[];
}
function EntityChoiceCard({ clientId }: { clientId: number }) {
  const { data, isLoading, error } = useGetEntityChoice(clientId, undefined, {
    query: { queryKey: getGetEntityChoiceQueryKey(clientId), staleTime: ANALYSIS_STALE_MS },
  });
  const [showAssumptions, setShowAssumptions] = useState(false);
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error || !data) return null;
  const e = data as unknown as EntityChoiceResp;
  if (!e.applicable) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4 text-xs text-muted-foreground">
          Entity choice (S-corp election): {e.reason ?? "no modelable Schedule C business."}
        </CardContent>
      </Card>
    );
  }
  const best = e.bestOption;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Entity choice: sole prop vs S-corp
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            Schedule C profit {usd(e.businessProfit)} · sole-prop net tax {usd(e.soleProp.netTaxAfterCredits)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {best && best.savingsVsSoleProp > 0.5 ? (
          <div className="rounded-lg bg-success/10 p-3 text-sm font-medium text-success">
            Best modeled comp level {usd(best.reasonableComp)} saves {usd(best.savingsVsSoleProp)}/yr vs sole prop —
            net the payroll/1120-S admin costs and validate the comp benchmark before electing.
          </div>
        ) : (
          <div className="rounded-lg bg-muted/40 p-3 text-sm font-medium">
            The S-corp election does not beat sole-prop at the modeled comp levels.
          </div>
        )}
        <div className="grid grid-cols-5 gap-2 text-sm">
          <div className="font-medium text-muted-foreground">W-2 comp</div>
          <div className="text-right font-medium text-muted-foreground">K-1 income</div>
          <div className="text-right font-medium text-muted-foreground">Payroll taxes</div>
          <div className="text-right font-medium text-muted-foreground">Total cost</div>
          <div className="text-right font-medium text-muted-foreground">Savings</div>
          {e.options.map((o) => (
            <EntityOptionRow key={o.reasonableComp} o={o} isBest={o.reasonableComp === best?.reasonableComp} />
          ))}
        </div>
        <button
          type="button"
          className="text-[11px] text-brand-ink underline-offset-2 hover:underline"
          onClick={() => setShowAssumptions((v) => !v)}
        >
          {showAssumptions ? "Hide" : "Show"} model assumptions ({e.assumptions.length})
        </button>
        {showAssumptions && (
          <ul className="space-y-1 border-t pt-2 text-[11px] text-muted-foreground">
            {e.assumptions.map((a, i) => (
              <li key={i}>• {a}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
function EntityOptionRow({ o, isBest }: { o: EntityOption; isBest: boolean }) {
  const payroll = o.employerFica + o.employeeFica + o.futa;
  return (
    <>
      <div className={isBest ? "font-semibold" : ""}>{usd(o.reasonableComp)}</div>
      <div className="text-right tabular-nums">{usd(o.sCorpOrdinaryIncome)}</div>
      <div className="text-right tabular-nums">{usd(payroll)}</div>
      <div className={`text-right tabular-nums ${isBest ? "font-semibold" : ""}`}>{usd(o.totalCost)}</div>
      <div className={`text-right tabular-nums ${o.savingsVsSoleProp > 0 ? "text-success" : "text-destructive"}`}>
        {o.savingsVsSoleProp > 0 ? "+" : ""}
        {usd(o.savingsVsSoleProp)}
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Card 5 — Engagement status + filing deadline
// ════════════════════════════════════════════════════════════════════════════
const ENGAGEMENT_LABELS: Record<string, string> = {
  not_started: "Not started",
  awaiting_documents: "Awaiting documents",
  in_preparation: "In preparation",
  in_review: "In review",
  ready_to_file: "Ready to file",
  filed: "Filed",
};
function EngagementCard({ clientId }: { clientId: number }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetTaxReturn(clientId, {
    query: { queryKey: getGetTaxReturnQueryKey(clientId) },
  });
  const update = useUpdateEngagement();
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!data) return null;
  const ret = data as unknown as {
    taxYear: number;
    engagementStatus?: string;
    extensionFiled?: boolean;
    effectiveDeadline?: string;
  };
  const status = ret.engagementStatus ?? "not_started";
  const extended = ret.extensionFiled ?? false;
  const patch = async (body: UpdateEngagementBody) => {
    try {
      await update.mutateAsync({ clientId, data: body });
      await queryClient.invalidateQueries({ queryKey: getGetTaxReturnQueryKey(clientId) });
    } catch {
      // Leave the server value; the next refetch shows the truth.
    }
  };
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Engagement
          <span className="ml-2 text-xs font-normal text-muted-foreground">TY{ret.taxYear}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <Select
          value={status}
          onValueChange={(v) => {
            // Radix can fire an empty value before items mount — never PATCH it.
            if (!v || !(v in ENGAGEMENT_LABELS)) return;
            void patch({ engagementStatus: v as UpdateEngagementBody["engagementStatus"] });
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ENGAGEMENT_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={extended} onCheckedChange={(c) => void patch({ extensionFiled: c === true })} />
          Extension filed (Form 4868)
        </label>
        <span className="text-xs text-muted-foreground">
          {/* Server-computed §6072(a)/§6081 date (weekend-rolled) — never re-derived in JSX. */}
          Deadline:{" "}
          <span className="font-medium text-foreground">
            {ret.effectiveDeadline ?? `${ret.taxYear + 1}-${extended ? "10" : "04"}-15`}
          </span>
          {extended ? " (extended)" : ""}
        </span>
        {update.isPending && <span className="text-xs text-muted-foreground">Saving…</span>}
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Card 6 — Client organizer (document-request checklist)
// ════════════════════════════════════════════════════════════════════════════
interface OrganizerItemResp { id: string; category: string; title: string; detail: string; status: string }
interface OrganizerResp {
  taxYear: number;
  priorYear: number;
  items: OrganizerItemResp[];
  counts: { missing: number; received: number; questions: number };
}
function OrganizerCard({ clientId }: { clientId: number }) {
  const { data, isLoading, error } = useGetClientOrganizer(clientId, undefined, {
    query: { queryKey: getGetClientOrganizerQueryKey(clientId) },
  });
  const [expanded, setExpanded] = useState(false);
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (error || !data) return null;
  const o = data as unknown as OrganizerResp;
  const visible = expanded ? o.items : o.items.filter((i) => i.status === "missing").slice(0, 6);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span>
            Client organizer
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              TY{o.taxYear} · {o.counts.missing} outstanding · {o.counts.received} received
            </span>
          </span>
          <Button
            variant="outline"
            size="sm"
            title="Branded printable checklist personalized from last year's documents"
            onClick={() => downloadFile(`/api/clients/${clientId}/organizer/pdf?taxYear=${o.taxYear}`)}
          >
            Organizer (PDF)
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {visible.map((i) => (
          <div key={i.id} className="flex items-start gap-2 text-sm">
            <span className={i.status === "received" ? "text-success" : i.status === "question" ? "text-brand-ink" : "text-muted-foreground"}>
              {i.status === "received" ? "✓" : i.status === "question" ? "?" : "☐"}
            </span>
            <span className={i.status === "received" ? "text-muted-foreground line-through" : ""}>{i.title}</span>
          </div>
        ))}
        <button
          type="button"
          className="pt-1 text-[11px] text-brand-ink underline-offset-2 hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show outstanding only" : `Show all ${o.items.length} items (incl. questionnaire)`}
        </button>
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Card 7 — Prior-year roll-forward (proforma)
// ════════════════════════════════════════════════════════════════════════════
interface RollForwardResp {
  fromYear: number;
  toYear: number;
  copied: Record<string, number>;
  carryforwardsSeeded: Array<{ type: string; amount: number }>;
}
function RollForwardCard({ clientId }: { clientId: number }) {
  const queryClient = useQueryClient();
  const roll = useRollForwardClient();
  const [result, setResult] = useState<RollForwardResp | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const onRoll = async () => {
    setErrorMsg(null);
    try {
      const r = await roll.mutateAsync({ clientId, data: {} });
      setResult(r as unknown as RollForwardResp);
      // Everything about THIS CLIENT changed year (every per-client query key
      // starts with /api/clients/:id) + the firm-wide views that aggregate it.
      // A blanket invalidateQueries() would refetch every heavy firm-wide
      // query in the cache for no reason. The boundary check matters: a bare
      // startsWith would make client 1 match /api/clients/10/… too.
      const prefix = `/api/clients/${clientId}`;
      await queryClient.invalidateQueries({
        predicate: (q) => {
          const key = q.queryKey[0];
          if (typeof key === "string" && (key === prefix || key.startsWith(`${prefix}/`) || key.startsWith(`${prefix}?`))) {
            return true;
          }
          // Hand-written TUPLE keys carry clientId as a later element, e.g.
          // ["capital-transactions", clientId] / ["schedule-c-assets", clientId] /
          // ["schedule-k1", clientId] / ["asset-balances", clientId] — the string
          // prefix above misses them, so those sub-tabs showed STALE data after a
          // roll-forward (audit 2026-06-24 R2-F4). An extra refetch is harmless.
          return q.queryKey.includes(clientId);
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/engagements"], exact: false });
    } catch (e) {
      const detail = (e as { response?: { data?: { error?: string } }; message?: string });
      setErrorMsg(detail.response?.data?.error ?? detail.message ?? "Roll-forward failed");
    }
  };
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Prior-year roll-forward (proforma)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Copies last year's W-2 employers, 1099 payers, K-1 entities (basis rolled), rentals, and account
          balances into the next tax year as estimates, advances the client's year, and auto-seeds every
          engine carryforward. Capital transactions and disposed rentals never roll.
        </p>
        <Button size="sm" onClick={() => void onRoll()} disabled={roll.isPending}>
          {roll.isPending ? "Rolling…" : "Roll forward to next year"}
        </Button>
        {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
        {result && (
          <div className="rounded-lg border bg-muted/30 p-3 text-xs">
            <p className="font-medium text-success">
              Rolled TY{result.fromYear} → TY{result.toYear}.
            </p>
            <p className="mt-1 text-muted-foreground">
              Copied: {Object.entries(result.copied)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => `${n} ${k}`)
                .join(", ") || "no input rows"}
              .
            </p>
            {result.carryforwardsSeeded.length > 0 && (
              <p className="mt-1 text-muted-foreground">
                Carryforwards auto-seeded: {result.carryforwardsSeeded.map((c) => `${c.type} ${usd(c.amount)}`).join("; ")}.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Card 0 — Notifications (T5 G-10): currently-due deadlines / vouchers / docs
// ════════════════════════════════════════════════════════════════════════════
interface NotifEvent {
  kind: "filing_deadline" | "extension_deadline" | "estimate_voucher" | "doc_request";
  dedupeKey: string;
  title: string;
  body: string;
  dueDate: string | null;
  daysUntil: number | null;
  urgency: "overdue" | "urgent" | "upcoming" | "scheduled";
  amount: number | null;
}
interface NotificationsResp { clientId: number; taxYear: number; asOfDate: string; events: NotifEvent[] }

const URGENCY_PILL: Record<NotifEvent["urgency"], { cls: string; label: string }> = {
  overdue: { cls: "bg-destructive/10 text-destructive", label: "Overdue" },
  urgent: { cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400", label: "Urgent" },
  upcoming: { cls: "bg-brand/10 text-brand-ink", label: "Upcoming" },
  scheduled: { cls: "bg-secondary text-muted-foreground", label: "Scheduled" },
};

function timing(e: NotifEvent): string {
  if (e.daysUntil == null) return "no due date";
  if (e.daysUntil < 0) return `${Math.abs(e.daysUntil)} day${e.daysUntil === -1 ? "" : "s"} overdue`;
  if (e.daysUntil === 0) return "due today";
  return `in ${e.daysUntil} day${e.daysUntil === 1 ? "" : "s"}`;
}

function NotificationsCard({ clientId }: { clientId: number }) {
  const { data, isLoading, error } = useGetNotificationEvents(clientId, {
    query: { queryKey: getGetNotificationEventsQueryKey(clientId), staleTime: ANALYSIS_STALE_MS },
  });
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (error || !data) return null;
  const n = data as unknown as NotificationsResp;
  const events = n.events ?? [];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span>
            Notifications
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {events.length === 0 ? "nothing due" : `${events.length} due · as of ${n.asOfDate}`}
            </span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {events.length === 0 ? (
          <div className="text-sm text-muted-foreground">All caught up — no deadlines, vouchers, or document requests are due.</div>
        ) : (
          events.map((e) => {
            const pill = URGENCY_PILL[e.urgency];
            return (
              <div key={e.dedupeKey} className="flex items-start justify-between gap-3 rounded-lg border border-border p-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${pill.cls}`}>{pill.label}</span>
                    <span className="truncate text-sm font-medium">{e.title}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{e.body}</div>
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground">{timing(e)}</div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

export function CpaToolsTab({ clientId }: { clientId: number }) {
  return (
    <div className="space-y-4">
      <NotificationsCard clientId={clientId} />
      <EngagementCard clientId={clientId} />
      <ProjectionCard clientId={clientId} />
      <MfjVsMfsCard clientId={clientId} />
      <EntityChoiceCard clientId={clientId} />
      <YearOverYearCard clientId={clientId} />
      <OrganizerCard clientId={clientId} />
      <RollForwardCard clientId={clientId} />
    </div>
  );
}
