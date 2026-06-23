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
  type ScheduleK1Fact,
  type RentalPropertyFact,
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

/**
 * T1.0g (TP-2) — carryforward adjustment types are FIXED prior-year dollar
 * amounts, never income that grows: scaling them by the income-growth factor
 * inflates projected-year deductions/credits out of thin air. The original
 * MVP set predated the newer credit/§179/§163(d) carryforward types — all 15
 * are now excluded from growth scaling.
 */
const CARRYFORWARD_NO_SCALE_TYPES: ReadonlySet<string> = new Set([
  "capital_loss_carryforward_short",
  "capital_loss_carryforward_long",
  "schedule_e_passive_loss_carryforward",
  "k1_passive_loss_carryforward",
  "amt_credit_carryforward",
  "charitable_carryforward_cash",
  "nol_carryforward",
  "section_163j_carryforward_from_prior",
  // TP-2 additions (audit 2026-06-11): these scaled with income before.
  "foreign_tax_credit_carryforward",
  "amt_nol_carryforward",
  "schedule_c_section179_carryforward",
  "investment_interest_carryforward",
  "adoption_credit_carryforward",
  "rd_credit_carryforward",
  "general_business_credit_carryforward",
]);

/**
 * One-time DISPOSITION gain/loss adjustments. Like capitalTransactions and
 * form4797 (dropped from projection years below), these represent a SPECIFIC
 * realized event — a home sale (§121), a like-kind exchange (§1031), a
 * QSBS/§1231 disposition, an ISO/ESPP disqualifying disposition, or a §1250/28%
 * disposition sub-bucket. Carrying them into projection years — worse, SCALED by
 * the income-growth factor — fabricates an annual gain (repro: a one-time $400k
 * §121 home sale recurred as $412k the next year, inflating projected AGI and the
 * §6654 vouchers). They are year-0 only. A detector that intends a gain to recur
 * (e.g. the §453 installment spread) injects it via per-year what-if mutations,
 * applied AFTER this projection — so dropping the baseline copy does not affect
 * those. (audit 2026-06-23)
 *
 * NOTE the general `long_term_capital_gain` / `short_term_capital_gain` levers are
 * DELIBERATELY NOT here: they are the catch-all recurring-gain inputs (a
 * buy-and-hold investor's annual Schedule-D distributions; prospectAnalyzer uses
 * `long_term_capital_gain` for a client's recurring 1040 line 7). `taxProjection`
 * and `rothOptimizer` consume `projectYearForward` DIRECTLY with no re-injection,
 * so dropping those would understate the projection / §6654 vouchers — the very
 * failure class the quarterlyAutopilot fix in this same audit was preventing.
 * (code-review 2026-06-23: caught long_term_capital_gain wrongly added here.)
 */
const ONE_TIME_DISPOSITION_ADJ_TYPES: ReadonlySet<string> = new Set([
  "home_sale_gross_gain_primary_residence",
  "section_1031_realized_gain",
  "section_1031_boot_received",
  "qsbs_gross_gain",
  "qsbs_adjusted_basis",
  "iso_disqualifying_disposition_ordinary",
  "espp_disqualifying_disposition_ordinary",
  "unrecaptured_section_1250_gain",
  "collectibles_28_rate_gain",
  "section_1231_lookback_loss",
]);

function scaleAdjustments(adjs: AdjustmentFact[], factor: number): AdjustmentFact[] {
  // Only scale dollar-amount adjustments. Carry-forwards are FIXED dollars
  // (a depleting prior-year balance, not recurring income) — held unchanged.
  // Accurate year-over-year depletion is the opt-in chainCarryforwards path.
  return adjs.map((a) => {
    if (CARRYFORWARD_NO_SCALE_TYPES.has(a.adjustmentType)) return { ...a };
    const scaled = scaleNumish(a.amount, factor);
    if (scaled == null) return { ...a };
    return { ...a, amount: scaled };
  });
}

/**
 * T1.0g (H1) — recurring pass-through income must survive into projection
 * years. The engine filters scheduleK1 rows STRICTLY by `taxYear`, so without
 * advancing the year a K-1 owner's income silently VANISHED from every
 * projection year ≥ 1 (repro: $300k S-corp K-1 → trajectory AGI [350k, 51.5k,
 * 53k]) — every multi-year delta then priced in empty brackets.
 *
 * Growth semantics (documented decision, 2026-06-11):
 *  - INCOME/EXPENSE boxes scale by the growth factor, like W-2s/1099s
 *    (Box 1/2/3/4, interest, dividends, royalties, ST/LT gains, SE earnings,
 *    §199A QBI + W-2 wages, distributions, separately-stated deductions).
 *  - BALANCE-SHEET fields are HELD at baseline (basis at start/end, at-risk,
 *    §199A UBIA — point-in-time capital amounts, not recurring flows; scaling
 *    them would fabricate basis).
 */
function scaleK1(k: ScheduleK1Fact, factor: number, newTaxYear: number): ScheduleK1Fact {
  const next: Record<string, unknown> = { ...k };
  next.taxYear = newTaxYear;
  const dollarFields = [
    "box1OrdinaryIncome", "box2RentalRealEstate", "box3OtherRentalIncome",
    "box4GuaranteedPayments", "interestIncome", "ordinaryDividends",
    "qualifiedDividends", "royalties", "netShortTermCapitalGain",
    "netLongTermCapitalGain", "selfEmploymentEarnings", "section199aQbi",
    "section199aW2Wages", "distributions", "separatelyStatedDeductions",
  ];
  for (const f of dollarFields) {
    const scaled = scaleNumish(next[f], factor);
    if (scaled != null) next[f] = scaled;
  }
  return next as unknown as ScheduleK1Fact;
}

/**
 * T1.0g (H1) — rental real estate recurs in projection years (same engine
 * year-filter problem as K-1s). Operating amounts (rentalIncome,
 * totalExpenses) scale; the DEPRECIABLE BASIS + placed-in-service facts are
 * held (basis is fixed at acquisition — the advancing taxYear naturally walks
 * the MACRS schedule forward); `suspendedLossCarryforward` is held (the
 * carryforward principle above). A property fully disposed in the baseline
 * year does NOT recur (it was sold) — filtered out of projection years.
 */
function scaleRental(r: RentalPropertyFact, factor: number, newTaxYear: number): RentalPropertyFact {
  const next: Record<string, unknown> = { ...r };
  next.taxYear = newTaxYear;
  for (const f of ["rentalIncome", "totalExpenses"]) {
    const scaled = scaleNumish(next[f], factor);
    if (scaled != null) next[f] = scaled;
  }
  return next as unknown as RentalPropertyFact;
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
  // Age advances WITH the year so age-gated benefits turn on mid-horizon: the
  // §63(f) additional standard deduction AND the OBBBA senior deduction both key
  // on 65. Pre-fix the age was frozen at baseline while the SAME module aged the
  // taxpayer for RMD (baseAge + y) — the std-deduction logic and the RMD logic
  // then disagreed, over-stating projected tax for anyone crossing 65 in-horizon
  // (audit 2026-06-23 F3).
  const baseAge = baseline.client.taxpayerAge;
  const baseSpouseAge = baseline.client.spouseAge;
  const newTaxpayerAge = baseAge != null ? baseAge + yearsAhead : baseAge;
  const newSpouseAge = baseSpouseAge != null ? baseSpouseAge + yearsAhead : baseSpouseAge;
  return {
    ...baseline,
    client: {
      ...baseline.client,
      taxYear: newTaxYear,
      taxpayerAge: newTaxpayerAge,
      spouseAge: newSpouseAge,
    },
    w2s: baseline.w2s.map((w) => scaleW2(w, factor, newTaxYear)),
    form1099s: baseline.form1099s.map((r) => scale1099(r, factor, newTaxYear)),
    // One-time disposition gains do NOT recur in projection years (mirror the
    // capitalTransactions/form4797 treatment below) — audit 2026-06-23.
    adjustments: scaleAdjustments(
      baseline.adjustments.filter((a) => !ONE_TIME_DISPOSITION_ADJ_TYPES.has(a.adjustmentType)),
      factor,
    ),
    // T1.0g (H1) — RECURRING pass-through income advances + scales (the engine
    // year-filters these arrays; pre-fix they silently dropped out of every
    // projection year). Disposed rentals do not recur.
    scheduleK1: baseline.scheduleK1?.map((k) => scaleK1(k, factor, newTaxYear)),
    rentalProperties: baseline.rentalProperties
      ?.filter((r) => r.fullyDisposedThisYear !== true)
      .map((r) => scaleRental(r, factor, newTaxYear)),
    // T1.0g (H1) — ONE-TIME dispositions deliberately do NOT recur:
    //  - capitalTransactions (Form 8949 lots) are realized sales of specific
    //    lots; repeating them every projection year would fabricate annual
    //    gains. They stay year-0 only (the engine's year filter excludes the
    //    baseline rows from projection years either way — the empty array
    //    makes that EXPLICIT rather than incidental).
    //  - form4797 business-property sales are likewise one-time §1231/§1245/
    //    §1250 dispositions — excluded from projection years.
    // NOTE: a client whose 1099-B summary boxes duplicate the 8949 lots will
    // see the SCALED 1099-B gains recur (pre-existing 1099 semantics) — the
    // per-lot detail simply no longer overrides them in projection years.
    capitalTransactions: baseline.capitalTransactions ? [] : undefined,
    form4797: baseline.form4797 ? [] : undefined,
    taxYear: newTaxYear,
  };
}

// ── RMD — IRS Uniform Lifetime Table (Pub 590-B Table III) ─────────────────
// SECURE Act 2.0: RMDs begin at age 73 (those born 1951–1959). The RMD for a
// year = (prior Dec-31 account balance) / (Uniform Lifetime divisor for the age
// attained that year). Roth IRAs are EXEMPT during the owner's lifetime — which
// is the whole point of a conversion ladder: converted dollars leave the RMD
// base permanently. Divisors cross-verified against IRS Pub 590-B + 3 sources.

/** SECURE 2.0 first-RMD age (born 1951–1959). */
export const RMD_TRIGGER_AGE = 73;

/** IRS Uniform Lifetime Table (Pub 590-B Table III), distribution-period divisors. */
export const UNIFORM_LIFETIME_DIVISORS: Readonly<Record<number, number>> = {
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1,
  80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4,
  88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9,
  96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
};

/**
 * Uniform Lifetime Table divisor for an age, or null when no RMD is required
 * (under age 73). Ages past 100 clamp to the age-100 divisor (the table
 * continues in Pub 590-B but is irrelevant for planning horizons).
 */
export function rmdDivisorForAge(age: number): number | null {
  if (!Number.isFinite(age) || age < RMD_TRIGGER_AGE) return null;
  const a = Math.min(100, Math.floor(age));
  return UNIFORM_LIFETIME_DIVISORS[a] ?? UNIFORM_LIFETIME_DIVISORS[100];
}

/**
 * Required Minimum Distribution = prior-year-end balance / divisor. Returns 0
 * when no RMD is required (age < 73) or the balance is non-positive.
 */
export function requiredMinimumDistribution(priorYearEndBalance: number, age: number): number {
  const d = rmdDivisorForAge(age);
  if (d == null || priorYearEndBalance <= 0) return 0;
  return priorYearEndBalance / d;
}

// ── Carryforward threading (pure) ──────────────────────────────────────────
// The engine OUTPUTS each remaining carryforward after a year's return; an
// accurate multi-year trajectory must START the next year from those depleted
// remainders rather than re-using the frozen year-0 amounts. captureCarryforwards
// reads the remainders off a computed return; applyCarryforwards rewrites the
// carryforward adjustments on the next year's inputs.

export interface CarryforwardState {
  nol: number;
  capitalLossShort: number;
  capitalLossLong: number;
  charitableCash: number;
  section163j: number;
  amtCredit: number;
  amtNol: number;
  passiveLossScheduleE: number;
}

/** Map each CarryforwardState field to its INPUT adjustmentType string. */
const CARRYFORWARD_ADJ_TYPE: Readonly<Record<keyof CarryforwardState, string>> = {
  nol: "nol_carryforward",
  capitalLossShort: "capital_loss_carryforward_short",
  capitalLossLong: "capital_loss_carryforward_long",
  charitableCash: "charitable_carryforward_cash",
  section163j: "section_163j_carryforward_from_prior",
  amtCredit: "amt_credit_carryforward",
  amtNol: "amt_nol_carryforward",
  passiveLossScheduleE: "schedule_e_passive_loss_carryforward",
};

/** Extract the carryforwards that roll to next year from a computed return. */
export function captureCarryforwards(r: ComputedTaxReturn): CarryforwardState {
  return {
    nol: Math.max(0, r.nolCarryforwardRemaining ?? 0),
    capitalLossShort: Math.max(0, r.capitalLossCarryforwardShort ?? 0),
    capitalLossLong: Math.max(0, r.capitalLossCarryforwardLong ?? 0),
    charitableCash: Math.max(0, r.charitableCarryforwardCashRemaining ?? 0),
    section163j: Math.max(0, r.section163jDisallowedCarryforward ?? 0),
    amtCredit: Math.max(0, r.amtCreditCarryforwardRemaining ?? 0),
    amtNol: Math.max(0, r.amtNolCarryforwardRemaining ?? 0),
    passiveLossScheduleE: Math.max(0, r.scheduleEPassiveLossSuspended ?? 0),
  };
}

/**
 * Replace the carryforward adjustments in `inputs` with the threaded state
 * (dropping any existing/frozen carryforward adjustments first; only positive
 * amounts are re-added). Pure — returns a fresh inputs object.
 */
export function applyCarryforwards(inputs: TaxReturnInputs, state: CarryforwardState): TaxReturnInputs {
  const cfTypes = new Set<string>(Object.values(CARRYFORWARD_ADJ_TYPE));
  const others = inputs.adjustments.filter((a) => !cfTypes.has(a.adjustmentType));
  const threaded: AdjustmentFact[] = [];
  for (const key of Object.keys(CARRYFORWARD_ADJ_TYPE) as (keyof CarryforwardState)[]) {
    const amt = state[key];
    if (amt > 0) {
      threaded.push({
        adjustmentType: CARRYFORWARD_ADJ_TYPE[key],
        amount: Math.round(amt * 100) / 100,
        isApplied: true,
      });
    }
  }
  return { ...inputs, adjustments: [...others, ...threaded] };
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
  /**
   * OPT-IN: thread each year's REMAINING carryforwards (NOL, cap-loss short/long,
   * charitable cash, §163(j), AMT credit, AMT NOL, Sched-E PAL) into the next
   * year — i.e. deplete them year over year instead of re-using the frozen
   * year-0 amounts. Default false (back-compat: every existing consumer + the
   * freeze-dependent tests are unchanged; only opt-in callers see depletion).
   */
  chainCarryforwards?: boolean;
  /**
   * OPT-IN: model Required Minimum Distributions. Each projection year the client
   * is >= age 73 (per client.taxpayerAge + the year offset), the RMD
   * (prior-year-end IRA balance / Uniform Lifetime divisor) is injected as
   * ordinary income; the balance grows at iraGrowth (default 1.05) and is reduced
   * by each year's RMD. No-op without client.taxpayerAge. Default off.
   */
  rmd?: { startingIraBalance: number; iraGrowth?: number };
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
  /** RMD injected as income in each year (0 when RMD modeling is off / under 73). */
  rmdByYear: number[];
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
  const chain = options?.chainCarryforwards ?? false;
  const rmdOpt = options?.rmd;
  const baseAge = baseline.client.taxpayerAge ?? null;
  const iraGrowth = rmdOpt?.iraGrowth ?? 1.05;

  const yearInputs: TaxReturnInputs[] = [];
  const yearReturns: ComputedTaxReturn[] = [];
  const rmdByYear: number[] = [];
  let priorCf: CarryforwardState | null = null;
  let iraBalance = rmdOpt ? Math.max(0, rmdOpt.startingIraBalance) : 0;

  for (let y = 0; y < yearsAhead; y++) {
    let inputs = projectYearForward(baseline, y, { incomeGrowth: growth });

    // Carryforward threading: start from last year's depleted remainders.
    if (chain && priorCf) inputs = applyCarryforwards(inputs, priorCf);

    // RMD: inject the required distribution as ordinary income at age >= 73.
    // (prior-year-end balance / divisor). The balance is the running iraBalance,
    // which represents the Dec-31 balance going into this year.
    let rmdThisYear = 0;
    if (rmdOpt && baseAge != null) {
      rmdThisYear = requiredMinimumDistribution(iraBalance, baseAge + y);
      if (rmdThisYear > 0) {
        inputs = applyWhatIfMutations(inputs, [
          { kind: "add_adjustment", adjustmentType: "additional_income", amount: Math.round(rmdThisYear) },
        ]);
      }
    }
    rmdByYear.push(Math.round(rmdThisYear));

    // Per-year strategy mutations layer on top (e.g. a Roth conversion).
    const yearMuts = muts[y];
    if (yearMuts && yearMuts.length > 0) {
      inputs = applyWhatIfMutations(inputs, yearMuts);
    }

    yearInputs.push(inputs);
    const computed = computeTaxReturnPure(inputs);
    yearReturns.push(computed);

    if (chain) priorCf = captureCarryforwards(computed);
    // Evolve the IRA: withdraw this year's RMD from the prior-year-end balance,
    // then grow the remainder to next year's prior-year-end balance.
    if (rmdOpt) iraBalance = Math.max(0, iraBalance - rmdThisYear) * iraGrowth;
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
    rmdByYear,
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
