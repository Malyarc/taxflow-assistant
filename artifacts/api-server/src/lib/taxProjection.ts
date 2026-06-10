/**
 * T2.2 D1 — Tax projection + quarterly estimated-tax (1040-ES) planner.
 *
 * Turns a one-time return into a recurring relationship: project NEXT year's
 * return from this year's, size the four §6654 safe-harbor estimated-tax
 * vouchers, and surface the year-over-year + OBBBA-law-change deltas.
 *
 * PURE (no Date/random/DB) — Haven-portable. Reuses the proven primitives:
 *   - `projectYearForward` (multiYearEngine) to grow income + advance the year
 *   - `computeTaxReturnPure` to compute the projected return
 *   - `computeForm2210` (§6654) for the required-annual-payment safe harbor
 *
 * The 1040-ES safe harbor (IRC §6654(d)): the smaller of
 *   (a) 90% of the PROJECTED year's tax, or
 *   (b) 100% of the CURRENT (baseline) year's tax — 110% when the baseline AGI
 *       exceeds $150,000 ($75,000 MFS).
 * The amount to cover via estimates = that target minus the projected year's
 * expected withholding, split across the four installments.
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
  type ComputedTaxReturn,
} from "./taxReturnEngine";
import { projectYearForward } from "./multiYearEngine";
import { computeForm2210 } from "./form2210";

export interface QuarterlyVoucher {
  /** 1–4. */
  quarter: number;
  /** Statutory installment due date (ISO yyyy-mm-dd), derived from the year. */
  dueDate: string;
  /** Even quarter of the amount to cover via estimates (rounded to the dollar). */
  amount: number;
}

export interface ProjectionYearSummary {
  taxYear: number;
  totalIncome: number;
  adjustedGrossIncome: number;
  taxableIncome: number;
  /** Total federal tax (pre-credit liability, engine convention). */
  federalTaxLiability: number;
  federalTaxWithheld: number;
  federalRefundOrOwed: number;
  stateTaxLiability: number;
  effectiveTaxRate: number;
  /** §6654 current-year tax (total tax net of refundable credits). */
  section6654Tax: number;
  /** OBBBA Schedule 1-A total deduction in this year (tips/overtime/car-loan/senior). */
  obbbaSchedule1A: number;
}

export interface YoyDelta {
  totalIncome: number;
  adjustedGrossIncome: number;
  taxableIncome: number;
  federalTaxLiability: number;
  stateTaxLiability: number;
  combinedTax: number;
  effectiveTaxRate: number;
}

export interface TaxProjectionResult {
  baseline: ProjectionYearSummary;
  projected: ProjectionYearSummary;
  /** projected − baseline (positive = went up). */
  yoyDelta: YoyDelta;
  incomeGrowth: number;
  estimatedTax: {
    /** §6654 required annual payment for the projected year (the safe-harbor target). */
    requiredAnnualPayment: number;
    /** Which harbor bound: "90%_current" (of projected) or "prior_year". */
    safeHarborBasis: "90%_current" | "prior_year";
    /** The prior-year multiplier applied (1.0 or 1.1). */
    priorYearSafeHarborPct: number;
    /** Expected projected-year withholding credited against the target. */
    projectedWithholding: number;
    /** Total to cover via the four vouchers (target − withholding, floored at 0). */
    totalEstimatedPayments: number;
    vouchers: QuarterlyVoucher[];
    /** TRUE when projected withholding alone already meets the safe harbor. */
    withholdingCoversSafeHarbor: boolean;
  };
  /** The projected-year OBBBA Schedule 1-A benefit (informational law-change line). */
  obbbaImpact: {
    deductionTotal: number;
    /** Approx tax benefit = deduction × projected marginal-ish effective ordinary rate. */
    note: string;
  };
}

/** 1040-ES statutory installment due dates for `taxYear` (ISO yyyy-mm-dd). */
function voucherDueDates(taxYear: number): string[] {
  return [
    `${taxYear}-04-15`,
    `${taxYear}-06-15`,
    `${taxYear}-09-15`,
    `${taxYear + 1}-01-15`,
  ];
}

function summarize(ret: ComputedTaxReturn, section6654Tax: number): ProjectionYearSummary {
  return {
    taxYear: ret.taxYear,
    totalIncome: ret.totalIncome,
    adjustedGrossIncome: ret.adjustedGrossIncome,
    taxableIncome: ret.taxableIncome,
    federalTaxLiability: ret.federalTaxLiability,
    federalTaxWithheld: ret.federalTaxWithheld,
    federalRefundOrOwed: ret.federalRefundOrOwed,
    stateTaxLiability: ret.stateTaxLiability,
    effectiveTaxRate: ret.effectiveTaxRate,
    section6654Tax,
    obbbaSchedule1A: ret.obbbaSchedule1A.total,
  };
}

export interface ComputeTaxProjectionArgs {
  /** Current-year inputs (the baseline). */
  baselineInputs: TaxReturnInputs;
  /** Current-year computed return (avoids a redundant recompute). */
  baselineReturn: ComputedTaxReturn;
  /** Annual income growth factor (default 1.03 = 3%). */
  incomeGrowth?: number;
}

export function computeTaxProjection(args: ComputeTaxProjectionArgs): TaxProjectionResult {
  const growth = args.incomeGrowth ?? 1.03;
  const baselineRet = args.baselineReturn;

  // Project one year forward and compute the projected return.
  const projectedInputs = projectYearForward(args.baselineInputs, 1, { incomeGrowth: growth });
  const projectedRet = computeTaxReturnPure(projectedInputs);

  // §6654 tax for each year (total tax net of refundable credits).
  const baseline2210 = computeForm2210({ ret: baselineRet });
  const baselineSection6654Tax = baseline2210.currentYearTax;

  // The projected year's safe harbor: 90% of projected vs prior-year-pct of the
  // BASELINE year's §6654 tax. Pass the baseline as the "prior year".
  const mfs = baselineRet.filingStatus === "married_filing_separately";
  const priorAgiThreshold = mfs ? 75_000 : 150_000;
  const projected2210 = computeForm2210({
    ret: projectedRet,
    input: {
      priorYearTax: baselineSection6654Tax,
      priorYearAgi: baselineRet.adjustedGrossIncome,
      priorYearAvailable: true,
    },
  });

  const target = projected2210.requiredAnnualPayment;
  const projectedWithholding = projectedRet.federalTaxWithheld;
  const toCover = Math.max(0, target - projectedWithholding);
  const perQuarter = Math.round(toCover / 4);
  const dueDates = voucherDueDates(projectedRet.taxYear);
  const vouchers: QuarterlyVoucher[] = dueDates.map((dueDate, i) => ({
    quarter: i + 1,
    dueDate,
    amount: perQuarter,
  }));

  // Which bound set the target? requiredAnnualPayment = min(90%-of-projected,
  // prior-year-pct × baseline tax). When there is no usable prior-year tax the
  // only available harbor is 90%-of-current.
  const ninetyCurrent = projected2210.ninetyPercentCurrent;
  const safeHarborBasis: "90%_current" | "prior_year" =
    projected2210.priorYearSafeHarbor == null || ninetyCurrent <= projected2210.priorYearSafeHarbor
      ? "90%_current"
      : "prior_year";

  const yoyDelta: YoyDelta = {
    totalIncome: projectedRet.totalIncome - baselineRet.totalIncome,
    adjustedGrossIncome: projectedRet.adjustedGrossIncome - baselineRet.adjustedGrossIncome,
    taxableIncome: projectedRet.taxableIncome - baselineRet.taxableIncome,
    federalTaxLiability: projectedRet.federalTaxLiability - baselineRet.federalTaxLiability,
    stateTaxLiability: projectedRet.stateTaxLiability - baselineRet.stateTaxLiability,
    combinedTax:
      projectedRet.federalTaxLiability + projectedRet.stateTaxLiability -
      (baselineRet.federalTaxLiability + baselineRet.stateTaxLiability),
    effectiveTaxRate: projectedRet.effectiveTaxRate - baselineRet.effectiveTaxRate,
  };

  return {
    baseline: summarize(baselineRet, baselineSection6654Tax),
    projected: summarize(projectedRet, projected2210.currentYearTax),
    yoyDelta,
    incomeGrowth: growth,
    estimatedTax: {
      requiredAnnualPayment: target,
      safeHarborBasis,
      priorYearSafeHarborPct: projected2210.priorYearSafeHarborPct,
      projectedWithholding,
      totalEstimatedPayments: toCover,
      vouchers,
      withholdingCoversSafeHarbor: toCover <= 0.005,
    },
    obbbaImpact: {
      deductionTotal: projectedRet.obbbaSchedule1A.total,
      note:
        projectedRet.obbbaSchedule1A.total > 0
          ? "OBBBA Schedule 1-A (tips/overtime/car-loan/senior) reduces projected taxable income; benefit ≈ deduction × the ordinary marginal rate. Sunsets after TY2028."
          : "No OBBBA Schedule 1-A deductions projected for this client.",
    },
  };
}
