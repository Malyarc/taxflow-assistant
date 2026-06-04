import { computeTaxReturnPure, type TaxReturnInputs } from "./taxReturnEngine";
import { projectYearForward } from "./multiYearEngine";
import { applyWhatIfMutations } from "./whatIfEngine";
import { calculateFederalTaxWithBreakdown } from "./taxCalculator";

// PLAN-B1 — multi-year Roth-conversion bracket-fill optimizer (v1 core).
//
// The canonical advisory move: in lower-income years (early retirement, a gap
// year), convert just enough traditional-IRA money to fill the TOP of the
// current federal ordinary bracket — locking in tax at today's low rate so the
// balance grows tax-free instead of being taxed at a higher rate later (RMDs).
//
// This v1 computes the recommended conversion ladder over a horizon: each year
// it fills the current bracket (capped by the remaining IRA balance) and uses
// the ENGINE to compute the exact current-year federal tax cost of that
// conversion — no heuristic. The long-term-value model (RMD avoidance, IRMAA
// surcharges, Social-Security taxability interaction) is the next increment;
// see `assumptions`.
//
// PURE — no DB/framework. Ports 1:1 into Haven's @haven/tax-planning.

export interface RothLadderYear {
  /** 0-based offset from the baseline year. */
  yearIndex: number;
  taxYear: number;
  /** Ordinary taxable income before any conversion this year. */
  taxableIncomeBeforeConversion: number;
  /** Top of the current federal ordinary bracket (the fill target). */
  bracketCeiling: number;
  /** Marginal rate the conversion is taxed at (the current bracket's rate). */
  marginalRate: number;
  /** Recommended conversion: fill the bracket, capped by the IRA balance. */
  conversion: number;
  /** Engine-computed current-year federal tax cost of the conversion. */
  conversionTaxCost: number;
  /** Traditional-IRA balance remaining after this year's conversion. */
  iraBalanceRemaining: number;
}

export interface RothLadderPlan {
  years: RothLadderYear[];
  /** Total converted across the horizon (now growing tax-free in the Roth). */
  totalConverted: number;
  /** Total current-year federal tax paid on the laddered conversions. */
  totalConversionTaxCost: number;
  /** Blended rate paid on the conversions (cost / converted). */
  blendedConversionRate: number;
  startingIraBalance: number;
  horizonYears: number;
  incomeGrowth: number;
  iraGrowth: number;
  assumptions: string[];
}

export function optimizeRothConversionLadder(
  baseline: TaxReturnInputs,
  opts: {
    horizonYears: number;
    traditionalIraBalance: number;
    /** Annual income growth for the projection (1.03 = 3%/yr). */
    incomeGrowth?: number;
    /** Annual growth of the un-converted trad-IRA balance (1.05 default). */
    iraGrowth?: number;
  },
): RothLadderPlan {
  if (opts.horizonYears < 1) throw new Error("horizonYears must be >= 1");
  const incomeGrowth = opts.incomeGrowth ?? 1.03;
  const iraGrowth = opts.iraGrowth ?? 1.05;
  let iraBalance = Math.max(0, opts.traditionalIraBalance);

  const years: RothLadderYear[] = [];
  let totalConverted = 0;
  let totalCost = 0;

  for (let y = 0; y < opts.horizonYears; y++) {
    const projected = projectYearForward(baseline, y, { incomeGrowth });
    const baseReturn = computeTaxReturnPure(projected);
    const taxableBefore = Math.max(0, baseReturn.taxableIncome);

    // Headroom to the TOP of the current federal bracket (canonical bracket-fill;
    // the 37% top bracket has an Infinite ceiling → headroom 0, by design).
    const { breakdown } = calculateFederalTaxWithBreakdown(
      taxableBefore,
      baseline.client.filingStatus,
      projected.taxYear,
    );
    const currentBracket = breakdown.length > 0 ? breakdown[breakdown.length - 1] : undefined;
    const bracketMax =
      currentBracket && Number.isFinite(currentBracket.bracketMax) ? currentBracket.bracketMax : taxableBefore;
    const marginalRate = currentBracket ? currentBracket.rate : 0;
    const headroom = Math.max(0, bracketMax - taxableBefore);
    const conversion = Math.min(headroom, iraBalance);

    let conversionTaxCost = 0;
    if (conversion > 0) {
      const withConversion = applyWhatIfMutations(projected, [
        { kind: "add_adjustment", adjustmentType: "additional_income", amount: Math.round(conversion) },
      ]);
      const withReturn = computeTaxReturnPure(withConversion);
      conversionTaxCost = Math.max(0, withReturn.federalTaxLiability - baseReturn.federalTaxLiability);
    }

    iraBalance = Math.max(0, iraBalance - conversion);
    years.push({
      yearIndex: y,
      taxYear: projected.taxYear,
      taxableIncomeBeforeConversion: Math.round(taxableBefore),
      bracketCeiling: Number.isFinite(bracketMax) ? Math.round(bracketMax) : Number.POSITIVE_INFINITY,
      marginalRate,
      conversion: Math.round(conversion),
      conversionTaxCost: Math.round(conversionTaxCost),
      iraBalanceRemaining: Math.round(iraBalance),
    });
    totalConverted += conversion;
    totalCost += conversionTaxCost;
    iraBalance = Math.round(iraBalance * iraGrowth); // grow the remainder for next year
  }

  return {
    years,
    totalConverted: Math.round(totalConverted),
    totalConversionTaxCost: Math.round(totalCost),
    blendedConversionRate: totalConverted > 0 ? totalCost / totalConverted : 0,
    startingIraBalance: Math.round(opts.traditionalIraBalance),
    horizonYears: opts.horizonYears,
    incomeGrowth,
    iraGrowth,
    assumptions: [
      "Fills to the TOP of the current federal ordinary bracket each year (no spill into the next bracket).",
      `Income projected forward at ${Math.round((incomeGrowth - 1) * 100)}%/yr; un-converted trad-IRA grows at ${Math.round((iraGrowth - 1) * 100)}%/yr.`,
      "Conversion modeled as ordinary income; the current-year federal tax cost is engine-computed, not estimated.",
      "v1 core: does NOT yet model RMD avoidance, IRMAA Part-B/D surcharges, or Social-Security taxability interaction (next increment).",
    ],
  };
}
