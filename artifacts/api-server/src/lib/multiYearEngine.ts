/**
 * Phase H — H3: multi-year scenario engine.
 *
 * Given a baseline TaxReturnInputs, projects N years forward by scaling
 * income facts at a configurable inflation factor and advancing the tax
 * year. Returns the full per-year computed return for both baseline and
 * scenario trajectories so callers can compute multi-year deltas.
 *
 * Bracket handling: the engine's `resolveTaxYear` clamps unknown years
 * (>2025) to the latest available year (TY2025) — so the engine effectively
 * runs every projection year on TY2025 brackets. This is a SIMPLIFICATION
 * (real brackets index at ~3% per year), but it's safe for MVP planning
 * comparisons: as long as we use the same bracket year for baseline and
 * scenario, the DELTA is meaningful even if absolute numbers are slightly
 * off. Document this in detectors that consume multi-year output.
 *
 * Inflation factor default = 1.03 (3% per year). Override per call.
 *
 * Module is pure: no DB, no LLM, no I/O. Callers (detectors, route
 * handlers) load inputs and pass them in.
 */

import {
  computeTaxReturnPure,
  type ComputedTaxReturn,
  type TaxReturnInputs,
  type W2Fact,
  type Form1099Fact,
  type AdjustmentFact,
} from "./taxReturnEngine";
import { applyWhatIfMutations, type WhatIfMutation } from "./whatIfEngine";

/** Default annual income growth factor (3% nominal). */
export const DEFAULT_INCOME_GROWTH = 1.03;
/** Default projection horizon (years). */
export const DEFAULT_HORIZON_YEARS = 5;

// ── Year-forward projection (pure) ─────────────────────────────────────────

function scaleNumish(v: unknown, factor: number): string | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return String(Math.round(n * factor * 100) / 100);
}

function scaleW2(w: W2Fact, factor: number, newTaxYear: number): W2Fact {
  const next: Record<string, unknown> = { ...w };
  // CRITICAL: advance taxYear so the engine includes the W-2 when computing
  // the projection year's return. Without this, the engine filters the W-2
  // out (taxYear mismatch) and the projected return has AGI=0.
  next.taxYear = newTaxYear;
  // Scale the dollar fields. SS wage base caps Box 3 at $168,600 (2024) — we
  // intentionally do NOT cap here because the projection is for a future year
  // where the cap will have inflated too. Engine uses Box 1 fallback when Box 3
  // is absent, so scaling Box 1 keeps SE/Medicare math consistent.
  const dollarFields = [
    "wagesBox1", "federalTaxWithheldBox2", "federalWithholdingBox2",
    "socialSecurityWagesBox3", "socialSecurityTaxBox4",
    "medicareWagesBox5", "medicareTaxBox6",
    "socialSecurityTipsBox7", "allocatedTipsBox8",
    "dependentCareBenefitsBox10", "nonqualifiedPlansBox11",
    "stateTaxWithheldBox17", "stateWagesBox16", "stateTaxBox17",
  ];
  for (const f of dollarFields) {
    const scaled = scaleNumish(next[f], factor);
    if (scaled != null) next[f] = scaled;
  }
  return next as W2Fact;
}

function scale1099(r: Form1099Fact, factor: number, newTaxYear: number): Form1099Fact {
  const next: Record<string, unknown> = { ...r };
  // Advance taxYear (engine filters by taxYear when iterating 1099s).
  next.taxYear = newTaxYear;
  const dollarFields = [
    "nonemployeeCompensation", "interestIncome", "taxExemptInterest",
    "ordinaryDividends", "qualifiedDividends",
    "totalCapitalGainDistribution",
    "shortTermGainLoss", "longTermGainLoss",
    "taxableAmount", "grossDistribution",
    "unemploymentCompensation", "stateLocalRefund",
    "grossPaymentAmount", "rents", "royalties", "otherIncome",
    "fishingBoatProceeds", "medicalAndHealthcare",
    "federalTaxWithheld", "stateTaxWithheld",
  ];
  for (const f of dollarFields) {
    const scaled = scaleNumish(next[f], factor);
    if (scaled != null) next[f] = scaled;
  }
  return next as unknown as Form1099Fact;
}

function scaleAdjustments(adjs: AdjustmentFact[], factor: number): AdjustmentFact[] {
  // Only scale dollar-amount adjustments. Carry-forwards are tricky (multi-
  // year carryforwards would compound differently), so we keep them
  // unchanged for MVP.
  const carryForwardTypes = new Set([
    "capital_loss_carryforward_short",
    "capital_loss_carryforward_long",
    "schedule_e_passive_loss_carryforward",
    "k1_passive_loss_carryforward",
    "amt_credit_carryforward",
    "charitable_carryforward_cash",
    "nol_carryforward",
    "section_163j_carryforward_from_prior",
  ]);
  return adjs.map((a) => {
    if (carryForwardTypes.has(a.adjustmentType)) return { ...a };
    const scaled = scaleNumish(a.amount, factor);
    if (scaled == null) return { ...a };
    return { ...a, amount: scaled };
  });
}

/**
 * Project a TaxReturnInputs N years forward. Default factor = 3%/year
 * compound. Pure — does not mutate baseline.
 */
export function projectYearForward(
  baseline: TaxReturnInputs,
  yearsAhead: number,
  options?: { incomeGrowth?: number },
): TaxReturnInputs {
  const growth = options?.incomeGrowth ?? DEFAULT_INCOME_GROWTH;
  if (yearsAhead < 0) throw new Error("yearsAhead must be >= 0");
  if (yearsAhead === 0) {
    // Year 0 = baseline as-is (with fresh adjustments array to maintain
    // applyWhatIfMutations semantics).
    return {
      ...baseline,
      adjustments: baseline.adjustments.map((a) => ({ ...a })),
    };
  }
  const factor = Math.pow(growth, yearsAhead);
  const newTaxYear = baseline.taxYear + yearsAhead;
  return {
    ...baseline,
    client: { ...baseline.client, taxYear: newTaxYear },
    w2s: baseline.w2s.map((w) => scaleW2(w, factor, newTaxYear)),
    form1099s: baseline.form1099s.map((r) => scale1099(r, factor, newTaxYear)),
    adjustments: scaleAdjustments(baseline.adjustments, factor),
    taxYear: newTaxYear,
  };
}

// ── Multi-year trajectory runner ───────────────────────────────────────────

export interface MultiYearOptions {
  /** Annual income growth factor (1.03 = 3%/year). */
  incomeGrowth?: number;
  /**
   * Per-year mutations. mutationsByYear[N] is applied to year N's inputs
   * before computing. Empty entries (or missing indices) leave that year
   * unchanged from the projection. Used to model year-N strategy actions
   * (e.g., year-0 Roth conversion).
   */
  mutationsByYear?: ReadonlyArray<readonly WhatIfMutation[] | undefined>;
}

export interface MultiYearProjection {
  /** Inputs used at each year (after projection + mutations applied). */
  yearInputs: TaxReturnInputs[];
  /** Computed tax return at each year. */
  yearReturns: ComputedTaxReturn[];
  /** Sum of (federal + state + SE + NIIT + AMT) tax burden across the window. */
  totalTaxBurden: number;
  /** Sum of federalTaxLiability across the window. */
  totalFederalTax: number;
  /** Sum of stateTaxLiability across the window. */
  totalStateTax: number;
  /** The horizon (number of years computed, inclusive of year 0). */
  yearsAhead: number;
  /** Growth factor used (default 1.03). */
  incomeGrowth: number;
}

/**
 * Run an N-year trajectory: year 0 = baseline as-is, years 1..N-1 =
 * income-scaled projections. Per-year mutations applied if supplied.
 */
export function runMultiYearTrajectory(
  baseline: TaxReturnInputs,
  yearsAhead: number,
  options?: MultiYearOptions,
): MultiYearProjection {
  if (yearsAhead < 1) throw new Error("yearsAhead must be >= 1");
  const growth = options?.incomeGrowth ?? DEFAULT_INCOME_GROWTH;
  const muts = options?.mutationsByYear ?? [];

  const yearInputs: TaxReturnInputs[] = [];
  const yearReturns: ComputedTaxReturn[] = [];

  for (let y = 0; y < yearsAhead; y++) {
    let inputs = projectYearForward(baseline, y, { incomeGrowth: growth });
    const yearMuts = muts[y];
    if (yearMuts && yearMuts.length > 0) {
      inputs = applyWhatIfMutations(inputs, yearMuts);
    }
    yearInputs.push(inputs);
    yearReturns.push(computeTaxReturnPure(inputs));
  }

  const totalFederalTax = yearReturns.reduce((s, r) => s + r.federalTaxLiability, 0);
  const totalStateTax = yearReturns.reduce((s, r) => s + r.stateTaxLiability, 0);
  // Total burden uses federalTaxLiability (already includes SE + NIIT + AMT
  // pre-credits) + state. Credits are netted via federalRefundOrOwed; for the
  // multi-year burden we report PRE-credit federal + state.
  const totalTaxBurden = totalFederalTax + totalStateTax;

  return {
    yearInputs,
    yearReturns,
    totalTaxBurden,
    totalFederalTax,
    totalStateTax,
    yearsAhead,
    incomeGrowth: growth,
  };
}

// ── Multi-year delta (compare two trajectories) ────────────────────────────

export interface MultiYearDelta {
  /** Per-year federalTaxLiability delta (scenario − baseline). */
  yearByYearFederal: number[];
  /** Per-year stateTaxLiability delta. */
  yearByYearState: number[];
  /** Per-year combined (fed + state) delta. */
  yearByYearCombined: number[];
  /** Sum of combined deltas across the window. NEGATIVE = scenario saves. */
  totalCombinedDelta: number;
  /** Sum of federal deltas across the window. */
  totalFederalDelta: number;
  /** Sum of state deltas across the window. */
  totalStateDelta: number;
}

/**
 * Compare two multi-year trajectories of the same horizon and return the
 * per-year + total deltas. Trajectories must have the same yearsAhead.
 */
export function compareMultiYearTrajectories(
  baseline: MultiYearProjection,
  scenario: MultiYearProjection,
): MultiYearDelta {
  if (baseline.yearsAhead !== scenario.yearsAhead) {
    throw new Error(
      `Trajectory horizons must match (baseline=${baseline.yearsAhead}, scenario=${scenario.yearsAhead})`,
    );
  }
  const yearByYearFederal: number[] = [];
  const yearByYearState: number[] = [];
  const yearByYearCombined: number[] = [];
  for (let y = 0; y < baseline.yearsAhead; y++) {
    const bf = baseline.yearReturns[y].federalTaxLiability;
    const bs = baseline.yearReturns[y].stateTaxLiability;
    const sf = scenario.yearReturns[y].federalTaxLiability;
    const ss = scenario.yearReturns[y].stateTaxLiability;
    const df = sf - bf;
    const ds = ss - bs;
    yearByYearFederal.push(df);
    yearByYearState.push(ds);
    yearByYearCombined.push(df + ds);
  }
  return {
    yearByYearFederal,
    yearByYearState,
    yearByYearCombined,
    totalCombinedDelta: yearByYearCombined.reduce((s, v) => s + v, 0),
    totalFederalDelta: yearByYearFederal.reduce((s, v) => s + v, 0),
    totalStateDelta: yearByYearState.reduce((s, v) => s + v, 0),
  };
}
