/**
 * T1.3 — Multi-year global optimizer (bracket-filling).
 *
 * The classic multi-year planning move: realize income (Roth conversions, gain
 * harvesting) up to the TOP of a target bracket each year, so deferred income is
 * recognized at a controlled rate instead of bunching into a high bracket later
 * (e.g. when RMDs hit at 73). This computes the amount to convert/realize each
 * year to fill the target bracket, the running balance, and the incremental tax.
 *
 * Complements rothOptimizer (which models the lifetime RMD/IRMAA VALUE of a Roth
 * ladder); this answers the sizing question "how much, each year, to the bracket
 * top." PURE — no Date/random/DB.
 */
import { computeTaxReturnPure, type TaxReturnInputs } from "./taxReturnEngine";
import { calculateFederalTax, federalBracketCeiling } from "./taxCalculator";

export interface BracketFillOptions {
  horizonYears: number;
  /** Fill to the top of the bracket at this marginal rate (e.g. 0.22, 0.24). */
  targetMarginalRate: number;
  /** Traditional-IRA / deferred balance available to convert. */
  traditionalIraBalance: number;
  /** Annual growth of the baseline ordinary income (default 1.03). */
  incomeGrowth?: number;
  /** Annual growth of the remaining deferred balance (default 1.05). */
  iraGrowth?: number;
}

export interface BracketFillYear {
  year: number;
  baselineTaxable: number;
  bracketCeiling: number;
  /** Amount to convert/realize this year to fill the target bracket. */
  conversion: number;
  iraRemaining: number;
  /** Federal tax cost of THIS year's conversion (≈ amount × target rate). */
  incrementalTax: number;
}

export interface BracketFillResult {
  targetMarginalRate: number;
  perYear: BracketFillYear[];
  totalConverted: number;
  totalIncrementalTax: number;
  iraRemainingAtHorizon: number;
  /** Blended rate on the total converted (totalIncrementalTax / totalConverted). */
  blendedConversionRate: number;
  assumptions: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
const round2 = (n: number) => Math.round(n * 100) / 100;

export function optimizeBracketFilling(baseline: TaxReturnInputs, opts: BracketFillOptions): BracketFillResult {
  const horizon = Math.round(clamp(opts.horizonYears, 1, 40));
  const incomeGrowth = clamp(opts.incomeGrowth ?? 1.03, 0.5, 2);
  const iraGrowth = clamp(opts.iraGrowth ?? 1.05, 0.5, 2);
  const fs = baseline.client.filingStatus ?? "single";
  const startYear = baseline.taxYear;
  const base0 = computeTaxReturnPure(baseline);

  let baselineTaxable = Math.max(0, base0.taxableIncome);
  let iraRemaining = Math.max(0, opts.traditionalIraBalance);
  const perYear: BracketFillYear[] = [];
  let totalConverted = 0;
  let totalIncrementalTax = 0;

  for (let i = 0; i < horizon; i++) {
    const year = startYear + i;
    const ceiling = federalBracketCeiling(opts.targetMarginalRate, fs, year);
    const room = Math.max(0, ceiling - baselineTaxable);
    const conversion = Math.min(room, iraRemaining);
    const incrementalTax = calculateFederalTax(baselineTaxable + conversion, fs, year) -
      calculateFederalTax(baselineTaxable, fs, year);
    iraRemaining -= conversion;
    totalConverted += conversion;
    totalIncrementalTax += incrementalTax;
    perYear.push({
      year,
      baselineTaxable: round2(baselineTaxable),
      bracketCeiling: ceiling,
      conversion: round2(conversion),
      iraRemaining: round2(iraRemaining),
      incrementalTax: round2(incrementalTax),
    });
    // Grow the baseline + deferred balance into the NEXT year only — not after the
    // final year (the prior code grew once more, reporting a phantom extra year of
    // growth in iraRemainingAtHorizon that disagreed with perYear[last].iraRemaining).
    if (i < horizon - 1) {
      baselineTaxable *= incomeGrowth;
      iraRemaining *= iraGrowth;
    }
  }

  return {
    targetMarginalRate: opts.targetMarginalRate,
    perYear,
    totalConverted: round2(totalConverted),
    totalIncrementalTax: round2(totalIncrementalTax),
    iraRemainingAtHorizon: round2(iraRemaining),
    blendedConversionRate: totalConverted > 0 ? round2(totalIncrementalTax / totalConverted * 10000) / 10000 : 0,
    assumptions: [
      `Fills to the top of the ${(opts.targetMarginalRate * 100).toFixed(0)}% federal bracket each year.`,
      `Baseline ordinary income grows ${((incomeGrowth - 1) * 100).toFixed(1)}%/yr; deferred balance grows ${((iraGrowth - 1) * 100).toFixed(1)}%/yr.`,
      "Federal-only incremental tax (state + IRMAA + NIIT interaction not included in the sizing figure).",
      "Bracket thresholds are held at each future year's published values (latest-year fallback beyond the supported range).",
    ],
  };
}
