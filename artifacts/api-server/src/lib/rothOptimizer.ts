import { computeTaxReturnPure, type TaxReturnInputs } from "./taxReturnEngine";
import { projectYearForward, requiredMinimumDistribution, RMD_TRIGGER_AGE } from "./multiYearEngine";
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

/**
 * Lifetime RMD-avoidance value: total federal tax over a long horizon comparing
 * a no-conversion BASELINE (full RMDs at 73+) against the SCENARIO where the
 * ladder's conversions shrink the traditional IRA, lowering future RMDs.
 */
export interface RmdAvoidanceProjection {
  valueHorizonYears: number;
  /** First projected tax year an RMD is required (baseline), or null if none in horizon. */
  firstRmdTaxYear: number | null;
  baselineLifetimeFederalTax: number;
  scenarioLifetimeFederalTax: number;
  /** baseline − scenario federal tax over the horizon. POSITIVE = converting wins. */
  lifetimeFederalTaxSaved: number;
  baselineRmdTotal: number;
  scenarioRmdTotal: number;
  baselineFinalIraBalance: number;
  scenarioFinalIraBalance: number;
  /** Lifetime Medicare IRMAA surcharge (Part B+D) with no conversions. */
  baselineLifetimeIrmaa: number;
  /** Lifetime IRMAA WITH the ladder — conversions raise MAGI → can bump tiers. */
  scenarioLifetimeIrmaa: number;
  /**
   * Net lifetime value = federal tax saved − extra IRMAA the conversions cost.
   * POSITIVE = converting wins (income-tax + Medicare-premium terms combined).
   */
  netLifetimeValue: number;
  /**
   * Tax-free Roth balance at the horizon (the laddered conversions, grown). This
   * is the UPSIDE the tax-only comparison omits — these dollars are never taxed
   * again, unlike the traditional IRA which owes tax on withdrawal.
   */
  scenarioRothBalanceFinal: number;
  assumptions: string[];
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
  /**
   * Lifetime RMD-avoidance value model — only present when client.taxpayerAge
   * is known (otherwise we can't tell when RMDs hit). Null when unavailable.
   */
  rmdAvoidance: RmdAvoidanceProjection | null;
  assumptions: string[];
}

// ── Medicare IRMAA (2025, SSA POMS HI 01101.020) ───────────────────────────
// Annual Part B + Part D income-related surcharge PER PERSON by MAGI tier. The
// single thresholds also cover HoH + MFS-lived-apart; MFJ uses the joint bands.
// IRMAA has a 2-YEAR lookback (a year's surcharge uses MAGI from 2 years prior)
// and applies once on Medicare (age 65+). MAGI ≈ AGI + tax-exempt interest.
const IRMAA_2025_TIERS: ReadonlyArray<{ singleLB: number; mfjLB: number; annual: number }> = [
  { singleLB: 106000, mfjLB: 212000, annual: (74.0 + 13.7) * 12 },   // $1,052.40
  { singleLB: 133000, mfjLB: 266000, annual: (185.0 + 35.3) * 12 },  // $2,643.60
  { singleLB: 167000, mfjLB: 334000, annual: (295.9 + 57.0) * 12 },  // $4,234.80
  { singleLB: 200000, mfjLB: 400000, annual: (406.9 + 78.6) * 12 },  // $5,826.00
  { singleLB: 500000, mfjLB: 750000, annual: (443.9 + 85.8) * 12 },  // $6,356.40
];

/** Annual Medicare IRMAA surcharge (Part B + Part D) for ONE person at a MAGI. */
export function irmaaAnnualSurchargePerPerson(magi: number, filingStatus: string): number {
  const isMfj = filingStatus === "married_filing_jointly" || filingStatus === "qualifying_widow";
  let surcharge = 0;
  for (const t of IRMAA_2025_TIERS) {
    if (magi > (isMfj ? t.mfjLB : t.singleLB)) surcharge = t.annual;
  }
  return surcharge;
}

/**
 * Project the lifetime RMD-avoidance value of a conversion ladder. PURE.
 * Compares total federal tax over `valueHorizonYears` between a BASELINE (no
 * conversions; the full traditional IRA grows and is drained by RMDs at age
 * 73+) and a SCENARIO where `conversionsByYear` shrink the IRA, so later RMDs —
 * and the tax on them — are smaller. Returns null when the client's age is
 * unknown (RMD timing is then unknowable). Testable in isolation with explicit
 * conversions (the optimizer calls it with its computed ladder).
 */
export function projectRmdAvoidance(
  baseline: TaxReturnInputs,
  opts: {
    startingIraBalance: number;
    conversionsByYear: number[];
    valueHorizonYears: number;
    incomeGrowth?: number;
    iraGrowth?: number;
  },
): RmdAvoidanceProjection | null {
  const baseAge = baseline.client.taxpayerAge;
  if (baseAge == null) return null;
  const incomeGrowth = opts.incomeGrowth ?? 1.03;
  const iraGrowth = opts.iraGrowth ?? 1.05;
  const horizon = Math.max(1, Math.floor(opts.valueHorizonYears));

  const addIncome = (inputs: TaxReturnInputs, amt: number): TaxReturnInputs =>
    amt > 0
      ? applyWhatIfMutations(inputs, [
          { kind: "add_adjustment", adjustmentType: "additional_income", amount: Math.round(amt) },
        ])
      : inputs;

  let sIra = Math.max(0, opts.startingIraBalance);
  let bIra = Math.max(0, opts.startingIraBalance);
  let sTax = 0;
  let bTax = 0;
  let sRmdTotal = 0;
  let bRmdTotal = 0;
  let rothBalance = 0; // tax-free Roth: the laddered conversions, grown
  let firstRmdTaxYear: number | null = null;
  const sMagi: number[] = []; // per-year scenario MAGI (≈ AGI) for IRMAA lookback
  const bMagi: number[] = [];

  for (let y = 0; y < horizon; y++) {
    const age = baseAge + y;
    const projected = projectYearForward(baseline, y, { incomeGrowth });
    const conv = y < opts.conversionsByYear.length ? Math.max(0, opts.conversionsByYear[y]) : 0;

    // SCENARIO: conversion + RMD on the conversion-reduced IRA.
    const sRmd = requiredMinimumDistribution(sIra, age);
    const sReturn = computeTaxReturnPure(addIncome(projected, conv + sRmd));
    sTax += sReturn.federalTaxLiability;
    sMagi.push(Math.max(0, sReturn.adjustedGrossIncome));
    sRmdTotal += sRmd;
    sIra = Math.max(0, sIra - conv - sRmd) * iraGrowth;
    // Converted dollars enter the Roth (tax paid from outside funds, the standard
    // ladder assumption) and grow tax-free.
    rothBalance = (rothBalance + conv) * iraGrowth;

    // BASELINE: RMD only, on the full un-converted IRA.
    const bRmd = requiredMinimumDistribution(bIra, age);
    const bReturn = computeTaxReturnPure(addIncome(projected, bRmd));
    bTax += bReturn.federalTaxLiability;
    bMagi.push(Math.max(0, bReturn.adjustedGrossIncome));
    bRmdTotal += bRmd;
    bIra = Math.max(0, bIra - bRmd) * iraGrowth;

    if (firstRmdTaxYear == null && bRmd > 0) firstRmdTaxYear = projected.taxYear;
  }

  // Medicare IRMAA: each year the client is 65+, the surcharge uses MAGI from 2
  // years prior (the IRMAA lookback; for the first two years we fall back to the
  // earliest projected year). MFJ assumes both spouses are on Medicare (×2).
  const fs = baseline.client.filingStatus;
  const numOnMedicare = fs === "married_filing_jointly" || fs === "qualifying_widow" ? 2 : 1;
  let sIrmaa = 0;
  let bIrmaa = 0;
  for (let y = 0; y < horizon; y++) {
    if (baseAge + y < 65) continue;
    if (y >= 2) {
      sIrmaa += irmaaAnnualSurchargePerPerson(sMagi[y - 2], fs) * numOnMedicare;
      bIrmaa += irmaaAnnualSurchargePerPerson(bMagi[y - 2], fs) * numOnMedicare;
    } else {
      // Years 0-1 look back to PRE-projection income (before any conversions), so
      // both trajectories use the baseline year-0 MAGI — the conversions' IRMAA
      // impact correctly appears only 2 years out (y >= 2).
      const preMagi = bMagi[0] ?? 0;
      const surcharge = irmaaAnnualSurchargePerPerson(preMagi, fs) * numOnMedicare;
      sIrmaa += surcharge;
      bIrmaa += surcharge;
    }
  }

  const taxSaved = bTax - sTax;
  const extraIrmaa = sIrmaa - bIrmaa; // conversions raise MAGI → ≥ 0 usually

  return {
    valueHorizonYears: horizon,
    firstRmdTaxYear,
    baselineLifetimeFederalTax: Math.round(bTax),
    scenarioLifetimeFederalTax: Math.round(sTax),
    lifetimeFederalTaxSaved: Math.round(taxSaved),
    baselineRmdTotal: Math.round(bRmdTotal),
    scenarioRmdTotal: Math.round(sRmdTotal),
    baselineFinalIraBalance: Math.round(bIra),
    scenarioFinalIraBalance: Math.round(sIra),
    baselineLifetimeIrmaa: Math.round(bIrmaa),
    scenarioLifetimeIrmaa: Math.round(sIrmaa),
    netLifetimeValue: Math.round(taxSaved - extraIrmaa),
    scenarioRothBalanceFinal: Math.round(rothBalance),
    assumptions: [
      `Total federal tax over ${horizon} yrs: BASELINE (no conversions, full RMDs at age ${RMD_TRIGGER_AGE}+) vs SCENARIO (the ladder shrinks the traditional IRA → smaller future RMDs).`,
      `RMD per IRS Uniform Lifetime Table (Pub 590-B). Un-converted IRA grows ${Math.round((iraGrowth - 1) * 100)}%/yr.`,
      `netLifetimeValue = federal tax saved − the EXTRA Medicare IRMAA the conversions trigger. IRMAA per the 2025 SSA table (Part B+D), 2-year MAGI lookback, applied at age 65+ (MFJ assumes both spouses on Medicare).`,
      `scenarioRothBalanceFinal is the tax-free Roth at the horizon (the converted dollars, grown) — an UPSIDE the tax-only netLifetimeValue omits, so the true benefit of converting is higher still.`,
      `Future brackets + the IRMAA table are held at the latest published year; the baseline-vs-scenario delta stays meaningful even as absolute figures drift on long horizons.`,
    ],
  };
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

  // Lifetime RMD-avoidance value model — only when the client's age is known
  // (we need it to time RMDs). Projected to ~age 92, at least the conversion
  // horizon. This is the long-term VALUE of converting; the per-year ladder
  // above is the near-term COST.
  const baseAge = baseline.client.taxpayerAge;
  const rmdAvoidance =
    baseAge != null
      ? projectRmdAvoidance(baseline, {
          startingIraBalance: opts.traditionalIraBalance,
          conversionsByYear: years.map((yr) => yr.conversion),
          valueHorizonYears: Math.max(opts.horizonYears, Math.min(40, Math.max(1, 92 - baseAge))),
          incomeGrowth,
          iraGrowth,
        })
      : null;

  return {
    years,
    totalConverted: Math.round(totalConverted),
    totalConversionTaxCost: Math.round(totalCost),
    blendedConversionRate: totalConverted > 0 ? totalCost / totalConverted : 0,
    startingIraBalance: Math.round(opts.traditionalIraBalance),
    horizonYears: opts.horizonYears,
    incomeGrowth,
    iraGrowth,
    rmdAvoidance,
    assumptions: [
      "Fills to the TOP of the current federal ordinary bracket each year (no spill into the next bracket).",
      `Income projected forward at ${Math.round((incomeGrowth - 1) * 100)}%/yr; un-converted trad-IRA grows at ${Math.round((iraGrowth - 1) * 100)}%/yr.`,
      "Conversion modeled as ordinary income; the current-year federal tax cost is engine-computed, not estimated.",
      "v1 core: does NOT yet model RMD avoidance, IRMAA Part-B/D surcharges, or Social-Security taxability interaction (next increment).",
    ],
  };
}
