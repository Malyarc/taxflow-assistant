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
import { projectYearForward, captureCarryforwards, applyCarryforwards } from "./multiYearEngine";
import { computeForm2210 } from "./form2210";
import { rollToBusinessDay } from "./engagement";

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
  /**
   * TP-4 — the projection's modeling assumptions, disclosed on the deliverable
   * (withholding growth, carryforward chaining, law-year clamping, §7503 roll).
   */
  assumptions: string[];
}

/**
 * TP-3 — 1040-ES installment due dates for `taxYear` with the §7503 roll
 * (ISO yyyy-mm-dd). Statutory dates are 4/15, 6/15, 9/15, 1/15; when one
 * lands on Saturday/Sunday it rolls to the next business day (shared
 * `rollToBusinessDay` from engagement.ts — e.g. Sun 2025-06-15 → Mon
 * 2025-06-16). The JANUARY voucher additionally collides with the MLK
 * federal holiday (3rd Monday of January) in a fully deterministic way:
 *  - Jan 15 = Sat → weekend roll lands Mon Jan 17 = the 3rd Monday (MLK) → Tue Jan 18
 *  - Jan 15 = Sun → weekend roll lands Mon Jan 16 = the 3rd Monday (MLK) → Tue Jan 17
 *  - Jan 15 = Mon → Jan 15 IS the 3rd Monday (MLK) → Tue Jan 16
 * (When Jan 15 falls Mon/Sat/Sun, the Monday in question is always the 3rd —
 * Mondays that month are the 1st/8th/15th, 3rd/10th/17th, or 2nd/9th/16th.)
 * Other federal holidays (e.g. DC Emancipation Day for the April voucher) are
 * NOT modeled — same documented conservatism as engagement.ts (the computed
 * date is never LATER than the true §7503 deadline).
 */
export function voucherDueDates(taxYear: number): string[] {
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const roll = (y: number, monthIdx0: number, day: number) =>
    rollToBusinessDay(Date.UTC(y, monthIdx0, day));
  // Q4 (Jan 15 of the FOLLOWING year): weekend roll, then the deterministic
  // MLK collision — if Jan 15 was a Sat/Sun/Mon, the rolled-to (or original)
  // Monday is the 3rd Monday of January (Birthday of Martin Luther King, Jr.,
  // a §7503 legal holiday) → +1 day to Tuesday.
  const jan15 = Date.UTC(taxYear + 1, 0, 15);
  const jan15Dow = new Date(jan15).getUTCDay();
  let q4 = rollToBusinessDay(jan15);
  if (jan15Dow === 6 || jan15Dow === 0 || jan15Dow === 1) q4 += 86_400_000;
  return [
    iso(roll(taxYear, 3, 15)),
    iso(roll(taxYear, 5, 15)),
    iso(roll(taxYear, 8, 15)),
    iso(q4),
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
  // TP-1 — thread the BASELINE year's REMAINING carryforwards into the
  // projected year (captureCarryforwards/applyCarryforwards, the proven
  // multiYearEngine pair): an NOL / capital-loss / charitable / §163(j) /
  // AMT-credit / AMT-NOL / Sched-E-PAL balance consumed in the baseline year
  // must not re-deduct at its opening value in the projection (repro: a fully
  // consumed $150k NOL understated the projected tax by $52,190 and undersized
  // every §6654 voucher).
  const projectedInputs = applyCarryforwards(
    projectYearForward(args.baselineInputs, 1, { incomeGrowth: growth }),
    captureCarryforwards(baselineRet),
  );
  const projectedRet = computeTaxReturnPure(projectedInputs);
  // The projected CALENDAR year. For a baseline at the newest supported year
  // the engine computes the projection under clamped latest-year LAW
  // (resolveTaxYear) and reports that clamped year — the calendar/voucher
  // year stays the true next year (disclosed in `assumptions`).
  const projectedCalendarYear = projectedInputs.taxYear;

  // §6654 tax for each year (total tax net of refundable credits).
  const baseline2210 = computeForm2210({ ret: baselineRet });
  const baselineSection6654Tax = baseline2210.currentYearTax;

  // The projected year's safe harbor: 90% of projected vs prior-year-pct of the
  // BASELINE year's §6654 tax. Pass the baseline as the "prior year".
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
  const dueDates = voucherDueDates(projectedCalendarYear);
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

  // TP-4 — disclose the projection's modeling assumptions on the deliverable.
  const mfs = baselineRet.filingStatus === "married_filing_separately";
  const priorAgiThreshold = mfs ? 75_000 : 150_000;
  const assumptions: string[] = [
    `Income, withholding, and most dollar amounts grown at ×${growth.toFixed(2)} from the TY${baselineRet.taxYear} baseline — withholding is NOT held level; if the client expects level withholding, the vouchers understate the gap by the withholding growth.`,
    "Carryforwards are CHAINED from the baseline year's engine outputs: NOL, capital-loss (short/long), charitable cash, §163(j), AMT credit, AMT NOL, and Schedule-E passive-loss balances enter the projected year at their REMAINING (post-baseline-consumption) values, not their opening values.",
    "Credit-type carryforwards without an engine remaining-balance output (FTC, §179, §163(d), adoption, R&D, GBC) are held at their baseline dollar amounts (never grown with income).",
    `§6654 safe harbor = min(90% of the projected year's tax, ${Math.round(projected2210.priorYearSafeHarborPct * 100)}% of the TY${baselineRet.taxYear} tax) — the prior-year multiplier is 110% when baseline AGI exceeds $${priorAgiThreshold.toLocaleString("en-US")} (${mfs ? "MFS" : "non-MFS"} threshold).`,
    "Voucher due dates apply the §7503 weekend roll plus the deterministic Birthday-of-MLK collision for the January installment; other federal/DC holidays (e.g. Emancipation Day) are not modeled — a computed date is never later than the true deadline.",
  ];
  if (projectedCalendarYear !== projectedRet.taxYear) {
    assumptions.push(
      `TY${projectedCalendarYear} is beyond the engine's newest supported tax year — the projected return is computed under TY${projectedRet.taxYear} law (current-law projection; brackets/limits for TY${projectedCalendarYear} are not yet enacted/published).`,
    );
  } else {
    assumptions.push(
      `Projected TY${projectedCalendarYear} computed under TY${projectedRet.taxYear} law as enacted today (current-law projection).`,
    );
  }

  return {
    baseline: summarize(baselineRet, baselineSection6654Tax),
    // Report the projected CALENDAR year (the law-year clamp, when it differs,
    // is disclosed in `assumptions`).
    projected: { ...summarize(projectedRet, projected2210.currentYearTax), taxYear: projectedCalendarYear },
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
    assumptions,
  };
}
