/**
 * T2.2 — CPA Tools tab: tax projection + 1040-ES, MFJ-vs-MFS optimizer, and
 * year-over-year + threshold alerts. Reads the T2.2 planning endpoints via the
 * generated React Query hooks; types the (permissively-schema'd) responses
 * locally against the api-server lib shapes.
 */
import {
  useGetTaxProjection,
  getGetTaxProjectionQueryKey,
  useGetMfjVsMfs,
  getGetMfjVsMfsQueryKey,
  useGetYearOverYear,
  getGetYearOverYearQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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
    query: { queryKey: getGetTaxProjectionQueryKey(clientId) },
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
    query: { queryKey: getGetMfjVsMfsQueryKey(clientId) },
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
    query: { queryKey: getGetYearOverYearQueryKey(clientId) },
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

export function CpaToolsTab({ clientId }: { clientId: number }) {
  return (
    <div className="space-y-4">
      <ProjectionCard clientId={clientId} />
      <MfjVsMfsCard clientId={clientId} />
      <YearOverYearCard clientId={clientId} />
    </div>
  );
}
