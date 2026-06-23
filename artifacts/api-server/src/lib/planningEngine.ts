/**
 * Tax Planning detection engine — Layer 2.
 *
 * Reads the engine's deterministic output (ComputedTaxReturn + client +
 * adjustments) and emits OpportunityHit[]. **No LLM, no math estimation by
 * language model.** Every $-amount is computed here from IRS-cited formulas.
 *
 * Adding a new rule:
 *   1. Add a catalog entry in lib/planning-strategies/src/strategies-v1.json
 *      (id, IRC citation, confidence, action template, etc.).
 *   2. Add a `detectXXX(...)` function below that returns OpportunityHit | null.
 *   3. Wire it into `evaluatePlanningOpportunities` so it runs on every client.
 *   4. Add at least 3 positive + 2 negative + 1 boundary test in
 *      scripts/src/tax-engine-planning-tests.ts. Hand-calc every expected.
 *
 * Invariant: detectors MUST be pure — same inputs → same hits. No I/O, no
 * randomness, no Date.now(). The LLM (Layer 4) consumes these hits; if the
 * math drifts the memos drift with it.
 */

import {
  CATALOG_V1,
  type OpportunityHit,
  type OpportunityMultiYear,
  type OpportunityWhatIf,
  type PlanningStrategy,
  type WhatIfMutation,
  type WhatIfSensitivity,
} from "@workspace/planning-strategies";
import type {
  ComputedTaxReturn,
  ClientFacts,
  AdjustmentFact,
  AssetBalanceFact,
  TaxReturnInputs,
} from "./taxReturnEngine";
import { annotateDeadlines } from "./planningCalendar";
import {
  calculateFederalTaxWithBreakdown,
  calculateStateTaxWithBreakdown,
  getFederalStandardDeduction,
  getFederalBracketBreakpoints,
  getSaltCap,
  KIDDIE_TAX_THRESHOLD,
  resolveTaxYear,
  SS_WAGE_BASE,
  calculateStudentLoanInterest,
  sliPhaseOutBand,
  saversCreditRateFor,
  type TaxYear,
} from "./taxCalculator";
import { runWhatIfScenarios } from "./whatIfEngine";
import {
  compareMultiYearTrajectories,
  DEFAULT_INCOME_GROWTH,
  runMultiYearTrajectory,
} from "./multiYearEngine";

/**
 * H2 + H12 — Run the detector's mutation through the pure engine and
 * (optionally) compute a ±10% sensitivity range in one batched call.
 *
 * Returns `{ whatIf, sensitivity }` where:
 *   - `whatIf` is the OpportunityWhatIf to attach to the OpportunityHit
 *     when the detector wants engine verification. Includes the exact
 *     mutations the engine ran (transparent for CPA audit), the delta,
 *     and the semantic interpretation (savings vs cost).
 *   - `sensitivity` is included on `whatIf` only when `varyAmount` is
 *     true AND the mutations array contains exactly one mutation with
 *     a numeric `amount` field (so we know what to scale ±10%).
 *
 * When `baselineInputs` is undefined (the caller opted out of H2 — e.g.
 * the planning-hit-list endpoint), this returns `undefined` so the
 * detector emits its heuristic OpportunityHit unchanged.
 */
function runDetectorWhatIf(args: {
  baselineInputs: TaxReturnInputs | undefined;
  scenarioId: string;
  label: string;
  mutations: WhatIfMutation[];
  semantics: "savings" | "cost";
  /**
   * H12 sensitivity — when true AND the mutations array has exactly one
   * entry with a numeric `amount`, also run scenarios at 90% / 110% of
   * that amount and return the sensitivity range. Skip for fixed-amount
   * strategies (TLH $3k cap, FTC unclaimed gap) where ±10% doesn't
   * change the result.
   */
  varyAmount: boolean;
}): OpportunityWhatIf | undefined {
  const { baselineInputs, scenarioId, label, mutations, semantics, varyAmount } = args;
  if (!baselineInputs) return undefined;

  // Find the single scalable mutation (the one whose amount we vary).
  // If varyAmount is true but there isn't exactly one amount-bearing
  // mutation, we still run the mid scenario but omit sensitivity.
  const amountBearing = mutations
    .map((m, i) => ({ m, i }))
    .filter((x) => typeof x.m.amount === "number" && Number.isFinite(x.m.amount));
  const canVary = varyAmount && amountBearing.length === 1 && (amountBearing[0].m.amount ?? 0) > 0;

  if (!canVary) {
    const result = runWhatIfScenarios(baselineInputs, [
      { scenarioId, label, mutations },
    ]);
    return {
      mutations,
      delta: result[0].delta,
      semantics,
    };
  }

  const scaleIdx = amountBearing[0].i;
  const midAmount = amountBearing[0].m.amount as number;
  const scaledMutations = (factor: number): WhatIfMutation[] =>
    mutations.map((m, i) => (i === scaleIdx ? { ...m, amount: midAmount * factor } : m));

  const results = runWhatIfScenarios(baselineInputs, [
    { scenarioId: `${scenarioId}-90`, label: `${label} (-10%)`, mutations: scaledMutations(0.9) },
    { scenarioId, label, mutations },
    { scenarioId: `${scenarioId}-110`, label: `${label} (+10%)`, mutations: scaledMutations(1.1) },
  ]);
  // Sensitivity magnitude uses combinedRefundDelta (post-credit) rather than
  // combinedTaxDelta (pre-credit), so credit-based strategies (FTC) report
  // accurately. For deduction strategies (SEP / NIIT), the two are equal in
  // magnitude (opposite sign).
  // SIGN (audit 2026-06-11): values are SIGNED BY SEMANTICS, not |abs|'d —
  // "savings" reports +refundDelta (a refund-increasing scenario is positive);
  // "cost" reports −refundDelta (a refund-reducing scenario is a positive
  // cost). A scenario that CONTRADICTS its semantics (e.g. a "savings"
  // mutation that nets a cost) now surfaces as a NEGATIVE value instead of
  // being silently flipped positive by Math.abs().
  const signed = (refundDelta: number): number =>
    Math.round(semantics === "cost" ? -refundDelta : refundDelta);
  const sensitivity: WhatIfSensitivity = {
    low: signed(results[0].delta.combinedRefundDelta),
    mid: signed(results[1].delta.combinedRefundDelta),
    high: signed(results[2].delta.combinedRefundDelta),
  };
  return {
    mutations,
    delta: results[1].delta,
    semantics,
    sensitivity,
  };
}

/**
 * H3 — Run a multi-year scenario for a detector. Used by strategies whose
 * value spans multiple years (G1.3 bunching, G1.4 Roth long-term, G1.8 DAF).
 *
 * Runs TWO trajectories of the same horizon:
 *   - Baseline: caller-supplied per-year mutations (often all undefined for
 *     strategies where the baseline is "do nothing"; for Roth long-term the
 *     baseline includes a year-N projected RMD).
 *   - Scenario: caller-supplied per-year strategy mutations.
 *
 * Returns the OpportunityMultiYear with per-year fed+state burden for both
 * trajectories + totalSavings (positive = scenario saves over the window).
 *
 * Returns undefined when `baselineInputs` is missing (planning-hit-list and
 * similar callers opt out of H3 by not passing baselineInputs).
 *
 * Cost: 2 × horizonYears engine runs. Caller decides whether the detector
 * is worth that overhead (we only wire it where the multi-year delta adds
 * real signal — currently G1.3 / G1.4 / G1.8).
 */
function runDetectorMultiYear(args: {
  baselineInputs: TaxReturnInputs | undefined;
  horizonYears: number;
  baselineMutationsByYear?: ReadonlyArray<readonly WhatIfMutation[] | undefined>;
  scenarioMutationsByYear: ReadonlyArray<readonly WhatIfMutation[] | undefined>;
  growthFactor?: number;
  multiYearAssumptions: string[];
}): OpportunityMultiYear | undefined {
  const {
    baselineInputs,
    horizonYears,
    baselineMutationsByYear,
    scenarioMutationsByYear,
    growthFactor,
    multiYearAssumptions,
  } = args;
  if (!baselineInputs) return undefined;
  if (horizonYears < 1) return undefined;

  const growth = growthFactor ?? DEFAULT_INCOME_GROWTH;
  const baselineProj = runMultiYearTrajectory(baselineInputs, horizonYears, {
    incomeGrowth: growth,
    mutationsByYear: baselineMutationsByYear,
  });
  const scenarioProj = runMultiYearTrajectory(baselineInputs, horizonYears, {
    incomeGrowth: growth,
    mutationsByYear: scenarioMutationsByYear,
  });
  const delta = compareMultiYearTrajectories(baselineProj, scenarioProj);

  const baselineYearTax = baselineProj.yearReturns.map((r) =>
    Math.round(r.federalTaxLiability + r.stateTaxLiability),
  );
  const scenarioYearTax = scenarioProj.yearReturns.map((r) =>
    Math.round(r.federalTaxLiability + r.stateTaxLiability),
  );
  const yearByYearDelta = delta.yearByYearCombined.map((v) => Math.round(v));
  const totalSavings = -Math.round(delta.totalCombinedDelta);

  return {
    horizonYears,
    baselineYearTax,
    scenarioYearTax,
    yearByYearDelta,
    totalSavings,
    growthAssumption: growth,
    multiYearAssumptions,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toNum(val: string | number | null | undefined): number {
  if (val == null) return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function strategyById(id: string): PlanningStrategy {
  const s = CATALOG_V1.strategies.find((x) => x.id === id);
  if (!s) throw new Error(`planningEngine: catalog missing strategy ${id}`);
  return s;
}

/**
 * PLAN-08 — a catalog strategy stops being authoritative past its `validUntil`
 * tax year (its TY-specific thresholds go stale). Compared against the RETURN's
 * tax year — deterministic + back-fileable, NOT the wall clock. A "2026-12-31"
 * strategy is valid for TY ≤ 2026 returns and suppressed for TY ≥ 2027.
 * Malformed dates never suppress (defensive — fail open, don't hide a strategy).
 */
export function isStrategyExpiredForYear(validUntil: string, taxYear: number): boolean {
  const validUntilYear = Number(String(validUntil).slice(0, 4));
  if (!Number.isFinite(validUntilYear)) return false;
  return taxYear > validUntilYear;
}

/**
 * Template substitution. Replaces {{key}} with the formatted value.
 * Numbers are formatted with commas, no decimals (planning-tier values).
 */
function interpolate(template: string, vars: Record<string, number | string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key];
    if (v == null) return `{{${key}}}`;
    if (typeof v === "number") {
      return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    }
    return String(v);
  });
}

/**
 * Federal marginal rate at the client's current taxable income. Re-derives
 * from `calculateFederalTaxWithBreakdown` so the rate matches whatever the
 * engine actually used for the tax computation.
 */
export function federalMarginalRate(computed: ComputedTaxReturn): number {
  const { marginalRate } = calculateFederalTaxWithBreakdown(
    computed.taxableIncome,
    computed.filingStatus,
    computed.taxYear,
  );
  return marginalRate;
}

/**
 * T1.0g (M3, audit 2026-06-11) — actual-W-2-wage signal for the
 * employee-benefit detectors (G1.96 §132(f) transit, G1.72 RSU, G1.87
 * §401(a)(17), G1.57 NQDC). These strategies REQUIRE an employer/W-2
 * relationship; the old `totalIncome − netSE` proxy counted K-1 / rental /
 * investment income as "wages", so a K-1-only owner with zero W-2s got
 * engine-verified transit-fringe and RSU-withholding hits.
 *
 *  - `hasW2` — the return actually includes ≥ 1 W-2 (engine's year-filtered
 *    `w2Count`; available on BOTH the baselineInputs and hit-list paths).
 *  - `wages` — Box-1 wage total: the REAL sum from baselineInputs.w2s when
 *    available (year-filtered like the engine), else a refined proxy that
 *    subtracts every identifiable non-wage bucket (SE, K-1 active/passive/
 *    portfolio, rental, capital gains, interest, dividends, retirement,
 *    unemployment, SS) from totalIncome. Floored at 0.
 */
function w2WagesSignal(
  computed: ComputedTaxReturn,
  baselineInputs?: TaxReturnInputs,
): { hasW2: boolean; wages: number } {
  const hasW2 = (computed.w2Count ?? 0) > 0;
  if (!hasW2) return { hasW2, wages: 0 };
  if (baselineInputs) {
    const wages = (baselineInputs.w2s ?? [])
      .filter((w) => (w.taxYear ?? computed.taxYear) === computed.taxYear)
      .reduce((s, w) => s + toNum(w.wagesBox1), 0);
    return { hasW2, wages: Math.max(0, wages) };
  }
  const s1099 = computed.form1099Summary;
  const k1 = computed.scheduleK1;
  const nonWage =
    (computed.detail.se.netSeEarnings ?? 0) +
    (s1099?.retirementIncome ?? 0) +
    (s1099?.unemploymentCompensationOnly ?? 0) +
    (s1099?.interestIncome ?? 0) +
    (s1099?.ordinaryDividends ?? 0) +
    (s1099?.longTermCapitalGains ?? 0) +
    (s1099?.shortTermCapitalGains ?? 0) +
    (k1?.totalActiveOrdinaryIncome ?? 0) +
    (k1?.totalGuaranteedPayments ?? 0) +
    (k1?.totalPassiveBucketNetApplied ?? 0) +
    (k1?.totalInterestIncome ?? 0) +
    (k1?.totalOrdinaryDividends ?? 0) +
    (k1?.totalRoyalties ?? 0) +
    (k1?.totalShortTermCapitalGain ?? 0) +
    (k1?.totalLongTermCapitalGain ?? 0) +
    (computed.scheduleERentalAppliedToAgi ?? 0) +
    (computed.socialSecurityTaxable ?? 0);
  return { hasW2, wages: Math.max(0, computed.totalIncome - nonWage) };
}

/**
 * State marginal rate at the client's federal AGI (which is the state base
 * before state-specific subtractions in most states). Returns 0 for states
 * with no income tax (FL, TX, WA, etc.).
 */
function stateMarginalRate(computed: ComputedTaxReturn): number {
  const { marginalRate } = calculateStateTaxWithBreakdown(
    computed.adjustedGrossIncome,
    computed.stateCode,
    computed.filingStatus,
    computed.taxYear,
  );
  return marginalRate;
}

// ── G1.1 — SEP-IRA / Solo 401(k) ───────────────────────────────────────────

/**
 * §415(c) annual additions limit for defined-contribution plans (SEP, Solo 401k
 * employer-side). Per IRS Notice 2023-75 (TY2024), Notice 2024-80 (TY2025), and
 * Notice 2025-67 / IR-2025-111 (TY2026 = $72,000).
 */
const SEP_ANNUAL_LIMIT: Record<TaxYear, number> = {
  2024: 69000,
  2025: 70000,
  2026: 72000,
};

/**
 * Self-employment net-earnings threshold below which the SEP planning
 * opportunity is too small to justify the recommendation. Matches the
 * Phase G plan: rule should fire at net SE ≥ $30,000.
 */
const SEP_NET_SE_TRIGGER = 30000;

/**
 * Whether the client already has an existing SEP / Solo 401(k) contribution
 * adjustment. Engine does not yet model SEP/Solo401k as a first-class
 * adjustment type, so this catches future adjustment-type names by string
 * convention. When the schema adds an explicit type, no detector change is
 * needed.
 */
function hasExistingSepOrSolo(adjustments: AdjustmentFact[]): boolean {
  return adjustments.some((a) => {
    if (a.isApplied === false) return false;
    const t = (a.adjustmentType ?? "").toLowerCase();
    if (toNum(a.amount) <= 0) return false;
    return (
      t.includes("sep_ira") ||
      t.includes("solo_401k") ||
      t.includes("solo401k") ||
      t.includes("self_employed_retirement") ||
      t === "sep" ||
      t === "solo401k"
    );
  });
}

function detectSepIra(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, adjustments, baselineInputs } = args;
  void client; // reserved for future spouse-attribution
  // NOTE: do NOT exclude married_filing_separately here. Unlike the traditional-
  // IRA deduction (§219(g)) and the Roth IRA (§408A) — which impose a punishing
  // $0–$10k MFS phase-out — a SEP-IRA (§408(k)) and the employer side of a Solo
  // 401(k) (§415(c)) carry NO filing-status restriction (Pub 560). An MFS sole
  // proprietor is fully entitled to the contribution/deduction, so suppressing
  // them here was a missed opportunity (mis-applied IRA instinct).

  const netSe = computed.detail.se.netSeEarnings;
  if (netSe < SEP_NET_SE_TRIGGER) return null;
  if (hasExistingSepOrSolo(adjustments)) return null;

  const halfSe = computed.detail.se.deductibleHalf;
  const sepCap = SEP_ANNUAL_LIMIT[resolveTaxYear(computed.taxYear)];
  // Pub 560: contribution = 20% of (net SE earnings − half-SE-tax deduction)
  // for the self-employed individual (the rate-conversion of the 25%-of-net-
  // compensation employer rule). Capped at the §415(c) annual additions limit.
  const baseForContribution = Math.max(0, netSe - halfSe);
  const contribution = Math.min(baseForContribution * 0.20, sepCap);
  if (contribution <= 0) return null;

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  const estSavings = contribution * (fedRate + stateRate);

  // H2: Verify the savings by running the actual scenario through the
  // engine. The SEP contribution is above-the-line — same arithmetic
  // as a generic `deduction` adjustment. Re-running the engine picks
  // up cascade effects the heuristic misses (NIIT cliff escape, AMT
  // shift, QBI base change, EITC phase-in/out, state-tax recomputation).
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.1-sep-contribution",
    label: `SEP-IRA contribution $${Math.round(contribution).toLocaleString("en-US")}`,
    mutations: [
      { kind: "add_adjustment", adjustmentType: "deduction", amount: Math.round(contribution) },
    ],
    semantics: "savings",
    varyAmount: true,
  });

  const strategy = strategyById("G1.1");
  const contributionRounded = Math.round(contribution);
  const vars: Record<string, number | string> = {
    contribution: contributionRounded,
    estSavings: Math.round(estSavings),
  };
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const combinedPct = Math.round((fedRate + stateRate) * 1000) / 10;
  const rationale =
    `Net SE earnings of ${fmt(Math.round(netSe))} support a SEP-IRA contribution of ~${fmt(contributionRounded)} ` +
    `at a combined federal+state marginal rate of ${combinedPct}%.`;

  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      halfSeDeduction: Math.round(halfSe),
      sepCap,
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
      contribution: Math.round(contribution),
    },
    assumptions: [
      `Contribution = 20% × (net SE earnings − ½ SE tax) per IRS Pub 560.`,
      `Capped at §415(c) annual additions limit (${fmt(sepCap)} for TY${computed.taxYear}; Notice 2023-75 / 2024-80).`,
      `Above-the-line deduction on Schedule 1 Line 16 — modeled as a generic engine "deduction" adjustment (same arithmetic effect on AGI).`,
      `Sensitivity range computed at ±10% of the recommended contribution.`,
    ],
    whatIf,
  };
}

// ── G1.2 — PTET (Pass-Through Entity Tax) election ────────────────────────

/**
 * STATE_PTET_REGIMES — per-state Pass-Through Entity Tax (SALT-cap workaround)
 * regime data, keyed by USPS state code (+ "DC"). Every U.S. jurisdiction is
 * listed (hasPtet true or false) so the table is self-documenting: a maintainer
 * sees each state's status at a glance and the yearly freshness review is a scan
 * of one table.
 *
 *   hasPtet     — the state has enacted an ELECTIVE entity-level PTET that lets
 *                 S-corp / partnership owners pay + deduct state income tax at
 *                 the entity level, bypassing the federal $10k/$40k SALT cap
 *                 (IRS Notice 2020-75; IRC §164(b)(6)+(7)).
 *   topPtetRate — the entity-level PTET rate as a decimal. For GRADUATED regimes
 *                 (NJ BAIT, NY, OR) this is the TOP marginal rate; the detector
 *                 applies it to the owner's incremental pass-through income to
 *                 estimate the PTET actually payable. 0 when hasPtet is false.
 *   notes       — statutory / DOR basis, the applicable tax year for the rate,
 *                 and any known rate trajectory.
 *
 * Source basis: AICPA "States' Elective Pass-Through Entity (PTE) Tax" tracker,
 * cross-checked per state against the statute / DOR form instructions (see the
 * per-state note) and the CrossLink / Smith & Howard / EisnerAmper 2024-25
 * summaries. Where a state is ratcheting its rate, the rate is anchored to
 * TY2024 (the dominant completed filing year for this app's data) and the TY2025
 * value is captured in the note.
 *
 * ⚠ FRESHNESS — PTET regimes and rates change EVERY YEAR: states keep enacting
 * PTETs, and the flat-tax states (AR, CO, GA, IA, IN, KY, MO, MS, NC, NE, UT, WV)
 * are ratcheting their individual rates DOWN annually. Re-verify this table each
 * filing season against the AICPA tracker + each state's DOR before relying on
 * the dollar estimates. Table verified 2026-06.
 */
export interface PtetRegime {
  hasPtet: boolean;
  topPtetRate: number;
  notes: string;
}

export const STATE_PTET_REGIMES: Readonly<Record<string, PtetRegime>> = {
  // ── States WITH an enacted elective PTET (36) ──────────────────────────────
  AL: { hasPtet: true, topPtetRate: 0.05, notes: "5% flat (Act 2021-1, Alabama Electing PTE Tax Act; = top individual rate)." },
  AZ: { hasPtet: true, topPtetRate: 0.025, notes: "2.5% flat TY2023+ (A.R.S. §43-1014 → §43-1011 flat individual rate; AZ Form 165 instr.; was 4.5% TY2022)." },
  AR: { hasPtet: true, topPtetRate: 0.039, notes: "= AR top individual rate; 3.9% (eff. 1/1/2024 per the 2024 special session; was 4.4%)." },
  CA: { hasPtet: true, topPtetRate: 0.093, notes: "9.3% FLAT (R&TC §19900 et seq.) — the specific PTE-elective rate, NOT the 13.3% top individual rate. Extended through 2030." },
  CO: { hasPtet: true, topPtetRate: 0.044, notes: "= CO flat individual rate (SALT Parity Act, C.R.S. §39-22-340 et seq.); 4.40% TY2024 (4.25% TY2025)." },
  CT: { hasPtet: true, topPtetRate: 0.0699, notes: "6.99% (Conn. Gen. Stat. §12-699; mandatory pre-2024, elective from TY2024)." },
  GA: { hasPtet: true, topPtetRate: 0.0539, notes: "= GA flat individual rate (HB 149); 5.39% TY2024 (5.19% TY2025, declining toward 4.99%)." },
  HI: { hasPtet: true, topPtetRate: 0.11, notes: "graduated to the 11% top individual rate (Act 50 (2023), TY2023+)." },
  ID: { hasPtet: true, topPtetRate: 0.05695, notes: "= ID flat individual/corporate rate (Affected Business Entity tax); 5.695% TY2024 (was 5.8%)." },
  IL: { hasPtet: true, topPtetRate: 0.0495, notes: "4.95% flat (35 ILCS 5/201(p); = individual rate). TY2021-2025." },
  IN: { hasPtet: true, topPtetRate: 0.0305, notes: "= IN flat individual rate; 3.05% TY2024 (3.0% TY2025; →2.9% by 2027)." },
  IA: { hasPtet: true, topPtetRate: 0.057, notes: "= IA top individual rate; 5.7% TY2024 (IA goes flat 3.8% TY2025)." },
  KS: { hasPtet: true, topPtetRate: 0.057, notes: "5.7% (K.S.A. 79-32,287; = top individual rate)." },
  KY: { hasPtet: true, topPtetRate: 0.04, notes: "= KY flat individual rate; 4.0% TY2024 (was 4.5% TY2023)." },
  LA: { hasPtet: true, topPtetRate: 0.0425, notes: "= LA individual rate; graduated top 4.25% TY2024 (LA went flat 3% TY2025)." },
  MD: { hasPtet: true, topPtetRate: 0.08, notes: "8% on resident individual members' shares (Md. Tax-Gen. §10-102.1; ≈ 5.75% state + county-equivalent); 8.25% corporate members." },
  MA: { hasPtet: true, topPtetRate: 0.05, notes: "5% flat (Ch. 63D; = individual rate). The 4% millionaire surtax is NOT imposed at the entity level." },
  MI: { hasPtet: true, topPtetRate: 0.0425, notes: "4.25% flat flow-through entity tax (MCL 206.813; = individual rate)." },
  MN: { hasPtet: true, topPtetRate: 0.0985, notes: "= MN top individual rate 9.85% (Minn. Stat. §289A.08 subd. 7a)." },
  MS: { hasPtet: true, topPtetRate: 0.047, notes: "= MS flat individual rate above the exemption; 4.7% TY2024 (4.4% TY2025; →4.0% by 2026)." },
  MO: { hasPtet: true, topPtetRate: 0.048, notes: "= MO top individual rate; 4.8% TY2024 (4.7% TY2025)." },
  MT: { hasPtet: true, topPtetRate: 0.059, notes: "= MT top individual rate (SB 554, TY2023+); 5.9% TY2024 (restructured from 6.75%)." },
  NE: { hasPtet: true, topPtetRate: 0.0584, notes: "= NE top individual rate (LB 754); 5.84% TY2024 (5.20% TY2025; →3.99% by 2027)." },
  NJ: { hasPtet: true, topPtetRate: 0.109, notes: "BAIT graduated 5.675%-10.9%; top 10.9% over $1M (N.J.S.A. 54A:12-1 et seq.)." },
  NM: { hasPtet: true, topPtetRate: 0.059, notes: "= NM top individual rate 5.9% (N.M. Stat. §7-3A; PTE entity tax)." },
  NY: { hasPtet: true, topPtetRate: 0.109, notes: "PTET graduated 6.85%-10.9%; top 10.9% (Tax Law Art. 24-A). NYC PTET (3.876%) is a separate add-on." },
  NC: { hasPtet: true, topPtetRate: 0.045, notes: "= NC flat individual rate; 4.5% TY2024 (4.25% TY2025; 3.99% thereafter)." },
  OH: { hasPtet: true, topPtetRate: 0.03, notes: "3% TY2023+ (R.C. §5747.38, Form IT 4738; = business-income tax rate; was 5% TY2022)." },
  OK: { hasPtet: true, topPtetRate: 0.0475, notes: "= OK top individual rate for individual members 4.75% (68 O.S. §2355.1P-4); 4% corporate members." },
  OR: { hasPtet: true, topPtetRate: 0.099, notes: "PTE-E graduated 9% (≤$250k) / 9.9% (>$250k); top 9.9% (ORS 314.778)." },
  RI: { hasPtet: true, topPtetRate: 0.0599, notes: "5.99% flat (R.I. Gen. Laws §44-11-2.3; = top individual rate)." },
  SC: { hasPtet: true, topPtetRate: 0.03, notes: "3% flat active-trade-or-business rate (S.C. Code §12-6-545 / §12-6-3910, I-335 election)." },
  UT: { hasPtet: true, topPtetRate: 0.0455, notes: "= UT flat individual rate; 4.55% TY2024 (4.5% TY2025; was 4.65%)." },
  VA: { hasPtet: true, topPtetRate: 0.0575, notes: "5.75% (Va. Code §58.1-390.3; = top individual rate). TY2021-2025." },
  WV: { hasPtet: true, topPtetRate: 0.065, notes: "WV PTE tax (S.B. 151, TY2022+) at 6.5%; NOTE WV has cut its individual rates since (top ≈5.12% TY2024) — confirm the entity-year rate. Low-stakes (rarely strands SALT above the cap)." },
  WI: { hasPtet: true, topPtetRate: 0.079, notes: "7.9% flat entity rate (Wis. Stat. §71.21(6) / §71.365(4m); = corporate rate, not the 7.65% top individual)." },

  // ── Income-tax states WITHOUT a PTET (5 + DC) ──────────────────────────────
  DE: { hasPtet: false, topPtetRate: 0, notes: "No PTET enacted (has an individual income tax but no SALT-cap workaround)." },
  ME: { hasPtet: false, topPtetRate: 0, notes: "No PTET enacted as of TY2024." },
  ND: { hasPtet: false, topPtetRate: 0, notes: "No PTET enacted (individual income tax, no workaround)." },
  PA: { hasPtet: false, topPtetRate: 0, notes: "No PTET enacted — PA notably has not adopted a SALT-cap workaround." },
  VT: { hasPtet: false, topPtetRate: 0, notes: "No PTET enacted as of TY2024." },
  DC: { hasPtet: false, topPtetRate: 0, notes: "No §164 SALT-cap PTET (the District's unincorporated-business franchise tax is unrelated)." },

  // ── No broad individual income tax → nothing to work around (9) ────────────
  AK: { hasPtet: false, topPtetRate: 0, notes: "No broad individual income tax → no PTET." },
  FL: { hasPtet: false, topPtetRate: 0, notes: "No individual income tax → no PTET." },
  NV: { hasPtet: false, topPtetRate: 0, notes: "No individual income tax → no PTET." },
  NH: { hasPtet: false, topPtetRate: 0, notes: "No tax on wage/business income (interest-&-dividends tax fully phased out by 2025) → no PTET." },
  SD: { hasPtet: false, topPtetRate: 0, notes: "No individual income tax → no PTET." },
  TN: { hasPtet: false, topPtetRate: 0, notes: "No individual income tax (Hall tax repealed 2021) → no PTET." },
  TX: { hasPtet: false, topPtetRate: 0, notes: "No individual income tax → no PTET." },
  WA: { hasPtet: false, topPtetRate: 0, notes: "No broad individual income tax (7% LTCG excise only) → no PTET." },
  WY: { hasPtet: false, topPtetRate: 0, notes: "No individual income tax → no PTET." },
};

function detectPtetElection(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { client, computed } = args;
  // Resident state must have an enacted PTET regime with a positive rate.
  const state = (client.state ?? "").toUpperCase();
  const regime = STATE_PTET_REGIMES[state];
  if (!regime || !regime.hasPtet || regime.topPtetRate <= 0) return null;

  // Must be a K-1 client with active (i.e. non-passive) pass-through income.
  // Passive K-1 income doesn't benefit from PTET in the same way (the rule
  // is intended for owner-operators of S-corps / partnerships).
  const activeK1 = computed.scheduleK1?.totalActiveOrdinaryIncome ?? 0;
  if (activeK1 <= 0) return null;

  // The cap must strand SALT: uncapped state+property tax above the (OBBBA-aware,
  // year-indexed) federal SALT cap.
  // MISSED-OPPORTUNITY FIX (2026-06-04 detector audit): do NOT gate on itemizing.
  // PTET moves the state-tax deduction to the ENTITY level (deducted on the
  // 1120-S/1065, reducing the K-1 income that flows to the 1040), which bypasses
  // the individual SALT cap entirely and is INDEPENDENT of whether the owner
  // itemizes (Notice 2020-75; §164(b)(6)+(7)). A standard-deduction filer is in
  // fact a PRIME candidate — especially a high earner whose OBBBA cap is phased
  // DOWN toward the $10k floor so their capped SALT drops below the std deduction
  // and the engine picks the std ded (itemizedDeductions == null). The old
  // itemizing gate suppressed exactly those clients. The saltUncapped > saltCap
  // test below correctly detects stranded SALT for itemizers AND std-ded filers.
  // OBBBA-aware, year-indexed SALT cap — single source of truth shared with the
  // core engine's Schedule A computation (taxCalculator.getSaltCap).
  const saltCap = getSaltCap(computed.taxYear, client.filingStatus, computed.adjustedGrossIncome);
  const { saltUncapped } = computed.scheduleA;
  if (saltUncapped <= saltCap) return null;
  const strandedSalt = saltUncapped - saltCap;

  // RATE-AWARE VALUATION (2026-06-06g): PTET can only move the state income tax
  // ATTRIBUTABLE TO the pass-through income to the entity level. That tax ≈
  // active K-1 income × the state's PTET rate (ptetPayable). The federal benefit
  // is the LESSER of (the stranded SALT) and (the PTET actually payable),
  // deducted at the owner's federal marginal rate. Bounding by ptetPayable fixes
  // the prior all-stranded heuristic's overstatement for low-PTET-rate states:
  // e.g. CA's flat 9.3% on $500k = $46.5k cannot recover $50k of stranded SALT —
  // the $3.5k balance is property tax / non-PTE state tax PTET cannot reach.
  const ptetPayable = activeK1 * regime.topPtetRate;
  const recoverable = Math.min(strandedSalt, ptetPayable);
  const fedRate = federalMarginalRate(computed);
  const estSavings = recoverable * fedRate;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.2");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  // Display rate as a trimmed percent (9.3, 10.9, 6.99, 5, 5.7).
  const ratePct = (regime.topPtetRate * 100).toFixed(2).replace(/\.?0+$/, "");
  const vars = {
    estSavings: Math.round(estSavings),
    recoverableSalt: Math.round(recoverable),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Resident state ${state} has a PTET regime (top rate ${ratePct}%); the SALT cap binds at ` +
      `${fmt(saltCap)} but ${fmt(Math.round(saltUncapped))} of state + property tax was paid, stranding ` +
      `${fmt(Math.round(strandedSalt))}. Electing PTET deducts ~${fmt(Math.round(recoverable))} at the entity ` +
      `level instead — the lesser of the stranded SALT and the ${ratePct}% PTET on ${fmt(Math.round(activeK1))} of active K-1 income.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      state,
      statePtetRate: regime.topPtetRate,
      activeK1Income: Math.round(activeK1),
      saltUncapped: Math.round(saltUncapped),
      saltCap,
      strandedSalt: Math.round(strandedSalt),
      ptetPayable: Math.round(ptetPayable),
      recoverableSalt: Math.round(recoverable),
      federalMarginalRate: fedRate,
    },
    assumptions: [
      `Resident state ${state} has an enacted elective PTET regime; top entity rate ${ratePct}% (${regime.notes}).`,
      `Federal benefit = min(stranded SALT ${fmt(Math.round(strandedSalt))}, active K-1 ${fmt(Math.round(activeK1))} × ${ratePct}% PTET = ${fmt(Math.round(ptetPayable))}) × federal marginal rate ${(fedRate * 100).toFixed(0)}%. Bounding by the PTET actually payable avoids overstating recovery when the stranded SALT is partly property tax / non-PTE state tax that PTET cannot move to the entity level.`,
      `SALT cap for TY${computed.taxYear} = ${fmt(saltCap)} (IRC §164(b)(6)+(7)). OBBBA (P.L. 119-21 §70120) raised the cap to $40k ($20k MFS) for TY2025 [$40.4k TY2026, +1%/yr through 2029], phasing DOWN 30% of MAGI over $500k ($250k MFS) to a $10k floor, then reverting to $10k after 2029. TCJA $10k applies for TY2024 and earlier. For a standard-deduction filer this is still a conservative estimate — they get no federal benefit from any state tax today, and PTET recovers the entity-level portion regardless of itemizing.`,
      `Assumes active K-1 income (passive doesn't qualify the same way under most PTET regimes).`,
      `⚠ PTET rates change yearly — re-verify ${state}'s rate against its DOR/statute each filing season (table verified 2026-06).`,
      `Engine does NOT model the PTET election as a first-class adjustment type — H2 verification deferred (would require multi-mutation: remove personal SALT + add PTE-level deduction + PTE-state-tax credit). Tracked as H1 catalog work.`,
    ],
  };
}

// ── G1.10 — Foreign Tax Credit unclaimed ──────────────────────────────────

function sumAdjustment(adjustments: AdjustmentFact[], type: string): number {
  return adjustments
    .filter((a) => a.adjustmentType === type && a.isApplied !== false)
    .reduce((s, a) => s + toNum(a.amount), 0);
}

function detectForeignTaxCreditGap(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { computed, adjustments, baselineInputs } = args;
  const foreignTaxPaid = sumAdjustment(adjustments, "foreign_tax_paid");
  if (foreignTaxPaid <= 0) return null;
  const claimed = computed.foreignTaxCredit?.credit ?? 0;
  // Fire when the engine's auto-claimed FTC is materially below the foreign
  // tax actually paid — typically because the simplified $300/$600 limit
  // capped it and Form 1116 wasn't filed.
  if (claimed >= foreignTaxPaid * 0.95) return null;
  const recoverable = foreignTaxPaid - claimed;
  if (recoverable <= 0) return null;

  // H2: mutation = SET `foreign_source_taxable_income` to a value large
  // enough that the Form 1116 ratio doesn't bind (so the engine claims the
  // full foreign tax paid). `set_adjustment` replaces any existing
  // foreign_source_taxable_income entries to guarantee the value (avoids
  // summing with a small existing one). Value chosen: max(taxableIncome,
  // foreignTaxPaid × 5) — guarantees the binding limit becomes foreignTaxPaid
  // rather than the ratio. Fixed-amount strategy — no meaningful sensitivity.
  const fstUnlockAmount = Math.max(
    computed.taxableIncome,
    foreignTaxPaid * 5,
  );
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.10-ftc-unclaimed",
    label: `Unlock Form 1116 ($${Math.round(recoverable).toLocaleString("en-US")} recoverable)`,
    mutations: [
      {
        kind: "set_adjustment",
        adjustmentType: "foreign_source_taxable_income",
        amount: Math.round(fstUnlockAmount),
      },
    ],
    semantics: "savings",
    varyAmount: false, // sensitivity meaningless — result binds at foreignTaxPaid
  });

  const strategy = strategyById("G1.10");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = {
    estSavings: Math.round(recoverable),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(recoverable),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Foreign tax paid of ${fmt(Math.round(foreignTaxPaid))} but only ${fmt(Math.round(claimed))} claimed as FTC. ` +
      `Filing Form 1116 with foreign-source taxable income unlocks ~${fmt(Math.round(recoverable))} of additional credit.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      foreignTaxPaid: Math.round(foreignTaxPaid),
      currentlyClaimed: Math.round(claimed),
      recoverable: Math.round(recoverable),
    },
    assumptions: [
      `Without Form 1116, engine uses simplified $300/$600 limit (Pub 514) → caps FTC below foreign tax paid.`,
      `H2 mutation provides foreign-source taxable income large enough that the Form 1116 ratio binds at the foreign tax paid (not the income-share limit).`,
      `Assumes the client's foreign income is taxable in both jurisdictions and qualifies for FTC (Pub 514 — passive vs general category not modeled).`,
      `No sensitivity range — recoverable amount is determined by the existing foreignTaxPaid - claimed gap.`,
    ],
    whatIf,
  };
}

// ── G1.3 — Bunching itemized vs standard ──────────────────────────────────

function detectBunching(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { computed, adjustments, baselineInputs } = args;
  const charitableCash = sumAdjustment(adjustments, "charitable_cash");
  if (charitableCash <= 0) return null;

  // NB: computed.standardDeduction is the *chosen* deduction (max of std vs
  // itemized). For this detector we need the actual standard-deduction value
  // to compute the ±15% band. Pull it directly from the calculator helper.
  const stdDed = getFederalStandardDeduction(computed.filingStatus, computed.taxYear);
  const itemizedTotal = computed.scheduleA.totalItemized;
  // Within ±15% of std ded — bunching has the highest leverage right at the
  // cliff. Filers far below std ded already lose itemized value; filers far
  // above already itemize comfortably and don't need bunching.
  if (itemizedTotal < stdDed * 0.85) return null;
  if (itemizedTotal > stdDed * 1.15) return null;

  const fedRate = federalMarginalRate(computed);
  // Phase G plan formula. The 0.25 × stdDed approximates the average annual
  // benefit of an alternating-year itemize/standard pattern: you "recover"
  // half the std ded one year (worth marginalRate of that half), averaged
  // over the 2-year cycle (×0.5).
  const heuristicEstSavings = stdDed * 0.25 * fedRate;
  if (heuristicEstSavings <= 0) return null;

  // H3 — Multi-year 2-year alternating cycle.
  // Baseline: each year donates currentCharitableCash (engine projects
  // unchanged; income scales 3%/yr).
  // Scenario: year 0 doubles charitable_cash (bunch); year 1 zeros it out.
  // Same total giving over the cycle; only timing differs. The
  // `totalSavings` is the engine-verified multi-year delta.
  const multiYear = runDetectorMultiYear({
    baselineInputs,
    horizonYears: 2,
    scenarioMutationsByYear: [
      [
        {
          kind: "set_adjustment",
          adjustmentType: "charitable_cash",
          amount: Math.round(charitableCash * 2),
        },
      ],
      [
        {
          kind: "set_adjustment",
          adjustmentType: "charitable_cash",
          amount: 0,
        },
      ],
    ],
    multiYearAssumptions: [
      `2-year alternating cycle: year 0 doubles charitable_cash to ${Math.round(charitableCash * 2).toLocaleString("en-US")} (push above std-ded), year 1 zeros it out (take std-ded).`,
      `SAME total giving across the cycle — only timing changes.`,
      `Income scaled at 3%/year compound projection.`,
      `Engine clamps unknown future years to TY2025 brackets — comparison delta is meaningful even though absolute year-2+ numbers don't reflect future bracket inflation.`,
    ],
  });

  // Prefer engine-verified multi-year savings when available; fall back to
  // the heuristic. Divide by horizonYears for annualized estSavings (CPAs
  // think in $/year, not $/cycle).
  const annualMultiYearSavings = multiYear && multiYear.totalSavings > 0
    ? multiYear.totalSavings / multiYear.horizonYears
    : null;
  const estSavings = annualMultiYearSavings ?? heuristicEstSavings;

  const strategy = strategyById("G1.3");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = { estSavings: Math.round(estSavings) };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Itemized total ${fmt(Math.round(itemizedTotal))} is within +/- 15% of the ${fmt(stdDed)} ` +
      `standard deduction, and there is ${fmt(Math.round(charitableCash))} of cash charitable giving ` +
      `that could be bunched.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      itemizedTotal: Math.round(itemizedTotal),
      standardDeduction: stdDed,
      charitableCash: Math.round(charitableCash),
      federalMarginalRate: fedRate,
      heuristicEstSavings: Math.round(heuristicEstSavings),
      annualMultiYearSavings: annualMultiYearSavings != null ? Math.round(annualMultiYearSavings) : null,
    },
    assumptions: [
      `Bunching is a MULTI-YEAR strategy (alternate itemize / standard each year).`,
      `Fires within ±15% of std-ded threshold where bunching has the highest leverage.`,
      annualMultiYearSavings != null
        ? `Engine-verified via H3 multi-year primitive (2-year cycle). Heuristic was ${fmt(Math.round(heuristicEstSavings))}/year.`
        : `Heuristic estSavings = stdDed × 0.25 × marginal rate (no H3 multi-year baseline available — pass baselineInputs to enable engine verification).`,
    ],
    multiYear,
  };
}

// ── G1.8 — Charitable Donor-Advised Fund bunching ─────────────────────────

const G1_8_MIN_CHARITABLE = 5000;
const G1_8_MIN_MARGINAL_RATE = 0.32;

function detectCharitableDaf(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { computed, adjustments, baselineInputs } = args;
  const charitableCash = sumAdjustment(adjustments, "charitable_cash");
  if (charitableCash <= G1_8_MIN_CHARITABLE) return null;

  const fedRate = federalMarginalRate(computed);
  if (fedRate < G1_8_MIN_MARGINAL_RATE) return null;

  // Phase G plan formula: (charitableCash × 2) × marginalRate × 0.2.
  // The 2× reflects bunching 2-3 years into one; the 0.2 reflects the
  // fraction recoverable above the standard-deduction floor in the bunch
  // year (empirical from the AICPA tax-planning playbook).
  const heuristicEstSavings = charitableCash * 2 * fedRate * 0.2;
  if (heuristicEstSavings <= 0) return null;

  // H3 — Multi-year 3-year DAF front-loading.
  // Baseline: each year donates currentCharitableCash.
  // Scenario: year 0 contributes 3× current to DAF; years 1-2 grant FROM
  // the DAF (no new charitable_cash). Same total giving; concentrated for
  // the bunch year so itemized clears the std-ded cliff.
  const multiYear = runDetectorMultiYear({
    baselineInputs,
    horizonYears: 3,
    scenarioMutationsByYear: [
      [
        {
          kind: "set_adjustment",
          adjustmentType: "charitable_cash",
          amount: Math.round(charitableCash * 3),
        },
      ],
      [
        {
          kind: "set_adjustment",
          adjustmentType: "charitable_cash",
          amount: 0,
        },
      ],
      [
        {
          kind: "set_adjustment",
          adjustmentType: "charitable_cash",
          amount: 0,
        },
      ],
    ],
    multiYearAssumptions: [
      `3-year DAF front-loading: year 0 contributes ${Math.round(charitableCash * 3).toLocaleString("en-US")} (3 years' worth) to the DAF; years 1 and 2 grant FROM the DAF balance (no new TaxFlow charitable_cash).`,
      `Same total giving across the 3-year cycle — concentration shifts the year-0 deduction above std-ded.`,
      `Income scaled at 3%/year compound for projection years.`,
      `60% AGI cap on cash gifts NOT modeled — large concentrated gifts can exceed the cap (excess carries forward 5 years per §170(d)(1)).`,
    ],
  });

  // Prefer engine-verified multi-year savings (annualized over the cycle)
  // when available; fall back to heuristic.
  const annualMultiYearSavings = multiYear && multiYear.totalSavings > 0
    ? multiYear.totalSavings / multiYear.horizonYears
    : null;
  const estSavings = annualMultiYearSavings ?? heuristicEstSavings;

  const strategy = strategyById("G1.8");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = { estSavings: Math.round(estSavings) };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Cash charitable giving of ${fmt(Math.round(charitableCash))} at a ${(fedRate * 100).toFixed(0)}% ` +
      `federal marginal rate is a strong fit for DAF front-loading.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      charitableCash: Math.round(charitableCash),
      federalMarginalRate: fedRate,
      heuristicEstSavings: Math.round(heuristicEstSavings),
      annualMultiYearSavings: annualMultiYearSavings != null ? Math.round(annualMultiYearSavings) : null,
    },
    assumptions: [
      `Donor-Advised Fund bunching is a MULTI-YEAR strategy (front-load 2-3 years of giving into one tax year, take std-ded in the off years).`,
      `Fires at $5k+ charitable AND 32%+ marginal rate — the threshold where DAF logistics + tax benefit exceed implementation friction.`,
      annualMultiYearSavings != null
        ? `Engine-verified via H3 multi-year primitive (3-year cycle). Heuristic was ${fmt(Math.round(heuristicEstSavings))}/year.`
        : `Heuristic estSavings = charitable × 2 × marginal rate × 0.2 (no baselineInputs for H3 multi-year verification).`,
    ],
    multiYear,
  };
}

// ── G1.4 — Roth conversion window ─────────────────────────────────────────

const G1_4_MAX_MARGINAL = 0.24;
const G1_4_EXPECTED_FUTURE_RATE = 0.32;
const G1_4_MIN_AGE = 30;
const G1_4_MAX_AGE = 72;

function detectRothConversion(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, baselineInputs } = args;
  const fedRate = federalMarginalRate(computed);
  // Only fire when there's a meaningful spread vs the assumed future rate.
  if (fedRate >= G1_4_MAX_MARGINAL) return null;

  const age = client.taxpayerAge;
  // Unknown age → fire (CPA judgment call). Known age outside range → suppress.
  if (age != null && (age < G1_4_MIN_AGE || age > G1_4_MAX_AGE)) return null;

  // FALSE-POSITIVE FIX (2026-06-04 detector audit): a Roth conversion requires a
  // PRE-TAX balance to convert (§408A(d)(3)) — a Roth account cannot be Roth-
  // converted. When the CPA HAS supplied asset balances and NONE are pre-tax
  // (the young all-Roth saver), there is nothing to convert, so advising "convert
  // ~$X of traditional IRA" is affirmatively wrong → suppress. When no balances
  // were supplied at all, fire informationally (no signal the balance is zero;
  // prerequisiteData surfaces the traditional-IRA requirement to the CPA). Only a
  // POSITIVE no-pre-tax signal suppresses, so this never over-suppresses on
  // missing data.
  const balances = baselineInputs?.assetBalances ?? [];
  if (balances.length > 0) {
    const preTaxTypes = new Set([
      "traditional_ira", "sep_ira", "simple_ira", "rollover_ira",
      "401k", "403b", "457b", "pretax_401k", "pension",
    ]);
    const preTaxBalance = balances
      .filter((a) => preTaxTypes.has((a.assetType ?? "").toLowerCase()))
      .reduce((s, a) => s + toNum(a.balance), 0);
    if (preTaxBalance <= 0) return null;
  }

  // Headroom to the top of the current bracket. Use calculateFederalTaxWith-
  // Breakdown to find the last bracket hit; cap on the 37% bracket is Infinity
  // so we can't fill it.
  const { breakdown } = calculateFederalTaxWithBreakdown(
    computed.taxableIncome,
    computed.filingStatus,
    computed.taxYear,
  );
  if (breakdown.length === 0) return null;
  const currentBracket = breakdown[breakdown.length - 1];
  if (!Number.isFinite(currentBracket.bracketMax)) return null;
  const conversion = Math.max(0, currentBracket.bracketMax - computed.taxableIncome);
  if (conversion <= 0) return null;

  const spread = G1_4_EXPECTED_FUTURE_RATE - fedRate;
  const estSavings = conversion * spread;
  if (estSavings <= 0) return null;

  // H2: mutation = add `additional_income` of conversion. Engine effect:
  // current-year tax UP by conversion × marginal rate (this is the COST
  // of doing the strategy, not the savings). The savings is long-term
  // (heuristic estSavings = conversion × (futureRate − currentRate)).
  // Semantics = "cost" — frontend renders this as a current-year cost
  // sub-callout, not a savings headline.
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.4-roth-conversion",
    label: `Roth conversion $${Math.round(conversion).toLocaleString("en-US")}`,
    mutations: [
      {
        kind: "add_adjustment",
        adjustmentType: "additional_income",
        amount: Math.round(conversion),
      },
    ],
    semantics: "cost",
    varyAmount: true,
  });

  // H3 — 5-year horizon. Baseline = "leave it in trad IRA, distribute in 5
  // years": year-4 (5 years inclusive of year 0) adds additional_income of
  // (conversion × growth^4) representing the projected required distribution.
  // Scenario = "convert now": year-0 adds additional_income of conversion;
  // years 1-4 unchanged (Roth distributions are tax-free).
  //
  // The trad-IRA growth rate (default 7%, S&P 500 long-term proxy) is
  // DECOUPLED from the income-scaling rate (default 3%) — the IRA grows
  // tax-deferred at market returns, not at wage growth.
  const TRAD_IRA_GROWTH = 1.07;
  const HORIZON = 5;
  const projectedDistribution = Math.round(conversion * Math.pow(TRAD_IRA_GROWTH, HORIZON - 1));
  // For an N-year array, index N-1 is the last year. Use undefined for
  // years 0..N-2 so they pass through unchanged.
  const baselineMuts: (readonly WhatIfMutation[] | undefined)[] = new Array(HORIZON).fill(undefined);
  baselineMuts[HORIZON - 1] = [
    {
      kind: "add_adjustment",
      adjustmentType: "additional_income",
      amount: projectedDistribution,
    },
  ];
  const scenarioMuts: (readonly WhatIfMutation[] | undefined)[] = new Array(HORIZON).fill(undefined);
  scenarioMuts[0] = [
    {
      kind: "add_adjustment",
      adjustmentType: "additional_income",
      amount: Math.round(conversion),
    },
  ];
  const multiYear = runDetectorMultiYear({
    baselineInputs,
    horizonYears: HORIZON,
    baselineMutationsByYear: baselineMuts,
    scenarioMutationsByYear: scenarioMuts,
    multiYearAssumptions: [
      `5-year horizon comparing "convert ${Math.round(conversion).toLocaleString("en-US")} now" vs. "leave in trad IRA, distribute ${projectedDistribution.toLocaleString("en-US")} in year 4".`,
      `Trad-IRA balance grows at ${((TRAD_IRA_GROWTH - 1) * 100).toFixed(0)}%/year tax-deferred (S&P 500 long-term proxy) — decoupled from wage growth (3%/year used for income projection).`,
      `Year-4 distribution is a SIMPLIFIED PROXY for actual lifetime RMDs which spread across many years (SECURE 2.0 starts RMDs at age 73).`,
      `Engine clamps unknown future years to TY2025 brackets — the actual bracket arbitrage may differ if future statutes change rates.`,
      `Ignores any state-residency change between year 0 and year 4 — assumes client stays in the same state.`,
    ],
  });

  const strategy = strategyById("G1.4");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = {
    estSavings: Math.round(estSavings),
    conversion: Math.round(conversion),
    currentRate: `${(fedRate * 100).toFixed(0)}%`,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client sits at a ${(fedRate * 100).toFixed(0)}% federal marginal rate with ` +
      `${fmt(Math.round(conversion))} of headroom to the top of the current bracket. ` +
      `Converting traditional IRA to Roth this year locks in that rate vs an assumed ` +
      `future rate of ${(G1_4_EXPECTED_FUTURE_RATE * 100).toFixed(0)}%.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      federalMarginalRate: fedRate,
      bracketTop: currentBracket.bracketMax,
      conversion: Math.round(conversion),
      assumedFutureRate: G1_4_EXPECTED_FUTURE_RATE,
      taxpayerAge: age ?? null,
    },
    assumptions: [
      `Conversion amount = headroom to top of current marginal bracket (locks in current rate).`,
      `Future marginal rate assumed at ${(G1_4_EXPECTED_FUTURE_RATE * 100).toFixed(0)}% for the heuristic estSavings (Phase G plan baseline).`,
      `H2 delta represents the CURRENT-YEAR TAX COST of the conversion. Long-term net benefit captured by H3 multi-year scenario (see multiYear field).`,
      `Engine modeled as added "additional_income" — same arithmetic effect as 1099-R taxable distribution from traditional IRA.`,
      `Pro-rata rule for after-tax basis (§408(d)(2)) NOT modeled — H6 Form 8606 handles that for clients with after-tax IRA basis.`,
      `Sensitivity range computed at ±10% of the conversion amount.`,
    ],
    whatIf,
    multiYear,
  };
}

// ── G1.5 — AMT timing (ISO bargain element) ────────────────────────────────

function detectAmtIsoTiming(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { computed, adjustments, baselineInputs } = args;
  if (computed.amtTax <= 0) return null;
  const isoBargain = sumAdjustment(adjustments, "amt_iso_bargain_element");
  if (isoBargain <= 0) return null;

  // The entire AMT could potentially be deferred OR avoided by either
  // spreading exercises across years (so AMT exemption covers more of it)
  // or doing a same-year disqualifying sale (converts AMT-preference to
  // ordinary W-2 income). estSavings = amtTax (the upper bound).

  // H2: mutation = remove the ISO bargain element. Models the
  // "disqualifying sale" route (the bargain becomes ordinary income on
  // the W-2 side instead of an AMT preference). For the "spread
  // exercises" route we approximate by removing the bargain entirely;
  // in reality the CPA chooses how much to spread.
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.5-amt-iso-defer",
    label: `Defer ISO bargain $${Math.round(isoBargain).toLocaleString("en-US")}`,
    mutations: [
      { kind: "remove_adjustment", adjustmentType: "amt_iso_bargain_element" },
    ],
    semantics: "savings",
    varyAmount: false, // mutation is a removal, no amount to scale
  });

  const strategy = strategyById("G1.5");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = { estSavings: Math.round(computed.amtTax) };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(computed.amtTax),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `AMT of ${fmt(Math.round(computed.amtTax))} driven by ${fmt(Math.round(isoBargain))} of ISO ` +
      `bargain element. Spreading the exercise across multiple tax years OR a same-year ` +
      `disqualifying sale would convert the preference and likely eliminate the AMT.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      amtTax: Math.round(computed.amtTax),
      isoBargainElement: Math.round(isoBargain),
    },
    assumptions: [
      `H2 mutation removes the ISO bargain element entirely (models a same-year disqualifying disposition — bargain becomes W-2 ordinary income).`,
      `Real-world choice: spread exercises across multiple years (partial removal) — engine result is the upper bound.`,
      `Disqualifying sale converts AMT preference to ordinary W-2 income — Pub 525 + Form 3921 instructions.`,
      `Excludes the §53 minimum-tax credit recovery (deferring AMT generates a credit usable in future years when regular tax binds — that future-year benefit is not captured here).`,
      `No sensitivity — mutation is binary (defer all or none).`,
    ],
    whatIf,
  };
}

// ── G1.6 — NIIT cliff avoidance ────────────────────────────────────────────

const NIIT_THRESHOLDS: Record<string, number> = {
  single: 200000,
  head_of_household: 200000,
  married_filing_jointly: 250000,
  qualifying_widow: 250000,
  married_filing_separately: 125000,
};

const G1_6_BAND = 10000;

function detectNiitCliff(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, baselineInputs } = args;
  const threshold = NIIT_THRESHOLDS[client.filingStatus] ?? NIIT_THRESHOLDS.single;
  const agi = computed.adjustedGrossIncome;
  // Symmetric band per spec. "Below threshold" case still fires (as an early
  // warning) but estSavings is zero so it won't rank into the top hits.
  if (agi < threshold - G1_6_BAND) return null;
  if (agi > threshold + G1_6_BAND) return null;

  const nii = computed.detail.niit?.investmentIncome ?? 0;
  if (nii <= 0) return null;

  const niitTax = computed.niitTax;
  // Round up; estSavings = current NIIT (the upper bound recoverable by
  // dropping AGI below the threshold).
  if (niitTax <= 0) return null;

  // H2: mutation = add `deduction` of `excess` (the amount AGI exceeds
  // threshold by). This drops AGI below the NIIT threshold (eliminating
  // NIIT) AND saves ordinary tax on the deduction. The H2 delta captures
  // BOTH effects — usually a much larger savings than the heuristic
  // (which only counted the NIIT). Represents a real strategy: an
  // additional 401(k) / HSA / SEP contribution of `excess` dollars.
  const excess = Math.max(0, agi - threshold);
  const whatIf = excess > 0
    ? runDetectorWhatIf({
        baselineInputs,
        scenarioId: "G1.6-niit-defer",
        label: `Defer $${Math.round(excess).toLocaleString("en-US")} of AGI below NIIT threshold`,
        mutations: [
          {
            kind: "add_adjustment",
            adjustmentType: "deduction",
            amount: Math.round(excess),
          },
        ],
        semantics: "savings",
        varyAmount: true,
      })
    : undefined;

  const strategy = strategyById("G1.6");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = {
    estSavings: Math.round(niitTax),
    threshold: threshold,
    deferAmount: Math.round(agi - threshold),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(niitTax),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `AGI ${fmt(Math.round(agi))} sits ${fmt(Math.round(agi - threshold))} above the ${fmt(threshold)} ` +
      `NIIT threshold with ${fmt(Math.round(nii))} of investment income. Dropping AGI below the ` +
      `threshold removes the 3.8% NIIT entirely.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(agi),
      threshold,
      excess: Math.round(agi - threshold),
      netInvestmentIncome: Math.round(nii),
      niitTax: Math.round(niitTax),
    },
    assumptions: [
      `NIIT threshold ${fmt(threshold)} for filing status "${client.filingStatus}" (IRC §1411).`,
      `H2 mutation adds a deduction equal to the AGI excess above threshold — models a 401(k) / HSA / SEP contribution that also reduces AGI.`,
      `whatIf.delta.combinedTaxDelta therefore captures BOTH (a) the NIIT eliminated AND (b) the ordinary-tax savings on the deduction. Usually larger than heuristic estSavings (NIIT-only).`,
      `Assumes investment income stays above the new excess (so NIIT cap still binds on excess, not NII).`,
      `Sensitivity range computed at ±10% of the defer amount.`,
    ],
    whatIf,
  };
}

// ── G1.7 — §199A wage / UBIA limit (K-1) ──────────────────────────────────

/**
 * §199A taxable-income thresholds (Rev. Proc. 2023-34 TY2024 + 2024-40 TY2025).
 * Below threshold: no wage/UBIA limit. Within phase-in band: limit phases in.
 * Above phase-in top: wage/UBIA limit binds fully.
 *
 * For TY2024:
 *   Single / MFS / HoH: threshold $191,950, top $241,950
 *   MFJ / QSS:           threshold $383,900, top $483,900
 *
 * For TY2025:
 *   Single / MFS / HoH: threshold $197,300, top $247,300
 *   MFJ / QSS:           threshold $394,600, top $494,600
 *
 * For TY2026 (OBBBA P.L. 119-21 made §199A PERMANENT and WIDENED the phase-in
 * range from $50k→$75k single / $100k→$150k MFJ; Rev. Proc. 2025-32 thresholds):
 *   Single / MFS / HoH: threshold $201,750, top $276,750 ($75k band)
 *   MFJ / QSS:           threshold $403,500, top $553,500 ($150k band)
 * (MFS is published $201,775 — a $25 rounding artifact; we treat MFS = single,
 * consistent with prior years, immaterial to the heuristic.) OBBBA also adds a
 * NEW $400 minimum QBI deduction (TY2026, for ≥$1,000 active QBI; indexed after
 * 2026) — informational here; the core QBI calc floor is a tracked follow-up.
 */
const QBI_THRESHOLDS: Record<TaxYear, Record<string, { threshold: number; top: number }>> = {
  2024: {
    single: { threshold: 191950, top: 241950 },
    married_filing_separately: { threshold: 191950, top: 241950 },
    head_of_household: { threshold: 191950, top: 241950 },
    married_filing_jointly: { threshold: 383900, top: 483900 },
    qualifying_widow: { threshold: 383900, top: 483900 },
  },
  2025: {
    single: { threshold: 197300, top: 247300 },
    married_filing_separately: { threshold: 197300, top: 247300 },
    head_of_household: { threshold: 197300, top: 247300 },
    married_filing_jointly: { threshold: 394600, top: 494600 },
    qualifying_widow: { threshold: 394600, top: 494600 },
  },
  2026: {
    single: { threshold: 201750, top: 276750 },
    married_filing_separately: { threshold: 201750, top: 276750 },
    head_of_household: { threshold: 201750, top: 276750 },
    married_filing_jointly: { threshold: 403500, top: 553500 },
    qualifying_widow: { threshold: 403500, top: 553500 },
  },
};

function detectQbiPhaseIn(args: {
  computed: ComputedTaxReturn;
  client: ClientFacts;
}): OpportunityHit | null {
  const { computed, client } = args;
  const k1Active = computed.scheduleK1?.totalActiveOrdinaryIncome ?? 0;
  const qbi = computed.detail.qbi?.qbiAmount ?? 0;
  // Only fires for K-1 / pass-through clients with QBI income.
  if (k1Active <= 0 || qbi <= 0) return null;

  const cfg = QBI_THRESHOLDS[resolveTaxYear(computed.taxYear)];
  if (!cfg) return null;
  const tier = cfg[computed.filingStatus] ?? cfg.single;
  const taxableBeforeQbi = computed.taxableIncome + computed.qbiDeduction;
  if (taxableBeforeQbi <= tier.threshold) return null;
  if (taxableBeforeQbi > tier.top) return null;

  const fedRate = federalMarginalRate(computed);
  // STALE-PREMISE FIX (2026-06-04 detector audit): the engine NOW applies the
  // §199A(b)(2)(B) wage/UBIA limit (calculateQbi) when the K-1 supplies W-2 wages
  // / UBIA — the old "engine applies flat 20%, restructuring recovers ~50% of QBI"
  // proxy was a fictional headline number. Base the estimate on the engine's
  // ACTUAL limit impact.
  const qbiDetail = computed.detail.qbi;
  let lostQbiDeduction: number;
  if (qbiDetail?.wageUbiaLimitBinds === true) {
    // The wage/UBIA limit already reduced the deduction below the 20% tentative.
    // Recoverable = the engine-computed shortfall (what raising W-2 wages inside
    // the entity could restore, up to the taxable-income cap).
    lostQbiDeduction = Math.max(0, (qbiDetail.preliminaryDeduction ?? 0) - (qbiDetail.finalDeduction ?? 0));
  } else {
    // Limit did not bind: either the K-1 supplied no W-2 wages/UBIA (engine
    // applied the flat 20%, so the deduction MAY be overstated vs a real Form
    // 8995-A) or wages are already adequate. No engine-quantified current loss —
    // surface a conservative forward-looking estimate (the assumptions flag that
    // the entity's W-2 wages/UBIA must be confirmed).
    lostQbiDeduction = (qbiDetail?.preliminaryDeduction ?? qbi * 0.20) * 0.5;
  }
  const estSavings = lostQbiDeduction * fedRate;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.7");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = { estSavings: Math.round(estSavings) };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Taxable-before-QBI ${fmt(Math.round(taxableBeforeQbi))} is in the §199A phase-in band ` +
      `(${fmt(tier.threshold)}-${fmt(tier.top)}), where the §199A(b)(2)(B) wage/UBIA limit ` +
      `progressively applies. ` +
      (qbiDetail?.wageUbiaLimitBinds === true
        ? `The engine's wage/UBIA limit is reducing the deduction by ~${fmt(Math.round(lostQbiDeduction))}; ` +
          `raising the entity's W-2 wages (or documenting UBIA) could restore up to ~${fmt(Math.round(estSavings))} of federal tax.`
        : `Confirm the entity's W-2 wages / UBIA on the K-1 — if low, a Form 8995-A would limit the deduction ` +
          `below the engine's flat 20%; structuring W-2 wages preserves it (est. ~${fmt(Math.round(estSavings))}).`),
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      taxableBeforeQbi: Math.round(taxableBeforeQbi),
      qbiAmount: Math.round(qbi),
      lostQbiDeduction: Math.round(lostQbiDeduction),
      wageUbiaLimitBinds: qbiDetail?.wageUbiaLimitBinds === true ? 1 : 0,
      threshold: tier.threshold,
      phaseInTop: tier.top,
      federalMarginalRate: fedRate,
    },
    assumptions: [
      qbiDetail?.wageUbiaLimitBinds === true
        ? `The engine's §199A(b)(2)(B) wage/UBIA limit (calculateQbi) BINDS here; the estimate is the engine-computed shortfall the deduction lost to the limit — restorable by raising the entity's W-2 wages, up to the 20%-of-taxable cap.`
        : `The engine DOES model the §199A wage/UBIA limit, but it did not bind here (the K-1 supplied no W-2 wages/UBIA so the flat 20% applied, OR wages are already adequate). The estimate is a conservative forward-looking proxy — CONFIRM the entity's W-2 wages/UBIA on the K-1.`,
      `Recoverable savings ≈ (20% tentative − wage-limited deduction) × marginal rate when the limit binds; otherwise a conservative ~50%-of-tentative forward-looking figure.`,
      `Phase-in band thresholds: TY${computed.taxYear}, ${client.filingStatus === "married_filing_jointly" || client.filingStatus === "qualifying_widow" ? "MFJ/QSS" : "single/HoH/MFS"} per Rev. Proc. 2023-34 / 2024-40 / 2025-32.`,
    ],
  };
}

// ── G1.9 — Tax-loss harvesting ────────────────────────────────────────────

const G1_9_MAX_OFFSET = 3000;
const G1_9_MAX_OFFSET_MFS = 1500;

function detectTaxLossHarvesting(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, baselineInputs } = args;
  const maxOffset = client.filingStatus === "married_filing_separately"
    ? G1_9_MAX_OFFSET_MFS
    : G1_9_MAX_OFFSET;
  if (computed.capitalLossDeducted >= maxOffset) return null;

  // Has capital-market activity: either gains (something to offset) or
  // losses (some history of trading). We don't fire for pure-W-2 clients
  // who'd have to open a brokerage from scratch to even harvest losses.
  const ltcg = computed.form1099Summary?.longTermCapitalGains ?? 0;
  const stcg = computed.form1099Summary?.shortTermCapitalGains ?? 0;
  const netCap = computed.netCapitalGainLoss ?? 0;
  if (ltcg <= 0 && stcg <= 0 && netCap === 0) return null;

  const fedRate = federalMarginalRate(computed);
  // Phase G plan: flat $3k × ordinary marginal rate. The "rest" of harvested
  // losses beyond the $3k cap carries forward indefinitely (upside not
  // captured in the headline number — surfaced in the rationale).
  const estSavings = maxOffset * fedRate;
  if (estSavings <= 0) return null;

  // H2: mutation = add `capital_loss_carryforward_short` of `maxOffset`
  // ($3k single/HoH/MFJ; $1.5k MFS). Engine applies the IRC §1211 annual
  // cap, offsetting against ordinary income. Fixed-amount strategy: no
  // sensitivity (excess harvest carries forward indefinitely, but the
  // current-year benefit is capped at maxOffset).
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.9-tlh-3k",
    label: `Harvest $${maxOffset.toLocaleString("en-US")} of capital losses`,
    mutations: [
      {
        kind: "add_adjustment",
        adjustmentType: "capital_loss_carryforward_short",
        amount: maxOffset,
      },
    ],
    semantics: "savings",
    varyAmount: false, // fixed cap, sensitivity wouldn't reflect strategy variability
  });

  const strategy = strategyById("G1.9");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = { estSavings: Math.round(estSavings) };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Current capital-loss deduction ${fmt(Math.round(computed.capitalLossDeducted))} is below ` +
      `the ${fmt(maxOffset)} annual cap. Harvesting unrealized losses to reach the cap saves ` +
      `~${fmt(Math.round(estSavings))} of federal tax (plus carryforward upside on losses ` +
      `beyond the cap).`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      capitalLossDeducted: Math.round(computed.capitalLossDeducted),
      maxOffset,
      longTermCapitalGains: Math.round(ltcg),
      shortTermCapitalGains: Math.round(stcg),
      netCapitalGainLoss: Math.round(netCap),
      federalMarginalRate: fedRate,
    },
    assumptions: [
      `IRC §1211 annual cap on net capital loss against ordinary income: $${maxOffset.toLocaleString("en-US")} (${client.filingStatus === "married_filing_separately" ? "MFS" : "single/HoH/MFJ"}).`,
      `H2 mutation harvests a ST capital loss carryforward up to the cap — represents realized loss offsetting ordinary income.`,
      `Excess harvested losses (beyond annual cap) carry forward indefinitely — multi-year benefit NOT captured in single-year delta.`,
      `Wash-sale rule (IRC §1091) must be respected — sell + don't repurchase substantially identical security within 30 days either side.`,
      `No sensitivity — strategy benefit is capped at the IRC §1211 annual offset.`,
    ],
    whatIf,
  };
}

// ── G1.11 — Qualified Charitable Distribution (QCD) §408(d)(8) ────────────

/**
 * QCD annual cap, indexed for inflation. Per IRC §408(d)(8)(F) starting
 * 2024 (SECURE 2.0 Act §307). TY2025 $108,000 per IRS Notice 2024-80;
 * TY2026 $111,000 (indexed; Rev. Proc. 2025-32).
 */
const QCD_CAP: Record<TaxYear, number> = {
  2024: 105_000,
  2025: 108_000,
  2026: 111_000,
};

const QCD_MIN_AGE = 70.5;
// PLAN-06: detector gates on year-end age. A client who turned 70 in the
// first half of the year reaches 70½ by year-end and is QCD-eligible — so we
// fire at year-end age ≥ 70 and have the CPA confirm the distribution date for
// the borderline age-70 case (a late-year 70th birthday isn't yet 70½).
const QCD_MIN_FIRE_AGE = 70;

function detectQcd(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, adjustments, baselineInputs } = args;
  const age = client.taxpayerAge;
  // Must be 70½ on the distribution date. Engine tracks only whole-year
  // (year-end) age, not the exact 70½ date. PLAN-06: fire at year-end age ≥ 70
  // — a client who turned 70 in the first half of the year reaches 70½ by
  // year-end and IS eligible. The prior 71+ gate silently dropped every
  // eligible 70½ split-year client. Year-end age 70 can't itself confirm 70½
  // (a late-year birthday misses it), so the assumptions flag the CPA to
  // confirm the distribution fell on/after the 70½ date.
  if (age == null || age < QCD_MIN_FIRE_AGE) return null;
  // age 70 at year-end is the borderline case needing a distribution-date check.
  const needs70HalfDateConfirm = age < 71;
  // Must have IRA / retirement-plan income (the QCD source).
  const retIncome = computed.form1099Summary?.retirementIncome ?? 0;
  if (retIncome <= 0) return null;
  // Must have charitable giving in scope (otherwise no donation to convert).
  const charitableCash = sumAdjustment(adjustments, "charitable_cash");
  if (charitableCash <= 0) return null;

  const cap = QCD_CAP[resolveTaxYear(computed.taxYear)];
  // QCD amount = lesser of (giving, cap, retirement income — can't QCD more
  // than the IRA distribution).
  const qcdAmount = Math.min(charitableCash, cap, retIncome);
  if (qcdAmount <= 0) return null;

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  // Heuristic: assumes client is on std-ded (so the charitable cash isn't
  // currently giving them a deduction; QCD's AGI exclusion is pure win).
  // For itemizing filers the savings is smaller (just the AGI-spillover
  // effects: NIIT shift, IRMAA, SS-taxability, etc.). H2 captures the
  // true magnitude.
  const estSavings = qcdAmount * (fedRate + stateRate);

  // H2 mutation: replace the charitable-cash portion of the donation with
  // an above-the-line "deduction" of the same amount. Engine treats:
  //   - Remaining charitable_cash → reduced itemized deduction
  //   - New deduction → AGI reduction (the QCD exclusion's effect)
  const newCharitableCash = Math.max(0, charitableCash - qcdAmount);
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.11-qcd",
    label: `QCD $${Math.round(qcdAmount).toLocaleString("en-US")}`,
    mutations: [
      {
        kind: "set_adjustment",
        adjustmentType: "charitable_cash",
        amount: Math.round(newCharitableCash),
      },
      {
        kind: "add_adjustment",
        adjustmentType: "deduction",
        amount: Math.round(qcdAmount),
      },
    ],
    semantics: "savings",
    varyAmount: false, // multi-mutation, scaling one not meaningful
  });

  const strategy = strategyById("G1.11");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    qcdAmount: Math.round(qcdAmount),
    estSavings: Math.round(estSavings),
    taxYear: computed.taxYear,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client (age ${age}) has ${fmt(Math.round(retIncome))} of IRA distribution income and ` +
      `${fmt(Math.round(charitableCash))} of charitable giving. Up to ${fmt(qcdAmount)} can be ` +
      `directed as a QCD — excluded from AGI rather than included + (maybe) deducted on Schedule A.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      taxpayerAge: age,
      requires70HalfDateConfirm: needs70HalfDateConfirm,
      retirementIncome: Math.round(retIncome),
      charitableCash: Math.round(charitableCash),
      qcdCap: cap,
      qcdAmount: Math.round(qcdAmount),
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
    },
    assumptions: [
      needs70HalfDateConfirm
        ? `Client is age 70 at year-end — CONFIRM the QCD was made on/after the day the client turned 70½ (IRC §408(d)(8)). A late-year 70th birthday means they reach 70½ next year and are NOT yet eligible.`
        : `Client is past 70½ for the full year — QCD-eligible. (Detector fires at year-end age ≥ 70; PLAN-06.)`,
      `QCD cap ${fmt(cap)} for TY${computed.taxYear} (IRC §408(d)(8)(F); indexed for inflation post-SECURE 2.0).`,
      `Charity must be a 501(c)(3) public charity — NOT a private foundation, DAF, or supporting organization.`,
      `Transfer MUST go direct from IRA custodian to charity — distribution to the client first DISQUALIFIES it.`,
      `H2 mutation: subtract from charitable_cash (loses Schedule A deduction) AND add an above-the-line deduction (the QCD exclusion). Net delta is the AGI-spillover benefit (NIIT, IRMAA, SS taxability).`,
      `For std-ded filers (no Schedule A benefit currently), QCD captures the full above-the-line savings — usually larger than the heuristic.`,
    ],
    whatIf,
  };
}

// ── G1.12 — Donate appreciated stock instead of cash (heuristic-only) ─────

const G1_12_MIN_CHARITABLE = 5000;
/**
 * Assumed average unrealized-appreciation percentage for donated stock.
 * Conservative — actual percentages vary widely by lot age + holding.
 * For more accuracy, would need per-lot cost basis (H5).
 */
const G1_12_AVG_UNREALIZED_PCT = 0.30;
const G1_12_LTCG_RATE_DEFAULT = 0.15;

function detectAppreciatedStockDonation(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  const charitableCash = sumAdjustment(adjustments, "charitable_cash");
  if (charitableCash <= G1_12_MIN_CHARITABLE) return null;
  // Has long-term capital gain (something to donate in stock form).
  const ltcg = computed.form1099Summary?.longTermCapitalGains ?? 0;
  if (ltcg <= 0) return null;

  // Donation amount = min of (current cash giving, available LTCG).
  // The strategy replaces $X of cash giving with $X of stock — CPA picks
  // lots so unrealized appreciation roughly equals X × assumed-pct.
  const donationAmount = Math.min(charitableCash, ltcg);
  // Savings = avoided cap-gains tax on the unrealized appreciation in the
  // donated lots. We use the engine's actual federal LTCG rate when easily
  // derivable; otherwise the default 15%.
  const ltcgRate = G1_12_LTCG_RATE_DEFAULT;
  const estSavings = donationAmount * G1_12_AVG_UNREALIZED_PCT * ltcgRate;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.12");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    donationAmount: Math.round(donationAmount),
    estSavings: Math.round(estSavings),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client donates ${fmt(Math.round(charitableCash))} in cash AND has ${fmt(Math.round(ltcg))} ` +
      `of long-term capital gains this year. Donating appreciated stock instead of cash (up to ` +
      `${fmt(Math.round(donationAmount))}) avoids cap-gains tax on the unrealized appreciation.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      charitableCash: Math.round(charitableCash),
      longTermCapitalGains: Math.round(ltcg),
      donationAmount: Math.round(donationAmount),
      assumedUnrealizedPct: G1_12_AVG_UNREALIZED_PCT,
      ltcgRate,
    },
    assumptions: [
      `Heuristic: assumes ${(G1_12_AVG_UNREALIZED_PCT * 100).toFixed(0)}% of donated stock FMV is unrealized appreciation. Real percentage varies by lot age + market performance.`,
      `LTCG rate assumed at ${(ltcgRate * 100).toFixed(0)}% (most HNW filers). 0% bracket applies < $47,025 single TY2024; 20% applies > $518,900.`,
      `Must be LONG-term (held > 1 year). Short-term gains don't qualify for FMV deduction — limited to cost basis under IRC §170(e).`,
      `Charity must accept in-kind stock — most large 501(c)(3)s do, but smaller ones may not.`,
      `H2 verification DEFERRED — engine doesn't track per-lot cost basis. Real delta would reduce reported LTCG by the donated FMV; matching by lot requires H5 asset balance tracking.`,
      `Form 8283 required for non-cash donations > $500 (Section A for items < $5,000; Section B with qualified appraisal for items > $5,000).`,
    ],
    // No whatIf: requires per-lot cost basis (H5) for accurate engine delta.
  };
}

// ── G1.13 — Augusta Rule §280A(g) ─────────────────────────────────────────

const G1_13_MIN_SE_INCOME = 50_000;
const G1_13_MAX_DAYS = 14;
const G1_13_DEFAULT_DAILY_RATE = 1500; // Conservative average for event venues

function detectAugustaRule(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { computed, adjustments, baselineInputs } = args;
  // Must have meaningful business income (SE or K-1 active).
  const netSe = computed.detail.se.netSeEarnings;
  const k1Active = computed.scheduleK1?.totalActiveOrdinaryIncome ?? 0;
  if (netSe < G1_13_MIN_SE_INCOME && k1Active < G1_13_MIN_SE_INCOME) return null;
  // Suppress if CPA has already entered an augusta_rule_rent adjustment.
  const existing = sumAdjustment(adjustments, "augusta_rule_rent");
  if (existing > 0) return null;

  const rentAmount = G1_13_MAX_DAYS * G1_13_DEFAULT_DAILY_RATE;
  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  const estSavings = rentAmount * (fedRate + stateRate);

  // H2 mutation: business deducts rentAmount (above-the-line via the generic
  // "deduction" adjustment); homeowner excludes from income under §280A(g)
  // safe-harbor.
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.13-augusta",
    label: `Augusta Rule rent $${rentAmount.toLocaleString("en-US")}`,
    mutations: [
      {
        kind: "add_adjustment",
        adjustmentType: "deduction",
        amount: rentAmount,
      },
    ],
    semantics: "savings",
    varyAmount: true,
  });

  const strategy = strategyById("G1.13");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    rentAmount,
    dailyRate: G1_13_DEFAULT_DAILY_RATE,
    estSavings: Math.round(estSavings),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(Math.max(netSe, k1Active)))} of business income. The §280A(g) ` +
      `safe-harbor lets a homeowner rent their residence to their business for up to 14 days/year ` +
      `at fair rental rate — business deducts, homeowner excludes from personal income.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      k1ActiveIncome: Math.round(k1Active),
      defaultDailyRate: G1_13_DEFAULT_DAILY_RATE,
      maxDays: G1_13_MAX_DAYS,
      rentAmount,
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
    },
    assumptions: [
      `Default rate $${G1_13_DEFAULT_DAILY_RATE.toLocaleString("en-US")}/day — conservative estimate for a typical residential venue. ACTUAL rate must be FAIR MARKET — document with comparable Airbnb / event-venue listings.`,
      `STRICT 14-day annual limit (§280A(g)(2)) — if even one day over, ALL rental income becomes taxable.`,
      `Each rental day MUST have legitimate business purpose: board meeting, client event, planning retreat, etc. Document with written meeting minutes + agenda.`,
      `Business must actually need the space — IRS challenges sham rentals where no business activity occurs.`,
      `Sensitivity range based on ±10% of the assumed $${rentAmount.toLocaleString("en-US")} annual rent — vary the dailyRate input if comparable venues suggest a different rate.`,
      `Engine models the deduction generically — actual implementation requires a board resolution authorizing the rental and a written rental agreement.`,
    ],
    whatIf,
  };
}

// ── G1.14 — HSA maximization ──────────────────────────────────────────────

const HSA_CAP: Record<TaxYear, { self: number; family: number; catchup55: number }> = {
  2024: { self: 4_150, family: 8_300, catchup55: 1_000 },
  2025: { self: 4_300, family: 8_550, catchup55: 1_000 },
  // TY2026 per Rev. Proc. 2025-19 (§223(b)). $1,000 catch-up is statutory, not indexed.
  2026: { self: 4_400, family: 8_750, catchup55: 1_000 },
};

function detectHsaMax(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, adjustments, baselineInputs } = args;
  // Proxy for HDHP coverage: client has set hsaIsFamilyCoverage (true or
  // false). When null, CPA hasn't gathered HSA data — skip. Detector also
  // skips when there's NO existing hsa_contribution AND the flag is false
  // (probably non-HDHP client who has set the flag to "self" by default).
  // For safety: require explicit "true" OR an existing nonzero contribution
  // (which proves HDHP coverage).
  const existingHsa = sumAdjustment(adjustments, "hsa_contribution");
  const existingEmployer = sumAdjustment(adjustments, "hsa_employer_contribution");
  const isFamily = client.hsaIsFamilyCoverage === true;
  const hasAnyHsa = existingHsa + existingEmployer > 0;
  if (!isFamily && !hasAnyHsa) return null;

  const cfg = HSA_CAP[resolveTaxYear(computed.taxYear)];
  const baseCap = isFamily ? cfg.family : cfg.self;
  const age = client.taxpayerAge ?? 0;
  const catchup = age >= 55 ? cfg.catchup55 : 0;
  const totalCap = baseCap + catchup;
  // §223 employer contribution counts against the cap.
  const remainingRoom = Math.max(0, totalCap - existingHsa - existingEmployer);
  if (remainingRoom <= 0) return null;

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  // HSA is federal + state above-the-line in most states (CA + NJ DO tax
  // HSA — engine handles state-side; for the heuristic we use combined
  // rate as a reasonable upper bound).
  const estSavings = remainingRoom * (fedRate + stateRate);

  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.14-hsa-max",
    label: `Max HSA: add $${remainingRoom.toLocaleString("en-US")}`,
    mutations: [
      {
        kind: "add_adjustment",
        adjustmentType: "hsa_contribution",
        amount: remainingRoom,
      },
    ],
    semantics: "savings",
    varyAmount: true,
  });

  const strategy = strategyById("G1.14");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    contributionGap: remainingRoom,
    cap: totalCap,
    estSavings: Math.round(estSavings),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(existingHsa + existingEmployer)} of HSA contributions vs the ${fmt(totalCap)} ` +
      `${isFamily ? "family" : "self-only"} cap${catchup > 0 ? ` (incl ${fmt(catchup)} age-55 catch-up)` : ""}. ` +
      `Remaining room: ${fmt(remainingRoom)}. HSA contributions are above-the-line, triple-tax-advantaged.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      isFamily,
      taxpayerAge: age,
      cap: totalCap,
      existingHsaContribution: existingHsa,
      existingEmployerContribution: existingEmployer,
      remainingRoom,
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
    },
    assumptions: [
      `§223 cap TY${computed.taxYear}: ${fmt(baseCap)} ${isFamily ? "family" : "self-only"}${catchup > 0 ? ` + ${fmt(catchup)} age-55 catch-up = ${fmt(totalCap)} total` : ""}.`,
      `Employer contributions (W-2 Box 12 code W) count against the cap.`,
      `HDHP coverage required for the full year — pro-rate under §223(b)(8) "last-month rule" with testing period; not modeled here.`,
      `H2 mutation adds hsa_contribution above-the-line — engine reduces AGI by the full amount (CA + NJ slightly different; engine handles).`,
      `Contribution deadline: April 15 of next year (same as IRA).`,
      `Sensitivity range based on ±10% of the remaining room — variations occur if existing employer contribution changes mid-year.`,
    ],
    whatIf,
  };
}

// ── Phase H — H1 catalog v1.3 detectors ──────────────────────────────────

const LTCG_RATE_DEFAULT = 0.15;

function sumAssetBalance(assets: AssetBalanceFact[] | undefined, type: string): number {
  if (!assets) return 0;
  return assets
    .filter((a) => a.assetType === type)
    .reduce((s, a) => s + toNum(a.balance), 0);
}

function sumAssetCostBasis(assets: AssetBalanceFact[] | undefined, type: string): number {
  if (!assets) return 0;
  return assets
    .filter((a) => a.assetType === type)
    .reduce((s, a) => s + toNum(a.costBasis), 0);
}

// ── G1.15 — NUA (Net Unrealized Appreciation) on employer stock ──────────

const G1_15_MIN_STOCK_BALANCE = 50_000;

function detectNua(args: {
  computed: ComputedTaxReturn;
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { computed, assetBalances } = args;
  if (!assetBalances || assetBalances.length === 0) return null;
  // Only NUA-eligible employer stock rows in the 401(k) qualify.
  const nuaStock = assetBalances.filter(
    (a) => a.assetType === "employer_stock_in_401k" && a.nuaEligible === true,
  );
  if (nuaStock.length === 0) return null;
  const fmv = nuaStock.reduce((s, a) => s + toNum(a.balance), 0);
  const costBasis = nuaStock.reduce((s, a) => s + toNum(a.costBasis), 0);
  if (fmv < G1_15_MIN_STOCK_BALANCE) return null;
  // Need NUA (FMV > costBasis); if costBasis missing/zero, assume 30% basis as default.
  const effectiveBasis = costBasis > 0 ? costBasis : fmv * 0.30;
  const nuaAmount = fmv - effectiveBasis;
  if (nuaAmount <= 0) return null;

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  // Strategy savings: NUA is taxed at LTCG (15-20%) when sold, vs ordinary
  // (marginal) if rolled to IRA and distributed later.
  const estSavings = nuaAmount * (fedRate + stateRate - LTCG_RATE_DEFAULT);
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.15");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    costBasis: Math.round(effectiveBasis),
    nuaAmount: Math.round(nuaAmount),
    estSavings: Math.round(estSavings),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client holds ${fmt(Math.round(fmv))} of NUA-eligible employer stock in their 401(k) ` +
      `with ${fmt(Math.round(effectiveBasis))} cost basis (${fmt(Math.round(nuaAmount))} of ` +
      `unrealized appreciation). Lump-sum in-kind distribution + LTCG sale saves vs ordinary ` +
      `rollover-then-distribute.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      fmv: Math.round(fmv),
      costBasis: Math.round(effectiveBasis),
      nuaAmount: Math.round(nuaAmount),
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
      ltcgRateAssumed: LTCG_RATE_DEFAULT,
    },
    assumptions: [
      `Strategy requires a TRIGGERING EVENT: separation from service, age 59½, death, or disability.`,
      `Entire qualified plan must be distributed in ONE tax year (Form 1099-R "lump sum distribution").`,
      `Cost basis from plan statement; engine assumes 30% of FMV when missing.`,
      `LTCG rate assumed at ${(LTCG_RATE_DEFAULT * 100).toFixed(0)}% (0% for taxable < $47,025 single TY2024; 20% > $518,900). CPA refines.`,
      `Ordinary tax on cost basis is paid immediately (out-of-pocket). Client needs liquidity for that.`,
      `H2 verification deferred — engine doesn't model the in-kind distribution / per-share basis. Heuristic estSavings uses marginal − LTCG spread.`,
    ],
    // No whatIf — needs per-share basis tracking + lump-sum distribution
    // semantics the engine doesn't yet model.
  };
}

// ── G1.16 — Mega-Backdoor Roth ───────────────────────────────────────────

const G1_16_415C_LIMIT: Record<TaxYear, number> = {
  2024: 69_000,
  2025: 70_000,
  2026: 72_000, // Notice 2025-67 / IR-2025-111
};
const G1_16_402G_ELECTIVE: Record<TaxYear, number> = {
  2024: 23_000,
  2025: 23_500,
  2026: 24_500, // IR-2025-111 (401(k) elective deferral)
};

function detectMegaBackdoorRoth(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { computed, adjustments, assetBalances } = args;
  if (!assetBalances || assetBalances.length === 0) return null;
  // Presence of a 401k_after_tax row signals: plan permits after-tax + in-
  // service rollover/conversion. Detector fires when there's measurable
  // headroom (the §415(c) total annual additions cap minus the elective
  // deferral cap minus employer match).
  const afterTaxAsset = assetBalances.find((a) => a.assetType === "401k_after_tax");
  if (!afterTaxAsset) return null;

  const cap415c = G1_16_415C_LIMIT[resolveTaxYear(computed.taxYear)];
  const electiveCap = G1_16_402G_ELECTIVE[resolveTaxYear(computed.taxYear)];
  // Assume employee elective contribution = full $23k elective cap (most
  // high-comp clients in this scenario are maxing). Assume employer match
  // ≈ 5% of W-2 wages (reasonable cohort assumption).
  const w2Wages = computed.totalIncome > 0 ? computed.totalIncome * 0.7 : 0; // rough
  const assumedEmployerMatch = Math.min(w2Wages * 0.05, cap415c * 0.5);
  const headroom = Math.max(0, cap415c - electiveCap - assumedEmployerMatch);
  if (headroom < 5_000) return null;
  const existingAfterTax = toNum(afterTaxAsset.balance);
  const contribution = Math.max(0, headroom - existingAfterTax);
  if (contribution < 5_000) return null;

  // Heuristic estSavings: future-tax-free growth × assumed future rate.
  // Use 7%/yr growth × 20 years horizon × 32% future rate, discounted to
  // present value at 5%. PV ≈ contribution × (1.07^20 - 1) × 0.32 / (1.05^20).
  const growth = Math.pow(1.07, 20);
  const futureRate = 0.32;
  const discount = Math.pow(1.05, 20);
  const taxFreeGrowth = contribution * (growth - 1);
  const estSavings = (taxFreeGrowth * futureRate) / discount;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.16");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  void adjustments; // unused — reserved for future per-adjustment detection
  const vars: Record<string, number | string> = {
    contribution: Math.round(contribution),
    estSavings: Math.round(estSavings),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client's 401(k) plan accepts after-tax contributions and permits in-service rollover or ` +
      `in-plan Roth conversion (H5 record present). §415(c) cap ${fmt(cap415c)} for TY${computed.taxYear} ` +
      `− elective deferrals ${fmt(electiveCap)} − assumed employer match ~${fmt(Math.round(assumedEmployerMatch))} ` +
      `= ${fmt(Math.round(contribution))} of mega-backdoor Roth headroom.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      cap415c,
      electiveCap,
      assumedEmployerMatch: Math.round(assumedEmployerMatch),
      existingAfterTax: Math.round(existingAfterTax),
      headroom: Math.round(headroom),
      contribution: Math.round(contribution),
      growthAssumption: 0.07,
      futureRateAssumption: futureRate,
      discountRate: 0.05,
      horizonYears: 20,
    },
    assumptions: [
      `§415(c) total annual additions cap ${fmt(cap415c)} for TY${computed.taxYear}.`,
      `§402(g) elective deferral cap ${fmt(electiveCap)} assumed maxed (most clients at this AGI level are).`,
      `Employer match estimated at 5% of approximated W-2 wages — refine with actual plan terms.`,
      `Long-term benefit assumes 7% growth × 20 years × 32% future tax rate, discounted at 5%/yr.`,
      `Strategy REQUIRES plan document permitting after-tax contributions AND in-service rollover OR in-plan Roth conversion. Confirm via plan summary plan description (SPD).`,
      `Notice 2014-54 governs the tax-free / taxable split when rolling out — direct rollover to Roth IRA is cleanest.`,
      `H2 verification deferred — requires future-year projection of growth + distribution (H3 multi-year primitive in place but not wired yet).`,
    ],
  };
}

// ── G1.17 — S-corp reasonable compensation split ─────────────────────────

const G1_17_MIN_S_CORP_INCOME = 50_000;
const G1_17_REASONABLE_COMP_PCT = 0.40; // assumption: 40% wages, 60% distributions
const G1_17_FICA_TOTAL = 0.153; // 6.2% SS + 1.45% Medicare, both sides

function detectScorpReasonableComp(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { client, computed, adjustments } = args;
  void client; // unused — reserved for future spouse-attribution
  const k1Summary = computed.scheduleK1;
  if (!k1Summary) return null;
  // FALSE-POSITIVE FIX (2026-06-04 detector audit): this strategy applies ONLY to
  // S-CORPORATIONS. The reasonable-comp / wage-vs-distribution lever (Rev. Rul.
  // 74-44) does not exist for a partnership or active LLC member — a partner
  // cannot be a W-2 employee of their own partnership (Rev. Rul. 69-184) and their
  // distributive share is already fully SE-taxed. `totalActiveOrdinaryIncome` pools
  // active partnership + S-corp Box 1, so gate on actual S-corp presence (mirrors
  // the §1377 G1.95 guard) or this fires for partnership-only clients.
  if ((k1Summary.sCorpCount ?? 0) < 1) return null;
  // Estimate S-corp income from active K-1 ordinary income. The engine
  // doesn't currently track per-K-1 entity type cleanly in summary, so we
  // use totalActiveOrdinaryIncome as proxy (assumes most active income
  // comes from S-corp for clients where this matters).
  const sCorpIncome = k1Summary.totalActiveOrdinaryIncome ?? 0;
  if (sCorpIncome < G1_17_MIN_S_CORP_INCOME) return null;

  // DATA-DRIVEN (PLAN): reasonable comp is a facts-and-circumstances figure (Rev.
  // Rul. 74-44; the IRS weighs role, hours, comparable wages — what an RC Reports /
  // BLS OES study produces). When the CPA supplies the benchmarked figure via the
  // `scorp_reasonable_comp` adjustment, use it; otherwise fall back to the rough
  // 40%-of-profit placeholder (NOT a substitute for a real comp study).
  const cpaReasonableComp = sumAdjustment(adjustments, "scorp_reasonable_comp");
  const reasonableCompIsBenchmarked = cpaReasonableComp > 0;
  const reasonableComp = reasonableCompIsBenchmarked
    ? Math.min(cpaReasonableComp, sCorpIncome) // comp can't exceed the available profit
    : sCorpIncome * G1_17_REASONABLE_COMP_PCT;
  const distributions = Math.max(0, sCorpIncome - reasonableComp);
  // PLAN-07: the FICA saved by taking distributions instead of wages is the
  // 12.4% SS portion ONLY on distributions up to the wage base REMAINING after
  // reasonable-comp wages already consume it, plus 2.9% Medicare (uncapped) on
  // all distributions. When reasonable comp >= the wage base, SS savings is $0
  // (only Medicare is saved) — the old "15.3% × min(dist, wageBase)" overstated
  // savings by the full 12.4% SS portion for high-comp owners.
  const SS_RATE = 0.124;
  const MED_RATE = 0.029;
  const ssWageBase = SS_WAGE_BASE[resolveTaxYear(computed.taxYear)];
  const ssBaseRemaining = Math.max(0, ssWageBase - reasonableComp);
  const ssSavings = Math.min(distributions, ssBaseRemaining) * SS_RATE;
  const medSavings = distributions * MED_RATE;
  const estSavings = ssSavings + medSavings;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.17");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    reasonableComp: Math.round(reasonableComp),
    distributions: Math.round(distributions),
    estSavings: Math.round(estSavings),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Active S-corp K-1 income of ${fmt(Math.round(sCorpIncome))}. Splitting between W-2 wages ` +
      `(FICA-subject) and distributions (FICA-exempt) saves ~${fmt(Math.round(estSavings))} in ` +
      `FICA tax — but reasonable comp must be defensible (RC Reports / BLS benchmarks).`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      sCorpIncome: Math.round(sCorpIncome),
      reasonableComp: Math.round(reasonableComp),
      reasonableCompIsBenchmarked: reasonableCompIsBenchmarked ? 1 : 0,
      distributions: Math.round(distributions),
      ssSavings: Math.round(ssSavings),
      medSavings: Math.round(medSavings),
      ficaRate: G1_17_FICA_TOTAL,
    },
    assumptions: [
      reasonableCompIsBenchmarked
        ? `Reasonable comp = the CPA-supplied benchmarked figure (${fmt(Math.round(reasonableComp))}, via scorp_reasonable_comp) — an RC Reports / BLS OES study result, not the rough default.`
        : `Reasonable comp uses the rough 40%-of-profit PLACEHOLDER — supply the benchmarked figure via the scorp_reasonable_comp adjustment (RC Reports / BLS OES) for a defensible estimate.`,
      `SS portion (12.4%) applies only to distributions up to the ${fmt(ssWageBase)} TY${computed.taxYear} wage base REMAINING after reasonable comp; Medicare (2.9%) on all distributions. When comp >= the wage base, only Medicare is saved.`,
      `Rev. Rul. 74-44 + Mike v. Comm'r line of cases: distributions can be recharacterized as wages if comp is unreasonably low — leading IRS audit issue.`,
      `K-1 income assumed to be from S-corp (engine doesn't yet differentiate entity types in summary). CPA verifies on K-1 box 1 + Schedule K-1 line A.`,
      `H2 verification deferred — engine would need to model W-2 box 3/5 + FICA tax pipeline for the W-2 portion; current proxy is acceptable for planning estimates.`,
    ],
  };
}

// ── G1.18 — REPS (Real Estate Professional Status) election §469(c)(7) ───

function detectRepsElection(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { client, computed } = args;
  // Don't fire if client is already flagged as real estate professional.
  if (client.rentalRealEstateProfessional === true) return null;

  // Need suspended passive losses to make REPS worthwhile.
  const suspendedPal = computed.passiveActivityLoss?.suspendedToNextYear ?? 0;
  if (suspendedPal <= 0) return null;

  // REPS requires >50% of work time in real estate + 750+ hours. Most
  // clients with significant non-real-estate W-2 won't qualify. Suppress
  // for those.
  const totalIncome = computed.totalIncome ?? 0;
  // scheduleERentalGrossNet is a NUMBER (net rental income post-MACRS, not
  // an object). Used here just as a proxy signal that the client has real
  // estate activity.
  const rentalRelated = Math.abs(computed.scheduleERentalGrossNet ?? 0);
  // If non-rental income > $200k it's hard to satisfy >50% time test.
  if (totalIncome - rentalRelated > 200_000) return null;

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  const estSavings = suspendedPal * (fedRate + stateRate);
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.18");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    suspendedPal: Math.round(suspendedPal),
    estSavings: Math.round(estSavings),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(suspendedPal))} of suspended §469 passive losses. Electing ` +
      `REPS under §469(c)(7) (with material participation) converts losses to NON-passive — they ` +
      `offset W-2/SE income immediately rather than carry forward.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      suspendedPal: Math.round(suspendedPal),
      nonRentalIncome: Math.round(totalIncome - rentalRelated),
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
    },
    assumptions: [
      `REPS qualification (IRC §469(c)(7)) requires BOTH (1) more than 50% of personal services in real-property trade or business AND (2) more than 750 hours per year.`,
      `Material participation in EACH rental activity (or aggregate via §1.469-9(g) election covering ALL interests in rental real estate).`,
      `IRS scrutinizes time logs — contemporaneous calendars, board minutes, and activity logs are required. Backfilled time sheets get challenged.`,
      `Engine's suspendedPal value reflects the current year's PAL carryforward — actual REPS-recoverable amount depends on lookback to prior years too.`,
      `H2 mutation is "set rentalRealEstateProfessional = true" — but the engine's §469 calc happens before suspension, so a simple mutation would over-estimate by also recovering prior-year PAL that wouldn't immediately materialize. Detection-only.`,
    ],
  };
}

// ── G1.19 — Charitable Remainder Trust (CRT) — informational ─────────────

function detectCrtFramework(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  // Heuristic informational trigger: high AGI + significant capital gains
  // suggests appreciated assets potentially suitable for CRT.
  if (computed.adjustedGrossIncome < 500_000) return null;
  const ltcg = computed.form1099Summary?.longTermCapitalGains ?? 0;
  const charitableCash = sumAdjustment(adjustments, "charitable_cash");
  if (ltcg < 100_000 && charitableCash < 25_000) return null;

  // Heuristic estSavings: assume CRT shelters $X of cap gains at 23.8%
  // (LTCG + NIIT), where X = min(ltcg, $500k) — conservative.
  const sheltered = Math.min(ltcg, 500_000);
  const estSavings = sheltered * 0.238;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.19");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    estSavings: Math.round(estSavings),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(ltcg))} of long-term cap gains and ` +
      `${fmt(Math.round(charitableCash))} of charitable giving + AGI > $500k. A CRT (CRAT or CRUT) ` +
      `could shelter the cap gains, provide an income stream, AND deliver an immediate charitable ` +
      `deduction. Informational only — full design requires trust attorney + §7520 actuarial analysis.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(computed.adjustedGrossIncome),
      ltcg: Math.round(ltcg),
      charitableCash: Math.round(charitableCash),
      shelteredAssumption: Math.round(sheltered),
    },
    assumptions: [
      `INFORMATIONAL detector — fires for highly-appreciated-asset + high-AGI clients. CPA evaluates suitability.`,
      `CRT is IRREVOCABLE — once funded, the asset can't be retrieved.`,
      `Two structures: CRAT (fixed annuity, 5-50% of initial FMV) and CRUT (% of annually-revalued FMV).`,
      `§7520 rate (Applicable Federal Rate, updated monthly) drives PV of remainder interest — affects current-year deduction.`,
      `Remainder beneficiary must be a 501(c)(3) public charity (NOT a DAF or private foundation in most cases).`,
      `Term limits: max 20 years (lifetime annuity for ≥1 life). Charity must receive at LEAST 10% of initial FMV.`,
      `Full execution requires trust attorney (3-6 months) and actuarial valuation. Engine cannot model this; estSavings is a rough upper bound.`,
    ],
  };
}

// ── G1.20 — Conservation easement (with high audit risk warning) ─────────

function detectConservationEasement(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  void adjustments;
  // Heuristic informational trigger: very-high-AGI client (>$1M) with real
  // estate holdings is the typical conservation-easement candidate.
  if (computed.adjustedGrossIncome < 1_000_000) return null;
  // Need to have real estate income — proxy via Schedule E net (engine
  // exposes net, not gross). Use absolute value since losses count too.
  const rentalGross = Math.abs(computed.scheduleERentalGrossNet ?? 0);
  if (rentalGross < 50_000) return null;

  // Heuristic estSavings: very rough — assume deduction = 30% of AGI cap,
  // at 37% marginal. Real value depends on appraisal.
  const deductionEstimate = computed.adjustedGrossIncome * 0.30;
  const estSavings = deductionEstimate * 0.37;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.20");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    estSavings: Math.round(estSavings),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `**HIGH IRS AUDIT RISK STRATEGY.** Client AGI ${fmt(Math.round(computed.adjustedGrossIncome))} + real ` +
      `estate ${fmt(Math.round(rentalGross))} suggests potential suitability. Notice 2017-10 designates ` +
      `syndicated conservation easements as LISTED TRANSACTIONS. Single-property non-syndicated ` +
      `easements have less risk but still face high IRS scrutiny.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(computed.adjustedGrossIncome),
      rentalGross: Math.round(rentalGross),
      deductionEstimate: Math.round(deductionEstimate),
    },
    assumptions: [
      `**⚠️ HIGH AUDIT RISK** — Notice 2017-10 designates syndicated conservation easements as LISTED TRANSACTIONS subject to disclosure + penalty. SECURE 2.0 Section 605 imposed a 4:1 maximum-deduction-to-investment ratio for syndicated deals.`,
      `Single-property easements (client owns suitable land) have less risk but still face heightened IRS scrutiny.`,
      `Qualified appraisal under §170(h)(1)(A) — appraiser must specialize in conservation easements.`,
      `Perpetuity requirement — easement runs with the land forever. Affects future sale value.`,
      `Recipient organization must be a "qualified organization" (typically a land trust accredited by the Land Trust Accreditation Commission).`,
      `Heuristic estSavings is a CEILING — actual deduction depends on appraisal, qualified organization, and 50% / 30% AGI limits with 15-year carryforward.`,
      `STRONGLY suggest pre-filing review by experienced tax counsel.`,
    ],
  };
}

// ── G1.21 — §1031 like-kind exchange timing ──────────────────────────────

function detectSection1031Timing(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  // Skip if client already used §1031 this year (recognized via the adjustment).
  if (sumAdjustment(adjustments, "section_1031_realized_gain") > 0) return null;
  // Trigger: meaningful rental income AND high total income (so the tax
  // hit on a future sale would be material).
  const rentalRelated = Math.abs(computed.scheduleERentalGrossNet ?? 0);
  if (rentalRelated < 100_000) return null;
  if (computed.totalIncome < 200_000) return null;

  // Heuristic: assume avg replacement gain ~$250k, deferral worth
  // (LTCG 0.20 + NIIT 0.038) × 0.5 (time-value proxy).
  const ASSUMED_GAIN = 250_000;
  const DEFERRAL_RATE = (0.20 + 0.038) * 0.5;
  const estSavings = Math.round(ASSUMED_GAIN * DEFERRAL_RATE);

  const strategy = strategyById("G1.21");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(rentalRelated))} of rental activity at total income ` +
      `${fmt(Math.round(computed.totalIncome))}. On a future sale, structuring as a §1031 ` +
      `like-kind exchange via a Qualified Intermediary can defer ordinary cap gain — ` +
      `estimated benefit on a hypothetical $250k gain ~${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      rentalGrossNet: Math.round(rentalRelated),
      totalIncome: Math.round(computed.totalIncome),
      assumedGain: ASSUMED_GAIN,
      deferralRate: DEFERRAL_RATE,
    },
    assumptions: [
      `Heuristic — assumes hypothetical $250k replacement gain. Real value depends on the specific property sale + replacement.`,
      `Deferral value modeled as (20% LTCG + 3.8% NIIT) × 0.5 time-value factor.`,
      `Strict timelines: 45 days to identify replacement, 180 days to close (IRC §1031(a)(3)).`,
      `Engine does NOT model §1031 itself here — fires as a heuristic prompt. C5 engine support computes recognized/deferred from section_1031_realized_gain + section_1031_boot_received adjustments when the CPA enters them.`,
      `Post-TCJA: §1031 limited to REAL property only. Personal property exchanges no longer qualify.`,
    ],
  };
}

// ── G1.22 — Pre-RMD Roth conversion ladder (age 60-72) ───────────────────

const G1_22_LADDER_MIN_AGE = 60;
const G1_22_LADDER_MAX_AGE = 72;
const G1_22_MIN_TRAD_IRA_BALANCE = 500_000;
const G1_22_MAX_MARGINAL = 0.32;

function detectPreRmdRothLadder(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { client, computed, assetBalances } = args;
  const age = client.taxpayerAge;
  if (age == null) return null;
  if (age < G1_22_LADDER_MIN_AGE || age > G1_22_LADDER_MAX_AGE) return null;

  const fedRate = federalMarginalRate(computed);
  if (fedRate >= G1_22_MAX_MARGINAL) return null;

  // H5: aggregate traditional + SEP + SIMPLE IRA balances.
  if (!assetBalances || assetBalances.length === 0) return null;
  const tradTypes = new Set(["traditional_ira", "sep_ira", "simple_ira"]);
  const tradBalance = assetBalances
    .filter((a) => tradTypes.has(a.assetType))
    .reduce((s, a) => s + toNum(a.balance), 0);
  if (tradBalance < G1_22_MIN_TRAD_IRA_BALANCE) return null;

  // Heuristic: convert ~bracket headroom each year for (73 − age) years.
  const { breakdown } = calculateFederalTaxWithBreakdown(
    computed.taxableIncome,
    computed.filingStatus,
    computed.taxYear,
  );
  if (breakdown.length === 0) return null;
  const currentBracket = breakdown[breakdown.length - 1];
  const headroom = Number.isFinite(currentBracket.bracketMax)
    ? Math.max(0, currentBracket.bracketMax - computed.taxableIncome)
    : 0;
  const annualConversion = Math.max(20_000, Math.min(headroom, 100_000));
  const ladderYears = 73 - age;
  const totalConversion = Math.min(tradBalance, annualConversion * ladderYears);
  // Future RMD-age rate proxy: top of current bracket + 1 (move up one
  // bracket). Conservative spread: 4%.
  const RMD_RATE_SPREAD = 0.04;
  const estSavings = Math.round(totalConversion * RMD_RATE_SPREAD);
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.22");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    annualConversion: Math.round(annualConversion),
    topRate: `${Math.round(fedRate * 100)}%`,
    totalConversion: Math.round(totalConversion),
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client age ${age} with ${fmt(Math.round(tradBalance))} of pre-tax IRA balance at a ` +
      `${(fedRate * 100).toFixed(0)}% marginal rate has ${ladderYears} years until RMD age 73. ` +
      `A Roth conversion ladder of ~${fmt(Math.round(annualConversion))}/year ` +
      `reduces the RMD base by ~${fmt(Math.round(totalConversion))}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      taxpayerAge: age,
      tradIraBalance: Math.round(tradBalance),
      federalMarginalRate: fedRate,
      bracketHeadroom: Math.round(headroom),
      annualConversion: Math.round(annualConversion),
      ladderYears,
      totalConversion: Math.round(totalConversion),
      assumedRateSpread: RMD_RATE_SPREAD,
    },
    assumptions: [
      `Pre-RMD Roth conversion ladder reduces FUTURE RMD income at projected higher tax rates.`,
      `Heuristic spread of 4% (one bracket up) between current rate and projected RMD-age rate.`,
      `Annual conversion sized to fill current bracket OR $20k-$100k range — CPA refines based on tax-cost cash flow.`,
      `SECURE 2.0 raised RMD age to 73 (TY2023) and to 75 (TY2033+) per IRC §401(a)(9). Engine uses age 73.`,
      `Conversion tax should be paid from NON-IRA funds to maximize Roth balance growth (IRA dollars used for tax = double-tax effect).`,
      `H6 Form 8606 §408(d)(2) pro-rata rule applies if client has any after-tax IRA basis.`,
    ],
  };
}

// ── G1.23 — Cost segregation study ───────────────────────────────────────

const G1_23_MIN_RENTAL_GROSS = 100_000;
const G1_23_MIN_MARGINAL = 0.24;
const G1_23_ACCELERATED_FRACTION = 0.25;
const G1_23_BONUS_RATE: Record<TaxYear, number> = {
  2024: 0.60,
  2025: 0.40,
  // OBBBA (§70301) restored 100% bonus depreciation for property placed in
  // service after 2025-01-19 — matches the core engine's BONUS_DEPR_RATES.
  2026: 1.0,
};

function detectCostSegregation(args: {
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { computed } = args;
  const rentalGross = Math.abs(computed.scheduleERentalGrossNet ?? 0);
  if (rentalGross < G1_23_MIN_RENTAL_GROSS) return null;
  const fedRate = federalMarginalRate(computed);
  if (fedRate < G1_23_MIN_MARGINAL) return null;
  const bonusRate = G1_23_BONUS_RATE[resolveTaxYear(computed.taxYear)];

  // estSavings = rentalGross × 0.25 (accelerated portion) × bonus × marginal
  const acceleratedBasis = rentalGross * G1_23_ACCELERATED_FRACTION;
  const yearOneBonusDep = acceleratedBasis * bonusRate;
  const estSavings = Math.round(yearOneBonusDep * fedRate);
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.23");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    taxYear: computed.taxYear,
    bonusPct: Math.round(bonusRate * 100),
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Rental activity gross/net ${fmt(Math.round(rentalGross))} at ${(fedRate * 100).toFixed(0)}% ` +
      `marginal rate. A cost-segregation study can reclassify ~25% of property basis to 5/7/15-year ` +
      `buckets eligible for ${Math.round(bonusRate * 100)}% bonus depreciation in TY${computed.taxYear}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      rentalGross: Math.round(rentalGross),
      federalMarginalRate: fedRate,
      acceleratedFraction: G1_23_ACCELERATED_FRACTION,
      bonusRate,
      acceleratedBasis: Math.round(acceleratedBasis),
      yearOneBonusDep: Math.round(yearOneBonusDep),
    },
    assumptions: [
      `Heuristic — ~25% of property basis assumed reclassifiable to short-life buckets via cost-seg study. Real % varies (15-30% typical).`,
      `TY${computed.taxYear} bonus depreciation rate: ${Math.round(bonusRate * 100)}% (phased down from 100% TY2022 per TCJA).`,
      `Requires engineering-based cost-seg study from a qualified provider (Marshall & Stevens, KBKG, etc.).`,
      `For PRIOR-year properties, Form 3115 §481(a) catch-up adjustment recoups missed depreciation in one year (no need to amend).`,
      `Recapture: short-life property recaptures as ordinary income on sale — but typically client benefits from 5-10 years of accelerated deduction first.`,
      `H2 verification deferred — engine doesn't model per-property cost-seg breakdown.`,
    ],
  };
}

// ── G1.24 — Qualified Opportunity Zone investment ────────────────────────

const G1_24_MIN_CAP_GAINS = 100_000;

function detectOpportunityZone(args: {
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { computed } = args;
  const ltcg = computed.form1099Summary?.longTermCapitalGains ?? 0;
  const stcg = computed.form1099Summary?.shortTermCapitalGains ?? 0;
  const totalGains = ltcg + stcg;
  if (totalGains < G1_24_MIN_CAP_GAINS) return null;

  // Heuristic: defer ALL eligible gains. Value = deferred_amount × (LTCG +
  // NIIT) × time-value 0.3 + long-term tax-free upside (assume 5x growth
  // over 10 yrs, taxable at LTCG ≈ 30% × gain × 0 = 0 after step-up,
  // discounted at 5%). Simplified to deferral-side only for MVP.
  const DEFERRAL_VALUE = (0.20 + 0.038) * 0.3;
  const estSavings = Math.round(totalGains * DEFERRAL_VALUE);
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.24");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    deferredGain: Math.round(totalGains),
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(totalGains))} of realized capital gains this year. Rolling the ` +
      `gain into a Qualified Opportunity Fund within 180 days defers tax until 2026-12-31 + provides ` +
      `tax-free QOF appreciation after 10-year hold (IRC §1400Z-2).`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      longTermCapitalGains: Math.round(ltcg),
      shortTermCapitalGains: Math.round(stcg),
      totalGains: Math.round(totalGains),
      deferralValueRate: DEFERRAL_VALUE,
    },
    assumptions: [
      `Heuristic deferral value = (LTCG 0.20 + NIIT 0.038) × 0.3 time-value factor.`,
      `Long-term appreciation upside (step-up after 10 years) NOT modeled — varies wildly by QOF performance.`,
      `STRICT 180-day window from realization date to QOF investment.`,
      `OBBBA (P.L. 119-21) made the OZ program PERMANENT ("OZ 2.0"): gains invested on/before 2026-12-31 keep the ORIGINAL statutory recognition date of 2026-12-31 (near-zero deferral value for late-2026 investments); investments AFTER 2026-12-31 get a ROLLING 5-YEAR deferral (recognized at the earlier of sale or the 5th anniversary) + a 10% basis step-up (30% for rural QOFs) at year 5.`,
      `OZ 2.0 zone designations are DECENNIAL (every 10 years starting 7/1/2026, effective 1/1/2027; tightened low-income criteria — current zones remain usable through 2028-12-31). For a gain realized NOW, weigh deferring the investment into the post-2026 regime against the 180-day clock.`,
      `QOF must invest ≥ 90% of assets in a Qualified Opportunity Zone (audited semi-annually).`,
      `H2 verification deferred — engine doesn't model QOF deferral or 10-year basis step-up.`,
    ],
  };
}

// ── G1.26 — Backdoor Roth IRA (high-income filer) ────────────────────────

// Roth IRA MAGI phase-out TOP (above this, no direct contribution is allowed →
// the backdoor route applies). YEAR-INDEXED (was a single TY2024-only map, which
// produced a FALSE POSITIVE for TY2025/2026 clients whose AGI sat between the
// stale TY2024 top and the true current-year top — they were told "above the
// phase-out, do a backdoor" when they could still contribute directly).
// Notice 2024-80 (TY2025) / Rev. Proc. 2025-32 (TY2026). MFS top is the
// statutory un-indexed $10k (lived-with-spouse).
const G1_26_ROTH_PHASEOUT_TOP: Record<TaxYear, Record<string, number>> = {
  2024: { single: 161_000, head_of_household: 161_000, married_filing_jointly: 240_000, qualifying_widow: 240_000, married_filing_separately: 10_000 },
  2025: { single: 165_000, head_of_household: 165_000, married_filing_jointly: 246_000, qualifying_widow: 246_000, married_filing_separately: 10_000 },
  2026: { single: 168_000, head_of_household: 168_000, married_filing_jointly: 252_000, qualifying_widow: 252_000, married_filing_separately: 10_000 },
};
// IRA contribution limit (§219(b)) + 50+ catch-up (§219(b)(5)(B), indexed by
// SECURE 2.0 §108 from 2024). 2026 per IRS Notice 2025-67: base $7,500,
// catch-up $1,100 -> $8,600 total for age 50+.
const G1_26_IRA_CAP_BASE: Record<TaxYear, number> = { 2024: 7_000, 2025: 7_000, 2026: 7_500 };
const G1_26_IRA_CAP_CATCHUP: Record<TaxYear, number> = { 2024: 8_000, 2025: 8_000, 2026: 8_600 };

function detectBackdoorRoth(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { client, computed, adjustments, assetBalances } = args;
  // AGI must exceed the direct-Roth contribution phase-out TOP for the return's
  // tax year (year-indexed so a TY2025/2026 client inside the current band is not
  // wrongly told to use the backdoor when a direct contribution is still allowed).
  const topsForYear = G1_26_ROTH_PHASEOUT_TOP[resolveTaxYear(computed.taxYear)];
  const phaseOutTop = topsForYear[client.filingStatus] ?? topsForYear.single;
  if (computed.adjustedGrossIncome <= phaseOutTop) return null;

  // Skip if client already has a nondeductible IRA contribution this year
  // (indicates the strategy is already in motion).
  if (sumAdjustment(adjustments, "nondeductible_ira_contribution") > 0) return null;

  // Check pro-rata trap: if pre-tax IRA balance > nominal cutoff, flag
  // but still fire (with louder caveat). H5 traditional/SEP/SIMPLE balance.
  const tradTypes = new Set(["traditional_ira", "sep_ira", "simple_ira"]);
  const preTaxBalance = (assetBalances ?? [])
    .filter((a) => tradTypes.has(a.assetType))
    .reduce((s, a) => s + toNum(a.balance), 0);
  const proRataTrap = preTaxBalance > 1_000;

  const age = client.taxpayerAge ?? 0;
  const contribAmount =
    (age >= 50 ? G1_26_IRA_CAP_CATCHUP : G1_26_IRA_CAP_BASE)[resolveTaxYear(computed.taxYear)];
  // Long-term benefit similar to G1.16: 7%/yr growth × 20 yrs × 32%
  // future rate, discounted at 5%. PV = contrib × (1.07^20 - 1) × 0.32 / 1.05^20.
  const growth = Math.pow(1.07, 20);
  const discount = Math.pow(1.05, 20);
  const taxFreeGrowth = contribAmount * (growth - 1);
  const estSavings = Math.round((taxFreeGrowth * 0.32) / discount);

  const strategy = strategyById("G1.26");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    contributionAmount: contribAmount,
    estSavings,
  };
  const proRataWarning = proRataTrap
    ? ` ⚠ Pre-tax IRA balance of ${fmt(Math.round(preTaxBalance))} triggers §408(d)(2) pro-rata trap (see H6 Form 8606) — most of the conversion would be taxable. Consider rolling pre-tax to 401(k) first.`
    : "";
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: proRataTrap ? Math.max(0.4, strategy.confidence - 0.3) : strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `AGI ${fmt(Math.round(computed.adjustedGrossIncome))} exceeds the direct-Roth phase-out top ` +
      `${fmt(phaseOutTop)} for ${client.filingStatus}. A backdoor Roth (nondeductible IRA + immediate ` +
      `conversion) lets the client add ${fmt(contribAmount)} of after-tax dollars per year.` +
      proRataWarning,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(computed.adjustedGrossIncome),
      phaseOutTop,
      taxpayerAge: age,
      contribAmount,
      preTaxIraBalance: Math.round(preTaxBalance),
      proRataTrap,
      growthAssumption: 0.07,
      futureRateAssumption: 0.32,
      discountRate: 0.05,
      horizonYears: 20,
    },
    assumptions: [
      `IRA contribution cap TY2024: $7k base / $8k age 50+ (IRC §219(b); Notice 2023-75).`,
      `Roth direct-contribution phase-out top: $${phaseOutTop.toLocaleString("en-US")} for filing status ${client.filingStatus} (Pub 590-A TY2024).`,
      proRataTrap
        ? `⚠ Client has $${Math.round(preTaxBalance).toLocaleString("en-US")} pre-tax IRA balance — §408(d)(2) pro-rata trap applies. Most of the conversion would be taxable. Consider rolling pre-tax to 401(k) first (employer plans escape aggregation).`
        : `Pre-tax IRA balance is $0 (or nominal) — clean backdoor Roth with 100% tax-free conversion per §408(d)(2).`,
      `Long-term benefit assumed at 7%/yr growth × 20 yrs × 32% future rate, discounted at 5%/yr.`,
      `Form 8606 REQUIRED for both the nondeductible contribution (Part I) AND the conversion (Part II).`,
      `Annual recurring — repeat each year while AGI remains above the phase-out.`,
    ],
  };
}

// ── G1.27 — Inherited IRA 10-year rule (heuristic informational) ──────────

const G1_27_MIN_TRAD_IRA = 50_000;
const G1_27_MAX_AGE = 60;
const G1_27_TIMING_BENEFIT = 0.05;

function detectInheritedIra(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { client, computed, assetBalances } = args;
  const age = client.taxpayerAge;
  // Heuristic: typical inheritance-recipient profile is non-retiree age.
  // Suppress for clients > 60 (likely their own retirement IRA).
  if (age == null || age >= G1_27_MAX_AGE) return null;
  if (!assetBalances || assetBalances.length === 0) return null;
  const tradBalance = assetBalances
    .filter((a) => a.assetType === "traditional_ira")
    .reduce((s, a) => s + toNum(a.balance), 0);
  if (tradBalance < G1_27_MIN_TRAD_IRA) return null;

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  const estSavings = Math.round(tradBalance * (fedRate + stateRate) * G1_27_TIMING_BENEFIT);
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.27");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client age ${age} has ${fmt(Math.round(tradBalance))} in traditional IRA balance. If this is ` +
      `an INHERITED IRA from a non-spouse decedent who died after 2019-12-31, the 10-year distribution ` +
      `rule applies (IRC §401(a)(9)(H)). Planning the year-by-year distribution timing avoids bracket ` +
      `creep.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      taxpayerAge: age,
      tradIraBalance: Math.round(tradBalance),
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
      timingBenefitRate: G1_27_TIMING_BENEFIT,
    },
    assumptions: [
      `Heuristic informational — engine cannot distinguish own vs inherited IRA. CPA confirms inheritance status from client.`,
      `Triggers for clients age < 60 (typical inheritance-recipient profile). Older clients suppressed (likely own retirement IRA).`,
      `Timing-benefit factor ${(G1_27_TIMING_BENEFIT * 100).toFixed(0)}% — empirical estimate of bracket-creep avoidance across the 10-year window.`,
      `Spouse beneficiaries can treat as own / use lifetime stretch — strategy does NOT apply.`,
      `Final Reg §1.401(a)(9)-5 (TY2024): if decedent died AFTER their Required Beginning Date (RBD), annual RMDs are required in years 1-9 IN ADDITION to year-10 full distribution.`,
      `Pre-2020-01-01 deaths grandfathered into lifetime stretch — strategy applies only to post-2019 deaths.`,
    ],
  };
}

// ── G1.28 — Defined Benefit / Cash Balance Plan ──────────────────────────

const G1_28_MIN_NET_SE = 300_000;
const G1_28_MIN_AGE = 45;
const G1_28_AGE_TIERED_MAX: Array<{ minAge: number; max: number }> = [
  { minAge: 60, max: 300_000 },
  { minAge: 55, max: 250_000 },
  { minAge: 50, max: 200_000 },
  { minAge: 45, max: 150_000 },
];

function detectDefinedBenefitPlan(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, adjustments, baselineInputs } = args;
  const age = client.taxpayerAge;
  if (age == null || age < G1_28_MIN_AGE) return null;
  const netSe = computed.detail.se.netSeEarnings;
  if (netSe < G1_28_MIN_NET_SE) return null;
  // If client already has a substantial SE retirement contribution (e.g.
  // existing DB or aggressive SEP), suppress to avoid double-counting.
  const existingRetirement = sumAdjustment(adjustments, "self_employed_retirement");
  if (existingRetirement >= 69_000) return null;

  const tier = G1_28_AGE_TIERED_MAX.find((t) => age >= t.minAge);
  if (!tier) return null;
  const contribution = Math.min(tier.max, Math.round(netSe * 0.5));

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  const estSavings = Math.round(contribution * (fedRate + stateRate));

  // H2 mutation: add a "deduction" of the contribution amount. Same engine
  // arithmetic as G1.1 SEP — above-the-line on Sched 1.
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.28-db-plan",
    label: `DB plan contribution $${contribution.toLocaleString("en-US")}`,
    mutations: [
      { kind: "add_adjustment", adjustmentType: "deduction", amount: contribution },
    ],
    semantics: "savings",
    varyAmount: true,
  });

  const strategy = strategyById("G1.28");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    contribution,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client age ${age} with ${fmt(Math.round(netSe))} of net SE earnings is in the sweet spot for a ` +
      `Defined Benefit (or Cash Balance) plan. Age-tiered DB max for this client: ${fmt(tier.max)}. ` +
      `Estimated contribution ${fmt(contribution)} → tax savings ${fmt(estSavings)} at the combined ` +
      `${((fedRate + stateRate) * 100).toFixed(1)}% marginal rate.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      taxpayerAge: age,
      netSeEarnings: Math.round(netSe),
      ageTierMax: tier.max,
      contribution,
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
      existingRetirementAdjustment: Math.round(existingRetirement),
    },
    assumptions: [
      `Age-tiered DB contribution cap (heuristic): 45-49 = $150k; 50-54 = $200k; 55-59 = $250k; 60+ = $300k. Actual cap requires actuarial calc per §415(b).`,
      `Contribution capped at netSE × 0.5 (avoids over-funding when net SE is borderline).`,
      `H2 mutation models DB as a generic "deduction" adjustment — same arithmetic as SEP/Solo 401(k) (above-the-line on Sched 1 line 16).`,
      `Setup + recurring cost: ~$5k setup + $3-5k/yr actuarial maintenance. Engine ignores this cost in estSavings (gross savings only).`,
      `DB plans REQUIRE annual funding even in low-income years — clients with volatile SE income should consider Cash Balance (hybrid) instead.`,
      `If client has W-2 employees, nondiscrimination testing applies — may require contributions for staff. Engine assumes solo.`,
    ],
    whatIf,
  };
}

// ── G1.33 — EV Credit §30D / §25E ────────────────────────────────────────

const G1_33_AGI_LIMITS: Record<string, number> = {
  single: 150_000,
  head_of_household: 225_000,
  married_filing_jointly: 300_000,
  qualifying_widow: 300_000,
  married_filing_separately: 150_000,
};
const G1_33_NEW_EV_MAX_CREDIT = 7_500;

function detectEvCredit(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, adjustments, baselineInputs } = args;
  // OBBBA (P.L. 119-21): §30D/§25E TERMINATED for vehicles ACQUIRED after
  // 2025-09-30 (IRS OBBB FAQ) — a TY2025 return may still claim a Jan–Sep
  // 2025 acquisition; TY2026+ is dead law. Belt-and-braces on top of the
  // catalog validUntil (2025-12-31) gate.
  if (computed.taxYear > 2025) return null;
  const cap = G1_33_AGI_LIMITS[client.filingStatus] ?? G1_33_AGI_LIMITS.single;
  if (computed.adjustedGrossIncome > cap) return null;
  // Suppress when an existing credit-type adjustment >= $4,000 is present
  // (likely already an EV credit on the return). Heuristic — engine doesn't
  // have a dedicated EV credit adjustment type.
  const existingCredits = sumAdjustment(adjustments, "credit");
  if (existingCredits >= 4_000) return null;
  // Skip near-zero-tax clients (credit non-refundable; can't use).
  if (computed.federalTaxLiability < G1_33_NEW_EV_MAX_CREDIT) return null;

  const estSavings = G1_33_NEW_EV_MAX_CREDIT;

  // Q2 (audit 2026-06-08) — this is a CONDITIONAL estimate ("IF the client buys a
  // qualifying EV"), NOT an engine-verified saving. The prior code attached a
  // what-if that injected an ASSUMED $7,500 credit and the engine dutifully
  // "confirmed" the arithmetic → the hit was mislabeled "engine-verified $7,500"
  // and ranked #1 ahead of applicable strategies, for ANY filer under the MAGI
  // cap with no EV signal at all. Drop the what-if so it stays a clearly-flagged
  // estimate (gate on a real EV-purchase marker when the data model gains one).
  const whatIf = undefined;

  const strategy = strategyById("G1.33");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    estSavings,
    taxYear: computed.taxYear,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `AGI ${fmt(Math.round(computed.adjustedGrossIncome))} is within the EV credit MAGI cap of ` +
      `${fmt(cap)} for ${client.filingStatus}. A qualifying new EV ACQUIRED ON OR BEFORE 9/30/2025 ` +
      `(OBBBA terminated §30D/§25E for later acquisitions) claims up to ${fmt(estSavings)} via Form 8936 ` +
      `— for TY2025, confirm the acquisition (binding contract + payment) happened by that date.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(computed.adjustedGrossIncome),
      magiCap: cap,
      maxCredit: G1_33_NEW_EV_MAX_CREDIT,
      federalTaxLiability: Math.round(computed.federalTaxLiability),
    },
    assumptions: [
      `⚠ TERMINATED 9/30/2025 — OBBBA (P.L. 119-21) ended §30D (new EV) and §25E (used EV) for vehicles ACQUIRED after 2025-09-30 (IRS OBBB FAQ). A vehicle acquired by binding contract + payment on/before 9/30/2025 still claims the credit when placed in service. NO acquisitions qualify after that date; TY2026+ is dead law.`,
      `Max §30D new EV credit: $7,500 ($3,750 critical-minerals + $3,750 battery-components). Used EV §25E: $4,000 or 30% of price.`,
      `MAGI cap (TY2024): $150k single / $300k MFJ / $225k HoH / $150k MFS per IRA 2022. Use prior-year OR current-year MAGI, whichever is lower.`,
      `MSRP cap: $80k SUV/truck/van; $55k cars.`,
      `Vehicle MUST be on the qualified list at fueleconomy.gov — manufacturer-specific eligibility (many Teslas, Fords, Chevy Bolt, etc. qualify; some don't due to battery sourcing).`,
      `Point-of-sale transfer to dealer (TY2024+) lets client get the credit immediately rather than waiting for refund.`,
      `Non-refundable — engine suppresses suggestion when federal tax < $7,500 (client can't use the full credit). No carryforward.`,
      `Heuristic estSavings = max new EV credit. CPA scales down if client picks a vehicle with partial qualification or a used EV.`,
    ],
    whatIf,
  };
}

// ── G1.34 — Residential Clean Energy §25D ─────────────────────────────────

const G1_34_ASSUMED_INSTALL = 20_000;
// §25D residential clean energy credit rate. OBBBA repealed §25D for property
// placed in service after 2025-12-31, so the G1.34 strategy's validUntil (2025)
// suppresses it for TY2026+ regardless — only the supported years are kept here.
const G1_34_CREDIT_RATE: Record<TaxYear, number> = {
  2024: 0.30,
  2025: 0.30,
  2026: 0.30,
};
const G1_34_MIN_AGI = 50_000;

function detectResidentialCleanEnergy(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  assetBalances?: AssetBalanceFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { computed, adjustments, assetBalances } = args;
  // OBBBA (P.L. 119-21): §25D TERMINATED for expenditures after 2025-12-31 —
  // dead law from TY2026 (IRS OBBB FAQ). The catalog validUntil (2025-12-31)
  // already suppresses this post-detection; this guard is belt-and-braces so
  // the detector can never fire for a TY2026+ return through any path.
  if (computed.taxYear > 2025) return null;
  if (computed.adjustedGrossIncome < G1_34_MIN_AGI) return null;
  // Suppress if existing residential_clean_energy adjustment already present.
  if (sumAdjustment(adjustments, "residential_clean_energy") > 0) return null;
  // Heuristic owner-of-home detection: either H5 primary_residence asset OR
  // mortgage_interest adjustment (proxy for owning home).
  const hasResidence = (assetBalances ?? []).some((a) => a.assetType === "primary_residence");
  const hasMortgage = sumAdjustment(adjustments, "mortgage_interest") > 0;
  if (!hasResidence && !hasMortgage) return null;

  const rate = G1_34_CREDIT_RATE[resolveTaxYear(computed.taxYear)];
  const credit = Math.round(G1_34_ASSUMED_INSTALL * rate);
  // Must have enough federal tax to use the (non-refundable) credit. Engine
  // allows carryforward, so partial benefit is OK — but suppress for very
  // low federal tax filers to avoid noise.
  if (computed.federalTaxLiability < 1_000) return null;

  // Q2 pattern (audit 2026-06-11, mirroring the 2026-06-08 G1.33 fix) — this
  // is a CONDITIONAL purchase estimate ("IF the client installs $20k of
  // solar"), NOT an engine-verified saving. The prior code injected the
  // ASSUMED credit via a what-if and the engine dutifully "confirmed" the
  // arithmetic → every homeowner client got an "engine-verified $6,000*"
  // ranked above genuinely-applicable strategies. Drop the what-if so the hit
  // stays a clearly-flagged estimate (gate on a real install marker when the
  // data model gains one).
  const whatIf = undefined;

  const strategy = strategyById("G1.34");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings: credit };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: credit,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client owns a home (per H5 primary_residence or mortgage interest signal). TY${computed.taxYear} ` +
      `§25D credit rate is ${(rate * 100).toFixed(0)}%. A typical $20k solar/battery install delivers ` +
      `~${fmt(credit)} of federal credit + indefinite carryforward of any unused portion. ` +
      `URGENT: OBBBA terminated §25D — the expenditure must be made by 12/31/2025 (the credit EXPIRES ` +
      `after that date; no TY2026 window).`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(computed.adjustedGrossIncome),
      hasResidenceAsset: hasResidence,
      hasMortgageInterest: hasMortgage,
      assumedInstall: G1_34_ASSUMED_INSTALL,
      creditRate: rate,
      computedCredit: credit,
      federalTaxLiability: Math.round(computed.federalTaxLiability),
    },
    assumptions: [
      `⚠ EXPIRES 12/31/2025 — OBBBA (P.L. 119-21) TERMINATED §25D for expenditures made after 2025-12-31 (the IRA 2022 through-2034 schedule is repealed). The install must be PAID FOR by year-end 2025; no TY2026+ credit exists.`,
      `CONDITIONAL ESTIMATE — fires on a homeowner signal only; the client has not necessarily planned an install. estSavings assumes a $20,000 install × 30%. NOT engine-verified (no what-if attached — injecting an assumed credit would mislabel the hit engine-verified).`,
      `Assumed install cost $20,000 (heuristic). Real installs range $15k-$40k depending on system size + battery storage.`,
      `NO income cap — anyone with sufficient federal tax can use the credit (indefinite carryforward for unused portion; a post-2025 carryforward of a pre-2026 credit survives).`,
      `Qualifying equipment: solar PV, solar water heating, geothermal heat pump, small wind, fuel cell, battery storage ≥ 3 kWh.`,
      `Heat pumps for primary residence go under §25C Energy Efficient Home Improvement Credit (separate $1,200/yr cap) — NOT §25D.`,
      `Rental properties DO NOT qualify — primary or secondary residence only.`,
    ],
    whatIf,
  };
}

// ── G1.39 — §1202 QSBS holding-period planning (heuristic informational) ──

const G1_39_MIN_AGI = 500_000;
const G1_39_ASSUMED_GAIN = 1_000_000;
const G1_39_EXCLUSION_RATE = 0.20 + 0.038;

function detectQsbsPlanning(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  if (computed.adjustedGrossIncome < G1_39_MIN_AGI) return null;
  const k1Active = computed.scheduleK1?.totalActiveOrdinaryIncome ?? 0;
  if (k1Active <= 0) return null;
  // Suppress if QSBS adjustment is already present (engine already excluding).
  if (sumAdjustment(adjustments, "qsbs_gross_gain") > 0) return null;

  const estSavings = Math.round(G1_39_ASSUMED_GAIN * G1_39_EXCLUSION_RATE);

  const strategy = strategyById("G1.39");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client AGI ${fmt(Math.round(computed.adjustedGrossIncome))} + K-1 active income ` +
      `${fmt(Math.round(k1Active))} fits the founder / early-employee profile where §1202 QSBS ` +
      `(100% exclusion on the GREATER of $10M or 10× basis) may apply if the stock meets the ` +
      `qualified-small-business-stock criteria.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(computed.adjustedGrossIncome),
      k1ActiveIncome: Math.round(k1Active),
      assumedQualifyingGain: G1_39_ASSUMED_GAIN,
      exclusionRate: G1_39_EXCLUSION_RATE,
    },
    assumptions: [
      `HEURISTIC INFORMATIONAL — engine cannot verify §1202 eligibility from current data. CPA confirms all 6 §1202 requirements.`,
      `Assumed $1M qualifying gain × (20% LTCG + 3.8% NIIT) = $238k savings. Real upside scales linearly to the $10M cap (or 10× basis if higher).`,
      `100% exclusion applies to original-issuance C-corp stock acquired AFTER 2010-09-27. Earlier acquisitions get 50% or 75%.`,
      `Corp gross assets must have been ≤ $50M IMMEDIATELY BEFORE AND AFTER stock issuance — most VC-funded startups qualify; most large companies don't.`,
      `Qualified trade/business EXCLUDES: professional services (law, accounting, consulting, health), financial services, hotels, restaurants, farming, mining, banking.`,
      `Holding period > 5 years required. Planning: don't sell early. §1045 rollover allows deferral into another QSBS within 60 days.`,
      `Pre-issuance + retro CPA review essential — many post-hoc §1202 claims fail audit.`,
    ],
  };
}

// ── G1.45 — §121 Primary residence sale exclusion ────────────────────────

const G1_45_MIN_EMBEDDED_GAIN = 100_000;
const G1_45_LTCG_RATE = 0.20;

function detectSection121HomeSale(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { client, computed, adjustments, assetBalances } = args;
  if (!assetBalances || assetBalances.length === 0) return null;
  const residence = assetBalances.find((a) => a.assetType === "primary_residence");
  if (!residence) return null;
  const fmv = toNum(residence.balance);
  const basis = toNum(residence.costBasis);
  if (fmv <= 0 || basis < 0) return null;
  const embeddedGain = fmv - basis;
  if (embeddedGain < G1_45_MIN_EMBEDDED_GAIN) return null;
  // Suppress if a home-sale adjustment already exists this year.
  if (sumAdjustment(adjustments, "home_sale_gross_gain_primary_residence") > 0) return null;

  const exclusionCap = client.filingStatus === "married_filing_jointly" ||
                       client.filingStatus === "qualifying_widow"
    ? 500_000
    : 250_000;
  const excludedAmount = Math.min(embeddedGain, exclusionCap);
  // Saved tax = excluded × (LTCG + NIIT if AGI above NIIT threshold)
  const niitThreshold = NIIT_THRESHOLDS[client.filingStatus] ?? NIIT_THRESHOLDS.single;
  const niitApplies = computed.adjustedGrossIncome > niitThreshold;
  const rate = G1_45_LTCG_RATE + (niitApplies ? 0.038 : 0);
  const estSavings = Math.round(excludedAmount * rate);

  const strategy = strategyById("G1.45");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    embeddedGain: Math.round(embeddedGain),
    exclusionCap,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Primary residence FMV ${fmt(fmv)} vs cost basis ${fmt(basis)} = ${fmt(embeddedGain)} of ` +
      `embedded gain. On future sale, §121 excludes up to ${fmt(exclusionCap)} ` +
      `(${client.filingStatus === "married_filing_jointly" || client.filingStatus === "qualifying_widow" ? "MFJ" : "single/HoH/MFS"}). ` +
      `Estimated tax saved on a sale today: ${fmt(estSavings)} ` +
      `(${(rate * 100).toFixed(1)}% × ${fmt(excludedAmount)} excluded).`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      fmv: Math.round(fmv),
      costBasis: Math.round(basis),
      embeddedGain: Math.round(embeddedGain),
      exclusionCap,
      excludedAmount: Math.round(excludedAmount),
      niitApplies,
      effectiveRate: rate,
    },
    assumptions: [
      `§121 exclusion: $250k single/HoH/MFS; $500k MFJ/QSS.`,
      `2-of-last-5-years use AND ownership test required (IRC §121(a)). Engine assumes CPA will verify before sale.`,
      `Heuristic estSavings uses LTCG rate ${(G1_45_LTCG_RATE * 100).toFixed(0)}% + 3.8% NIIT if AGI > threshold. Real rate could be 15% (lower bracket) or 0% (zero-LTCG-bracket).`,
      `Embedded gain = FMV − costBasis from H5 primary_residence asset. Cost basis should include purchase price + capital improvements + selling costs.`,
      `Depreciation recapture (§1250) on prior rental periods is NOT excluded by §121 — applies as ordinary income up to recapture amount.`,
      `Nonqualified-use period (post-2008 rental periods) reduces the exclusion ratio per IRC §121(b)(5).`,
      `Only one §121 exclusion every 2 years — check whether client used it on a prior sale.`,
      `Not an annual recurring opportunity — informational planning. CPA tracks until sale.`,
    ],
  };
}

// ── G1.29 — §529 → Roth IRA SECURE 2.0 ───────────────────────────────────

const G1_29_MIN_529_BALANCE = 35_000;
const G1_29_PV_GROWTH = Math.pow(1.07, 20);
const G1_29_PV_DISCOUNT = Math.pow(1.05, 20);
const G1_29_FUTURE_RATE = 0.32;

function detect529ToRoth(args: {
  computed: ComputedTaxReturn;
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { computed, assetBalances } = args;
  if (!assetBalances || assetBalances.length === 0) return null;
  const total529 = assetBalances
    .filter((a) => a.assetType === "529")
    .reduce((s, a) => s + toNum(a.balance), 0);
  if (total529 < G1_29_MIN_529_BALANCE) return null;

  // Heuristic PV: $35k × growth × futureRate / discount.
  const lifetimeRollover = 35_000;
  const growthDollars = lifetimeRollover * (G1_29_PV_GROWTH - 1);
  const estSavings = Math.round((growthDollars * G1_29_FUTURE_RATE) / G1_29_PV_DISCOUNT);
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.29");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  void computed;
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(total529))} in 529 college-savings balance. If the 529 has been ` +
      `open 15+ years AND the rolled contributions are 5+ years old (SECURE 2.0 §126), beneficiary ` +
      `can roll up to $35,000 lifetime into a Roth IRA — annual cap = IRA contribution cap ($7k / $8k 50+).`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      total529Balance: Math.round(total529),
      lifetimeRolloverCap: lifetimeRollover,
      annualIraCap: 7_000,
      growthAssumption: 0.07,
      futureRateAssumption: G1_29_FUTURE_RATE,
      discountRate: 0.05,
      horizonYears: 20,
    },
    assumptions: [
      `NEW for TY2024+ per SECURE 2.0 §126.`,
      `Lifetime cap $35,000 per beneficiary (NOT per 529 account).`,
      `Annual rollover counts against IRA contribution limit ($7k / $8k 50+) — beneficiary cannot also make separate IRA contribution that year up to the cap.`,
      `Beneficiary OWNS the resulting Roth IRA (must have earned income equal to rollover amount).`,
      `529 must be open >= 15 years; contributions being rolled must be >= 5 years old per §529(c)(3)(E)(iii) (engine cannot verify; CPA confirms).`,
      `Long-term PV uses 7%/yr growth × 20 yrs × ${(G1_29_FUTURE_RATE * 100).toFixed(0)}% future rate, discounted at 5%/yr.`,
      `No current-year tax delta — Roth contributions are after-tax. Benefit is purely future tax-free growth.`,
    ],
  };
}

// ── G1.31 — Saver's Credit §25B ──────────────────────────────────────────
// The AGI→rate bands are the engine's year-indexed SAVERS_CREDIT_TIERS, read via
// saversCreditRateFor() (single source of truth; QSS→single column per PLAN-01).

const G1_31_CONTRIB_CAP_SINGLE = 2_000;
const G1_31_CONTRIB_CAP_MFJ = 4_000;
const G1_31_MIN_AGE = 18;

function detectSaversCredit(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, adjustments, baselineInputs } = args;
  const age = client.taxpayerAge;
  if (age != null && age < G1_31_MIN_AGE) return null;
  // Suppress if already claimed.
  if (sumAdjustment(adjustments, "retirement_contributions_savers") > 0) return null;
  // Need an actual §25B-eligible contribution for the credit to apply to.
  // FALSE-POSITIVE FIX (2026-06-04 detector audit): §25B(d)(1) / Form 8880 count
  // IRA contributions + elective deferrals (401(k)/403(b)/457/SIMPLE/SARSEP) —
  // NOT HSA contributions (HSA never appears on Form 8880). The engine's own
  // `calculateSaversCredit` sums ONLY ira_traditional + ira_roth +
  // retirement_contributions_savers, so including hsa_contribution here surfaced a
  // non-zero heuristic credit + "Credit ~$X" rationale for a client whose only
  // contribution is an HSA, while the engine computes $0. (`self_employed_retirement`
  // is not a real adjustment enum either — removed as dead, misleading signal.)
  const anyRetirement =
    sumAdjustment(adjustments, "ira_contribution_traditional") +
    sumAdjustment(adjustments, "ira_contribution_roth");
  if (anyRetirement <= 0) return null;

  // Determine the applicable §25B rate from the YEAR-INDEXED engine tiers
  // (single source of truth — the prior hardcoded TY2024-only bands mis-rated
  // TY2025+; audit Q3).
  const agi = computed.adjustedGrossIncome;
  const rate = saversCreditRateFor(computed.taxYear, client.filingStatus, agi);
  if (rate <= 0) return null;

  // PLAN-01: QSS uses the single $2,000 cap (Form 8880), not the MFJ $4,000.
  const cap = client.filingStatus === "married_filing_jointly"
    ? G1_31_CONTRIB_CAP_MFJ
    : G1_31_CONTRIB_CAP_SINGLE;
  const qualifyingContrib = Math.min(anyRetirement, cap);
  const estSavings = Math.round(qualifyingContrib * rate);
  if (estSavings <= 0) return null;

  // Q1 (audit 2026-06-08) — the SAVINGS IS the Saver's credit the client already
  // earns on the existing contribution, which the engine computes directly
  // (`saversCredit.appliedCredit`). The prior code attached a what-if that ADDED
  // ANOTHER $2,000 contribution — but §25B caps qualifying contributions at
  // $2,000, so for an already-contributing client the credit didn't change →
  // verifiedSavings collapsed to $0 and BURIED a valid high-confidence credit in
  // the hit-list ranking. Use the engine's actual credit (cap-fallback to the
  // heuristic) and DON'T attach the misleading add-more what-if.
  const engineSaversCredit = Math.round(computed.saversCredit?.appliedCredit ?? 0);
  const cappedSavings = engineSaversCredit > 0
    ? engineSaversCredit
    : Math.min(estSavings, Math.round(computed.federalTaxLiability));
  if (cappedSavings <= 0) return null;
  const whatIf = undefined;

  const strategy = strategyById("G1.31");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings: cappedSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: cappedSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `AGI ${fmt(Math.round(agi))} (${client.filingStatus}) is within the Saver's Credit ` +
      `${(rate * 100).toFixed(0)}% band. Existing retirement contributions ` +
      `${fmt(Math.round(anyRetirement))} qualify (cap ${fmt(cap)}). Credit ~${fmt(cappedSavings)} ` +
      `via Form 8880 — many CPAs miss this for low/mid-income clients with retirement savings.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(agi),
      filingStatus: client.filingStatus,
      bandRate: rate,
      qualifyingContribution: Math.round(qualifyingContrib),
      contributionCap: cap,
      computedCredit: estSavings,
      cappedSavings,
      federalTaxLiability: Math.round(computed.federalTaxLiability),
    },
    assumptions: [
      `TY2024 phase-out brackets per IRS Notice 2023-75: 50% / 20% / 10% / 0% by AGI band.`,
      `Contribution cap counted: $2,000 single / MFS / HoH; $4,000 MFJ / QSS.`,
      `Non-refundable — capped at federal tax liability (engine reports the capped value).`,
      `Excludes full-time students (5+ months) and individuals claimed as dependents — CPA confirms.`,
      `Existing IRA rollovers + distributions reduce qualifying contribution per §25B(d)(2) — engine doesn't auto-net distributions.`,
      `H2 mutation adds retirement_contributions_savers — engine routes through credit-ordering pipeline.`,
    ],
    whatIf,
  };
}

// ── G1.32 — DCFSA vs §21 Dependent Care Credit choice ────────────────────

const G1_32_DCFSA_LIMIT = 5_000;
const G1_32_FICA_RATE = 0.0765;
const G1_32_MIN_MARGINAL = 0.22;
const G1_32_SECTION_21_RATE_APPROX = 0.20;

function detectDcfsaVsCredit(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { client, computed, adjustments } = args;
  void client;
  const depCareExpenses = sumAdjustment(adjustments, "dependent_care_expenses");
  if (depCareExpenses <= 0) return null;
  // Need W-2 income (DCFSA requires employer-sponsored plan).
  const hasW2 = computed.totalIncome > 0; // proxy — engine doesn't expose W-2 vs SE split cleanly
  if (!hasW2) return null;

  const fedRate = federalMarginalRate(computed);
  if (fedRate < G1_32_MIN_MARGINAL) return null;

  const stateRate = stateMarginalRate(computed);
  // DCFSA savings vs §21 credit:
  //   DCFSA: $5k × (federal + state + FICA)
  //   §21 credit foregone: $3k × 20% (rough; engine has actual based on AGI)
  // Net benefit = DCFSA - lost §21 portion
  const dcfsaSavings = G1_32_DCFSA_LIMIT * (fedRate + stateRate + G1_32_FICA_RATE);
  const lostSection21 = Math.min(depCareExpenses, 3_000) * G1_32_SECTION_21_RATE_APPROX;
  const estSavings = Math.round(dcfsaSavings - lostSection21);
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.32");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    dcfsaAmount: G1_32_DCFSA_LIMIT,
    nextTaxYear: computed.taxYear + 1,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(depCareExpenses))} of dependent care expenses at a ` +
      `${(fedRate * 100).toFixed(0)}% federal marginal rate. Electing the $5,000 DCFSA via ` +
      `employer payroll saves more than the §21 credit because the marginal rate (+FICA) exceeds ` +
      `the 20% credit rate on the first $3k.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      dependentCareExpenses: Math.round(depCareExpenses),
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
      ficaRate: G1_32_FICA_RATE,
      dcfsaLimit: G1_32_DCFSA_LIMIT,
      dcfsaSavings: Math.round(dcfsaSavings),
      lostSection21: Math.round(lostSection21),
    },
    assumptions: [
      `DCFSA cap $5,000 (IRC §129(a)(2)) — both spouses must work. MFS limited to $2,500.`,
      `Saves marginal income tax + FICA 7.65% (employer + employee combined; engine uses employee-side 7.65%).`,
      `§21 Credit is 20-35% of $3k (1 child) / $6k (2+ children). Engine approximates as 20% for the comparison — CPA uses actual phase-down rate.`,
      `DCFSA reduces §21 qualifying expenses (no double-dip per §129(e)(7)).`,
      `Strategy is FORWARD-LOOKING — election must happen during open enrollment for next tax year.`,
      `Heuristic — actual savings depend on number of children, exact AGI, state DCFSA conformity (CA / NJ don't tax DCFSA; PA does).`,
    ],
  };
}

// ── G1.36 — R&D Credit §41 ───────────────────────────────────────────────

const G1_36_MIN_SE = 100_000;
const G1_36_ASSUMED_QRE = 50_000;
const G1_36_FIRST_TIME_RATE = 0.06;
const G1_36_ASC_RATE = 0.14;

function detectRdCredit(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;

  // P2-15c — ENGINE-VERIFIED path: the CPA entered qualified research expenses
  // (a `qualified_research_expenses` marker) → the engine computed the real §41
  // ASC credit (after §280C(c)(3) reduction + the §38 GBC liability limit). Report
  // THAT instead of the netSe-proxy heuristic below.
  const rd = computed.rdCredit;
  if (rd && rd.qualifiedResearchExpenses > 0 && rd.credit > 0) {
    const strategy = strategyById("G1.36");
    const fmt = (n: number) =>
      n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    const applied = Math.round(computed.rdCreditApplied);
    const carryforward = Math.round(computed.rdCreditCarryforwardRemaining);
    const fullCredit = Math.round(rd.credit);
    const cfNote =
      carryforward > 0
        ? ` ${fmt(applied)} is usable this year (the §38(c) limit caps the general business credit at regular tax over the tentative minimum tax); ${fmt(carryforward)} carries forward up to 20 years (§39).`
        : ` Fully usable against this year's income tax.`;
    const vars: Record<string, number | string> = { estSavings: fullCredit };
    return {
      strategyId: strategy.id,
      name: strategy.name,
      category: strategy.category,
      // The full §280C-reduced credit is the value earned; the §38 limit only
      // defers part of it (recoverable via the §39 carryforward).
      estSavings: fullCredit,
      verifiedSavings: fullCredit,
      savingsSource: "engine-verified",
      confidence: strategy.confidence,
      cpaEffortHours: strategy.cpaEffortHours,
      recurring: strategy.recurring,
      rationale:
        `Engine-verified §41 R&D credit of ${fmt(fullCredit)} on ${fmt(Math.round(rd.qualifiedResearchExpenses))} QREs ` +
        `via the ${rd.method === "asc" ? "Alternative Simplified Credit (14% over 50% of the prior-3-yr QRE avg)" : "6% startup rate (no 3-yr base)"} ` +
        `(${fmt(Math.round(rd.grossCredit))} gross × 0.79 §280C(c)(3) reduced election).${cfNote}`,
      action: interpolate(strategy.action, vars),
      prerequisiteData: strategy.prerequisiteData,
      citation: `${strategy.ircSection}; ${strategy.irsPub}`,
      inputs: {
        qualifiedResearchExpenses: Math.round(rd.qualifiedResearchExpenses),
        priorThreeYearAvgQre: Math.round(rd.priorThreeYearAvgQre),
        method: rd.method,
        rate: rd.rate,
        ascBase: Math.round(rd.ascBase),
        grossCredit: Math.round(rd.grossCredit),
        creditAfter280c: fullCredit,
        appliedThisYear: applied,
        carryforward,
      },
      assumptions: [
        `ENGINE-VERIFIED — value is the engine's computed §41 ASC credit (after §280C(c)(3) + the §38(c) liability limit), not a heuristic. The §41(d) 4-part test is the CPA's determination.`,
        `ASC = 14% × (current QRE − 50% × prior-3-yr-avg QRE); 6% × QRE when there's no 3-year base (startup).`,
        `§280C(c)(3) reduced-credit election applied by default (gross × (1 − 21%)) — avoids the QRE-deduction add-back. The full credit + deduction add-back is an alternative (not modeled).`,
        `§38(c)(1): the general business credit can't reduce regular tax below the tentative minimum tax; the excess carries forward (§39, 1-back/20-forward).`,
        `§41(h): a qualified small business (gross receipts < $5M AND < 5 yrs) may instead offset the EMPLOYER payroll tax up to $500k — OUT of this individual income-tax engine's scope (CPA evaluates separately).`,
        `§174 (post-TCJA) requires R&D costs to be CAPITALIZED + amortized (5 yr domestic / 15 yr foreign) — separate from the credit; the credit reduces capitalizable basis.`,
        `Heavy documentation (time studies / 4-part-test narratives) — most claims use a specialist.`,
      ],
    };
  }

  const netSe = computed.detail.se.netSeEarnings;
  if (netSe < G1_36_MIN_SE) return null;
  // Suppress if any prior R&D credit signal.
  const existingCredits = sumAdjustment(adjustments, "credit");
  if (existingCredits >= 2_000) return null;

  // Heuristic: assume first-time claimant. ASC = 14% × (current − 50% prior 3-yr avg).
  // For first-time: 6% × current QREs.
  const estSavings = Math.round(G1_36_ASSUMED_QRE * G1_36_FIRST_TIME_RATE);

  const strategy = strategyById("G1.36");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(netSe))} of net SE income (proxy for tech / engineering / ` +
      `software-development profile). If client performs qualifying research (4-part test under ` +
      `§41(d)), credit ~${fmt(estSavings)} on $50k assumed QREs via Form 6765 alternative ` +
      `simplified method.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      assumedQre: G1_36_ASSUMED_QRE,
      firstTimeRate: G1_36_FIRST_TIME_RATE,
      ascRate: G1_36_ASC_RATE,
    },
    assumptions: [
      `4-part test (§41(d)): permitted purpose, technological in nature, eliminate uncertainty, process of experimentation.`,
      `Qualifying Research Expenses (QREs): wages for R&D activities, supplies, 65% of contract research.`,
      `Alternative Simplified Credit (ASC) = 14% × (current QREs − 50% prior 3-yr avg). First-time claimants: 6% × current QREs (heuristic uses this).`,
      `Small business (gross receipts < $5M AND in business < 5 yrs) can use credit against payroll tax up to $500k/yr under §41(h) — useful even if no income tax.`,
      `§174 (post-TCJA) requires R&D expenses to be CAPITALIZED + amortized 5 yrs domestic / 15 yrs foreign — separate from the credit. R&D credit reduces capitalizable basis.`,
      `Heavy documentation requirement — time studies / project records / 4-part-test narratives. Most claims need a specialist (often boutique R&D firms charge 20-30% of credit).`,
      `Heuristic estSavings = $50k QRE × 6% = $3,000. Real claims often $20k-$200k+ for tech-SE clients.`,
    ],
  };
}

// ── G1.37 — §25C Energy Efficient Home Improvement ───────────────────────

const G1_37_ASSUMED_HEATPUMP_COST = 5_000;
const G1_37_HEATPUMP_CREDIT_RATE = 0.30;
const G1_37_HEATPUMP_CAP = 2_000;

function detectEnergyEfficientHome(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  assetBalances?: AssetBalanceFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { computed, adjustments, assetBalances } = args;
  // OBBBA (P.L. 119-21): §25C TERMINATED for property placed in service after
  // 2025-12-31 — dead law from TY2026 (IRS OBBB FAQ). Belt-and-braces on top
  // of the catalog validUntil gate.
  if (computed.taxYear > 2025) return null;
  if (sumAdjustment(adjustments, "energy_efficient_home") > 0) return null;
  if (sumAdjustment(adjustments, "energy_efficient_heatpump") > 0) return null;
  const hasResidence = (assetBalances ?? []).some((a) => a.assetType === "primary_residence");
  const hasMortgage = sumAdjustment(adjustments, "mortgage_interest") > 0;
  if (!hasResidence && !hasMortgage) return null;
  if (computed.federalTaxLiability < 1_000) return null;

  // Heat pump example: $5k install × 30% = $1,500. Below the $2k cap.
  const credit = Math.min(
    Math.round(G1_37_ASSUMED_HEATPUMP_COST * G1_37_HEATPUMP_CREDIT_RATE),
    G1_37_HEATPUMP_CAP,
  );

  // Q2 pattern (audit 2026-06-11, mirroring the 2026-06-08 G1.33 fix) — a
  // CONDITIONAL purchase ("IF the client installs a heat pump") must not be
  // engine-"verified" by injecting the assumed install: every mortgage-paying
  // client was getting an "engine-verified $1,500*" with no heat-pump signal.
  const whatIf = undefined;

  const strategy = strategyById("G1.37");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    taxYear: computed.taxYear,
    estSavings: credit,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: credit,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Homeowner (per H5 primary_residence or mortgage signal). Installing a qualifying ENERGY STAR ` +
      `heat pump (~${fmt(G1_37_ASSUMED_HEATPUMP_COST)} typical) delivers ${fmt(credit)} of §25C credit ` +
      `(30% × cost, capped at $2,000 for heat pumps). URGENT: OBBBA terminated §25C — the property must ` +
      `be PLACED IN SERVICE by 12/31/2025 (the credit EXPIRES after that date; no TY2026 window).`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      assumedHeatPumpCost: G1_37_ASSUMED_HEATPUMP_COST,
      creditRate: G1_37_HEATPUMP_CREDIT_RATE,
      heatPumpCap: G1_37_HEATPUMP_CAP,
      computedCredit: credit,
      federalTaxLiability: Math.round(computed.federalTaxLiability),
    },
    assumptions: [
      `⚠ EXPIRES 12/31/2025 — OBBBA (P.L. 119-21) TERMINATED §25C for property placed in service after 2025-12-31 (the IRA 2022 through-2032 schedule is repealed). No TY2026+ credit exists.`,
      `CONDITIONAL ESTIMATE — fires on a homeowner signal only; the client has not necessarily planned an improvement. NOT engine-verified (no what-if attached — injecting the assumed install would mislabel the hit engine-verified).`,
      `Annual cap STRUCTURE: $1,200 general (windows $600, doors $250/$500 max, audit $150, AC/furnace/boiler $600); $2,000 separately for heat pumps + heat-pump water heaters + biomass stoves. Combined max ~$3,200.`,
      `NO carryforward — use-it-or-lose-it (vs §25D residential clean energy which IS carryforward-able).`,
      `Heuristic uses heat-pump example ($5k install). Other items (windows, doors) have lower caps + different rates.`,
      `ENERGY STAR certification required (Notice 2024-09).`,
      `Rental property does NOT qualify — primary or secondary residence only.`,
    ],
    whatIf,
  };
}

// ── G1.40 — §1244 Ordinary loss on small biz stock ───────────────────────

const G1_40_MIN_CAP_LOSS_CF = 25_000;
const G1_40_ORDINARY_CAP_SINGLE = 50_000;
const G1_40_ORDINARY_CAP_MFJ = 100_000;
const G1_40_RATE_SPREAD = 0.17;

function detectSection1244(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, adjustments, baselineInputs } = args;
  if (computed.totalIncome < 100_000) return null;
  const cfShort = sumAdjustment(adjustments, "capital_loss_carryforward_short");
  const cfLong = sumAdjustment(adjustments, "capital_loss_carryforward_long");
  const capLossCf = cfShort + cfLong;
  if (capLossCf < G1_40_MIN_CAP_LOSS_CF) return null;

  const cap = client.filingStatus === "married_filing_jointly" ||
              client.filingStatus === "qualifying_widow"
    ? G1_40_ORDINARY_CAP_MFJ
    : G1_40_ORDINARY_CAP_SINGLE;
  // Recharacterizable portion = min(carryforward, cap).
  const recharacterizable = Math.min(capLossCf, cap);
  const estSavings = Math.round(recharacterizable * G1_40_RATE_SPREAD);
  if (estSavings <= 0) return null;

  // H2 (PLAN-Q2) — engine-verified CURRENT-YEAR delta of electing §1244 ordinary
  // treatment vs leaving the loss as capital. The election removes the
  // recharacterizable amount from the capital-loss carryforward (which would
  // otherwise release only $3k/yr against ordinary income) and deducts it in
  // full this year above the line (Form 4797 → Sch 1). The engine captures the
  // exact bracket/NOL limits the 17% rate-spread heuristic can't. We take the
  // recharacterized amount from short-term first (it would otherwise offset the
  // least-preferential income). varyAmount=false — the amount is the statutory
  // cap, not a free dial. NOTE: this is the CURRENT-YEAR benefit; the capital
  // carryforward retains residual future value, so the LIFETIME advantage is the
  // smaller rate-spread (heuristic estSavings) — both numbers travel on the hit.
  const removeFromShort = Math.min(cfShort, recharacterizable);
  const removeFromLong = recharacterizable - removeFromShort;
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.40-section-1244",
    label: `§1244 ordinary loss $${recharacterizable.toLocaleString("en-US")}`,
    mutations: [
      { kind: "set_adjustment", adjustmentType: "capital_loss_carryforward_short", amount: cfShort - removeFromShort },
      { kind: "set_adjustment", adjustmentType: "capital_loss_carryforward_long", amount: cfLong - removeFromLong },
      { kind: "add_adjustment", adjustmentType: "deduction", amount: recharacterizable },
    ],
    semantics: "savings",
    varyAmount: false,
  });

  const strategy = strategyById("G1.40");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    ordinaryCap: cap,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(capLossCf))} of capital loss carryforward. If any of that loss is ` +
      `from a failed SMALL BUSINESS C-CORP that met §1244 qualifying-stock criteria at original issuance, ` +
      `up to ${fmt(cap)} can be recharacterized as ORDINARY (deductible without the $3k/yr cap) instead ` +
      `of capital. Rate spread ~17% (ordinary − LTCG) recovers ~${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      capitalLossCarryforward: Math.round(capLossCf),
      ordinaryCap: cap,
      recharacterizable: Math.round(recharacterizable),
      rateSpread: G1_40_RATE_SPREAD,
    },
    assumptions: [
      `Engine cannot verify §1244 qualifying-stock status — CPA confirms all 5 requirements; the engine VERIFIES the tax math once the loss is recharacterized.`,
      `whatIf delta = the CURRENT-YEAR refund benefit of ordinary vs capital treatment (engine-computed, incl. real bracket/NOL limits). estSavings (rate-spread) is the conservative LIFETIME measure — the capital carryforward retains future value, so true lifetime gain sits between the two.`,
      `Annual ordinary-loss cap: $50,000 single/MFS/HoH/QSS; $100,000 MFJ. Excess flows to capital loss (Sch D).`,
      `Stock must be: (1) DOMESTIC C-CORP, (2) issued for money/property (not services), (3) ORIGINAL ISSUANCE to client, (4) corp raised ≤ $1M equity at issuance, (5) corp had > 50% gross receipts from active T/B in 5 yrs preceding loss.`,
      `Loss must be from sale, exchange, or worthlessness (Form 4797 Part I, NOT Sch D).`,
      `Strategy is REACTIVE — applies to loss already incurred. Forward planning: structure equity rounds to preserve §1244 eligibility (< $1M raised).`,
    ],
    whatIf,
  };
}

// ── G1.46 — Spousal IRA §219(c) ──────────────────────────────────────────

const G1_46_IRA_CAP_BASE = 7_000;
const G1_46_IRA_CAP_CATCHUP = 8_000;
const G1_46_MIN_EARNED_INCOME = 7_000;

function detectSpousalIra(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, adjustments, baselineInputs } = args;
  if (client.filingStatus !== "married_filing_jointly" &&
      client.filingStatus !== "qualifying_widow") return null;

  // §219(c)/§219(f)(1): a spousal IRA requires the working spouse to have
  // COMPENSATION = wages + net SE earnings. SS, pensions, IRA/retirement
  // distributions, interest, dividends, capital gains, rents, and royalties are
  // NOT compensation. Engine can't verify the per-spouse split — CPA confirms one
  // spouse has $0 earned income. (audit 2026-06-23 — the old proxy subtracted only
  // retirement + unemployment from totalIncome, so taxable SS / dividends / LTCG
  // counted as "earned" and the strategy fired for couples with ZERO compensation;
  // because it carries an engine-verified what-if it then ranked at the TOP. Now
  // uses the same wage/SE signal as the other earned-income detectors.)
  const { wages } = w2WagesSignal(computed, baselineInputs);
  const totalEarnings = wages + Math.max(0, computed.detail.se.netSeEarnings ?? 0);
  if (totalEarnings < G1_46_MIN_EARNED_INCOME) return null;

  // Suppress if any spouse_ira_contribution marker already on return.
  // Use existing ira_contribution_traditional as proxy — if client already
  // contributed $7k+, may already be doing this.
  const existingIra = sumAdjustment(adjustments, "ira_contribution_traditional");
  if (existingIra >= G1_46_IRA_CAP_BASE * 2) return null; // both spouses already maxed

  const age = client.taxpayerAge ?? 0;
  const contribution = age >= 50 ? G1_46_IRA_CAP_CATCHUP : G1_46_IRA_CAP_BASE;

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  const estSavings = Math.round(contribution * (fedRate + stateRate));
  if (estSavings <= 0) return null;

  // H2 mutation: add ira_contribution_traditional = $7k. Engine treats
  // as above-the-line deduction (subject to §219(g) coverage phase-out
  // which engine doesn't fully model — caveat in assumptions).
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.46-spousal-ira",
    label: `Spousal IRA $${contribution.toLocaleString("en-US")}`,
    mutations: [
      { kind: "add_adjustment", adjustmentType: "ira_contribution_traditional", amount: contribution },
    ],
    semantics: "savings",
    varyAmount: true,
  });

  const strategy = strategyById("G1.46");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `MFJ client with ${fmt(Math.round(totalEarnings))} total earned income. If one spouse has ` +
      `$0 (or limited) earned income, the working spouse's earnings support a ${fmt(contribution)} ` +
      `Spousal IRA contribution. Above-the-line deductible — saves ~${fmt(estSavings)} at the ` +
      `combined ${((fedRate + stateRate) * 100).toFixed(1)}% marginal rate.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      filingStatus: client.filingStatus,
      taxpayerAge: age,
      totalEarnings: Math.round(totalEarnings),
      existingIraContribution: Math.round(existingIra),
      contribution,
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
    },
    assumptions: [
      `§219(c) allows non-working spouse on MFJ return to contribute up to the IRA cap based on working spouse's earned income.`,
      `TY2024 cap: $7,000 base / $8,000 age 50+ (Notice 2023-75).`,
      `Heuristic — engine CANNOT verify per-spouse earned income split. CPA confirms.`,
      `§219(g) phase-out applies when working spouse is covered by retirement plan at work: MFJ $230k-$240k for the SPOUSAL contribution (different from active-participant phase-out $123k-$143k). Engine doesn't model this — CPA verifies.`,
      `Spousal Roth IRA option available — subject to direct-Roth phase-out (G1.26 covers backdoor when over phase-out).`,
      `H2 mutation models as above-the-line "deduction" — actual engine treatment of ira_contribution_traditional already handles this.`,
    ],
    whatIf,
  };
}

// ── G1.47 — §453 Installment Sale ────────────────────────────────────────

const G1_47_MIN_EMBEDDED_GAIN = 250_000;
const G1_47_MIN_AGI = 250_000;
const G1_47_TIMING_BENEFIT_FACTOR = 0.05;
const G1_47_DEFAULT_INSTALLMENT_YEARS = 5;

function detectInstallmentSale(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  assetBalances?: AssetBalanceFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { computed, adjustments, assetBalances, baselineInputs } = args;
  if (computed.adjustedGrossIncome < G1_47_MIN_AGI) return null;
  if (!assetBalances || assetBalances.length === 0) return null;
  // Look for real_estate or primary_residence with embedded gain > threshold.
  const candidate = assetBalances.find((a) => {
    if (a.assetType !== "real_estate" && a.assetType !== "primary_residence") return false;
    const bal = toNum(a.balance);
    const basis = toNum(a.costBasis);
    return bal > 0 && (bal - basis) > G1_47_MIN_EMBEDDED_GAIN;
  });
  if (!candidate) return null;
  void adjustments;

  const fmv = toNum(candidate.balance);
  const basis = toNum(candidate.costBasis);
  const embeddedGain = fmv - basis;
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const heuristicEstSavings = Math.round(embeddedGain * G1_47_TIMING_BENEFIT_FACTOR);
  if (heuristicEstSavings <= 0) return null;

  const years = G1_47_DEFAULT_INSTALLMENT_YEARS;
  const annualGain = Math.round(embeddedGain / years);

  // H3 (PLAN-Q2) — engine-verified MULTI-YEAR bracket-smoothing. BOTH trajectories
  // recognize the SAME total gain; only the timing differs, so the delta is the
  // honest installment benefit — NO overstatement: the deferred gain IS taxed in
  // the later years (the reason a single-year what-if was wrong here). Baseline:
  // full gain in year 0. Scenario: gain/N each year. Injected via the new
  // `long_term_capital_gain` lever (flows through Schedule D netting → preferential
  // rate + §1411 NIIT). §453(i) depreciation recapture is a year-0 item the CPA
  // nets out of the embedded gain.
  const gainMutation = (amount: number): WhatIfMutation[] => [
    { kind: "add_adjustment", adjustmentType: "long_term_capital_gain", amount },
  ];
  const multiYear = runDetectorMultiYear({
    baselineInputs,
    horizonYears: years,
    // Year 0 recognizes the full gain; years 1..N-1 = undefined (lump-sum baseline).
    baselineMutationsByYear: [gainMutation(embeddedGain)],
    scenarioMutationsByYear: Array.from({ length: years }, () => gainMutation(embeddedGain / years)),
    multiYearAssumptions: [
      `Installment sale spreads the ${fmt(embeddedGain)} gain evenly over ${years} years (${fmt(embeddedGain / years)}/yr) vs full recognition in year 0 — SAME total gain, different timing.`,
      `Income scaled at 3%/year compound for projection years; the gain stacks on each year's other income (drives the LTCG-rate + NIIT-threshold smoothing).`,
      `§453(i) depreciation recapture (§1245/§1250) is recognized in YEAR OF SALE regardless — net it out of the embedded gain before relying on this figure.`,
      `Publicly traded securities + dealer dispositions do NOT qualify (§453(b)(2)); imputed interest (§483/§1274) is separately ordinary.`,
    ],
  });
  // One-time strategy → use the TOTAL multi-year savings (not annualized) when the
  // engine ran; else the conservative heuristic 5%-of-gain estimate.
  const estSavings = multiYear && multiYear.totalSavings > 0
    ? Math.round(multiYear.totalSavings)
    : heuristicEstSavings;

  const strategy = strategyById("G1.47");
  const vars: Record<string, number | string> = {
    plannedYears: G1_47_DEFAULT_INSTALLMENT_YEARS,
    annualGain,
    totalGain: Math.round(embeddedGain),
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `H5 property (${candidate.accountName}) has FMV ${fmt(fmv)} vs basis ${fmt(basis)} = ` +
      `${fmt(Math.round(embeddedGain))} embedded gain. AGI ${fmt(Math.round(computed.adjustedGrossIncome))} ` +
      `is high enough that single-year recognition would hit peak brackets. Installment sale spreads ` +
      `the gain over ${G1_47_DEFAULT_INSTALLMENT_YEARS} years for blended-rate smoothing.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      assetType: candidate.assetType,
      assetName: candidate.accountName,
      fmv: Math.round(fmv),
      costBasis: Math.round(basis),
      embeddedGain: Math.round(embeddedGain),
      agi: Math.round(computed.adjustedGrossIncome),
      installmentYears: G1_47_DEFAULT_INSTALLMENT_YEARS,
      timingBenefitFactor: G1_47_TIMING_BENEFIT_FACTOR,
      annualGain,
      currentMarginalRate: federalMarginalRate(computed),
      heuristicEstSavings,
      multiYearTotalSavings: multiYear ? Math.round(multiYear.totalSavings) : null,
    },
    assumptions: [
      multiYear
        ? `ENGINE-VERIFIED via the H3 multi-year primitive (PLAN-Q2): baseline recognizes the full ${fmt(embeddedGain)} gain in year 0; the scenario spreads ${fmt(embeddedGain / years)}/yr over ${years} years. SAME total gain — the delta is the genuine bracket-smoothing benefit (the deferred gain IS taxed in the later years, so this does NOT overstate). estSavings = the total multi-year savings. Heuristic was ${fmt(heuristicEstSavings)}.`
        : `Heuristic timing-benefit ${(G1_47_TIMING_BENEFIT_FACTOR * 100).toFixed(0)}% (no baselineInputs for H3 verification) — conservative; actual bracket arbitrage across the installment years runs 2-15% of gain. inputs.currentMarginalRate shows the engine's bracket context.`,
      `${years}-year planning horizon assumed. Real installment can be 2-30+ years per contract — longer terms smooth further.`,
      `Publicly traded securities + dealer dispositions do NOT qualify per §453(b)(2).`,
      `§453(i) depreciation recapture (§1245/§1250) RECOGNIZED IN YEAR OF SALE — net it out of the embedded gain; only the excess flows through the installment method.`,
      `Imputed interest (§483 / §1274) on long-term notes — interest portion separately ordinary.`,
      `Election to opt OUT exists — file by due date if all-cash recognition preferred (e.g., low-bracket year, buyer credit concern).`,
    ],
    multiYear,
  };
}

// ── G1.48 — §83(b) election timing (informational) ───────────────────────

const G1_48_ASSUMED_APPRECIATION = 0.30;
const G1_48_RATE_SPREAD = 0.37 - 0.20;

function detectSection83b(args: {
  computed: ComputedTaxReturn;
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { computed, assetBalances } = args;
  if (!assetBalances || assetBalances.length === 0) return null;
  const preElection = assetBalances.find((a) => a.assetType === "restricted_stock_pre_83b");
  if (!preElection) return null;
  void computed;

  const balance = toNum(preElection.balance);
  if (balance <= 0) return null;
  // estSavings = balance × assumed appreciation × rate spread (ordinary - LTCG)
  const estSavings = Math.round(balance * G1_48_ASSUMED_APPRECIATION * G1_48_RATE_SPREAD);
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.48");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client holds ${fmt(balance)} of restricted stock where NO §83(b) election was made at grant. ` +
      `For FUTURE grants (current is past the 30-day deadline), filing §83(b) within 30 days locks in ` +
      `FMV-at-grant as ordinary income — subsequent appreciation becomes capital gain. Estimated ` +
      `value of properly electing on future grants ~${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      restrictedStockBalance: Math.round(balance),
      assumedAppreciationPct: G1_48_ASSUMED_APPRECIATION,
      rateSpread: G1_48_RATE_SPREAD,
    },
    assumptions: [
      `H5 restricted_stock_pre_83b asset type implies client received restricted stock WITHOUT making §83(b) election (past the 30-day deadline).`,
      `Strategy is FORWARD-LOOKING — applies to NEW grants, not the existing balance.`,
      `Strict 30-DAY deadline from GRANT (not vest) per Reg. §1.83-2(a).`,
      `Heuristic: assumes 30% appreciation between grant + vest. Real spread varies wildly (0%-1000%+).`,
      `Rate spread ${(G1_48_RATE_SPREAD * 100).toFixed(0)}% = peak ordinary 37% − LTCG 20%.`,
      `Election is IRREVOCABLE — risk of paying tax on FMV-at-grant if equity becomes worthless before vest.`,
      `Best fit: early-stage startup grants with low FMV-at-grant + strong upside expectation.`,
      `Worst fit: late-stage pre-IPO grants where FMV is already high — pay big tax now without certainty.`,
    ],
  };
}

// ── G1.49 — Family Employment of Children §3121(b)(3)(A) ─────────────────

const G1_49_MIN_NET_SE = 50_000;
const G1_49_CHILD_STD_DED_2024 = 14_600;
const G1_49_SE_FICA_RATE = 0.153; // both employer + employee = 15.3% on SE
const G1_49_DEFAULT_NUM_CHILDREN = 1;

/**
 * PLAN-03/04 — count of dependent children that could be subject to a
 * child-focused planning strategy.
 *
 * `dependentsUnder17` captures only CTC-qualifying kids (under 17). A child
 * who is 17, or an 18-23 full-time student, drops out of that count into
 * `otherDependents` (where they earn the $500 Credit for Other Dependents).
 * Child-strategy detectors apply to populations that extend past 16 —
 * family employment §3121(b)(3)(A) covers under-18, kiddie tax §1(g) covers
 * under-18 + 18-23 students, Coverdell §530 covers under-18 — so the
 * eligible-children proxy is the SUM. Callers caveat that `otherDependents`
 * may also include non-child relatives (e.g. an elderly parent), which the
 * CPA filters when confirming the strategy.
 */
function countEligibleChildren(client: ClientFacts): number {
  return (client.dependentsUnder17 ?? 0) + (client.otherDependents ?? 0);
}

function detectFamilyEmployment(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, adjustments, baselineInputs } = args;
  const netSe = computed.detail.se.netSeEarnings;
  if (netSe < G1_49_MIN_NET_SE) return null;
  // PLAN-03: the §3121(b)(3)(A) FICA exemption covers children UNDER 18 (FUTA
  // under 21) — broader than the CTC's under-17 count. A 17-year-old dependent
  // child drops out of dependentsUnder17 into otherDependents, so use both as
  // the eligible-children proxy. (CPA confirms the dependent is the taxpayer's
  // child actually employed — otherDependents may include non-child relatives.)
  const eligibleChildren = countEligibleChildren(client);
  if (eligibleChildren <= 0) return null;
  // Suppress if existing family_employment marker. Use generic "deduction"
  // with a magic amount as a proxy.
  const existingFamEmp = adjustments.find((a) =>
    (a.adjustmentType ?? "").toLowerCase().includes("family_employment"),
  );
  if (existingFamEmp) return null;

  const numChildren = Math.min(eligibleChildren, G1_49_DEFAULT_NUM_CHILDREN);
  const wagesPerChild = G1_49_CHILD_STD_DED_2024;
  const totalWages = wagesPerChild * numChildren;

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  // Savings = parent's marginal (income + SE FICA) on the deductible wages,
  // minus child's federal income tax (0 if at/under std ded).
  const estSavings = Math.round(totalWages * (fedRate + stateRate + G1_49_SE_FICA_RATE));

  // H2 mutation: add a deduction of $14,600 (wages to child). Engine treats
  // as Schedule C expense / above-the-line reducing AGI.
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.49-family-employment",
    label: `Family wages $${totalWages.toLocaleString("en-US")} to child(ren) under 18`,
    mutations: [
      { kind: "add_adjustment", adjustmentType: "deduction", amount: totalWages },
    ],
    semantics: "savings",
    varyAmount: true,
  });

  const strategy = strategyById("G1.49");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    wagesPerChild,
    numChildren,
    totalWages,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Sole prop with ${fmt(Math.round(netSe))} net SE income + ${eligibleChildren} eligible child dependent(s). ` +
      `Employing child(ren) under 18 in the business shields wages from FICA per §3121(b)(3)(A) ` +
      `AND the child's standard deduction (${fmt(G1_49_CHILD_STD_DED_2024)}) shields the wages from ` +
      `federal income tax. Net savings ~${fmt(estSavings)} per year per child.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      eligibleChildren,
      numChildrenAssumed: numChildren,
      wagesPerChild,
      totalWages,
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
      seFicaRate: G1_49_SE_FICA_RATE,
    },
    assumptions: [
      `STRICT requirement: business MUST be sole prop or husband-wife partnership. S-corp / C-corp wages to children ARE FICA-subject.`,
      `Child must actually perform real work + receive reasonable wages (no sham employment). IRS scrutinizes — document carefully (timesheets, job description, W-2, payroll records).`,
      `Child under 18: FICA + Medicare exempt (§3121(b)(3)(A)). Under 21: also FUTA exempt (§3306(c)(5)).`,
      `TY2024 child standard deduction: $14,600 — shields wages from federal income tax up to that amount.`,
      `Wages above std ded taxed at child's marginal rate (likely 10-12%) — still much lower than parent's marginal.`,
      `BONUS: child can fund Roth IRA up to earned income — powerful long-term tax-free growth.`,
      `State income tax + state SUTA may still apply — varies by state.`,
      `Engine heuristic: 1 child × $14,600 wages. Multiple children scale linearly up to the dependentsUnder17 count.`,
      `H2 mutation models wages as a "deduction" — reduces parent's AGI by $14,600 (above-the-line equivalent).`,
    ],
    whatIf,
  };
}

// ── G1.51 — AOC vs LLC choice §25A ───────────────────────────────────────

const G1_51_AOC_MAX = 2_500;
const G1_51_LLC_MAX = 2_000;
const G1_51_AGI_PHASE_OUT_TOP: Record<string, number> = {
  single: 90_000,
  head_of_household: 90_000,
  married_filing_jointly: 180_000,
  qualifying_widow: 180_000,
  married_filing_separately: 0, // MFS cannot claim
};

function detectAocVsLlc(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, adjustments, baselineInputs } = args;
  if (client.filingStatus === "married_filing_separately") return null;
  const phaseOut = G1_51_AGI_PHASE_OUT_TOP[client.filingStatus] ?? G1_51_AGI_PHASE_OUT_TOP.single;
  if (computed.adjustedGrossIncome > phaseOut) return null;

  const llcExpenses = sumAdjustment(adjustments, "qualified_education_expenses_llc");
  const aocExpenses = sumAdjustment(adjustments, "qualified_education_expenses_aoc");
  if (llcExpenses <= 0) return null;
  if (aocExpenses > 0) return null; // already claiming AOC

  // Switching from LLC to AOC picks up the extra $500.
  const extraCredit = G1_51_AOC_MAX - G1_51_LLC_MAX;
  const estSavings = extraCredit;

  // H2 mutation: swap LLC expense → AOC expense. Use same expense amount.
  const swapAmount = Math.min(llcExpenses, 4_000); // AOC counts up to $4k
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.51-aoc-swap",
    label: `Switch LLC → AOC ($${swapAmount.toLocaleString("en-US")} expenses)`,
    mutations: [
      { kind: "set_adjustment", adjustmentType: "qualified_education_expenses_llc", amount: 0 },
      { kind: "set_adjustment", adjustmentType: "qualified_education_expenses_aoc", amount: swapAmount },
    ],
    semantics: "savings",
    varyAmount: false,
  });

  const strategy = strategyById("G1.51");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  void fmt;
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client is claiming Lifetime Learning Credit (${fmt(Math.round(llcExpenses))} expenses, max ` +
      `$2,000 credit). If the student is an undergrad in first 4 years of post-secondary AND ` +
      `enrolled at least half-time, switching to American Opportunity Credit picks up $500 extra ` +
      `(AOC max $2,500 vs LLC max $2,000).`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      filingStatus: client.filingStatus,
      agi: Math.round(computed.adjustedGrossIncome),
      phaseOutTop: phaseOut,
      llcExpenses: Math.round(llcExpenses),
      aocExpenses: Math.round(aocExpenses),
      aocMax: G1_51_AOC_MAX,
      llcMax: G1_51_LLC_MAX,
      extraCredit,
    },
    assumptions: [
      `AOC: 100% of first $2k + 25% of next $2k = max $2,500 per STUDENT. 4 yrs post-secondary. 40% refundable.`,
      `LLC: 20% of first $10k = max $2,000 per RETURN (NOT per student). Unlimited years. Non-refundable.`,
      `Cannot claim BOTH for same student in same year.`,
      `AOC requires: enrolled at least half-time, working toward degree/credential, in first 4 years of post-secondary, no felony drug conviction.`,
      `Phase-out: AOC + LLC have identical phase-out: $80k-$90k single / $160k-$180k MFJ (TY2024).`,
      `MFS cannot claim either credit.`,
      `Strategy saves $500/yr for up to 4 yrs per AOC-eligible student = $2,000 lifetime per student.`,
      `H2 mutation swaps the qualifying expense from LLC to AOC — engine recomputes credit via credit-ordering pipeline.`,
    ],
    whatIf,
  };
}

// ── G1.30 — ACA PTC §36B reconciliation ─────────────────────────────────
// Two-track: when the client has real Marketplace coverage (1095-A → the engine
// ran Form 8962), report the ENGINE-VERIFIED §36B reconciliation. Otherwise
// fall back to the forward-looking SE-income heuristic (a prompt to project
// next-year MAGI accurately).

const G1_30_AGI_MIN = 30_000;
const G1_30_AGI_MAX = 120_000;
const G1_30_HEURISTIC_BENEFIT = 1_000;

function detectAcaPtc(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { computed, adjustments, baselineInputs } = args;

  // ENGINE-VERIFIED path (P2-14): the client has Marketplace coverage
  // (acaAnnualPremium/Slcsp populated from a 1095-A → calculatePremiumTaxCredit
  // ran). Report the engine's ACTUAL Form 8962 reconciliation rather than the
  // $1,000 heuristic. netPtc > 0 = additional refundable PTC to claim; netPtc < 0
  // = excess advance APTC that must be repaid (capped) — the planning value is
  // the exposure that pre-year-end MAGI management can reduce.
  const ptc = computed.premiumTaxCredit;
  if (ptc && ptc.annualPremium > 0 && ptc.annualSlcsp > 0 && Math.abs(ptc.netPtc) >= 1) {
    const strategy = strategyById("G1.30");
    const fmt = (n: number) =>
      n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
    const verified = Math.round(Math.abs(ptc.netPtc));
    const isClawback = ptc.netPtc < 0;
    const capNote =
      isClawback && ptc.repaymentCap != null // T1.0d #14 — null = uncapped (was Infinity)
        ? ` Repayment is capped at ${fmt(ptc.repaymentCap)} under §36B(f)(2)(B) at ${pct(ptc.fplFraction)} FPL.`
        : isClawback
          ? ` At ${pct(ptc.fplFraction)} FPL (≥400%) the repayment is UNCAPPED — full ${fmt(verified)} is owed.`
          : ``;
    // §36B-cliff OPTIMIZER (P2): near an FPL band edge / the 400% cliff the PTC is
    // highly nonlinear, so a deductible contribution that lowers MAGI recovers far
    // more than its face value. Engine-verified what-if at a $7,000 traditional-IRA
    // contribution (the most universal lever — a SE client's SEP/HSA can go larger);
    // combinedRefundDelta = the income-tax saving on the deduction PLUS the PTC swing.
    // When present (baselineInputs supplied), this becomes the actionable headline
    // (annotateVerifiedSavings reads it); otherwise the reconciliation |netPtc| stands.
    const optimizerWhatIf = runDetectorWhatIf({
      baselineInputs,
      scenarioId: "G1.30-ptc-magi-optimizer",
      label: "PTC: $7,000 deductible IRA lowers MAGI",
      mutations: [{ kind: "add_adjustment", adjustmentType: "ira_contribution_traditional", amount: 7000 }],
      semantics: "savings",
      varyAmount: true,
    });
    const optimizerBeneficial = optimizerWhatIf != null && optimizerWhatIf.delta.combinedRefundDelta > 0;
    const vars: Record<string, number | string> = { estSavings: verified, taxYear: computed.taxYear };
    return {
      strategyId: strategy.id,
      name: strategy.name,
      category: strategy.category,
      estSavings: verified,
      verifiedSavings: verified,
      savingsSource: "engine-verified",
      confidence: strategy.confidence,
      cpaEffortHours: strategy.cpaEffortHours,
      recurring: strategy.recurring,
      rationale: isClawback
        ? `Engine-verified Form 8962: client received ${fmt(Math.round(ptc.advanceAptc))} advance APTC but ` +
          `qualifies for only ${fmt(Math.round(ptc.computedPtc))} at ${pct(ptc.fplFraction)} FPL → ${fmt(verified)} ` +
          `excess must be REPAID.${capNote} A pre-year-end deductible contribution (traditional IRA / HSA / SEP) ` +
          `that lowers MAGI raises the PTC steeply near a band edge and can reduce or eliminate this clawback.`
        : `Engine-verified Form 8962: client qualifies for ${fmt(Math.round(ptc.computedPtc))} PTC but received only ` +
          `${fmt(Math.round(ptc.advanceAptc))} advance APTC → ${fmt(verified)} additional refundable credit to claim ` +
          `at ${pct(ptc.fplFraction)} FPL. Confirm the 1095-A figures on Form 8962.`,
      action: interpolate(strategy.action, vars),
      prerequisiteData: strategy.prerequisiteData,
      citation: `${strategy.ircSection}; ${strategy.irsPub}`,
      inputs: {
        modifiedAgi: Math.round(ptc.modifiedAgi),
        householdSize: ptc.householdSize,
        fplFraction: Number(ptc.fplFraction.toFixed(4)),
        applicableFigure: Number(ptc.applicableFigure.toFixed(4)),
        expectedContribution: Math.round(ptc.expectedContribution),
        annualPremium: Math.round(ptc.annualPremium),
        annualSlcsp: Math.round(ptc.annualSlcsp),
        computedPtc: Math.round(ptc.computedPtc),
        advanceAptc: Math.round(ptc.advanceAptc),
        netPtc: Math.round(ptc.netPtc),
        repaymentCap: ptc.repaymentCap != null ? Math.round(ptc.repaymentCap) : -1, // T1.0d #14 — null = uncapped
        optimizerIraContribution: optimizerBeneficial ? 7000 : 0,
        optimizerNetBenefit: optimizerBeneficial ? Math.round(Math.abs(optimizerWhatIf!.delta.combinedRefundDelta)) : 0,
      },
      assumptions: [
        `ENGINE-VERIFIED — value is the engine's computed Form 8962 net reconciliation (computed PTC − advance APTC), not a heuristic.`,
        isClawback
          ? `netPtc < 0 → excess advance APTC repayment. The ${fmt(verified)} is the exposure; how much is AVOIDABLE depends on the MAGI lever available before year-end (an IRA/HSA/SEP deduction that drops MAGI toward a lower applicable-figure band).`
          : `netPtc > 0 → additional refundable PTC the client is owed on Form 8962 Line 26.`,
        optimizerBeneficial
          ? `§36B OPTIMIZER (engine-verified): a $7,000 deductible traditional-IRA contribution lowers MAGI and is worth ${fmt(Math.round(Math.abs(optimizerWhatIf!.delta.combinedRefundDelta)))} combined (income-tax saving + PTC swing) — far more than $7,000 × marginal near a band edge. A SE client's SEP/HSA lever can go larger. Assumes earned income + §219(g) IRA eligibility.`
          : `§36B optimizer what-if requires baselineInputs (per-client endpoint) — not run on the firm-wide path.`,
        `MAGI = AGI + tax-exempt interest + the §911/§931/§933 foreign exclusions per §36B(d)(2)(B) (engine uses AGI + FEIE add-back).`,
        `Post-IRA-2022 §80101 ZERO 400%-FPL cliff applies through TY2025; the 400% cliff REINSTATES TY2026 absent legislation — a repayment over 400% FPL is then uncapped.`,
        `Coordinates with G1.42 SE Health Insurance — both reference the same premiums (Pub 974 circular calc when both apply).`,
      ],
      // When the optimizer ran (baselineInputs present + beneficial), the actionable
      // mitigation becomes the engine-verified headline; otherwise |netPtc| stands.
      whatIf: optimizerBeneficial ? optimizerWhatIf : undefined,
    };
  }

  const agi = computed.adjustedGrossIncome;
  if (agi < G1_30_AGI_MIN || agi > G1_30_AGI_MAX) return null;
  // Proxy for marketplace coverage: client has SE income (less likely
  // employer-sponsored). Engine has no PTC-specific marker yet.
  const netSe = computed.detail.se.netSeEarnings;
  if (netSe <= 0) return null;
  // Suppress if a premium_tax_credit adjustment is already present.
  const existingPtc = sumAdjustment(adjustments, "premium_tax_credit");
  if (existingPtc !== 0) return null; // any signal client already reconciled

  const estSavings = G1_30_HEURISTIC_BENEFIT;

  const strategy = strategyById("G1.30");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    estSavings,
    taxYear: computed.taxYear,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client AGI ${fmt(Math.round(agi))} is within the ACA Marketplace relevance range with SE income ` +
      `(${fmt(Math.round(netSe))}) — likely buying coverage independently. Accurate mid-year MAGI ` +
      `projection avoids advance-PTC overpayment that gets clawed back on Form 8962 reconciliation.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(agi),
      netSeEarnings: Math.round(netSe),
      agiMin: G1_30_AGI_MIN,
      agiMax: G1_30_AGI_MAX,
      heuristicBenefit: G1_30_HEURISTIC_BENEFIT,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify Marketplace coverage. Uses (AGI in range + SE income) as proxy. CPA confirms 1095-A presence.`,
      `TY${computed.taxYear} threshold: 100-400% FPL household income. Post-IRA 2022 §80101 extended ZERO cap through TY2025 (no 400% cliff). 400% cliff REINSTATES TY2026 absent legislation.`,
      `Heuristic estSavings $1,000 — typical overpayment avoidance. Real reconciliation can range from $0 (perfect projection) to several $k (large mid-year income change).`,
      `Strategy is FORWARD-LOOKING — applies to projecting next year's MAGI accurately. Current-year reconciliation handled on Form 8962.`,
      `Coordinates with G1.42 SE Health Insurance — both apply to the same premiums (Pub 974 circular calculation when both used).`,
      `Engine doesn't yet model PTC directly — no H2 mutation. Heuristic informational only.`,
    ],
  };
}

// ── G1.41 — §1045 QSBS Rollover (heuristic) ──────────────────────────────

const G1_41_MIN_FOUNDER_SIGNAL = 200_000;
const G1_41_MIN_LTCG = 500_000;
const G1_41_DEFERRAL_RATE = (0.20 + 0.038) * 0.3;

function detectSection1045Rollover(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  // Founder profile signal: K-1 active income > $50k OR net SE > $200k OR
  // total income > $200k (proxy for "could plausibly own QSBS").
  const k1Active = computed.scheduleK1?.totalActiveOrdinaryIncome ?? 0;
  const netSe = computed.detail.se.netSeEarnings;
  const founderSignal = k1Active >= 50_000 || netSe >= G1_41_MIN_FOUNDER_SIGNAL ||
                        computed.totalIncome >= G1_41_MIN_FOUNDER_SIGNAL;
  if (!founderSignal) return null;
  const ltcg = computed.form1099Summary?.longTermCapitalGains ?? 0;
  if (ltcg < G1_41_MIN_LTCG) return null;
  // Suppress if §1045 marker present.
  const existing = sumAdjustment(adjustments, "section_1045_rollover_gain");
  if (existing > 0) return null;

  // Assume deferred gain ≈ LTCG amount (cap at $500k for conservativeness).
  const deferredGain = Math.min(ltcg, 500_000);
  const estSavings = Math.round(deferredGain * G1_41_DEFERRAL_RATE);
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.41");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has founder-profile signals (K-1 active ${fmt(Math.round(k1Active))} / net SE ` +
      `${fmt(Math.round(netSe))} / total income ${fmt(Math.round(computed.totalIncome))}) + LTCG ` +
      `${fmt(Math.round(ltcg))}. If any of that LTCG came from §1202 QSBS held > 6 months AND ` +
      `client reinvested in another QSBS within 60 days, §1045 defers up to ${fmt(deferredGain)} ` +
      `of cap-gain tax.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      k1ActiveIncome: Math.round(k1Active),
      netSeEarnings: Math.round(netSe),
      totalIncome: Math.round(computed.totalIncome),
      ltcg: Math.round(ltcg),
      deferredGainAssumed: deferredGain,
      deferralRate: G1_41_DEFERRAL_RATE,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify QSBS status of sold stock. CPA confirms all 6 §1202 requirements at original sale.`,
      `Original stock must have been held > 6 MONTHS (vs §1202's > 5 years for outright exclusion).`,
      `60-DAY DEADLINE from sale to reinvest in qualifying replacement QSBS.`,
      `Replacement stock must ALSO meet all §1202 QSBS criteria (C-corp gross assets ≤ $50M at issuance + active T/B + qualified type, etc.).`,
      `Basis CARRYS OVER to new QSBS — gain is DEFERRED, not eliminated.`,
      `If replacement is held to satisfy original 5-year window combined with carryover holding period, can ultimately qualify for §1202 100% exclusion.`,
      `Heuristic deferral value = (LTCG 20% + NIIT 3.8%) × 0.3 time-value factor.`,
      `Filed via Form 8949 with code 'R' for rollover.`,
    ],
  };
}

// ── G1.42 — Self-Employed Health Insurance §162(l) (H2-wired) ────────────

const G1_42_MIN_NET_SE = 30_000;
const G1_42_ASSUMED_PREMIUMS = 12_000;

function detectSelfEmployedHealthIns(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { computed, adjustments, baselineInputs } = args;
  const netSe = computed.detail.se.netSeEarnings;
  if (netSe < G1_42_MIN_NET_SE) return null;
  // Suppress if already claimed.
  const existing = sumAdjustment(adjustments, "self_employed_health_insurance_premiums");
  if (existing > 0) return null;

  // Cap at (net SE − half-SE) per §162(l)(2)(A). Heuristic assumes $12k
  // premiums fits under this cap for most clients (it does whenever netSE
  // > ~$13k).
  const halfSe = computed.detail.se.deductibleHalf;
  const cap = Math.max(0, netSe - halfSe);
  const deductible = Math.min(G1_42_ASSUMED_PREMIUMS, cap);
  if (deductible <= 0) return null;

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  const estSavings = Math.round(deductible * (fedRate + stateRate));

  // H2: add self_employed_health_insurance_premiums adjustment. Engine
  // already supports this via K5 (Form 7206) — it'll apply the cap.
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.42-sehi",
    label: `SEHI premiums $${G1_42_ASSUMED_PREMIUMS.toLocaleString("en-US")}`,
    mutations: [
      { kind: "add_adjustment", adjustmentType: "self_employed_health_insurance_premiums", amount: G1_42_ASSUMED_PREMIUMS },
    ],
    semantics: "savings",
    varyAmount: true,
  });

  const strategy = strategyById("G1.42");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    premiumsAssumed: G1_42_ASSUMED_PREMIUMS,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Net SE earnings ${fmt(Math.round(netSe))} support a 100% above-the-line deduction of health ` +
      `insurance premiums per §162(l). Cap: ${fmt(Math.round(cap))} (net SE − half-SE). Assumed ` +
      `$12,000/year premiums = ${fmt(deductible)} deductible → ${fmt(estSavings)} tax savings at ` +
      `the combined ${((fedRate + stateRate) * 100).toFixed(1)}% marginal rate.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      halfSeDeduction: Math.round(halfSe),
      sectionLCap: Math.round(cap),
      assumedPremiums: G1_42_ASSUMED_PREMIUMS,
      deductible: Math.round(deductible),
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
    },
    assumptions: [
      `IRC §162(l) deduction is 100% of qualified health insurance premiums for SE + spouse + dependents.`,
      `Engine already supports this via the self_employed_health_insurance_premiums adjustment (K5 — Form 7206).`,
      `Cap per §162(l)(2)(A): premiums can't exceed (net SE − half-SE − retirement plan contributions).`,
      `DISQUALIFICATION: SE filer cannot be eligible to participate in employer-subsidized health plan via OWN or SPOUSE'S employer (§162(l)(2)(B)). CPA confirms.`,
      `Heuristic assumes $12k/yr premiums (typical for single/family in 2024). CPA refines with actual amounts.`,
      `S-corp owners: premiums must be reported on W-2 box 1 first (S-corp owns policy + pays/reimburses).`,
      `Coordinates with G1.30 ACA PTC — Pub 974 iterative method for circular calc when both apply.`,
      `H2 mutation models adding the deduction — engine applies the §162(l)(2)(A) cap automatically.`,
    ],
    whatIf,
  };
}

// ── G1.43 — Wash-sale proactive avoidance (heuristic) ────────────────────

const G1_43_MIN_CAP_LOSS_CF = 5_000;
const G1_43_FORFEIT_PREVENTION = 3_000;

function detectWashSaleAvoidance(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  const capLossCf = sumAdjustment(adjustments, "capital_loss_carryforward_short") +
                    sumAdjustment(adjustments, "capital_loss_carryforward_long");
  if (capLossCf < G1_43_MIN_CAP_LOSS_CF) return null;

  const fedRate = federalMarginalRate(computed);
  // estSavings = $3,000 (annual offset cap) × marginal ordinary rate
  const estSavings = Math.round(G1_43_FORFEIT_PREVENTION * fedRate);
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.43");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(capLossCf))} of capital loss carryforward — signals active ` +
      `tax-loss harvesting. Coaching client to avoid §1091 wash sales (no repurchase within 30 days ` +
      `before/after sale) prevents forfeiting losses. Estimated annual benefit on $3k typical cycle ` +
      `~${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      capitalLossCarryforward: Math.round(capLossCf),
      forfeitPreventionAmount: G1_43_FORFEIT_PREVENTION,
      federalMarginalRate: fedRate,
    },
    assumptions: [
      `FORWARD-LOOKING coaching — applies before client realizes losses, not after.`,
      `Engine already detects POST-event wash sales via E13 (auto-detection on capital_transactions table).`,
      `Wash-sale window: 30 days BEFORE + sale date + 30 days AFTER = 61-day exposure window.`,
      `Substantially-identical determination: same stock = yes; bond/preferred from same issuer = situational; ETF tracking same index = often yes; sector-ETF rotation = usually safe.`,
      `Cross-account wash sale: spouse's IRA / Roth IRA = IRS Rev. Rul. 2008-5 confirms IRA-side wash (no basis adjustment available → PERMANENT forfeit).`,
      `Heuristic estSavings = $3,000 annual ordinary-offset cap × marginal rate. Real value scales with typical TLH cycle.`,
    ],
  };
}

// ── G1.50 — §72(t) SEPP early-retirement (heuristic) ─────────────────────

const G1_50_MIN_AGE = 50;
const G1_50_MAX_AGE = 58;
const G1_50_MIN_TRAD_IRA = 200_000;
const G1_50_MAX_TOTAL_INCOME = 200_000;
const G1_50_ANNUAL_DRAW = 30_000;
const G1_50_PENALTY_RATE = 0.10;
const G1_50_DEFAULT_HORIZON = 5;

function detectSection72tSepp(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { client, computed, assetBalances } = args;
  const age = client.taxpayerAge;
  if (age == null || age < G1_50_MIN_AGE || age > G1_50_MAX_AGE) return null;
  if (computed.totalIncome > G1_50_MAX_TOTAL_INCOME) return null;
  if (!assetBalances || assetBalances.length === 0) return null;
  const tradTypes = new Set(["traditional_ira", "sep_ira", "simple_ira"]);
  const tradBalance = assetBalances
    .filter((a) => tradTypes.has(a.assetType))
    .reduce((s, a) => s + toNum(a.balance), 0);
  if (tradBalance < G1_50_MIN_TRAD_IRA) return null;

  // estSavings = avoided 10% penalty on $30k/yr × 5 yrs
  const estSavings = Math.round(G1_50_ANNUAL_DRAW * G1_50_PENALTY_RATE * G1_50_DEFAULT_HORIZON);

  const strategy = strategyById("G1.50");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client age ${age} with ${fmt(Math.round(tradBalance))} of pre-tax IRA balance + total income ` +
      `${fmt(Math.round(computed.totalIncome))} (modest — suggests possible early-retirement transition). ` +
      `§72(t) SEPP allows penalty-free withdrawal from age ${G1_50_MIN_AGE} to 59½. Avoided 10% ` +
      `penalty on ${fmt(G1_50_ANNUAL_DRAW)}/yr × ${G1_50_DEFAULT_HORIZON} yrs ~${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      taxpayerAge: age,
      tradIraBalance: Math.round(tradBalance),
      totalIncome: Math.round(computed.totalIncome),
      annualDrawAssumed: G1_50_ANNUAL_DRAW,
      penaltyRate: G1_50_PENALTY_RATE,
      horizonYears: G1_50_DEFAULT_HORIZON,
    },
    assumptions: [
      `HEURISTIC — fires for age 50-58 + IRA > $200k + total income < $200k as proxy for early-retirement transition. CPA confirms intent.`,
      `Must continue SEPP for 5 YEARS OR until age 59½ — WHICHEVER IS LATER. Modification before that = 10% penalty + interest RETROACTIVELY on ALL prior years' withdrawals.`,
      `Three methods per Notice 2022-6: (1) RMD method, (2) fixed amortization, (3) fixed annuitization. Election is LOCKED IN.`,
      `Interest rate cap: not more than 120% of mid-term AFR for the 2 prior months (Notice 2022-6).`,
      `Best practice: establish a DEDICATED SEPP IRA via partial rollover so only that account follows SEPP rules — leaves other IRA balances flexible.`,
      `Heuristic estSavings $15,000 = 10% × $30k/yr × 5 yrs. Real number scales with actual withdrawal amount + years to 59½.`,
      `Coordinate with G1.22 pre-RMD Roth ladder — both apply in same age band; sequence matters.`,
    ],
  };
}

// ── G1.52 — Estimated Tax Safe Harbor §6654 (heuristic) ─────────────────

const G1_52_MIN_SE = 20_000;
const G1_52_MIN_FED_TAX = 5_000;
const G1_52_HEURISTIC_PENALTY = 300;

function detectEstimatedTaxSafeHarbor(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  const netSe = computed.detail.se.netSeEarnings;
  if (netSe < G1_52_MIN_SE) return null;
  if (computed.federalTaxLiability < G1_52_MIN_FED_TAX) return null;
  void adjustments;

  // Determine 100% vs 110% rule based on AGI threshold.
  const safeHarborPct = computed.adjustedGrossIncome > 150_000 ? 110 : 100;
  const estSavings = G1_52_HEURISTIC_PENALTY;

  const strategy = strategyById("G1.52");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    safeHarborPct,
    estSavings,
    taxYear: computed.taxYear,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(netSe))} net SE earnings + ${fmt(Math.round(computed.federalTaxLiability))} ` +
      `federal tax. SE income lacks W-2 withholding — at risk of §6654 underpayment penalty unless ` +
      `quarterly estimated tax is paid. Safe harbor: ${safeHarborPct}% of prior year tax.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      federalTaxLiability: Math.round(computed.federalTaxLiability),
      agi: Math.round(computed.adjustedGrossIncome),
      safeHarborPct,
      heuristicPenalty: G1_52_HEURISTIC_PENALTY,
    },
    assumptions: [
      `HEURISTIC — engine doesn't yet track quarterly withholding vs prior-year safe harbor. Fires on SE-heavy income mix as proxy for underpayment risk.`,
      `Safe harbor §6654(d)(1)(B): pay greater of (100% of prior tax / 110% if AGI > $150k) OR 90% of current.`,
      `110% threshold ($150k AGI single / $75k MFS) — applies based on PRIOR-year AGI per §6654(d)(1)(C).`,
      `Withholding treated as paid EVENLY over the year — estimated tax payments credited by QUARTER.`,
      `Quarterly due dates: April 15, June 15, September 15, January 15 (per §6654(c)).`,
      `Penalty = (underpayment × AFR + 3% per §6621) by quarter, computed via Form 2210.`,
      `Annualized-income method (Form 2210 Schedule AI) available for clients with uneven income (seasonal SE).`,
      `Heuristic estSavings $300 typical — real penalty scales with shortfall + interest period.`,
    ],
  };
}

// ── G1.53 — Kiddie Tax §1(g) minimization (heuristic) ────────────────────

const G1_53_MIN_AGI = 200_000;
const G1_53_ASSUMED_EXCESS = 5_000;
const G1_53_RATE_DIFFERENTIAL = 0.32 - 0.10;

function detectKiddieTax(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { client, computed } = args;
  // PLAN-04: kiddie tax (§1(g)) reaches children under 18 AND 18-23 full-time
  // students — both populations beyond the CTC under-17 count. 17-year-olds
  // and student dependents live in otherDependents, so gate on the broader
  // eligible-children proxy (was dependentsUnder17 only, which under-fired).
  const eligibleChildren = countEligibleChildren(client);
  if (eligibleChildren <= 0) return null;
  if (computed.adjustedGrossIncome < G1_53_MIN_AGI) return null;

  // Year-correct §1(g) net-unearned-income threshold (= 2× the dependent floor:
  // $2,600 TY2024 / $2,700 TY2025-26) from the engine's map, not a hard-coded
  // TY2024 value. Informational only here — it does not gate fire/no-fire.
  const kiddieYear = resolveTaxYear(computed.taxYear);
  const unearnedThreshold = KIDDIE_TAX_THRESHOLD[kiddieYear];
  const childFloorHalf = Math.round(unearnedThreshold / 2);

  // estSavings per affected child × num kids (conservatively assume 1 affected).
  const numAffected = Math.min(eligibleChildren, 1);
  const estSavings = Math.round(G1_53_ASSUMED_EXCESS * G1_53_RATE_DIFFERENTIAL * numAffected);

  const strategy = strategyById("G1.53");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client AGI ${fmt(Math.round(computed.adjustedGrossIncome))} + ${eligibleChildren} dependent child(ren) ` +
      `(incl. any 17-yr-olds / 18-23 full-time students). If a child subject to kiddie tax has unearned income ` +
      `> ${fmt(unearnedThreshold)} (TY${kiddieYear} threshold), the excess is taxed at the parent's marginal rate via Form 8615. Shift to ` +
      `growth-oriented or tax-deferred investments to minimize current-year unearned income. Per affected ` +
      `child: ~${fmt(estSavings)}/year.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      eligibleChildren,
      dependentsUnder17: client.dependentsUnder17 ?? 0,
      otherDependents: client.otherDependents ?? 0,
      numAffectedAssumed: numAffected,
      agi: Math.round(computed.adjustedGrossIncome),
      unearnedThreshold,
      kiddieThresholdYear: kiddieYear,
      assumedExcessUnearned: G1_53_ASSUMED_EXCESS,
      rateDifferential: G1_53_RATE_DIFFERENTIAL,
    },
    assumptions: [
      `HEURISTIC — engine cannot track a child's unearned income. Fires for HNW families with dependent children (under-18, or 18-23 full-time students — both reached via dependentsUnder17 + otherDependents).`,
      `CPA filters otherDependents for non-child relatives (e.g. an elderly parent dependent isn't a kiddie-tax subject).`,
      `TY${kiddieYear} unearned-income thresholds (Rev. Proc.): ${fmt(childFloorHalf)} (no tax) + ${fmt(childFloorHalf)} (child's rate) = ${fmt(unearnedThreshold)} free.`,
      `Excess unearned income taxed at PARENT's marginal rate per IRC §1(g)(7)(A) and Form 8615.`,
      `Kiddie tax applies under 18 (or 18-23 if full-time student dependent, or 18 with no earned income > half support).`,
      `Rate differential heuristic ${(G1_53_RATE_DIFFERENTIAL * 100).toFixed(0)}% = parent 32% − child 10%. Real differential varies (could be 27% at top brackets).`,
      `Mitigation: shift child investments to growth-oriented (LTCG-favored), tax-deferred wrappers (529 / custodial Roth), or delay realization until child turns 18.`,
      `Election: Form 8814 lets parent report on parent's return (only if the child's gross income is under the Form 8814 cap for the year, ~$13k).`,
    ],
  };
}

// ── G1.54 — §183 Hobby Loss qualification (heuristic) ────────────────────

const G1_54_HOBBY_RANGE_MIN = 1_000;
const G1_54_HOBBY_RANGE_MAX = 10_000;
const G1_54_ASSUMED_LOSS = 5_000;

function detectHobbyLossQualification(args: {
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { computed } = args;
  const netSe = computed.detail.se.netSeEarnings;
  // Heuristic: SE income in $1k-$10k range signals possible hobby concern
  // (low profit, ambiguous business). Outside this range, presumed business
  // or pure hobby — no planning angle.
  if (netSe < G1_54_HOBBY_RANGE_MIN || netSe > G1_54_HOBBY_RANGE_MAX) return null;

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  const estSavings = Math.round(G1_54_ASSUMED_LOSS * (fedRate + stateRate));

  const strategy = strategyById("G1.54");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Net SE earnings ${fmt(Math.round(netSe))} are in the borderline $1k-$10k range — IRS scrutiny ` +
      `risk for §183 hobby-vs-business reclassification. If activity becomes a hobby (Reg §1.183-2(b) ` +
      `9-factor test fails), post-TCJA NO expense deduction. Preserving business status protects ` +
      `~${fmt(estSavings)} of typical deductible loss recovery.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      hobbyRangeMin: G1_54_HOBBY_RANGE_MIN,
      hobbyRangeMax: G1_54_HOBBY_RANGE_MAX,
      assumedLoss: G1_54_ASSUMED_LOSS,
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
    },
    assumptions: [
      `HEURISTIC — fires for borderline SE income ($1k-$10k) where IRS hobby-reclassification risk is highest.`,
      `Post-TCJA: hobby losses + expenses are NOT deductible at all (was 2%-AGI misc itemized pre-2018).`,
      `Safe harbor §183(d): presumed for profit if profitable 3 of 5 years (2 of 7 for horse breeding).`,
      `Failing safe harbor: 9-factor test (Reg §1.183-2(b)) — profit motive, expertise, time/effort, asset appreciation, prior success, history of income/loss, level of profit, financial status, personal pleasure.`,
      `Documentation requirements: separate bank account, written business plan, accounting books, contemporaneous time logs, professional advisors.`,
      `Assumed $5k typical loss recovery × marginal rate. Real value varies.`,
      `Engine cannot verify documentation quality — CPA reviews actual records.`,
    ],
  };
}

// ── G1.55 — Custodial Roth IRA for child (heuristic) ─────────────────────

const G1_55_MIN_NET_SE = 50_000;
const G1_55_CONTRIBUTION_CAP = 7_000;
const G1_55_GROWTH_50YR = Math.pow(1.07, 50);
const G1_55_DISCOUNT_50YR = Math.pow(1.05, 50);
const G1_55_FUTURE_RATE = 0.32;

function detectCustodialRothIra(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { client, computed } = args;
  const netSe = computed.detail.se.netSeEarnings;
  if (netSe < G1_55_MIN_NET_SE) return null;
  const kidsUnder17 = client.dependentsUnder17 ?? 0;
  if (kidsUnder17 <= 0) return null;

  // PV of $7k Roth contribution at 7% growth × 50 yrs × 32% future rate,
  // discounted at 5%/yr. Per child assumed.
  const growthDollars = G1_55_CONTRIBUTION_CAP * (G1_55_GROWTH_50YR - 1);
  const estSavingsPerChild = Math.round((growthDollars * G1_55_FUTURE_RATE) / G1_55_DISCOUNT_50YR);
  const numAffected = Math.min(kidsUnder17, 1); // conservative: 1 child
  const estSavings = estSavingsPerChild * numAffected;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.55");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(netSe))} net SE + ${kidsUnder17} dependent(s) under 17 — fits the ` +
      `family-employment (G1.49) pattern. Once child has W-2 earned income from the business, parent ` +
      `can open a custodial Roth IRA + contribute up to ${fmt(G1_55_CONTRIBUTION_CAP)}/yr (or earned ` +
      `income, whichever less). 50+ years of tax-free growth: PV ~${fmt(estSavings)} per child per year.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      dependentsUnder17: kidsUnder17,
      numAffectedAssumed: numAffected,
      contributionCap: G1_55_CONTRIBUTION_CAP,
      growthAssumption: 0.07,
      futureRateAssumption: G1_55_FUTURE_RATE,
      discountRate: 0.05,
      horizonYears: 50,
      estSavingsPerChild,
    },
    assumptions: [
      `Companion to G1.49 family employment — child needs EARNED INCOME (W-2 wages or SE) to fund Roth.`,
      `Contribution cap: lesser of $7,000 (TY2024) or child's earned income.`,
      `Long-term PV uses 7%/yr growth × 50 yrs × 32% future rate, discounted at 5%/yr.`,
      `ZERO current-year tax benefit (Roth is after-tax). MASSIVE long-term tax-free growth.`,
      `Custodial Roth IRA (UTMA/UGMA-titled): parent or guardian as custodian. Child takes control at age 18 or 21 by state.`,
      `Heuristic assumes 1 child funded. Multi-child families scale linearly (each child gets own Roth + contribution cap).`,
      `Roth contributions ALWAYS withdrawable tax-free as basis recovery (Treas. Reg. §1.408A-6 Q&A 8) — no penalty even before 59½.`,
    ],
  };
}

// ── G1.56 — Specific-Share-ID at sale (heuristic) ────────────────────────

const G1_56_MIN_GAIN = 5_000;
const G1_56_BASIS_DIFFERENTIAL_PCT = 0.04; // 4% of gain heuristic (20% basis-spread × 20% LTCG)

function detectSpecificShareId(args: {
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { computed } = args;
  const ltcg = computed.form1099Summary?.longTermCapitalGains ?? 0;
  const stcg = computed.form1099Summary?.shortTermCapitalGains ?? 0;
  const totalGain = ltcg + stcg;
  if (totalGain < G1_56_MIN_GAIN) return null;

  const estSavings = Math.round(totalGain * G1_56_BASIS_DIFFERENTIAL_PCT);
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.56");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    estSavings,
    saleAmount: Math.round(totalGain),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client realized ${fmt(Math.round(totalGain))} of capital gains (LT ${fmt(Math.round(ltcg))} + ` +
      `ST ${fmt(Math.round(stcg))}) from brokerage activity. Default lot-ID = FIFO. Switching to ` +
      `specific-lot identification (HIFO or hand-picked lots) BEFORE the sell order can shave ~4% ` +
      `of gain ≈ ${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      longTermCapitalGains: Math.round(ltcg),
      shortTermCapitalGains: Math.round(stcg),
      totalGain: Math.round(totalGain),
      basisDifferentialPct: G1_56_BASIS_DIFFERENTIAL_PCT,
    },
    assumptions: [
      `Election must be made AT TIME OF SALE per Treas. Reg. §1.1012-1(c)(7) — NOT retroactively at 1040 filing.`,
      `Default lot-ID for individual brokerage = FIFO. Mutual funds default = average cost.`,
      `Specific-ID election allowed for covered shares (post-2012 stocks per IRC §6045(g)(2)(B)).`,
      `HIFO (highest-in-first-out) typically minimizes gain on partial sale.`,
      `Heuristic 4%-of-gain assumes 20% lot-basis spread × 20% LTCG rate. Real differential varies by holding length + price history.`,
      `Engine does NOT have per-lot data — heuristic only. CPA reviews 1099-B basis breakdown.`,
      `Note: long-term vs short-term lot selection ALSO matters — selecting LT lots over ST at same basis swap saves the bracket differential (e.g., 22% ord vs 15% LTCG).`,
    ],
  };
}

// ── G1.57 — NQDC §409A deferred comp election (heuristic) ───────────────

const G1_57_MIN_W2 = 400_000;
const G1_57_MIN_AGE = 40;
const G1_57_MAX_AGE = 55;
const G1_57_ASSUMED_DEFERRAL = 100_000;
const G1_57_BRACKET_SPREAD = 0.37 - 0.22;

function detectNqdc409a(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, baselineInputs } = args;
  const age = client.taxpayerAge;
  if (age == null || age < G1_57_MIN_AGE || age > G1_57_MAX_AGE) return null;
  // M3 (audit 2026-06-11) — NQDC is EMPLOYER deferred comp: require ACTUAL
  // W-2s and gate on the wage signal, not raw totalIncome (a $500k-K-1 owner
  // with no W-2 is not an NQDC candidate).
  const { hasW2, wages } = w2WagesSignal(computed, baselineInputs);
  if (!hasW2) return null;
  const totalIncome = wages;
  if (totalIncome < G1_57_MIN_W2) return null;

  const estSavings = Math.round(G1_57_ASSUMED_DEFERRAL * G1_57_BRACKET_SPREAD);

  const strategy = strategyById("G1.57");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    deferralAmount: G1_57_ASSUMED_DEFERRAL,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client age ${age} with ${fmt(Math.round(totalIncome))} of W-2 wages (executive-comp range). ` +
      `If employer offers NQDC plan, defer ${fmt(G1_57_ASSUMED_DEFERRAL)} of current compensation to ` +
      `retirement. Bracket arbitrage: current ~37% vs retirement ~22% = ${fmt(estSavings)}/yr saved.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      taxpayerAge: age,
      totalIncome: Math.round(totalIncome),
      assumedDeferral: G1_57_ASSUMED_DEFERRAL,
      bracketSpread: G1_57_BRACKET_SPREAD,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify NQDC plan availability. Fires for high-income W-2 clients age 40-55 (transition-to-retirement window).`,
      `Initial election timing: must elect BEFORE start of service year per §409A(a)(4)(B). 30-day window for new participants.`,
      `Distribution events allowed (§409A(a)(2)): separation, death, disability, change in control, hardship, OR specified date.`,
      `Violation = immediate income recognition + 20% additional tax + interest at AFR + 1%/quarter per §409A(a)(1)(B).`,
      `CREDIT RISK: NQDC is unsecured promise. Diversify with other retirement vehicles.`,
      `Bracket-spread heuristic 15% = current 37% − retirement 22%. Real spread depends on client's projected retirement income trajectory.`,
      `Assumed $100k deferral. Real plans allow 25-100% of base + 100% of bonus typically.`,
      `Coordinate with §457(b) governmental NQDC (separate rules) + §280G golden parachute.`,
    ],
  };
}

// ── G1.58 — State residency change planning (heuristic) ─────────────────

const G1_58_HIGH_TAX_STATES = new Set(["CA", "NY", "NJ", "HI", "OR", "MA", "CT", "MD"]);
const G1_58_MIN_AGI = 500_000;
const G1_58_MIN_STATE_TAX = 30_000;
const G1_58_SAVINGS_RATE = 0.50;

function detectStateResidencyChange(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { client, computed } = args;
  const state = (client.state ?? "").toUpperCase();
  if (!G1_58_HIGH_TAX_STATES.has(state)) return null;
  if (computed.adjustedGrossIncome < G1_58_MIN_AGI) return null;
  if (computed.stateTaxLiability < G1_58_MIN_STATE_TAX) return null;

  const estSavings = Math.round(computed.stateTaxLiability * G1_58_SAVINGS_RATE);

  const strategy = strategyById("G1.58");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    currentState: state,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client is ${state} resident (high-tax state) with AGI ${fmt(Math.round(computed.adjustedGrossIncome))} ` +
      `+ ${fmt(Math.round(computed.stateTaxLiability))} state tax. Relocating to no-tax state ` +
      `(TX, FL, NV, WA, TN, SD, AK, WY) could save ~${fmt(estSavings)} (50%-effective heuristic ` +
      `accounting for partial-year transition).`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      currentState: state,
      agi: Math.round(computed.adjustedGrossIncome),
      stateTaxLiability: Math.round(computed.stateTaxLiability),
      assumedSavingsRate: G1_58_SAVINGS_RATE,
    },
    assumptions: [
      `Multi-year strategy — domicile + residency change requires 12-24 months of execution + audit-proof documentation.`,
      `CA Rev & Tax Code §17014: 183-day test + facts-and-circumstances domicile test. NY Tax Law §605: similar.`,
      `NY 'statutory residence': (183+ days) AND (permanent place of abode) — even non-domiciliaries can be taxed.`,
      `AUDIT RISK: CA + NY known for aggressive residency challenges. Document EVERYTHING (calendar, receipts, social media).`,
      `Income sourcing: wages where earned, business where operated, rental where property is. Residency-based portion saves; source-based portion doesn't.`,
      `Heuristic 50% savings — real rate varies. Conservative because transition year is part-year + relocating income-producing assets takes time.`,
      `Coordinate with H4 state-comparison engine (Phase H) for client-specific delta projection.`,
      `Trust + estate planning: change trustee state, situs of trusts.`,
    ],
  };
}

// ── G1.59 — Coverdell ESA §530 (heuristic) ───────────────────────────────

const G1_59_AGI_PHASE_OUT_TOP: Record<string, number> = {
  single: 110_000,
  head_of_household: 110_000,
  married_filing_jointly: 220_000,
  qualifying_widow: 220_000,
  married_filing_separately: 0,
};
const G1_59_CONTRIBUTION_CAP = 2_000;
const G1_59_GROWTH_15YR = Math.pow(1.07, 15);
const G1_59_DISCOUNT_15YR = Math.pow(1.05, 15);

function detectCoverdellEsa(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { client, computed, adjustments } = args;
  if (client.filingStatus === "married_filing_separately") return null;
  // PLAN-04: Coverdell beneficiaries are children under 18 — a 17-year-old
  // (one more contribution year) sits in otherDependents, not dependentsUnder17.
  // Gate on the broader eligible-children proxy; the under-18 caveat below
  // tells the CPA to exclude any 18-23 student dependents swept into the count.
  const eligibleChildren = countEligibleChildren(client);
  if (eligibleChildren <= 0) return null;
  const cap = G1_59_AGI_PHASE_OUT_TOP[client.filingStatus] ?? G1_59_AGI_PHASE_OUT_TOP.single;
  if (computed.adjustedGrossIncome > cap) return null;
  void adjustments;

  const fedRate = federalMarginalRate(computed);
  // PV per child: $2k × (1.07^15 − 1) × marginal / 1.05^15
  const growthDollars = G1_59_CONTRIBUTION_CAP * (G1_59_GROWTH_15YR - 1);
  const estSavingsPerChild = Math.round((growthDollars * fedRate) / G1_59_DISCOUNT_15YR);
  const numAffected = Math.min(eligibleChildren, 1);
  const estSavings = estSavingsPerChild * numAffected;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.59");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${eligibleChildren} dependent child(ren) (incl. any 17-yr-olds in otherDependents) + AGI ` +
      `${fmt(Math.round(computed.adjustedGrossIncome))} (under ${fmt(cap)} Coverdell cap). Contribute ` +
      `${fmt(G1_59_CONTRIBUTION_CAP)}/yr per beneficiary UNDER 18 for tax-free K-12 + college growth. ` +
      `Long-term PV ~${fmt(estSavings)} per child.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      filingStatus: client.filingStatus,
      agi: Math.round(computed.adjustedGrossIncome),
      phaseOutTop: cap,
      eligibleChildren,
      dependentsUnder17: client.dependentsUnder17 ?? 0,
      otherDependents: client.otherDependents ?? 0,
      contributionCap: G1_59_CONTRIBUTION_CAP,
      federalMarginalRate: fedRate,
      estSavingsPerChild,
      numAffectedAssumed: numAffected,
    },
    assumptions: [
      `NO current-year 1040 tax effect — Coverdell contributions are NOT federally deductible and there is no credit; the entire value is TAX-FREE GROWTH (modeled here as a long-term PV). So §530 is correctly INFORMATIONAL — there is nothing for the engine to compute/verify (unlike §23/§41 which are real credits).`,
      `Contribution cap $2,000/yr PER BENEFICIARY — aggregate across all contributors.`,
      `Beneficiary must be under 18 (or special needs to age 21) when contributed. The eligible-children count includes otherDependents (to catch 17-yr-olds) — CPA excludes any 18-23 student dependents swept in, who can no longer receive new contributions.`,
      `AGI phase-out TY2024 (Rev. Proc. 2023-34 §3.20): $95k-$110k single / $190k-$220k MFJ.`,
      `Tax-free for QUALIFIED K-12 AND post-secondary education expenses (more flexible than §529 K-12 $10k/yr cap).`,
      `Non-qualified withdrawals: earnings portion taxable + 10% penalty.`,
      `Coordinates with G1.29 §529→Roth — both allowed; Coverdell better for K-12, §529 better for college + larger contributions.`,
      `Rollover from Coverdell to §529 allowed (one-way per Rev. Proc. 2017-24).`,
      `15-year PV horizon used in heuristic (typical K-12 + college timeframe).`,
    ],
  };
}

// ── G1.60 — §41(h) R&D Payroll-Tax Election (heuristic) ─────────────────

const G1_60_MIN_SE = 100_000;
const G1_60_MAX_SE = 5_000_000;
const G1_60_HEURISTIC_BENEFIT = 5_000;

function detectRdPayrollElection(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  const netSe = computed.detail.se.netSeEarnings;
  if (netSe < G1_60_MIN_SE || netSe > G1_60_MAX_SE) return null;
  // Suppress if R&D adjustment already present (signal client uses income-tax credit).
  void adjustments;

  const estSavings = G1_60_HEURISTIC_BENEFIT;

  const strategy = strategyById("G1.60");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(netSe))} net SE income — in the small-business range ($100k-$5M) ` +
      `where §41(h) payroll-tax election is most valuable. If business is < 5 years old + has W-2 ` +
      `employees doing R&D, elect to apply R&D credit against employer payroll tax up to $500k/yr cap. ` +
      `Heuristic ~${fmt(estSavings)} typical first-year benefit.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      minSe: G1_60_MIN_SE,
      maxSe: G1_60_MAX_SE,
      heuristicBenefit: G1_60_HEURISTIC_BENEFIT,
    },
    assumptions: [
      `ELIGIBILITY §41(h)(3): qualified small business — gross receipts < $5M AND in business < 5 years.`,
      `Cap: $500k/yr per IRA 2022 §13902 (doubled from $250k pre-IRA).`,
      `Beneficial for pre-revenue / low-income startups with no income tax to absorb the R&D credit.`,
      `WAGES requirement: §41 QREs require W-2 wages PAID by the company. Sole-prop SE earnings DON'T qualify on their own — need employees doing R&D.`,
      `Election made on Form 6765 attached to timely-filed (incl extensions) return.`,
      `Application via Form 8974 (Qualified Small Business Payroll Tax Credit) + Form 941 quarterly.`,
      `Election is ANNUAL — re-elect each year.`,
      `Coordinates with G1.36 income-tax R&D credit. If income tax exists, take that side first; if not, payroll election fills the gap.`,
      `Heuristic $5k — real first-year benefit ranges $2k-$50k+ based on QRE size + payroll tax magnitude.`,
    ],
  };
}

// ── G1.61 — §221 Student Loan Interest (H2-wired) ────────────────────────

const G1_61_DEDUCTION_CAP = 2_500;

function detectStudentLoanInterest(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, adjustments, baselineInputs } = args;
  if (client.filingStatus === "married_filing_separately") return null;
  // M2 (audit 2026-06-11) — the gate reads the ENGINE's year-indexed §221
  // phase-out band (sliPhaseOutBand — the same map calculateStudentLoanInterest
  // uses for the amount). The prior hardcoded TY2024 tops ($95k/$195k)
  // false-suppressed TY2025 single filers between $95k–$100k (Rev. Proc.
  // 2024-40 band $85k–$100k) and MFJ between $195k–$200k; wider for TY2026.
  const band = sliPhaseOutBand(client.filingStatus, computed.taxYear);
  if (!band) return null; // ineligible status
  const cap = band.end;
  if (computed.adjustedGrossIncome >= cap) return null;
  // Suppress if already claimed.
  if (sumAdjustment(adjustments, "student_loan_interest") > 0) return null;

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  // PLAN-05: apply the §221 phase-out fraction instead of assuming the full
  // $2,500 across the whole band. The detector only fires when no SLI deduction
  // is already claimed, so AGI == the §221 MAGI (§221(b)(2)(C) adds it back).
  const allowedDeduction = calculateStudentLoanInterest({
    interestPaid: G1_61_DEDUCTION_CAP,
    magi: computed.adjustedGrossIncome,
    filingStatus: client.filingStatus,
    taxYear: computed.taxYear,
  }).deductible;
  const estSavings = Math.round(allowedDeduction * (fedRate + stateRate));
  if (estSavings <= 0) return null;

  // H2 mutation: add student_loan_interest = $2,500. Engine treats as
  // above-the-line per §221.
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.61-student-loan-int",
    label: `§221 student loan interest $${G1_61_DEDUCTION_CAP.toLocaleString("en-US")}`,
    mutations: [
      { kind: "add_adjustment", adjustmentType: "student_loan_interest", amount: G1_61_DEDUCTION_CAP },
    ],
    semantics: "savings",
    varyAmount: false,
  });

  const strategy = strategyById("G1.61");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client AGI ${fmt(Math.round(computed.adjustedGrossIncome))} is within §221 phase-out cap of ` +
      `${fmt(cap)}. If client paid student loan interest, deduct up to $2,500 above-the-line on ` +
      `Schedule 1 Line 21. Saves ~${fmt(estSavings)} at the combined ${((fedRate + stateRate) * 100).toFixed(1)}% rate.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      filingStatus: client.filingStatus,
      agi: Math.round(computed.adjustedGrossIncome),
      phaseOutTop: cap,
      deductionCap: G1_61_DEDUCTION_CAP,
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
    },
    assumptions: [
      `§221 cap: $2,500/yr of qualified student loan interest paid.`,
      `TY${computed.taxYear} MAGI phase-out band for ${client.filingStatus}: $${band.start.toLocaleString("en-US")}–$${band.end.toLocaleString("en-US")} (engine's year-indexed §221 map — Rev. Proc. 2023-34 / 2024-40 / 2025-32).`,
      `Phase-out reduction: ratable, (band end − MAGI) / band width.`,
      `MFS — DISQUALIFIED per §221(f)(2).`,
      `Dependent of another taxpayer — DISQUALIFIED.`,
      `Related-party loans (family member) — DISQUALIFIED per §221(d)(1)(B).`,
      `Loan must be SOLELY to pay qualified higher education expenses for taxpayer / spouse / dependent.`,
      `Form 1098-E from servicer documents interest paid.`,
      `H2 mutation models adding the deduction; engine routes through above-the-line pipeline (Schedule 1 Line 21).`,
    ],
    whatIf,
  };
}

// ── G1.62 — §263A Inventory Method Choice (heuristic) ───────────────────

const G1_62_MIN_NET_SE = 100_000;
const G1_62_HEURISTIC_BENEFIT = 10_000;

function detectSection263aInventory(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  const netSe = computed.detail.se.netSeEarnings;
  if (netSe < G1_62_MIN_NET_SE) return null;
  void adjustments;

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  const estSavings = Math.round(G1_62_HEURISTIC_BENEFIT * (fedRate + stateRate));

  const strategy = strategyById("G1.62");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(netSe))} net SE income — if business carries inventory ` +
      `(retail/wholesale/manufacturing) and gross receipts avg < $30M over prior 3 yrs, can elect ` +
      `§263A(i) small-biz cash method via Form 3115 + skip UNICAP indirect cost capitalization. ` +
      `Heuristic ~${fmt(estSavings)} from acceleration + admin simplification.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      heuristicBenefit: G1_62_HEURISTIC_BENEFIT,
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify whether business actually carries inventory. CPA confirms.`,
      `§263A(i) small-biz exception: gross receipts < $30M (TY2024 indexed; was $25M pre-2018, now $30M per Rev. Proc. 2023-34 §3.32).`,
      `Cash method election bypasses UNICAP indirect cost capitalization — significant admin simplification.`,
      `Method change requires Form 3115 (Change in Accounting Method) with §481(a) catch-up adjustment.`,
      `§481(a) adjustment spread over 4 yrs (or 1 yr if favorable — usually a NET DECREASE in income).`,
      `Method choice generally LOCKED IN — opt out requires another Form 3115 with valid business purpose.`,
      `Heuristic estSavings $10k × marginal — actual depends on inventory volume + indirect cost mix.`,
    ],
  };
}

// ── G1.63 — Lot Rotation withdrawal sequence (heuristic) ────────────────

const G1_63_MIN_AGE = 60;
const G1_63_ANNUAL_OPTIMIZATION = 4_000;

function detectLotRotation(args: {
  client: ClientFacts;
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { client, assetBalances } = args;
  const age = client.taxpayerAge;
  if (age == null || age < G1_63_MIN_AGE) return null;
  if (!assetBalances || assetBalances.length === 0) return null;

  // Need diversified account types — trad-deferred + Roth + taxable.
  const tradTypes = new Set(["traditional_ira", "sep_ira", "simple_ira", "401k_traditional"]);
  const rothTypes = new Set(["roth_ira", "401k_roth"]);
  const taxableTypes = new Set(["brokerage_taxable"]);
  const hasTrad = assetBalances.some((a) => tradTypes.has(a.assetType) && toNum(a.balance) > 0);
  const hasRoth = assetBalances.some((a) => rothTypes.has(a.assetType) && toNum(a.balance) > 0);
  const hasTaxable = assetBalances.some((a) => taxableTypes.has(a.assetType) && toNum(a.balance) > 0);
  if (!(hasTrad && hasRoth && hasTaxable)) return null;

  const estSavings = G1_63_ANNUAL_OPTIMIZATION;

  const strategy = strategyById("G1.63");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client age ${age} with diversified retirement accounts (traditional + Roth + taxable brokerage). ` +
      `Optimal withdrawal sequence — taxable FIRST (LTCG-favored), tax-deferred NEXT (ordinary), Roth ` +
      `LAST (tax-free + no RMD + estate-favored) — preserves tax-advantaged growth longer. Annual ` +
      `benefit ~${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      taxpayerAge: age,
      hasTraditional: hasTrad,
      hasRoth: hasRoth,
      hasTaxable: hasTaxable,
      annualOptimization: G1_63_ANNUAL_OPTIMIZATION,
    },
    assumptions: [
      `Optimal sequence: (1) taxable brokerage first (LTCG-favored, basis-step-up at death), (2) tax-deferred trad IRA/401(k) (marginal rate), (3) Roth LAST (tax-free + no RMD + estate-tax-free).`,
      `RMD age 73 (SECURE 2.0) — pushed to 75 for taxpayers born 1960+ TY2033+ per §401(a)(9)(C)(v).`,
      `HSA before age 65 — qualified medical tax-free (G1.14 max applies); after 65 ordinary withdrawal OK.`,
      `Roth has NO required minimum distribution during owner's lifetime (§401(a)(9)(B) post-death rules apply).`,
      `Non-spouse inherited Roth post-2019: 10-yr rule applies (G1.27).`,
      `Charitable intent: integrate QCD (G1.11) for age 70½+ — reduces RMD impact.`,
      `Pre-RMD years: Roth conversion ladder (G1.22) coordinates with this sequence.`,
      `Heuristic 2% rate optimization per year × $20k typical annual withdrawal × 10-yr horizon.`,
    ],
  };
}

// ── G1.64 — §168(k) Bonus Depreciation Election OUT (heuristic) ─────────

const G1_64_MIN_BONUS_DEP = 5_000;
const G1_64_MAX_TAXABLE = 50_000;
const G1_64_BRACKET_SPREAD = 0.24 - 0.12;
const G1_64_TYPICAL_BONUS = 20_000;

function detectBonusDepreciationOptOut(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  if (computed.taxableIncome > G1_64_MAX_TAXABLE) return null;
  const bonusDep = sumAdjustment(adjustments, "bonus_depreciation_basis");
  if (bonusDep < G1_64_MIN_BONUS_DEP) return null;

  const estSavings = Math.round(G1_64_TYPICAL_BONUS * G1_64_BRACKET_SPREAD);

  const strategy = strategyById("G1.64");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    taxYear: computed.taxYear,
    bonusDep: Math.round(bonusDep),
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(bonusDep))} of §168(k) bonus depreciation in TY${computed.taxYear} ` +
      `with low taxable income ${fmt(Math.round(computed.taxableIncome))}. Electing OUT preserves the ` +
      `deduction for higher-bracket future years via regular MACRS. Bracket-arbitrage benefit ` +
      `~${fmt(estSavings)} ($20k typical × (24% future − 12% current)).`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      bonusDepreciationBasis: Math.round(bonusDep),
      taxableIncome: Math.round(computed.taxableIncome),
      bracketSpreadAssumed: G1_64_BRACKET_SPREAD,
      typicalBonus: G1_64_TYPICAL_BONUS,
    },
    assumptions: [
      `§168(k)(7) annual election OUT of bonus depreciation. By ASSET CLASS — applies to ALL bonus-eligible property in same class.`,
      `Bonus rate schedule: TY2022 = 100%; TY2023 = 80%; TY2024 = 60%; TY2025 = 40%; TY2026 = 20%; TY2027+ = 0%.`,
      `Property recovers under regular MACRS instead — 5/7/15/27.5/39 yr typical (no bonus).`,
      `Election made via statement attached to Form 4562. IRREVOCABLE once filed without IRS consent.`,
      `Income PROJECTION required — election worthless if future bracket isn't actually higher.`,
      `Coordinate with §179 (separate decision — §179 is asset-by-asset, NOT class-wide).`,
      `Bracket spread heuristic 12% = (24% future − 12% current). Real spread varies by client trajectory.`,
      `Heuristic $20k typical bonus dep × spread.`,
    ],
  };
}

// ── G1.65 — Adoption Credit §23 (heuristic) ─────────────────────────────

// §23 adoption credit, indexed. Max credit: TY2024 $16,810 (Notice 2023-75) /
// TY2025 $17,280 / TY2026 $17,670 (Rev. Proc. 2025-32). The MAGI phase-out is a
// $40k band starting at the threshold; credit fully eliminated above the top:
//   TY2024 $252,150–$292,150 / TY2025 $259,190–$299,190 / TY2026 $265,080–$305,080.
// OBBBA (P.L. 119-21) made up to $5,000 (TY2025) / $5,120 (TY2026) of the §23
// credit REFUNDABLE (was fully non-refundable through TY2024).
const G1_65_MAX_CREDIT: Record<TaxYear, number> = { 2024: 16_810, 2025: 17_280, 2026: 17_670 };
const G1_65_AGI_PHASE_OUT_TOP: Record<TaxYear, number> = { 2024: 292_150, 2025: 299_190, 2026: 305_080 };
const G1_65_AGI_PHASE_OUT_START: Record<TaxYear, number> = { 2024: 252_150, 2025: 259_190, 2026: 265_080 };
const G1_65_REFUNDABLE: Record<TaxYear, number> = { 2024: 0, 2025: 5_000, 2026: 5_120 };
const G1_65_HEURISTIC_AVG = 5_000;

function detectAdoptionCredit(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { client, computed, adjustments } = args;
  if (client.filingStatus === "married_filing_separately") return null;

  // P2-13 — ENGINE-VERIFIED path: if the CPA entered actual adoption expenses
  // (a `qualified_adoption_expenses` / `adoption_special_needs` marker) or a
  // prior-year carryforward, the engine computed the real §23 credit. Report
  // THAT number (engine-verified, with the §23(c) carryforward) instead of the
  // broad kids-under-17 heuristic below.
  const ac = computed.adoptionCredit;
  if (ac && ac.eligible && (ac.tentativeCredit > 0 || ac.priorCarryforward > 0)) {
    const strategy = strategyById("G1.65");
    const fmt = (n: number) =>
      n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    const verified = Math.round(ac.refundablePortion + ac.nonRefundableApplied);
    const year = computed.taxYear;
    const phasedNote =
      ac.phaseOutFraction > 0
        ? ` MAGI ${fmt(Math.round(ac.magi))} phases the credit out by ${(ac.phaseOutFraction * 100).toFixed(0)}% (band ${fmt(ac.phaseOutStart)}–${fmt(ac.phaseOutTop)}).`
        : ``;
    const cfNote =
      ac.carryforwardToNext > 0
        ? ` ${fmt(Math.round(ac.carryforwardToNext))} of nonrefundable credit exceeds this year's tax and carries forward 5 years (§23(c)).`
        : ``;
    const vars: Record<string, number | string> = { maxCredit: ac.maxCreditPerChild, estSavings: verified };
    return {
      strategyId: strategy.id,
      name: strategy.name,
      category: strategy.category,
      estSavings: verified,
      verifiedSavings: verified,
      savingsSource: "engine-verified",
      confidence: strategy.confidence,
      cpaEffortHours: strategy.cpaEffortHours,
      recurring: strategy.recurring,
      rationale:
        `Engine-verified §23 adoption credit of ${fmt(verified)} on Form 8839 for TY${year} ` +
        `(${fmt(Math.round(ac.refundablePortion))} refundable + ${fmt(Math.round(ac.nonRefundableApplied))} ` +
        `nonrefundable applied against income tax).${phasedNote}${cfNote}`,
      action: interpolate(strategy.action, vars),
      prerequisiteData: strategy.prerequisiteData,
      citation: `${strategy.ircSection}; ${strategy.irsPub}`,
      inputs: {
        qualifiedExpenses: Math.round(ac.qualifiedExpenses),
        specialNeeds: ac.specialNeeds ? 1 : 0,
        eligibleExpenses: Math.round(ac.eligibleExpenses),
        maxCreditPerChild: ac.maxCreditPerChild,
        magi: Math.round(ac.magi),
        phaseOutFraction: Number(ac.phaseOutFraction.toFixed(4)),
        tentativeCredit: Math.round(ac.tentativeCredit),
        refundableCap: ac.refundableCap,
        refundablePortion: Math.round(ac.refundablePortion),
        nonRefundableApplied: Math.round(ac.nonRefundableApplied),
        priorCarryforward: Math.round(ac.priorCarryforward),
        carryforwardToNext: Math.round(ac.carryforwardToNext),
      },
      assumptions: [
        `ENGINE-VERIFIED — value is the engine's computed §23 credit (refundable + nonrefundable applied), not a heuristic.`,
        `Special-needs adoption (§23(a)(3)) deems full-limit expenses regardless of amount spent — flagged: ${ac.specialNeeds ? "YES" : "no"}.`,
        ac.refundableCap > 0
          ? `OBBBA (P.L. 119-21 §70402): up to ${fmt(ac.refundableCap)} of the TY${year} credit is REFUNDABLE; the rest is nonrefundable with a 5-yr §23(c) carryforward.`
          : `TY${year} predates OBBBA refundability — the credit is fully nonrefundable (5-yr §23(c) carryforward).`,
        `Single-adoption model: expenses capped at one child's ${fmt(ac.maxCreditPerChild)} limit. Simultaneous multiple adoptions need per-child entry (sub-gap).`,
        `MAGI = AGI + FEIE add-back (§23(b)(2)(B)). Foreign adoption: credit allowed only in the year the adoption is FINALIZED (Reg §1.23-1).`,
      ],
    };
  }

  const kidsUnder17 = client.dependentsUnder17 ?? 0;
  if (kidsUnder17 < 1) return null;
  const year = computed.taxYear;
  const ry = resolveTaxYear(year);
  const maxCredit = G1_65_MAX_CREDIT[ry];
  const phaseOutTop = G1_65_AGI_PHASE_OUT_TOP[ry];
  const phaseOutStart = G1_65_AGI_PHASE_OUT_START[ry];
  const refundable = G1_65_REFUNDABLE[ry];
  if (computed.adjustedGrossIncome > phaseOutTop) return null;
  void adjustments;

  // Heuristic estSavings = $5k typical (strong CPA-confirm caveat). Post-OBBBA,
  // up to `refundable` is available regardless of liability; any heuristic amount
  // beyond the refundable floor is non-refundable (capped at federal income-tax
  // liability; 5-yr carryforward per §23(c)). For TY2024 refundable = 0 (the
  // pre-OBBBA all-non-refundable rule), so this collapses to min(5k, liability).
  const refundablePart = Math.min(G1_65_HEURISTIC_AVG, refundable);
  const nonRefundablePart = Math.min(
    Math.max(0, G1_65_HEURISTIC_AVG - refundable),
    Math.round(computed.federalTaxLiability),
  );
  const cappedSavings = refundablePart + nonRefundablePart;
  if (cappedSavings <= 0) return null;

  const strategy = strategyById("G1.65");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    maxCredit,
    estSavings: cappedSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: cappedSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${kidsUnder17} dependent(s) under 17 + AGI ${fmt(Math.round(computed.adjustedGrossIncome))} ` +
      `(under ${fmt(phaseOutTop)} TY${year} cap). IF client adopted (or in adoption process), ` +
      `claim Adoption Credit on Form 8839 — up to ${fmt(maxCredit)}/child. Heuristic typical ` +
      `~${fmt(cappedSavings)}${refundable > 0 ? ` (up to ${fmt(refundable)} refundable under OBBBA; CPA confirms actual adoption)` : ` (capped at federal tax liability; CPA confirms actual adoption)`}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      filingStatus: client.filingStatus,
      dependentsUnder17: kidsUnder17,
      agi: Math.round(computed.adjustedGrossIncome),
      taxYear: year,
      agiPhaseOutStart: phaseOutStart,
      agiPhaseOutTop: phaseOutTop,
      maxCreditPerChild: maxCredit,
      refundablePortion: refundable,
      federalTaxLiability: Math.round(computed.federalTaxLiability),
      heuristicTypicalCredit: G1_65_HEURISTIC_AVG,
      cappedSavings,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify actual adoption status. Fires too broadly for any family with kids — CPA MUST CONFIRM.`,
      `TY${year} max credit: ${fmt(maxCredit)} per child (TY2024 $16,810 Notice 2023-75; TY2025 $17,280; TY2026 $17,670 Rev. Proc. 2025-32).`,
      `AGI phase-out TY${year}: ${fmt(phaseOutStart)}-${fmt(phaseOutTop)} ($40k band).`,
      `Special-needs adoption: full ${fmt(maxCredit)} credit regardless of expenses per §23(a)(3) — state determines special-needs status.`,
      refundable > 0
        ? `OBBBA (P.L. 119-21): up to ${fmt(refundable)} REFUNDABLE for TY${year} (available even at $0 liability); the remainder is non-refundable with 5-yr carryforward per §23(c).`
        : `Non-refundable for TY${year} — capped at federal tax liability (engine reports capped value); 5-yr carryforward per §23(c). (OBBBA adds a refundable portion starting TY2025.)`,
      `MFS — DISQUALIFIED.`,
      `Foreign adoption — credit allowed only in year adoption FINALIZED per Reg §1.23-1.`,
      `Heuristic $5,000 typical — wide range. Real value depends on actual expenses + special-needs status.`,
    ],
  };
}

// ── G1.66 — Rollover-IRA → 401(k) §408(d)(2) pro-rata fix (heuristic) ───

const G1_66_MIN_TRAD_IRA = 1_000;
const G1_66_BACKDOOR_AMOUNT = 7_000;

function detectRolloverIraTo401k(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { client, computed, assetBalances } = args;
  if (!assetBalances || assetBalances.length === 0) return null;
  const tradTypes = new Set(["traditional_ira", "sep_ira", "simple_ira"]);
  const tradBalance = assetBalances
    .filter((a) => tradTypes.has(a.assetType))
    .reduce((s, a) => s + toNum(a.balance), 0);
  if (tradBalance < G1_66_MIN_TRAD_IRA) return null;
  // Only matters for backdoor Roth candidates (AGI > the direct-Roth phase-out
  // TOP for the return's tax year). Reuse the YEAR-INDEXED G1.26 map — a stale
  // TY2024-only map here gates fire/no-fire wrong for TY2025/26 returns (a
  // filer inside the current band can still contribute directly → no backdoor).
  const phaseOutTops = G1_26_ROTH_PHASEOUT_TOP[resolveTaxYear(computed.taxYear)];
  const phaseOutTop = phaseOutTops[client.filingStatus] ?? phaseOutTops.single;
  if (computed.adjustedGrossIncome <= phaseOutTop) return null;

  const fedRate = federalMarginalRate(computed);
  // Without fix: $7k backdoor + $100k pre-tax IRA → ratio = 100/107 = 0.935.
  // Taxable portion of $7k conversion = $7,000 × 0.935 = $6,542.
  // estSavings = $6,542 × marginal (avoided tax from cleaning the trap).
  const taxableProRata = G1_66_BACKDOOR_AMOUNT * (tradBalance / (tradBalance + G1_66_BACKDOOR_AMOUNT));
  const estSavings = Math.round(taxableProRata * fedRate);
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.66");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    rolloverAmount: Math.round(tradBalance),
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client AGI ${fmt(Math.round(computed.adjustedGrossIncome))} > ${fmt(phaseOutTop)} (Roth phase-out top — ` +
      `backdoor Roth candidate) BUT has ${fmt(Math.round(tradBalance))} of pre-tax trad/SEP/SIMPLE IRA ` +
      `triggering §408(d)(2) pro-rata trap. Roll pre-tax IRA into current 401(k) plan BEFORE year-end ` +
      `to clean the trap. Each year's backdoor Roth saves ~${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      tradIraBalance: Math.round(tradBalance),
      agi: Math.round(computed.adjustedGrossIncome),
      phaseOutTop,
      filingStatus: client.filingStatus,
      backdoorAmount: G1_66_BACKDOOR_AMOUNT,
      proRataTaxablePortion: Math.round(taxableProRata),
      federalMarginalRate: fedRate,
    },
    assumptions: [
      `§408(d)(2) IRA aggregation INCLUDES all trad/SEP/SIMPLE IRAs at year-end but EXCLUDES 401(k) and other employer plans.`,
      `Strategy requires CURRENT EMPLOYER 401(k) plan that ACCEPTS incoming rollovers — most do, but plan-specific.`,
      `AFTER-TAX IRA basis CANNOT be rolled to 401(k) — leave that portion in IRA for clean backdoor Roth conversion.`,
      `Roll IRA → 401(k) BEFORE year-end so it's not in the §408(d)(2) Dec-31 aggregation.`,
      `Direct trustee-to-trustee transfer recommended — avoids 60-day rollover window risk + automatic 20% withholding.`,
      `Coordinates with G1.26 backdoor Roth — clean execution requires pre-tax IRA = $0.`,
      `Future flexibility: 401(k) balance can be rolled back to IRA after leaving employer.`,
      `NOT applicable: clients with no 401(k) (use Solo 401(k) if self-employed — G1.1) or sole-prop without plan.`,
      `Heuristic estSavings = pro-rata taxable × marginal — varies by IRA balance + AGI bracket.`,
    ],
  };
}

// ── G1.67 — In-plan Roth Conversion §402A(c)(4)(B) (heuristic + H2 cost) ─

const G1_67_MIN_TRAD_401K = 25_000;
const G1_67_MIN_AGE = 30;
const G1_67_MAX_AGE = 72;
const G1_67_MAX_CURRENT_MARGINAL = 0.22;
const G1_67_CONVERSION_AMOUNT = 25_000;

function detectInPlanRothConversion(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  assetBalances?: AssetBalanceFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, assetBalances, baselineInputs } = args;
  if (client.filingStatus === "married_filing_separately") return null;
  const age = client.taxpayerAge;
  if (age == null || age < G1_67_MIN_AGE || age > G1_67_MAX_AGE) return null;
  if (!assetBalances || assetBalances.length === 0) return null;
  const trad401kBalance = assetBalances
    .filter((a) => a.assetType === "401k_traditional")
    .reduce((s, a) => s + toNum(a.balance), 0);
  if (trad401kBalance < G1_67_MIN_TRAD_401K) return null;
  const fedRate = federalMarginalRate(computed);
  if (fedRate > G1_67_MAX_CURRENT_MARGINAL) return null;
  const stateRate = stateMarginalRate(computed);

  // Conversion amount = MIN($25k typical, available trad 401(k) balance).
  // Cost (not savings) = conversion × (federal + state) marginal rate.
  // H2 cost semantics — current-year tax cost is REAL; long-term Roth benefit deferred.
  const conversionAmount = Math.min(G1_67_CONVERSION_AMOUNT, Math.round(trad401kBalance));
  const costThisYear = Math.round(conversionAmount * (fedRate + stateRate));

  // H2 — verify cost by running a what-if scenario (add ordinary income).
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.67-in-plan-roth-conversion",
    label: `In-plan Roth conversion $${conversionAmount.toLocaleString("en-US")}`,
    mutations: [
      { kind: "add_adjustment", adjustmentType: "additional_income", amount: conversionAmount },
    ],
    semantics: "cost",
    varyAmount: true,
  });

  const strategy = strategyById("G1.67");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    conversionAmount,
    costThisYear,
    currentRate: Math.round(fedRate * 100),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: costThisYear,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client age ${age} with ${fmt(Math.round(trad401kBalance))} pre-tax 401(k) at ${Math.round(fedRate * 100)}% ` +
      `current marginal rate (favorable bracket). In-plan Roth conversion of ${fmt(conversionAmount)} costs ` +
      `${fmt(costThisYear)} this year; future qualified distributions tax-free. Distinct from G1.4 (IRA) and ` +
      `G1.26 (backdoor). Pay tax with OUTSIDE funds.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      taxpayerAge: age,
      trad401kBalance: Math.round(trad401kBalance),
      conversionAmount,
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
      costThisYear,
    },
    assumptions: [
      `Conversion of $${conversionAmount.toLocaleString("en-US")} of pre-tax 401(k) to designated Roth 401(k) — taxable at current marginal rate.`,
      `H2 SEMANTICS: estSavings is the current-year tax COST (not savings). Long-term tax-free Roth benefit deferred to retirement.`,
      `Plan must offer in-plan Roth conversion feature (per Notice 2010-84 + Notice 2013-74). Most modern 401(k) plans do.`,
      `Pay conversion tax with OUTSIDE funds — withholding from 401(k) reduces converted amount + may trigger §72(t) penalty if under 59½.`,
      `5-year clock per §402A(c)(4)(F) — each conversion starts its own clock for tax-free qualified distribution.`,
      `IRREVOCABLE per TCJA — recharacterization eliminated TY2018+.`,
      `Distinct from G1.4 IRA Roth conversion (different account type) and G1.26 backdoor IRA (different mechanism).`,
      `Best for clients in transition years (sabbatical, low-income year) before peak career bracket.`,
    ],
    whatIf,
  };
}

// ── G1.68 — §174 R&D Capitalization Workaround (heuristic) ──────────────

const G1_68_MIN_SE = 200_000;
const G1_68_RECLASS_PCT = 0.30;
const G1_68_TYPICAL_RD_BUCKET = 80_000;

function detectSection174RdWorkaround(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  const netSe = computed.detail.se.netSeEarnings;
  if (netSe < G1_68_MIN_SE) return null;
  // Proxy for active trade/business: QBI adjustment present (CPA tagged for QBI).
  const hasQbi = adjustments.some(
    (a) => a.adjustmentType === "qbi_income" && a.isApplied !== false && toNum(a.amount) > 0,
  );
  if (!hasQbi) return null;
  // Skip if already taking §41 R&D credit (covered by G1.36).
  const hasRdCredit = adjustments.some(
    (a) =>
      (a.adjustmentType === "rd_credit" || a.adjustmentType === "section_41_credit") &&
      a.isApplied !== false &&
      toNum(a.amount) > 0,
  );
  if (hasRdCredit) return null;

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  const reclassAmount = G1_68_TYPICAL_RD_BUCKET * G1_68_RECLASS_PCT;
  const estSavings = Math.round(reclassAmount * (fedRate + stateRate));

  const strategy = strategyById("G1.68");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client SE income ${fmt(Math.round(netSe))} + QBI flag — likely active trade/business potentially impacted ` +
      `by TCJA §174 mandatory 5-yr R&D amortization (TY2022+). Workaround: (a) reclassify post-development ` +
      `support/marketing/sales from §174 to §162; (b) Form 6765 §41 R&D credit; (c) §59(e)(2) 10-yr election ` +
      `to avoid AMT preference. Heuristic ${fmt(estSavings)} benefit from ~30% reclassification.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      typicalRdBucket: G1_68_TYPICAL_RD_BUCKET,
      reclassPercent: G1_68_RECLASS_PCT,
      reclassAmount: Math.round(reclassAmount),
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify whether client actually has §174 R&D exposure. CPA confirms (SaaS, software, biotech, hardware are typical).`,
      `TCJA §13206 amended §174 effective TY2022 — mandatory 5-yr (domestic) / 15-yr (foreign) amortization replaces prior current-deduction.`,
      `Workaround #1: §162 vs §174 classification — post-development support, marketing, sales, content NOT §174 per Notice 2023-63.`,
      `Workaround #2: Form 6765 §41 R&D credit — 14% ASC or 20% incremental; coordinates with G1.36.`,
      `Workaround #3: §59(e)(2) optional 10-yr election — spreads §174 amortization to avoid line 2i AMT depreciation preference.`,
      `Change-in-accounting-method via Form 3115 + §481(a) catch-up adjustment (4-yr spread).`,
      `Coordinate with G1.36 (R&D credit) + G1.60 (§41(h) small-biz payroll-tax credit if < 5 yrs old + < $5M).`,
      `Documentation burden HIGH — contemporaneous research log + qualified research expense detail per §41(d) 4-part test.`,
      `Heuristic 30% × $80k typical R&D bucket × marginal — actual depends on client R&D spend mix.`,
    ],
  };
}

// ── G1.69 — Year-end Income Deferral / Acceleration Timing (heuristic) ──

const G1_69_MIN_AGI = 50_000;
const G1_69_MIN_MARGINAL = 0.22;
const G1_69_BRACKET_PROXIMITY = 20_000;
const G1_69_TYPICAL_SHIFT = 10_000;

function detectYearEndTiming(args: {
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { computed } = args;
  if (computed.adjustedGrossIncome < G1_69_MIN_AGI) return null;
  const fedRate = federalMarginalRate(computed);
  if (fedRate < G1_69_MIN_MARGINAL) return null;
  // Use the RETURN's actual year/status bracket geometry (was a hard-coded
  // TY2024 snapshot that gated proximity on stale breakpoints for TY2025/26).
  const breaks = getFederalBracketBreakpoints(computed.filingStatus, computed.taxYear);
  // Find nearest bracket break to current taxable income.
  let nearestBreak = Infinity;
  let distanceToBreak = Infinity;
  for (const b of breaks) {
    const d = Math.abs(computed.taxableIncome - b);
    if (d < distanceToBreak) {
      distanceToBreak = d;
      nearestBreak = b;
    }
  }
  if (distanceToBreak > G1_69_BRACKET_PROXIMITY) return null;

  // Heuristic spread = 10% (12→22 typical bracket boundary; conservatively assume rising-trajectory client).
  const bracketSpread = 0.10;
  const estSavings = Math.round(G1_69_TYPICAL_SHIFT * bracketSpread);

  const stateRate = stateMarginalRate(computed);
  const strategy = strategyById("G1.69");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const strategyDirection = computed.taxableIncome > nearestBreak ? "Defer" : "Accelerate";
  const vars: Record<string, number | string> = {
    projectedNextYear: fmt(Math.round(computed.adjustedGrossIncome * 1.03)),
    currentTaxable: fmt(Math.round(computed.taxableIncome)),
    strategyDirection,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client taxable income ${fmt(Math.round(computed.taxableIncome))} is within ${fmt(G1_69_BRACKET_PROXIMITY)} ` +
      `of bracket break at ${fmt(nearestBreak)} (TY${resolveTaxYear(computed.taxYear)} ${computed.filingStatus} brackets). Year-end income/` +
      `deduction shift of ~${fmt(G1_69_TYPICAL_SHIFT)} can avoid bracket creep. Estimated annual benefit ${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      adjustedGrossIncome: Math.round(computed.adjustedGrossIncome),
      taxableIncome: Math.round(computed.taxableIncome),
      nearestBracketBreak: nearestBreak,
      distanceToBreak: Math.round(distanceToBreak),
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
      typicalShift: G1_69_TYPICAL_SHIFT,
      bracketSpread,
    },
    assumptions: [
      `HEURISTIC — engine projects next-year trajectory as flat × 1.03. CPA refines with client's actual income outlook.`,
      `Strategy direction: ${strategyDirection} ~$10k income/deductions to optimize bracket positioning.`,
      `Cash-method taxpayer only — accrual-method clients have less timing flexibility.`,
      `Constructive receipt doctrine (Reg §1.451-2) — cannot defer income already physically/constructively received.`,
      `§461(g) prepaid-expense 12-month rule limits deduction acceleration to expenses with < 12-month benefit period.`,
      `AMT considerations — accelerating state-tax payment doesn't help if AMT applies (state tax is AMT preference).`,
      `Coordinate with G1.3 bunching (deduction acceleration), G1.4 Roth (bracket fill), G1.6 NIIT cliff ($200k/$250k boundary).`,
      `Heuristic 10% bracket spread (12→22 boundary). Real spread varies: 12→22 = 10%, 22→24 = 2%, 24→32 = 8%, 32→35 = 3%, 35→37 = 2%.`,
    ],
  };
}

// ── G1.70 — Bargain Sale to Charity §1011(b) (heuristic) ────────────────

const G1_70_MIN_LTCG = 50_000;
const G1_70_MIN_HOME_GAIN = 100_000;
const G1_70_TYPICAL_FMV = 200_000;
const G1_70_TYPICAL_BASIS = 50_000;
const G1_70_TYPICAL_SALE_PRICE = 50_000;

function detectBargainSale(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { computed, adjustments, assetBalances } = args;
  void adjustments;
  // Trigger #1: significant LTCG already realized.
  const ltcg = computed.detail.capitalGains.longTermGains;
  // Trigger #2: H5 primary_residence OR real_estate with embedded gain > $100k.
  const realEstate = (assetBalances ?? []).filter(
    (a) => a.assetType === "primary_residence" || a.assetType === "real_estate",
  );
  const embeddedGain = realEstate.reduce(
    (s, a) => s + Math.max(0, toNum(a.balance) - toNum(a.afterTaxBasis ?? a.costBasis ?? 0)),
    0,
  );
  if (ltcg < G1_70_MIN_LTCG && embeddedGain < G1_70_MIN_HOME_GAIN) return null;

  // Heuristic calc: $200k FMV asset / $50k basis / $50k sale price.
  // Per §1011(b): basis allocated = $50k × ($50k/$200k) = $12,500.
  // Gain = $50k − $12,500 = $37,500 @ LTCG rate.
  // Charity deduction = $200k − $50k = $150k (capped at 30% AGI for LTCG → public charity).
  const fmv = G1_70_TYPICAL_FMV;
  const basis = G1_70_TYPICAL_BASIS;
  const salePrice = G1_70_TYPICAL_SALE_PRICE;
  const basisAllocated = basis * (salePrice / fmv);
  const recognizedGain = salePrice - basisAllocated;
  const charitableDeduction = fmv - salePrice;

  const ltcgRate = 0.15;
  const fedRate = federalMarginalRate(computed);
  // Net benefit = (charitable deduction × marginal rate) − (recognized gain × LTCG rate)
  const charityBenefit = charitableDeduction * fedRate;
  const gainCost = recognizedGain * ltcgRate;
  const estSavings = Math.round(charityBenefit - gainCost);
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.70");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    assetDescription: "appreciated real estate / art / securities",
    fmv: Math.round(fmv),
    basis: Math.round(basis),
    salePrice: Math.round(salePrice),
    salePortion: Math.round((salePrice / fmv) * 100),
    donationPortion: Math.round((1 - salePrice / fmv) * 100),
    recognizedGain: Math.round(recognizedGain),
    charitableDeduction: Math.round(charitableDeduction),
    charityName: "qualified §501(c)(3)",
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(ltcg))} LTCG and/or ${fmt(Math.round(embeddedGain))} embedded gain in real estate. ` +
      `Bargain sale of ${fmt(fmv)} FMV asset (basis ${fmt(basis)}) to charity at ${fmt(salePrice)}: ${fmt(Math.round(recognizedGain))} ` +
      `recognized LTCG @ 15%; ${fmt(Math.round(charitableDeduction))} charitable deduction @ ${Math.round(fedRate * 100)}% marginal. ` +
      `Net benefit ~${fmt(estSavings)} per §1011(b).`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      longTermGains: Math.round(ltcg),
      embeddedRealEstateGain: Math.round(embeddedGain),
      typicalFmv: fmv,
      typicalBasis: basis,
      typicalSalePrice: salePrice,
      basisAllocated: Math.round(basisAllocated),
      recognizedGain: Math.round(recognizedGain),
      charitableDeduction: Math.round(charitableDeduction),
      federalMarginalRate: fedRate,
      ltcgRate,
      estSavings,
    },
    assumptions: [
      `HEURISTIC — engine doesn't verify charity acceptance or actual bargain sale terms. CPA structures.`,
      `§1011(b) basis allocation: basis × (sale_price / FMV) is the basis allocated to SALE portion. Remainder is gift.`,
      `Recognized gain = sale_price − allocated_basis. Character = LTCG if long-term, else STCG.`,
      `Charitable deduction = FMV − sale_price. Capped at 30% AGI for LTCG property to public charity (50% if 50%-org), 20% to private foundation. 5-yr carryforward per §170(d)(1).`,
      `Qualified APPRAISAL required per §170(f)(11)(C) for non-cash > $5,000. Form 8283 Sec B + appraiser signs Part III.`,
      `Holding period must be > 1 yr for FMV deduction; STCG bargain sale → basis-only deduction per §170(e)(1)(A).`,
      `Charity acceptance + §170(e)(1)(B)(i) 3-yr rule (for tangible personal property): if charity disposes < 3 yrs of receipt + property's use NOT related to charity's exempt purpose, deduction reduced to basis.`,
      `Heuristic assumes $200k FMV / $50k basis / $50k sale price example. Real bargain sale numbers vary widely.`,
      `Net benefit = (charity_deduction × marginal_rate) − (recognized_gain × LTCG_rate). Charity benefit dominates when marginal > LTCG.`,
    ],
  };
}

// ── G1.71 — ISO Lot Selection (Qualifying Disposition) (heuristic) ──────

const G1_71_MIN_ISO_BALANCE = 25_000;
const G1_71_TYPICAL_SPREAD = 50_000;
const G1_71_ORDINARY_VS_LTCG_PROXY = 0.09; // 24% ord − 15% LTCG

function detectIsoLotSelection(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { computed, adjustments, assetBalances } = args;
  const isoBalance = (assetBalances ?? [])
    .filter((a) => a.assetType === "iso_amt_credit_shares")
    .reduce((s, a) => s + toNum(a.balance), 0);
  const isoBargainAdj = adjustments
    .filter(
      (a) =>
        a.adjustmentType === "amt_iso_bargain_element" && a.isApplied !== false && toNum(a.amount) > 0,
    )
    .reduce((s, a) => s + toNum(a.amount), 0);
  if (isoBalance < G1_71_MIN_ISO_BALANCE && isoBargainAdj <= 0) return null;
  void computed;

  // Heuristic: $50k typical spread × (24% ord − 15% LTCG) = $4,500 annual.
  const estSavings = Math.round(G1_71_TYPICAL_SPREAD * G1_71_ORDINARY_VS_LTCG_PROXY);

  const strategy = strategyById("G1.71");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    eligibleLots: "(CPA-tracked)",
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(isoBalance))} ISO position (or ${fmt(Math.round(isoBargainAdj))} exercise bargain ` +
      `element). To preserve LTCG character on sale: hold > 2 yrs from grant + > 1 yr from exercise per §422(a). Specific-` +
      `share-identification election with broker. Heuristic ${fmt(estSavings)} annual preserved LTCG.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      isoBalance: Math.round(isoBalance),
      isoBargainAdj: Math.round(isoBargainAdj),
      typicalSpread: G1_71_TYPICAL_SPREAD,
      ordinaryVsLtcgProxy: G1_71_ORDINARY_VS_LTCG_PROXY,
      estSavings,
    },
    assumptions: [
      `§422(a) qualifying disposition requires BOTH: (a) > 2 yrs from grant + (b) > 1 yr from exercise.`,
      `Disqualifying disposition → §421(b) ordinary comp income on lesser of (FMV exercise − strike) or (sale − strike); excess at LTCG/STCG.`,
      `Distinct from G1.5 (AMT timing at EXERCISE) — this is at SALE; G1.5 covers AMT-preference avoidance at exercise.`,
      `Specific-share-identification per Reg §1.1012-1(c) — broker must accept SSI election BEFORE sale; default is FIFO.`,
      `Form 3921 box 1 grant date + box 2 exercise date determine qualifying-eligible lots.`,
      `$100k §422(d) annual exercise FMV limit — exercises > $100k/yr lose ISO status (NSO instead = ordinary income immediately).`,
      `AMT credit (Form 8801) — bargain element creates AMT in exercise year; §53 credit recoverable when regular > AMT in future.`,
      `Coordinate with G1.5 (AMT-ISO exercise timing) + G1.56 (specific-share-ID broader framework).`,
      `Heuristic: $50k typical spread × 9% (24% ord − 15% LTCG) = $4,500. Real spread varies by client bracket + spread size.`,
    ],
  };
}

// ── G1.72 — RSU Sell-to-Cover Withholding Gap (heuristic) ───────────────

const G1_72_MIN_WAGES = 300_000;
const G1_72_MIN_MARGINAL = 0.32;
const G1_72_TYPICAL_RSU = 200_000;
const G1_72_WITHHOLDING_RATE = 0.22;

function detectRsuSellToCover(args: {
  computed: ComputedTaxReturn;
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { computed, baselineInputs } = args;
  // M3 (audit 2026-06-11) — RSUs are W-2 compensation: require ACTUAL W-2s and
  // measure wages from the real Box-1 totals (or the refined proxy that nets
  // out K-1/rental/capital-gain income, which the old proxy counted as wages —
  // a $500k-K-1 client with no W-2 was told they had a $26k RSU withholding
  // gap). Engine doesn't decompose RSU from W-2; CPA confirms via Box 12 V.
  const { hasW2, wages: wagesProxy } = w2WagesSignal(computed, baselineInputs);
  if (!hasW2) return null;
  if (wagesProxy < G1_72_MIN_WAGES) return null;
  const fedRate = federalMarginalRate(computed);
  if (fedRate < G1_72_MIN_MARGINAL) return null;

  // Withholding gap = RSU × (marginal − 22%)
  const gap = G1_72_TYPICAL_RSU * (fedRate - G1_72_WITHHOLDING_RATE);
  const estSavings = Math.round(gap);

  const strategy = strategyById("G1.72");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    rsuIncome: G1_72_TYPICAL_RSU,
    marginalRate: Math.round(fedRate * 100),
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client W-2 wages ${fmt(Math.round(wagesProxy))} (likely embedded RSU vesting) at ${Math.round(fedRate * 100)}% marginal. ` +
      `RSU withheld at 22% supplemental rate per §3402(g)(1)(A) UNDER-withholds by ${Math.round((fedRate - G1_72_WITHHOLDING_RATE) * 100)}%. ` +
      `Pre-pay Q4 estimated tax to avoid §6654 underpayment penalty. Heuristic gap ~${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      wagesProxy: Math.round(wagesProxy),
      federalMarginalRate: fedRate,
      typicalRsu: G1_72_TYPICAL_RSU,
      withholdingRate: G1_72_WITHHOLDING_RATE,
      gap: Math.round(gap),
    },
    assumptions: [
      `HEURISTIC — engine doesn't decompose RSU from W-2 Box 1. CPA confirms with Box 12 V (or stock comp records).`,
      `Per §3402(g)(1)(A) supplemental rate: 22% for first $1M YTD, then 37% for excess (§3402(g)(1)(B)).`,
      `Withholding gap = RSU × (marginal − 22%). For 32% bracket = 10% gap; 35% = 13%; 37% = 15%.`,
      `Heuristic typical RSU $200,000 — adjust if client confirms different.`,
      `Coordinate with G1.52 estimated-tax safe harbor (110% prior-year alternative if AGI > $150k).`,
      `Coordinate with G1.6 NIIT cliff — RSU vest may push past $200k/$250k threshold.`,
      `Sell-to-cover ratio — broker auto-sells enough shares for 22% withholding; remainder vested net.`,
      `Q4 estimated tax due Jan 15 of next year (or Dec 31 if state-tax acceleration helps).`,
    ],
  };
}

// ── G1.73 — NUA In-Service Distribution age 55-59½ (heuristic) ──────────

const G1_73_MIN_EMP_STOCK = 50_000;
const G1_73_MIN_AGE = 55;
const G1_73_MAX_AGE = 59;
const G1_73_TYPICAL_BASIS_RATIO = 0.20;
const G1_73_RATE_SPREAD = 0.09;

function detectNuaInService(args: {
  client: ClientFacts;
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { client, assetBalances } = args;
  const age = client.taxpayerAge;
  if (age == null || age < G1_73_MIN_AGE || age > G1_73_MAX_AGE) return null;
  if (!assetBalances || assetBalances.length === 0) return null;
  const empStockBalance = assetBalances
    .filter((a) => a.assetType === "employer_stock")
    .reduce((s, a) => s + toNum(a.balance), 0);
  if (empStockBalance < G1_73_MIN_EMP_STOCK) return null;

  // Heuristic: assume 20% basis / 80% NUA appreciation typical.
  const nuaAmount = Math.round(empStockBalance);
  const basisAmount = Math.round(nuaAmount * G1_73_TYPICAL_BASIS_RATIO);
  const nuaAppreciation = nuaAmount - basisAmount;
  // Savings = NUA × (marginal − 15% LTCG). Use 24% marginal proxy = 9% spread.
  const estSavings = Math.round(nuaAppreciation * G1_73_RATE_SPREAD);

  const strategy = strategyById("G1.73");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    nuaAmount,
    basisAmount,
    nuaAppreciation,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client age ${age} (in 55-59½ in-service window) with ${fmt(nuaAmount)} of employer stock in 401(k). ` +
      `§402(e)(4) NUA election + §72(t)(2)(A)(v) 'rule of 55' separation: basis ${fmt(basisAmount)} taxed ` +
      `ordinary; appreciation ${fmt(nuaAppreciation)} deferred + at 15% LTCG. Distinct from G1.15 (retirement). ` +
      `Heuristic ${fmt(estSavings)} benefit.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      taxpayerAge: age,
      employerStockBalance: nuaAmount,
      typicalBasisRatio: G1_73_TYPICAL_BASIS_RATIO,
      basisAmount,
      nuaAppreciation,
      rateSpread: G1_73_RATE_SPREAD,
      estSavings,
    },
    assumptions: [
      `HEURISTIC — engine assumes 20% basis / 80% appreciation typical. Real ratio varies; CPA gets actual basis from plan administrator.`,
      `§402(e)(4) NUA election — MUST be lump-sum distribution of ALL plan assets in same calendar year.`,
      `Non-employer-stock portion can be rolled to IRA per Rev. Rul. 96-49 (preserves rollover treatment).`,
      `Triggering event required: separation from service, age 59½, death, OR disability.`,
      `§72(t)(2)(A)(v) 'rule of 55' — separation from service at age 55+ avoids 10% early-withdrawal penalty.`,
      `Cost basis taxed at ordinary in distribution year (may push into higher bracket).`,
      `NUA appreciation taxed at LTCG ONLY when stock sold (deferred indefinitely).`,
      `Estate planning bonus — NUA stock held until death: basis stepped up to FMV per §1014; NUA appreciation NEVER taxed.`,
      `Distinct from G1.15 (NUA at full retirement after 59½) — G1.73 captures the age 55-59½ in-service window.`,
      `Rate spread heuristic 9% = (24% marginal − 15% LTCG). Real spread varies by client bracket.`,
    ],
  };
}

// ── G1.74 — §45S FMLA Credit (heuristic) ────────────────────────────────

const G1_74_MIN_NET_SE = 250_000;
const G1_74_HEURISTIC_CREDIT = 2_500;

function detectFmlaCredit(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  const netSe = computed.detail.se.netSeEarnings;
  if (netSe < G1_74_MIN_NET_SE) return null;
  // Skip if already claiming §45S
  const hasFmlaCredit = adjustments.some(
    (a) =>
      (a.adjustmentType === "fmla_credit" || a.adjustmentType === "section_45s_credit") &&
      a.isApplied !== false &&
      toNum(a.amount) > 0,
  );
  if (hasFmlaCredit) return null;

  const estSavings = G1_74_HEURISTIC_CREDIT;

  const strategy = strategyById("G1.74");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client SE income ${fmt(Math.round(netSe))} — likely small biz with employees. §45S credit ` +
      `(12.5%-25% of paid FMLA wages, up to 12 wks/yr, qualifying employees < $84k prior-yr wages). ` +
      `Adopt written policy → claim Form 8994. Heuristic 5 employees × 2 wk × $1k × 25% = ${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      heuristicCredit: G1_74_HEURISTIC_CREDIT,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify whether biz has employees. CPA confirms.`,
      `Written policy MUST exist BEFORE leave is taken per Notice 2018-71.`,
      `Minimum 2 weeks paid leave per year + ≥ 50% of normal wage rate.`,
      `Qualifying employee: > 1 yr employed + < $84,000 prior-yr compensation (TY2024 indexed per Rev. Proc. 2023-34).`,
      `Credit rate scales 12.5% (at 50% of normal) to 25% (at 100% of normal) per §45S(a)(1)(A).`,
      `12-week max per employee per year cap.`,
      `Form 8994 + §38 general business credit pool (20-yr carryforward).`,
      `Coordinate with state-specific paid-leave laws (CA, NY, NJ, MA, WA, RI, CT, OR, CO) — federal credit doesn't preempt.`,
      `Heuristic 5 employees × 2 weeks × $1,000/wk × 25% = $2,500 — varies widely by biz size.`,
    ],
  };
}

// ── G1.75 — WOTC §51 (heuristic) ────────────────────────────────────────

const G1_75_MIN_NET_SE = 250_000;
const G1_75_TYPICAL_HIRES_QUALIFYING = 2;
const G1_75_STANDARD_CREDIT_PER_HIRE = 2_400;

function detectWotcCredit(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  const netSe = computed.detail.se.netSeEarnings;
  if (netSe < G1_75_MIN_NET_SE) return null;
  const hasWotc = adjustments.some(
    (a) =>
      (a.adjustmentType === "wotc_credit" || a.adjustmentType === "section_51_credit") &&
      a.isApplied !== false &&
      toNum(a.amount) > 0,
  );
  if (hasWotc) return null;

  const estSavings = G1_75_TYPICAL_HIRES_QUALIFYING * G1_75_STANDARD_CREDIT_PER_HIRE;

  const strategy = strategyById("G1.75");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client SE income ${fmt(Math.round(netSe))} — likely has employees. Screen new hires for §51 ` +
      `targeted groups (vets, ex-felons, SNAP, long-term unemployed). Form 8850 within 28 days. ` +
      `Heuristic 2 qualifying hires × $2,400 = ${fmt(estSavings)} via Form 5884.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      typicalHires: G1_75_TYPICAL_HIRES_QUALIFYING,
      standardCreditPerHire: G1_75_STANDARD_CREDIT_PER_HIRE,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify hiring activity. CPA confirms.`,
      `Form 8850 IRS pre-screening MUST be completed by employee on/before day of job offer.`,
      `28-day window after start date to submit Form 8850 + ETA Form 9061 to state workforce agency.`,
      `Standard targeted group: 40% × first $6k wages = $2,400 if employee works 400+ hrs first year (25% × $6k = $1,500 if 120-399 hrs).`,
      `Qualified veteran tiers: up to $9,600 (50% × $24k wages for service-disabled vet w/ 6+ mo unemployment).`,
      `Targeted groups per §51(d): TANF / IV-A recipient, veteran, ex-felon, designated community resident, vocational rehab referral, summer youth (16-17 from EZ/RC), SNAP recipient, SSI recipient, long-term family assistance, long-term unemployment recipient.`,
      `§280C(a) wage-deduction reduction (no double-dipping with credit).`,
      `Form 5884 + §38 general business credit (20-yr carryforward + 1-yr carryback).`,
      `WOTC currently authorized through 2025-12-31 per §51(c)(4) — periodic re-extensions.`,
      `Heuristic 2 qualifying hires × $2,400 standard credit = $4,800 — actual varies by hiring volume + target group mix.`,
    ],
  };
}

// ── G1.76 — §170(h) Non-syndicated Conservation Easement (heuristic) ────

const G1_76_MIN_REAL_ESTATE = 500_000;
const G1_76_TYPICAL_EASEMENT = 500_000;
const G1_76_TYPICAL_DEDUCTION_RATE = 0.35;

function detectNonSyndicatedEasement(args: {
  computed: ComputedTaxReturn;
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { computed, assetBalances } = args;
  if (!assetBalances || assetBalances.length === 0) return null;
  const realEstateBalance = assetBalances
    .filter((a) => a.assetType === "real_estate")
    .reduce((s, a) => s + toNum(a.balance), 0);
  if (realEstateBalance < G1_76_MIN_REAL_ESTATE) return null;

  void computed;
  // Heuristic: $500k typical easement × 35% effective deduction-driven savings.
  // Spread over multi-year cap; first-year benefit capped at 50% AGI.
  const estSavings = Math.round(G1_76_TYPICAL_EASEMENT * G1_76_TYPICAL_DEDUCTION_RATE);

  const strategy = strategyById("G1.76");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    landAcres: "(CPA-confirms)",
    easementValue: G1_76_TYPICAL_EASEMENT,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client holds ${fmt(Math.round(realEstateBalance))} of real estate (genuine landowner). ` +
      `§170(h) qualified perpetual conservation easement donation to qualified land trust. DISTINCT from ` +
      `G1.20 syndicated easement (Notice 2017-10 listed). 50% AGI cap (100% for rancher/farmer per ` +
      `§170(b)(1)(E)(iv)). Heuristic ${fmt(estSavings)} multi-year savings.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      realEstateBalance: Math.round(realEstateBalance),
      typicalEasement: G1_76_TYPICAL_EASEMENT,
      typicalDeductionRate: G1_76_TYPICAL_DEDUCTION_RATE,
      estSavings,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify whether land is qualified or whether landowner intends genuine donation. CPA confirms.`,
      `DISTINCT from G1.20 syndicated easement (Notice 2017-10 LISTED TRANSACTION — high audit risk). G1.76 is GENUINE landowner — low risk if appraisal sound.`,
      `Qualified APPRAISAL per §170(f)(11)(C) — required for ALL non-cash > $5,000. Form 8283 Sec B Part III signed.`,
      `Conservation purpose per §170(h)(4)(A): outdoor recreation / scenic / historic / open-space (farmland/habitat).`,
      `Perpetuity test per §170(h)(5)(A) — easement runs in perpetuity. Lender subordination required.`,
      `AGI cap: 50% per §170(b)(1)(E)(i). 100% if QUALIFIED RANCHER/FARMER per §170(b)(1)(E)(iv) (gross income from ranch/farm > 50% of total).`,
      `15-yr carryforward per §170(b)(1)(E)(ii) (vs 5-yr standard).`,
      `Form 8283 + 8283-V + appraisal narrative + baseline documentation + recorded easement deed.`,
      `State conformity varies — most follow federal §170 limits.`,
      `Heuristic $500k easement × 35% effective rate. Real easements range from $100k to $10M+; CPA confirms appraisal.`,
    ],
  };
}

// ── G1.77 — Self-rental Grouping §1.469-4(d) (heuristic) ────────────────

const G1_77_MIN_K1_ACTIVE = 50_000;
const G1_77_MIN_SUSPENDED_PAL = 10_000;

function detectSelfRentalGrouping(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { client, computed } = args;
  const k1Active = computed.scheduleK1?.totalActiveOrdinaryIncome ?? 0;
  if (k1Active < G1_77_MIN_K1_ACTIVE) return null;
  const suspended = computed.scheduleEPassiveLossSuspended ?? 0;
  if (suspended < G1_77_MIN_SUSPENDED_PAL) return null;
  // Skip if REPS already elected (G1.18 path).
  if (client.rentalRealEstateProfessional) return null;

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  const releaseableP = Math.min(suspended, k1Active);
  const estSavings = Math.round(releaseableP * (fedRate + stateRate));

  const strategy = strategyById("G1.77");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    suspendedPal: Math.round(suspended),
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(k1Active))} active K-1 income + ${fmt(Math.round(suspended))} rental PAL ` +
      `suspended under §469. Reg §1.469-4(d)(1) grouping election: combine rental + trade/business as ONE ` +
      `economic unit → releases suspended PAL against active income. Distinct from G1.18 REPS election. ` +
      `Estimated savings ${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      activeK1Income: Math.round(k1Active),
      suspendedPal: Math.round(suspended),
      releaseable: Math.round(releaseableP),
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
      estSavings,
    },
    assumptions: [
      `Material participation required in trade/business (one of 7 tests per Reg §1.469-5T).`,
      `Rental property rented to same trade/business (or related party) per self-rental rule §1.469-2(f)(6).`,
      `§1.469-4(c) appropriate economic unit test — 5 factors of organizational/economic unity.`,
      `Disclosure statement attached to return per Rev. Proc. 2010-13 (election IRREVOCABLE without IRS consent).`,
      `Distinct from G1.18 REPS election (which requires 750 hrs + > 50% personal services).`,
      `Self-rental rule §1.469-2(f)(6): net positive self-rental income is non-passive automatically; net negative loss STAYS passive without grouping election.`,
      `Coordinate with §199A — self-rental + active business CAN be aggregated for §199A wage/UBIA per Reg §1.199A-4.`,
      `Heuristic = min(suspended PAL, K1 active income) × marginal. Real release depends on at-risk basis + §163(j) flow-through.`,
    ],
  };
}

// ── G1.78 — Multi-state NR Income Allocation (heuristic) ────────────────

const G1_78_MIN_INCOME = 200_000;
const G1_78_OVER_SOURCING_PROXY = 0.05;
const G1_78_TYPICAL_STATE_MARGINAL = 0.07;

function detectMultiStateNrAllocation(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  w2States?: ReadonlyArray<string>;
}): OpportunityHit | null {
  const { client, computed, w2States } = args;
  if (computed.totalIncome < G1_78_MIN_INCOME) return null;
  // Detect multi-state W-2: at least one W-2 in different state than resident state.
  const residentState = (client.state ?? "").toUpperCase();
  if (!residentState) return null;
  const distinctW2States = new Set((w2States ?? []).map((s) => (s || "").toUpperCase()).filter(Boolean));
  if (distinctW2States.size === 0) return null;
  const hasNrState = [...distinctW2States].some((s) => s !== residentState);
  if (!hasNrState) return null;

  // Heuristic: $200k income × 5% over-sourcing × 7% typical state rate (NY/CA/MA average).
  const overSourced = Math.min(computed.totalIncome, 500_000) * G1_78_OVER_SOURCING_PROXY;
  const estSavings = Math.round(overSourced * G1_78_TYPICAL_STATE_MARGINAL);

  const strategy = strategyById("G1.78");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const secondaryState = [...distinctW2States].find((s) => s !== residentState) ?? "(other)";
  const vars: Record<string, number | string> = {
    primaryState: residentState,
    secondaryState,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client resident in ${residentState} with W-2 income from ${secondaryState}. Multi-state nonresident filing ` +
      `optimization (work-days calendar + convenience-of-employer rule). Estimated annual benefit ${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      totalIncome: Math.round(computed.totalIncome),
      residentState,
      secondaryState,
      overSourcedAmount: Math.round(overSourced),
      typicalStateMarginal: G1_78_TYPICAL_STATE_MARGINAL,
      estSavings,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify actual work-days calendar. CPA collects.`,
      `Convenience-of-employer rule states (work-from-home days STILL sourced to employer state): NY, NJ, DE, NE, PA.`,
      `State allocation methods vary: NY 'business carried on'; CA 'time of personal services performed'; NJ 'employee's days worked here'.`,
      `Reciprocity agreements skip nonresident filing: IL/IN, KY/IL/IN/MI/OH/VA/WV, MD/PA/VA/WV/DC, NJ/PA limited.`,
      `Resident-state credit-for-tax-paid usually capped at TAX-WHERE-EARNED computed at resident-state rate.`,
      `K-1 sourcing via partnership apportionment factor (sales/payroll/property — UDITPA or single-sales-factor).`,
      `Heuristic 5% over-sourcing × 7% state marginal. Real range $0 to $50k+ for high-income remote workers.`,
      `Coordinate with G1.58 state residency change + part-year residency (Phase E E12).`,
    ],
  };
}

// ── G1.79 — §453 Partial-Installment Election Out (heuristic) ───────────

const G1_79_MIN_LTCG = 250_000;
const G1_79_MIN_MARGINAL = 0.32;
const G1_79_TYPICAL_RATE_SPREAD = 0.02;
const G1_79_TYPICAL_GAIN = 500_000;

function detectInstallmentElectionOut(args: {
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { computed } = args;
  if (computed.detail.capitalGains.longTermGains < G1_79_MIN_LTCG) return null;
  if (computed.adjustedGrossIncome < 250_000) return null;
  const fedRate = federalMarginalRate(computed);
  if (fedRate < G1_79_MIN_MARGINAL) return null;

  const estSavings = Math.round(G1_79_TYPICAL_GAIN * G1_79_TYPICAL_RATE_SPREAD);

  const strategy = strategyById("G1.79");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const projectedRate = Math.min(0.37, fedRate + 0.03);
  const vars: Record<string, number | string> = {
    currentRate: Math.round(fedRate * 100),
    projectedRate: Math.round(projectedRate * 100),
    totalGain: G1_79_TYPICAL_GAIN,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(computed.detail.capitalGains.longTermGains))} LTCG + AGI ${fmt(Math.round(computed.adjustedGrossIncome))} ` +
      `at ${Math.round(fedRate * 100)}% marginal. §453(d) election OUT of installment treatment recognizes ENTIRE gain ` +
      `in current year (lower bracket vs future). Heuristic ${fmt(estSavings)} benefit.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      longTermGains: Math.round(computed.detail.capitalGains.longTermGains),
      agi: Math.round(computed.adjustedGrossIncome),
      currentMarginal: fedRate,
      typicalGain: G1_79_TYPICAL_GAIN,
      typicalRateSpread: G1_79_TYPICAL_RATE_SPREAD,
      estSavings,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify whether installment sale exists. CPA confirms with installment-sale records.`,
      `§453(d) election OUT is IRREVOCABLE; must be made by due date (with extensions) of return for year of sale.`,
      `Recapture per §453(i) — depreciation recapture (§1245 / §1250 / §291) is FULLY recognized in year of sale REGARDLESS of installment election.`,
      `§453A interest charge — applies to installment sales > $5M individual / $10M corp (deferred tax accrues at AFR).`,
      `Distinct from G1.47 (which uses default installment treatment).`,
      `Coordinate with G4.4 capital-loss carryforward (offset acceleration), G1.21 §1031 (alternative deferral).`,
      `Heuristic 2% bracket spread × $500k typical gain. Real spread varies by client trajectory.`,
    ],
  };
}

// ── G1.80 — §47 Historic Rehabilitation Credit (heuristic) ──────────────

const G1_80_MIN_RE_BALANCE = 250_000;
const G1_80_TYPICAL_QRE = 500_000;
const G1_80_CREDIT_RATE = 0.20;
const G1_80_SPREAD_YEARS = 5;

function detectHistoricRehabCredit(args: {
  computed: ComputedTaxReturn;
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { computed, assetBalances } = args;
  const realEstateBalance = (assetBalances ?? [])
    .filter((a) => a.assetType === "real_estate" || a.assetType === "primary_residence")
    .reduce((s, a) => s + toNum(a.balance), 0);
  if (realEstateBalance < G1_80_MIN_RE_BALANCE && computed.detail.se.netSeEarnings < 100_000) return null;

  const annualCredit = (G1_80_TYPICAL_QRE * G1_80_CREDIT_RATE) / G1_80_SPREAD_YEARS;
  const totalCredit = G1_80_TYPICAL_QRE * G1_80_CREDIT_RATE;
  const estSavings = Math.round(annualCredit);

  const strategy = strategyById("G1.80");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    qre: G1_80_TYPICAL_QRE,
    totalCredit: Math.round(totalCredit),
    annualCredit: Math.round(annualCredit),
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(realEstateBalance))} real estate. If certified historic rehabilitation, ` +
      `§47 20% credit on QRE ${fmt(G1_80_TYPICAL_QRE)} = ${fmt(Math.round(totalCredit))} spread over 5 yrs ` +
      `(${fmt(Math.round(annualCredit))}/yr). NPS Form 10-168 approval + Form 3468.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      realEstateBalance: Math.round(realEstateBalance),
      typicalQre: G1_80_TYPICAL_QRE,
      creditRate: G1_80_CREDIT_RATE,
      spreadYears: G1_80_SPREAD_YEARS,
      annualCredit: Math.round(annualCredit),
      totalCredit: Math.round(totalCredit),
      estSavings,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify whether property is certified historic. CPA + NPS confirm.`,
      `Structure must be CERTIFIED HISTORIC STRUCTURE per §47(c)(3) — listed on National Register OR contributing to registered historic district.`,
      `Rehabilitation must be CERTIFIED REHABILITATION per §47(c)(2)(C) — Secretary of Interior approval via NPS Form 10-168 Parts 1/2/3.`,
      `Pre-TCJA 10% non-historic credit REPEALED per TCJA §13402 (placed in service after 2017).`,
      `TCJA spread: 20% credit recognized 4% per year over 5 yrs (was lump-sum pre-TCJA).`,
      `Substantial-rehabilitation test per §47(c)(1)(A) — QREs > greater of $5,000 OR adjusted basis, within 24-mo period (60-mo phased).`,
      `5-yr recapture per §50(a)(1)(A) — disposal before 5 yrs triggers recapture (20% per year remaining).`,
      `Credit basis reduction per §50(c)(1) — depreciable basis reduced by credit amount.`,
      `State-specific historic credits stack (35 states with own programs).`,
      `Heuristic $500k QRE — actual rehabs range $50k to $50M+.`,
    ],
  };
}

// ── G1.81 — §44 Disabled Access Credit (heuristic) ──────────────────────

const G1_81_MIN_SE = 50_000;
const G1_81_MAX_SE = 1_000_000;
const G1_81_TYPICAL_EXPENSE = 5_250;
const G1_81_CREDIT_FLOOR = 250;

function detectDisabledAccessCredit(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  const netSe = computed.detail.se.netSeEarnings;
  if (netSe < G1_81_MIN_SE || netSe > G1_81_MAX_SE) return null;
  const hasCredit = adjustments.some(
    (a) =>
      (a.adjustmentType === "disabled_access_credit" || a.adjustmentType === "section_44_credit") &&
      a.isApplied !== false &&
      toNum(a.amount) > 0,
  );
  if (hasCredit) return null;

  // Credit = 50% × (expense − $250); capped at $5k ((10250-250)/2).
  const eligibleExpense = Math.min(G1_81_TYPICAL_EXPENSE, 10_250);
  const credit = Math.round(0.5 * Math.max(0, eligibleExpense - G1_81_CREDIT_FLOOR));
  const estSavings = credit;

  const strategy = strategyById("G1.81");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    accommodationDescription: "ADA accommodation",
    expenseAmount: G1_81_TYPICAL_EXPENSE,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Small biz SE ${fmt(Math.round(netSe))} (< $1M cap). §44 credit on ADA accommodations: 50% × ` +
      `($${G1_81_TYPICAL_EXPENSE.toLocaleString("en-US")} expense − $250 floor) = ${fmt(credit)}. Annual cap $5k via Form 8826.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      typicalExpense: G1_81_TYPICAL_EXPENSE,
      creditFloor: G1_81_CREDIT_FLOOR,
      credit,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify whether biz has actual ADA accommodation expenses. CPA confirms.`,
      `Eligible small business per §44(b): prior-yr gross receipts ≤ $1,000,000 OR ≤ 30 full-time employees.`,
      `Expense range: > $250 AND ≤ $10,250 per year (credit = 50% × (expense − $250)).`,
      `Annual cap $5,000 credit (=50% × ($10,250 − $250)).`,
      `Eligible expenses per §44(c)(2): remove architectural/physical barriers; interpreters; modify equipment; alternative formats; reasonable accommodations.`,
      `§44(d)(7) — disallowed if eligible for §190 deduction (architectural barrier removal). Choose ONE: credit OR deduction.`,
      `Form 8826 + §38 general business credit (20-yr carryforward).`,
      `Coordinate with state ADA grants.`,
      `Heuristic $5,250 typical expense → $2,500 credit. Real varies by accommodation type.`,
    ],
  };
}

// ── G1.82 — §1374 Built-In Gains (heuristic) ────────────────────────────

const G1_82_MIN_K1_ACTIVE = 50_000;
const G1_82_TYPICAL_AVOIDED_RECOGNITION = 100_000;
const G1_82_BIG_RATE = 0.21;

function detectSection1374Big(args: {
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { computed } = args;
  const k1Active = computed.scheduleK1?.totalActiveOrdinaryIncome ?? 0;
  if (k1Active < G1_82_MIN_K1_ACTIVE) return null;

  // Heuristic: $100k avoided recognition × 21% BIG = $21k entity-level tax savings
  // (flows through K-1 as reduction in pass-through ordinary income).
  const estSavings = Math.round(G1_82_TYPICAL_AVOIDED_RECOGNITION * G1_82_BIG_RATE);

  const strategy = strategyById("G1.82");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(k1Active))} S-corp K-1 active income. If S-corp converted from C-corp ` +
      `within 5 yrs, §1374 BIG tax = 21% × net recognized BIG. HOLDING appreciated assets past 5-yr recognition ` +
      `period avoids ${fmt(estSavings)} per $100k of avoided recognition. CPA confirms conversion date + asset basis.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      k1ActiveIncome: Math.round(k1Active),
      typicalAvoidedRecognition: G1_82_TYPICAL_AVOIDED_RECOGNITION,
      bigRate: G1_82_BIG_RATE,
      estSavings,
    },
    assumptions: [
      `HEURISTIC — engine doesn't track per-K-1 conversion date or asset basis. CPA confirms.`,
      `Applies ONLY to newly-elected S-corp within 5-yr recognition period per §1374(d)(7) (was 10 yrs pre-2009; PATH Act 2015 permanent reduction).`,
      `BIG tax = 21% × MIN(net recognized BIG, taxable income as if C-corp). Built-in LOSSES per §1374(d)(4) offset.`,
      `S-corp election date (Form 2553) determines recognition period start.`,
      `Asset-by-asset basis schedule MUST be maintained over recognition period.`,
      `C-corp earnings & profits at conversion can trigger §1375 passive investment income tax on top of §1374.`,
      `Form 1120-S Schedule D + Form 8869 (recognized BIG attached statement).`,
      `Tax flows through K-1 to shareholder as reduction in pass-through ordinary income.`,
      `Coordinate with G1.17 (S-corp reasonable comp), G1.83 (§338(h)(10) accelerates recognition).`,
      `Heuristic $100k avoided recognition × 21% BIG = $21k. Real value depends on asset appreciation × time-to-period-end.`,
    ],
  };
}

// ── G1.83 — §338(h)(10) Election (heuristic) ────────────────────────────

const G1_83_MIN_K1_ACTIVE = 100_000;
const G1_83_MIN_LTCG = 250_000;
const G1_83_TYPICAL_DEAL = 1_000_000;
const G1_83_RECAPTURE_PORTION = 0.30;
const G1_83_CHARACTER_SPREAD = 0.13;

function detectSection338h10(args: {
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { computed } = args;
  const k1Active = computed.scheduleK1?.totalActiveOrdinaryIncome ?? 0;
  if (k1Active < G1_83_MIN_K1_ACTIVE) return null;
  const ltcg = computed.detail.capitalGains.longTermGains;
  if (ltcg < G1_83_MIN_LTCG) return null;
  // Exclude owner-operator with SE income > $100k (proxy that entity has paid them W-2).
  if (computed.detail.se.netSeEarnings > 100_000) return null;

  // Heuristic: $1M deal × 30% recapture × 13% character spread = $39,000.
  const characterCost = G1_83_TYPICAL_DEAL * G1_83_RECAPTURE_PORTION * G1_83_CHARACTER_SPREAD;
  const estSavings = Math.round(characterCost);

  const strategy = strategyById("G1.83");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(k1Active))} S-corp K-1 + ${fmt(Math.round(ltcg))} LTCG — likely S-corp exit year. ` +
      `§338(h)(10) joint election treats stock sale as deemed asset sale: ordinary on §1245/§1250 recapture + cap ` +
      `gain on goodwill/§197. Buyer typically pays seller premium to compensate for character. Heuristic character ` +
      `cost ~${fmt(estSavings)} per $1M deal — negotiated against premium.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      k1ActiveIncome: Math.round(k1Active),
      longTermGains: Math.round(ltcg),
      typicalDeal: G1_83_TYPICAL_DEAL,
      recapturePortion: G1_83_RECAPTURE_PORTION,
      characterSpread: G1_83_CHARACTER_SPREAD,
      estSavings,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify whether actual stock sale occurred. CPA confirms.`,
      `Sale must be QUALIFIED STOCK PURCHASE per §338(d)(3) — 80%+ stock purchase within 12-mo period.`,
      `JOINT election by BOTH BUYER (corporation) AND ALL S-corp shareholders — Form 8023 within 8.5 mo of acquisition.`,
      `Asset allocation under §1060 residual method — Form 8883 + appraisal.`,
      `Character analysis: §1245 / §1250 / §291 depreciation recapture is ORDINARY; goodwill / §197 is CAP GAIN.`,
      `Bilateral price negotiation — buyer typically pays MORE cash to compensate seller for character conversion.`,
      `Seller-side state tax — most states track federal; CA / NY allow §338(h)(10) recognition deferred.`,
      `Distinct from §338(g) (one-sided election, no asset-sale treatment for seller — generally unfavorable for individuals).`,
      `Coordinate with G1.82 §1374 BIG (which DEFERS recognition; §338(h)(10) ACCELERATES via asset-sale treatment).`,
      `Heuristic 30% recapture portion + 13% character spread. Real allocation varies by industry + asset mix.`,
    ],
  };
}

// ── G1.84 — §351 Controlled-Corp Contribution (heuristic) ───────────────

const G1_84_MIN_RE_BALANCE = 500_000;
const G1_84_MIN_BROKERAGE_BALANCE = 250_000;
const G1_84_TYPICAL_FMV = 500_000;
const G1_84_TYPICAL_BASIS = 100_000;
const G1_84_LTCG_NIIT_RATE = 0.238;

function detectSection351Contribution(args: {
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { assetBalances } = args;
  if (!assetBalances || assetBalances.length === 0) return null;
  const reBalance = assetBalances
    .filter((a) => a.assetType === "real_estate")
    .reduce((s, a) => s + toNum(a.balance), 0);
  const brokerageBalance = assetBalances
    .filter((a) => a.assetType === "brokerage_taxable")
    .reduce((s, a) => s + toNum(a.balance), 0);
  if (reBalance < G1_84_MIN_RE_BALANCE && brokerageBalance < G1_84_MIN_BROKERAGE_BALANCE) return null;

  // Heuristic: $500k FMV - $100k basis = $400k gain × 23.8% LTCG+NIIT = $95,200 deferred.
  const embeddedGain = G1_84_TYPICAL_FMV - G1_84_TYPICAL_BASIS;
  const estSavings = Math.round(embeddedGain * G1_84_LTCG_NIIT_RATE);

  const strategy = strategyById("G1.84");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    contributedFmv: G1_84_TYPICAL_FMV,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client holds appreciated property (RE ${fmt(Math.round(reBalance))} + brokerage ${fmt(Math.round(brokerageBalance))}). ` +
      `If forming new corp + contributing for ≥ 80% control: §351 tax-free contribution defers ` +
      `${fmt(embeddedGain)} embedded gain. Heuristic PV benefit ${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      realEstateBalance: Math.round(reBalance),
      brokerageBalance: Math.round(brokerageBalance),
      typicalFmv: G1_84_TYPICAL_FMV,
      typicalBasis: G1_84_TYPICAL_BASIS,
      embeddedGain: Math.round(embeddedGain),
      ltcgNiitRate: G1_84_LTCG_NIIT_RATE,
      estSavings,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify intent to incorporate. CPA confirms.`,
      `Transferor (or group) must control ≥ 80% voting + ≥ 80% other classes per §368(c) IMMEDIATELY AFTER transfer.`,
      `Property transferred (NOT services per §351(d)(1) — services don't qualify; receive stock taxable as comp).`,
      `Boot received → recognize gain up to FMV of boot per §351(b); character preserved (LTCG if held > 1 yr).`,
      `Transferor basis in stock = transferred property basis − boot + gain recognized (§358).`,
      `Corporation basis in property = transferor basis + gain recognized (§362).`,
      `Disqualified: investment company stock (§351(e)(1)); inventory + receivables = ordinary.`,
      `Distinct from §721 partnership contribution (similar rules but partnership; no 80% control test).`,
      `Coordinate with §1244 small biz stock election (G1.40) — ordinary loss treatment if business fails.`,
      `QSBS §1202 timing — 5-yr holding starts at issuance (§351 timing matters for QSBS clock).`,
      `Heuristic $500k FMV / $100k basis = 80% appreciation. Real basis varies — CPA tracks.`,
    ],
  };
}

// ── G1.85 — §163(h)(3) Mortgage Interest Optimization (heuristic) ───────

const G1_85_MIN_MORTGAGE_INT = 20_000;

function detectMortgageInterestOptim(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  if (computed.itemizedDeductions == null) return null;
  const mortgageInt = sumAdjustment(adjustments, "mortgage_interest");
  if (mortgageInt < G1_85_MIN_MORTGAGE_INT) return null;

  // Heuristic: 80% of mortgage interest retained × marginal rate.
  const fedRate = federalMarginalRate(computed);
  const retainedDeduction = mortgageInt * 0.80;
  const estSavings = Math.round(retainedDeduction * fedRate);

  const strategy = strategyById("G1.85");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client itemizes with ${fmt(Math.round(mortgageInt))} mortgage interest. Verify §163(h)(3) classification: ` +
      `acquisition cap $750k (post-2017 origination) vs $1M (pre-2018 grandfathered). HELOC interest deductible ` +
      `ONLY if traced to buy/build/improve. Heuristic retained deduction ${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      mortgageInterest: Math.round(mortgageInt),
      federalMarginalRate: fedRate,
      retainedDeductionFactor: 0.80,
      estSavings,
    },
    assumptions: [
      `HEURISTIC — engine assumes 80% retained deduction. Actual retained depends on loan size vs cap.`,
      `Loans before 2017-12-15 GRANDFATHERED at $1M acquisition cap per §163(h)(3)(F)(i)(I).`,
      `Loan use TRACING per Reg §1.163-8T — proceeds must be traced to USE (acquisition, improvement, equity).`,
      `Acquisition indebtedness per §163(h)(3)(B): debt incurred to acquire, construct, or substantially improve qualified residence; secured by qualified residence.`,
      `Home-equity indebtedness post-TCJA: deductible ONLY if proceeds used to buy/build/improve.`,
      `Qualifying residence per §163(h)(4)(A)(i): principal residence + ONE other.`,
      `Refinance grandfathering: refi of grandfathered loan stays at $1M cap UP TO original balance.`,
      `Joint return aggregation — combined $750k cap (MFS $375k).`,
      `TCJA changes SUNSET TY2026 (revert to pre-TCJA $1M cap + home-equity allowed) per TCJA §11043(b) UNLESS extended.`,
      `Coordinate with G1.3 bunching (itemized), G1.78 multi-state.`,
    ],
  };
}

// ── G1.86 — Charitable Lead Trust (heuristic) ────────────────────────────

const G1_86_MIN_AGI = 1_000_000;
const G1_86_MIN_MARGINAL = 0.32;
const G1_86_MIN_CHARITY = 50_000;
const G1_86_TYPICAL_TRUST = 1_000_000;
const G1_86_PV_DEDUCTION = 700_000;

function detectCharitableLeadTrust(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  if (computed.adjustedGrossIncome < G1_86_MIN_AGI) return null;
  const fedRate = federalMarginalRate(computed);
  if (fedRate < G1_86_MIN_MARGINAL) return null;
  const charity = sumAdjustment(adjustments, "charitable_cash");
  if (charity < G1_86_MIN_CHARITY) return null;

  // Heuristic: $700k PV deduction × marginal rate × 30% AGI cap.
  // Cap to 30% of AGI for cash to public charity.
  const agiCap = computed.adjustedGrossIncome * 0.30;
  const deductibleThisYear = Math.min(G1_86_PV_DEDUCTION, agiCap);
  const estSavings = Math.round(deductibleThisYear * fedRate);

  const strategy = strategyById("G1.86");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    deductionAmount: G1_86_PV_DEDUCTION,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client HNW (AGI ${fmt(Math.round(computed.adjustedGrossIncome))}) + ${Math.round(fedRate * 100)}% marginal + ` +
      `${fmt(Math.round(charity))} charity giving = candidate for Grantor CLT. Fund $1M+ trust → immediate income-` +
      `tax deduction ~${fmt(G1_86_PV_DEDUCTION)} × marginal = ${fmt(estSavings)} (capped at 30% AGI = ${fmt(Math.round(agiCap))}, 5-yr CF).`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(computed.adjustedGrossIncome),
      federalMarginalRate: fedRate,
      charitableGiving: Math.round(charity),
      typicalTrust: G1_86_TYPICAL_TRUST,
      pvDeduction: G1_86_PV_DEDUCTION,
      agiCap: Math.round(agiCap),
      deductibleThisYear: Math.round(deductibleThisYear),
      estSavings,
    },
    assumptions: [
      `HEURISTIC — engine doesn't compute §7520 rate × PV math. Rough estimate ONLY.`,
      `GRANTOR CLT vs Non-grantor CLT: GRANTOR gives donor immediate income-tax deduction BUT donor pays tax on trust income during term.`,
      `Trust term + annuity rate determine PV deduction per §7520 rate (published monthly; use lowest available for highest deduction).`,
      `AGI cap: 30% for cash to public charity (5-yr carryforward per §170(d)(1)).`,
      `Distinct from CRT G1.19 (donor gets income, charity gets remainder) — CLT is OPPOSITE.`,
      `Estate planning bonus — at trust end, remainder to heirs at REDUCED gift/estate tax value (frozen at funding).`,
      `Trust documents per Rev. Proc. 2007-45 sample forms (CLAT) or Rev. Proc. 2008-45 (CLUT).`,
      `OUT OF SCOPE for engine — trust files 1041 (out of Option A). Heuristic FOR DONOR 1040 only.`,
      `Heuristic $700k PV deduction (70% of $1M trust) × marginal. Real PV varies with rate + term + annuity %.`,
    ],
  };
}

// ── G1.87 — §401(a)(17) Compensation Cap (heuristic) ────────────────────

// §401(a)(17) annual compensation cap, indexed. TY2024 $345k (Notice 2023-75);
// TY2025 $350k (Notice 2024-80); TY2026 $360k (Notice 2025-67 / IR-2025-111).
const G1_87_COMP_CAP: Record<TaxYear, number> = {
  2024: 345_000,
  2025: 350_000,
  2026: 360_000,
};
const G1_87_MIN_INCOME = 400_000;
const G1_87_LOST_MATCH_RATE = 0.05;

function detectSection401a17Cap(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { computed, adjustments, baselineInputs } = args;
  if (computed.totalIncome < G1_87_MIN_INCOME) return null;
  const seIncome = computed.detail.se.netSeEarnings ?? 0;
  // M3 (audit 2026-06-11) — §401(a)(17) caps PLAN COMPENSATION (W-2 wages or
  // SE earned income), not investment income. The wage leg requires ACTUAL
  // W-2s; the SE leg stands on the engine's net-SE figure. The old
  // `totalIncome − netSE` proxy told a K-1-only owner with an IRA adjustment
  // their "compensation" exceeded the qualified-plan cap.
  const { hasW2, wages } = w2WagesSignal(computed, baselineInputs);
  const wagesProxy = hasW2 ? wages : 0;
  const cap = G1_87_COMP_CAP[resolveTaxYear(computed.taxYear)];
  if (wagesProxy < cap && seIncome < cap) return null;
  // Skip if no qualified plan adjustment.
  const hasRetirement = adjustments.some(
    (a) =>
      a.isApplied !== false &&
      toNum(a.amount) > 0 &&
      (a.adjustmentType.includes("401k") ||
        a.adjustmentType.includes("retirement") ||
        a.adjustmentType.includes("sep") ||
        a.adjustmentType === "ira_contribution_traditional"),
  );
  if (!hasRetirement) return null;

  // Lost match = compensation above cap × 5% typical match rate.
  const compAboveCap = Math.max(0, Math.max(wagesProxy, seIncome) - cap);
  const lostMatch = compAboveCap * G1_87_LOST_MATCH_RATE;
  const fedRate = federalMarginalRate(computed);
  const estSavings = Math.round(lostMatch * fedRate);
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.87");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    capLimit: cap,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client compensation ${fmt(Math.round(Math.max(wagesProxy, seIncome)))} exceeds §401(a)(17) ${fmt(cap)} ` +
      `cap. ${fmt(Math.round(compAboveCap))} of compensation INELIGIBLE for qualified-plan math. Combine with ` +
      `NQDC §409A (G1.57) / DB plan (G1.28) / Mega-Backdoor (G1.16). Heuristic ${fmt(estSavings)} annual benefit.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      totalIncome: Math.round(computed.totalIncome),
      wagesProxy: Math.round(wagesProxy),
      seIncome: Math.round(seIncome),
      capLimit: cap,
      compAboveCap: Math.round(compAboveCap),
      lostMatch: Math.round(lostMatch),
      federalMarginalRate: fedRate,
      estSavings,
    },
    assumptions: [
      `§401(a)(17) compensation cap TY2024: $345,000 (Notice 2023-75); TY2025: $350,000 (Notice 2024-80).`,
      `Compensation ABOVE cap is INELIGIBLE for qualified-plan contribution math (employer 401(k) match + profit-share + SEP).`,
      `§415(c) defined-contribution annual additions limit: TY2024 $69,000 / TY2025 $70,000.`,
      `§415(b) defined-benefit annual benefit limit: TY2024 $275,000 / TY2025 $280,000.`,
      `Recapture via: NQDC §409A (G1.57), defined-benefit/cash-balance plan (G1.28), Mega-Backdoor (G1.16).`,
      `Top-heavy testing per §416 — concentrated ownership may force minimum contribution.`,
      `Highly Compensated Employees (HCE) test per §414(q): TY2024 > $155,000.`,
      `Heuristic 5% lost match × marginal — actual depends on employer match formula.`,
    ],
  };
}

// ── G1.88 — §199A SSTB Navigation (heuristic) ───────────────────────────

// G1.88/G1.89 reuse the year-indexed QBI_THRESHOLDS (threshold = SSTB full
// phase-out start; top = phase-out end). This year-indexes the SSTB band
// (TY2024 $191,950 / TY2025 $197,300 / TY2026 $201,750 single) instead of the
// prior TY2024-only hard-codes.
const G1_88_TYPICAL_PRESERVED = 2_400;

function detectSstbNavigation(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  const k1Active = computed.scheduleK1?.totalActiveOrdinaryIncome ?? 0;
  const netSe = computed.detail.se.netSeEarnings ?? 0;
  if (k1Active < 50_000 && netSe < 50_000) return null;
  const hasQbi = adjustments.some(
    (a) => a.adjustmentType === "qbi_income" && a.isApplied !== false && toNum(a.amount) > 0,
  );
  if (!hasQbi) return null;
  const sstbTier = (QBI_THRESHOLDS[resolveTaxYear(computed.taxYear)]);
  const sstbBand = sstbTier[computed.filingStatus] ?? sstbTier.single;
  const fullThresh = sstbBand.threshold;
  const phaseOutTop = sstbBand.top;
  if (computed.taxableIncome < fullThresh) return null;
  if (computed.taxableIncome > phaseOutTop) return null;

  // Heuristic preserved benefit: $2,400.
  const estSavings = G1_88_TYPICAL_PRESERVED;

  const strategy = strategyById("G1.88");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    sstThreshold: fullThresh,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client in §199A SSTB phase-out range (taxable ${fmt(Math.round(computed.taxableIncome))} between ` +
      `${fmt(fullThresh)} and ${fmt(phaseOutTop)}). If SSTB (health/law/accounting/consulting/etc.), ` +
      `deduction phases out — stay BELOW ${fmt(fullThresh)} via max retirement + deductions. Preserved ` +
      `${fmt(estSavings)} benefit.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      taxableIncome: Math.round(computed.taxableIncome),
      sstThreshold: fullThresh,
      phaseOutTop,
      filingStatus: computed.filingStatus,
      estSavings,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify whether client's business is SSTB. CPA confirms per Reg §1.199A-5.`,
      `SSTB definition §199A(d)(2): health, law, accounting, actuarial sci, performing arts, consulting, athletics, financial services, brokerage, investment management, trading, dealing in securities/partnership interests/commodities, OR trade where principal asset is reputation/skill.`,
      `TY2024 (Notice 2023-75): full deduction ≤ $191,950 single / $383,900 MFJ; phase-out top $241,950 single / $483,900 MFJ; NO deduction above phase-out for SSTB.`,
      `TY2025 (Notice 2024-80): full ≤ $197,300 single / $394,600 MFJ; phase-out top $247,300 single / $494,600 MFJ.`,
      `Non-SSTB businesses: phase-IN W-2-wage / UBIA cap above same threshold (G1.7 covers).`,
      `Strategy to stay below: max retirement (G1.1 SEP / G1.28 DB / G1.16 Mega), accelerate deductions (G1.3 bunching), defer income (G1.69).`,
      `Aggregation election per Reg §1.199A-4 (G1.89) NOT allowed for SSTB.`,
      `Heuristic $2,400 preserved — varies with QBI size + bracket.`,
    ],
  };
}

// ── G1.89 — §199A Aggregation Election (heuristic) ──────────────────────

const G1_89_TYPICAL_PRESERVED = 9_600;

function detectSection199aAggregation(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  const k1Active = computed.scheduleK1?.totalActiveOrdinaryIncome ?? 0;
  if (k1Active < 100_000) return null;
  const hasQbi = adjustments.some(
    (a) => a.adjustmentType === "qbi_income" && a.isApplied !== false && toNum(a.amount) > 0,
  );
  if (!hasQbi) return null;
  const aggTier = (QBI_THRESHOLDS[resolveTaxYear(computed.taxYear)]);
  const fullThresh = (aggTier[computed.filingStatus] ?? aggTier.single).threshold;
  if (computed.taxableIncome < fullThresh) return null;

  const estSavings = G1_89_TYPICAL_PRESERVED;

  const strategy = strategyById("G1.89");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    numTrades: 2,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(k1Active))} K-1 active income + QBI + taxable income above ` +
      `${fmt(fullThresh)} (W-2/UBIA cap kicks in). Reg §1.199A-4 aggregation election: combine related ` +
      `non-SSTB trades to share W-2 wages + UBIA. Form 8995-A Sch B annual election. Heuristic ${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      k1ActiveIncome: Math.round(k1Active),
      taxableIncome: Math.round(computed.taxableIncome),
      fullThreshold: fullThresh,
      estSavings,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify multi-trade structure. CPA confirms common ownership + shared characteristics.`,
      `Common ownership ≥ 50% per Reg §1.199A-4(b)(1)(i) (attribution rules §267(b)/§707(b)).`,
      `Shared characteristics ≥ 2 of: (a) products/services, (b) facilities/employees, (c) interconnected business processes.`,
      `Cannot include SSTB in aggregation per Reg §1.199A-4(b)(1)(iv).`,
      `Election made on Form 8995-A Sch B; ANNUAL election (can re-aggregate each year).`,
      `Disclosure required per Reg §1.199A-4(c)(2) — disclose aggregation by trade.`,
      `Aggregated wages + UBIA cap applies to AGGREGATED QBI (combined math, not per-trade).`,
      `Coordinate with G1.7 (W-2/UBIA simplified) + G1.88 (SSTB phase-out).`,
      `Heuristic $9,600 preserved = $200k QBI × 20% × 24% — varies widely.`,
    ],
  };
}

// ── G1.90 — Pooled Income Fund §642(c)(5) (heuristic) ──────────────────

const G1_90_MIN_AGI = 500_000;
const G1_90_MIN_AGE = 55;
const G1_90_MIN_CHARITY = 25_000;
const G1_90_TYPICAL_CONTRIB = 100_000;
const G1_90_PV_FACTOR = 0.70;

function detectPooledIncomeFund(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { client, computed, adjustments } = args;
  if (computed.adjustedGrossIncome < G1_90_MIN_AGI) return null;
  const age = client.taxpayerAge;
  if (age == null || age < G1_90_MIN_AGE) return null;
  const charity = sumAdjustment(adjustments, "charitable_cash");
  if (charity < G1_90_MIN_CHARITY) return null;

  const deductionAmount = G1_90_TYPICAL_CONTRIB * G1_90_PV_FACTOR;
  const fedRate = federalMarginalRate(computed);
  const agiCap = computed.adjustedGrossIncome * 0.30;
  const deductibleThisYear = Math.min(deductionAmount, agiCap);
  const estSavings = Math.round(deductibleThisYear * fedRate);

  const strategy = strategyById("G1.90");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    contribution: G1_90_TYPICAL_CONTRIB,
    deductionAmount: Math.round(deductionAmount),
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client age ${age} + AGI ${fmt(Math.round(computed.adjustedGrossIncome))} + charity ${fmt(Math.round(charity))} ` +
      `= candidate for PIF §642(c)(5). Contribute ${fmt(G1_90_TYPICAL_CONTRIB)} to charity-maintained fund; receive ` +
      `pro-rata life income; remainder to charity. PV deduction ${fmt(Math.round(deductionAmount))}; tax savings ${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      taxpayerAge: age,
      agi: Math.round(computed.adjustedGrossIncome),
      charitableGiving: Math.round(charity),
      typicalContrib: G1_90_TYPICAL_CONTRIB,
      pvFactor: G1_90_PV_FACTOR,
      deductionAmount: Math.round(deductionAmount),
      federalMarginalRate: fedRate,
      agiCap: Math.round(agiCap),
      deductibleThisYear: Math.round(deductibleThisYear),
      estSavings,
    },
    assumptions: [
      `HEURISTIC — engine doesn't compute §7520 rate × actuarial life expectancy. Rough estimate ONLY.`,
      `PIF similar to CRT G1.19 BUT: (a) charity maintains fund (no separate trust admin); (b) lower minimum (~$5k vs $100k+ CRT); (c) pro-rata income (no fixed annuity).`,
      `Qualified charity that maintains PIF per Reg §1.642(c)-5 (universities, hospitals, large land trusts commonly do).`,
      `Donor receives life income (pro-rata share of fund's ordinary income) — taxable to donor as DNI per §662.`,
      `PV remainder per §7520 rate × life-expectancy table — deductible at contribution (§170(f)(2)(A)).`,
      `AGI cap: 30% for cash to public charity (5-yr carryforward per §170(d)(1)).`,
      `OUT OF SCOPE for engine — PIF computes its own §662 income distribution; engine doesn't model.`,
      `Estate planning bonus — contribution removes asset from gross estate per §2055.`,
      `Heuristic 70% PV factor (age 70 + 7520 rate 5%). Real PV varies with age + rate.`,
    ],
  };
}

// ── G1.91 — §139 Qualified Disaster Relief (heuristic) ──────────────────

const G1_91_DISASTER_STATES = new Set([
  "CA", "FL", "TX", "LA", "NC", "SC", "TN", "KY", "MO", "IA", "GA",
]);
const G1_91_MIN_AGI = 100_000;
const G1_91_TYPICAL_RECEIVED = 20_000;

function detectDisasterRelief(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { client, computed, adjustments } = args;
  if (computed.adjustedGrossIncome < G1_91_MIN_AGI) return null;
  const state = (client.state ?? "").toUpperCase();
  if (!G1_91_DISASTER_STATES.has(state)) return null;
  // Q4 (audit 2026-06-08) — fire only when the client ACTUALLY has a recorded
  // disaster payment to potentially exclude under §139 (an actionable signal),
  // NOT for every >$100k filer who merely lives in a disaster-prone state with
  // NO marker (the prior inverted gate, which fired on a huge fraction of the
  // FL/TX/CA book and ranked by a phantom $20k×rate). Valued at the real marker.
  const disasterPaymentAmount = adjustments
    .filter((a) =>
      (a.adjustmentType === "section_139_payment" ||
        a.adjustmentType === "qualified_disaster_payment") &&
      a.isApplied !== false)
    .reduce((s, a) => s + Math.max(0, toNum(a.amount)), 0);
  if (disasterPaymentAmount <= 0) return null;

  const fedRate = federalMarginalRate(computed);
  const estSavings = Math.round(disasterPaymentAmount * fedRate);

  const strategy = strategyById("G1.91");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client in ${state} (recent federally-declared disaster proxy state). Confirm any received disaster-relief ` +
      `payments excluded under §139. Heuristic ${fmt(G1_91_TYPICAL_RECEIVED)} × ${Math.round(fedRate * 100)}% marginal ` +
      `= ${fmt(estSavings)}. Also: §165(h) casualty loss with 10% AGI floor WAIVED for federally-declared disaster.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      state,
      agi: Math.round(computed.adjustedGrossIncome),
      typicalReceived: G1_91_TYPICAL_RECEIVED,
      federalMarginalRate: fedRate,
      estSavings,
    },
    assumptions: [
      `HEURISTIC — engine cannot verify disaster payments received OR federally-declared disaster in client's specific year. CPA confirms via FEMA database.`,
      `Excludable per §139(b): reasonable/necessary personal/family/living/funeral expenses incurred as result of disaster.`,
      `Excludable per §139(c)(2): reasonable/necessary expenses for repair/rehabilitation of personal residence/contents.`,
      `Excludable per §139(c)(3): by reason of death/personal physical injury.`,
      `MUST be paid AS RESULT of qualified disaster (timing + causation).`,
      `§165(h)(5)(A) federally-declared disaster loss: deductible above 10% AGI floor (waived for fed-declared per TCJA §11044 — extends through 2025).`,
      `Casualty loss claim: Form 4684; basis adjustment per §165(b).`,
      `Coordinate with §165(i) prior-year deduction election (federally-declared).`,
      `Specific exclusions: §139(c)(4)(A) — not eligible if payment also Code §164/§115 excludable.`,
      `State conformity varies.`,
      `Heuristic $20k typical received payment × marginal. Real amounts vary by disaster + assistance type.`,
    ],
  };
}

// ── G1.92 — Solo 401(k) Employee Deferral vs SEP (heuristic) ────────────

const G1_92_MIN_SE = 20_000;
const G1_92_MAX_SE = 150_000;
// §402(g) elective deferral cap (employee side of a Solo 401(k)), indexed.
// TY2024 $23,000; TY2025 $23,500; TY2026 $24,500 (IR-2025-111).
const G1_92_EMPLOYEE_DEFERRAL: Record<TaxYear, number> = {
  2024: 23_000,
  2025: 23_500,
  2026: 24_500,
};

function detectSolo401kDeferral(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, adjustments, baselineInputs } = args;
  if (client.filingStatus === "married_filing_separately") return null;
  const netSe = computed.detail.se.netSeEarnings ?? 0;
  if (netSe < G1_92_MIN_SE || netSe > G1_92_MAX_SE) return null;
  // Skip if any retirement adj exists (G1.1 covers).
  const hasRetirement = adjustments.some(
    (a) =>
      a.isApplied !== false &&
      toNum(a.amount) > 0 &&
      (a.adjustmentType.includes("sep") ||
        a.adjustmentType.includes("solo401k") ||
        a.adjustmentType.includes("solo_401k") ||
        a.adjustmentType.includes("self_employed_retirement")),
  );
  if (hasRetirement) return null;

  // SEP contribution = 20% × (netSE − halfSE)
  const halfSe = computed.detail.se.deductibleHalf ?? 0;
  // §401(c)(2)/§404(a)(8) plan compensation for the self-employed = net SE
  // earnings − the ½-SE-tax deduction (the engine's own figures).
  const baseForContrib = Math.max(0, netSe - halfSe);
  const sepContrib = baseForContrib * 0.20;

  // M1 (audit 2026-06-11) — the employee elective deferral is capped at BOTH
  // the §402(g) dollar limit AND 100% of compensation (you cannot defer more
  // than you earned), and the total annual addition is capped at min(§415(c)
  // dollar limit, 100% of compensation) per §415(c)(1)(B). Pre-fix, a
  // $22k-net-SE client (comp ≈ $20.3k) was told to defer "$23,500 extra" —
  // an illegal recommendation.
  const deferralDollarLimit = G1_92_EMPLOYEE_DEFERRAL[resolveTaxYear(computed.taxYear)];
  const employeeDeferral = Math.min(deferralDollarLimit, baseForContrib);
  // Solo 401(k) total = employee deferral + employer match (= SEP-equivalent),
  // capped at the §415(c) annual-additions limit AND at compensation.
  const employerMatch = sepContrib;
  const section415cCap = SEP_ANNUAL_LIMIT[resolveTaxYear(computed.taxYear)];
  const totalContribution = Math.min(employeeDeferral + employerMatch, section415cCap, baseForContrib);

  // Extra shelter vs SEP
  const extraVsSep = Math.max(0, totalContribution - sepContrib);
  if (extraVsSep <= 0) return null;

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  const estSavings = Math.round(extraVsSep * (fedRate + stateRate));

  // H2: the Solo 401(k) employee elective deferral (the `extraVsSep` shelter
  // beyond the SEP-equivalent employer match) is an above-the-line deduction
  // on Schedule 1 — same arithmetic as a generic `deduction`. Re-running the
  // engine on the incremental deferral verifies the bracket-exact marginal
  // savings vs the flat heuristic (and any NIIT/AMT/QBI/state cascade).
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.92-solo401k-deferral",
    label: `Solo 401(k) extra deferral $${Math.round(extraVsSep).toLocaleString("en-US")}`,
    mutations: [
      { kind: "add_adjustment", adjustmentType: "deduction", amount: Math.round(extraVsSep) },
    ],
    semantics: "savings",
    varyAmount: true,
  });

  const strategy = strategyById("G1.92");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    employeeDeferral,
    employerMatch: Math.round(employerMatch),
    totalContribution: Math.round(totalContribution),
    extraVsSep: Math.round(extraVsSep),
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client net SE ${fmt(Math.round(netSe))} (low-mid range). Solo 401(k): employee deferral ${fmt(employeeDeferral)} + ` +
      `employer match ${fmt(Math.round(employerMatch))} = ${fmt(Math.round(totalContribution))} shelter vs SEP-only ` +
      `${fmt(Math.round(sepContrib))}. Extra shelter ${fmt(Math.round(extraVsSep))}; savings ${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      halfSeDeduction: Math.round(halfSe),
      sepContribution: Math.round(sepContrib),
      employeeDeferral,
      employerMatch: Math.round(employerMatch),
      totalContribution: Math.round(totalContribution),
      extraVsSep: Math.round(extraVsSep),
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
      estSavings,
    },
    assumptions: [
      `Solo 401(k) = employee deferral + employer match. Employee deferral capped at min(the year's §402(g) dollar limit — $23,000/$23,500/$24,500 TY2024/25/26 — AND 100% of plan compensation = net SE − ½SE per §401(c)(2)); the total annual addition is further capped at min(§415(c) dollar limit, 100% of compensation) per §415(c)(1)(B).`,
      `Age 50+ catch-up $7,500 (§414(v)). Not included in this heuristic (CPA adds if age ≥ 50).`,
      `Employer match = 20% × (netSE − halfSE) — same as SEP formula.`,
      `Total §415(c) cap TY2024 $69,000 / TY2025 $70,000 / TY2026 $72,000.`,
      `Plan establishment deadline: 12-31 of plan year (vs SEP-IRA extended return deadline = SEP more flexible).`,
      `Solo 401(k) allows Roth designation (Solo Roth 401(k) - tax-free growth); SEP doesn't.`,
      `Loan provision per §72(p) — Solo 401(k) can offer; SEP cannot.`,
      `Plan admin cost ~$1k/yr; Form 5500-EZ at $250k+ assets.`,
      `Coordinate with G1.1 (SEP-IRA — for high SE) — choose based on income level + plan-admin tolerance.`,
      `Heuristic = extra shelter × marginal. Real benefit depends on actual SE + age + employer-match structure.`,
      `H2: whatIf models the incremental deferral (extra vs SEP) as an above-the-line deduction; delta is the engine-verified bracket-exact savings.`,
    ],
    whatIf,
  };
}

// ── G1.93 — §163(d)(4)(B) Investment Interest Election (heuristic) ──────

const G1_93_MIN_QDIV_LTCG = 20_000;
const G1_93_MIN_INV_INT = 5_000;
const G1_93_ORD_LTCG_SPREAD = 0.132;

function detectInvestmentInterestElection(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { computed, adjustments, baselineInputs } = args;
  const qdivPlusLtcg = computed.preferentialIncome;
  if (qdivPlusLtcg < G1_93_MIN_QDIV_LTCG) return null;
  const invInt = sumAdjustment(adjustments, "investment_interest_expense");
  if (invInt < G1_93_MIN_INV_INT) return null;

  const fedRate = federalMarginalRate(computed);
  if (fedRate < 0.32) return null;

  // Elect to include enough QDIV/LTCG to free up investment-interest deduction.
  // Heuristic: $20k QDIV/LTCG × 0.132 spread = $2,640 'paid' to free $20k interest × 37% = $7,400 'gained'.
  const electedAmount = Math.min(qdivPlusLtcg, invInt);
  const ratePaid = electedAmount * G1_93_ORD_LTCG_SPREAD;
  const interestGain = electedAmount * fedRate;
  const estSavings = Math.round(interestGain - ratePaid);
  if (estSavings <= 0) return null;

  // H2 (PLAN-Q2) — engine-verified §163(d)(4)(B) election. Recommend electing
  // enough QDIV/LTCG to free the engine-computed DISALLOWED investment interest
  // (§163(d)(2)), capped at the available preferential income. The what-if treats
  // that amount as ordinary investment income (Form 4952 Line 4g) → the engine
  // recomputes the freed deduction AND the rate cost exactly, including the
  // std-vs-itemized floor + SALT cap the 13.2% heuristic ignores. Suppress when
  // the engine shows the election is NOT beneficial (e.g. too little OTHER
  // itemized deduction → the freed interest is wasted against the std deduction).
  const disallowed = computed.investmentInterestDisallowed ?? 0;
  const recommendedElection = Math.round(Math.min(qdivPlusLtcg, disallowed > 0 ? disallowed : electedAmount));
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.93-163d-election",
    label: `§163(d)(4)(B) elect $${recommendedElection.toLocaleString("en-US")}`,
    mutations: [
      { kind: "add_adjustment", adjustmentType: "investment_interest_election_amount", amount: recommendedElection },
    ],
    semantics: "savings",
    varyAmount: true,
  });
  if (whatIf && whatIf.delta.combinedRefundDelta <= 0) return null;

  const strategy = strategyById("G1.93");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    investmentInt: Math.round(invInt),
    electedAmount: Math.round(electedAmount),
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(qdivPlusLtcg))} QDIV/LTCG + ${fmt(Math.round(invInt))} investment interest expense ` +
      `+ ${Math.round(fedRate * 100)}% marginal. §163(d)(4)(B) election treats ${fmt(Math.round(electedAmount))} of ` +
      `QDIV/LTCG as ordinary → frees matching interest deduction. Net benefit ${fmt(estSavings)}.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      qdivPlusLtcg: Math.round(qdivPlusLtcg),
      investmentInterest: Math.round(invInt),
      federalMarginalRate: fedRate,
      electedAmount: Math.round(electedAmount),
      disallowedInterest: Math.round(disallowed),
      recommendedElection,
      ratePaid: Math.round(ratePaid),
      interestGain: Math.round(interestGain),
      estSavings,
    },
    assumptions: [
      whatIf
        ? `ENGINE-VERIFIED via Form 4952: electing $${recommendedElection.toLocaleString("en-US")} of QDIV/LTCG as ordinary investment income frees the §163(d)(2)-disallowed interest; the engine recomputes the exact net benefit (incl. the std-vs-itemized floor + SALT cap). Heuristic was ${fmt(estSavings)}.`
        : `Heuristic spread 13.2% = (37% ord − 23.8% LTCG+NIIT) on the elected amount (no baselineInputs for engine verification; the engine deduction is ITEMIZED — worthless if the client takes the std deduction).`,
      `Form 4952 to track + report investment interest expense.`,
      `Investment interest expense per §163(d)(3) — interest on debt to PURCHASE / CARRY investment property.`,
      `Net investment income per §163(d)(4): ordinary investment income (interest, NON-qualified dividends, royalties, net ST gain) − investment expenses (engine treats investment expenses as 0 — sub-gap).`,
      `Excess investment interest carries forward INDEFINITELY per §163(d)(2).`,
      `Election made annually on Form 4952 Line 4g — irrevocable for that year.`,
      `The elected amount STAYS in the §1411 NIIT base (the election is a §163(d) characterization, not §1411).`,
      `Trade-or-business interest is §163(j) territory (C7) — different rules.`,
    ],
    whatIf,
  };
}

// ── G1.94 — §85 Unemployment Income Analysis (heuristic) ────────────────

const G1_94_MIN_UI = 5_000;
const G1_94_MAX_AGI = 150_000;

function detectUnemploymentAnalysis(args: {
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { computed } = args;
  if (computed.adjustedGrossIncome > G1_94_MAX_AGI) return null;
  const ui = computed.form1099Summary?.unemploymentCompensationOnly ?? 0;
  if (ui < G1_94_MIN_UI) return null;

  const fedRate = federalMarginalRate(computed);
  const estSavings = Math.round(ui * fedRate);

  const strategy = strategyById("G1.94");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    uiAmount: Math.round(ui),
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(ui))} unemployment income. §85 — fully federal-taxable (ARP exclusion ` +
      `sunset TY2020). Confirm Sch 1 Line 7 has FULL amount. Elect §3402(p) voluntary 10% withholding via ` +
      `Form W-4V to avoid §6654 underpayment penalty. State-specific exclusions may apply.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      unemploymentIncome: Math.round(ui),
      agi: Math.round(computed.adjustedGrossIncome),
      federalMarginalRate: fedRate,
      estSavings,
    },
    assumptions: [
      `§85 unemployment income FULLY federal-taxable per TY2021+ (post-ARP sunset).`,
      `Voluntary withholding election per §3402(p) — 10% flat rate from state UI office (Form W-4V).`,
      `State conformity: TX/WA/FL/NV/SD/WY/AK no income tax; CA/NJ/PA/MT/VA/AL/NH exclude UI; OR after age 62; partial in others.`,
      `Schedule 1 Line 7 — full UI amount.`,
      `Form W-4V — voluntary withholding (10% flat federal rate ONLY — no state withholding option for UI).`,
      `§6654 underpayment penalty — UI without withholding can trigger penalty even with low income.`,
      `Coordinate with G1.52 estimated tax safe harbor + state-specific filing.`,
      `Heuristic = UI × marginal. Real value depends on existing withholding + state conformity.`,
    ],
  };
}

// ── G1.95 — §1377(a)(2) S-corp Terminating Shareholder (heuristic) ──────

const G1_95_MIN_K1 = 50_000;
const G1_95_TYPICAL_MISMATCH_BENEFIT = 5_000;

function detectSection1377Election(args: {
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { computed } = args;
  const k1Active = computed.scheduleK1?.totalActiveOrdinaryIncome ?? 0;
  if (k1Active < G1_95_MIN_K1) return null;
  // PLAN-02: §1377(a)(2) is an S-corp-only election; gate on S-corp presence,
  // NOT SE earnings. S-corp K-1 Box 1 is never self-employment income, so the
  // old `netSeEarnings` gate made this detector dead code for the very S-corp
  // shareholders the strategy targets.
  if ((computed.scheduleK1?.sCorpCount ?? 0) < 1) return null;

  const estSavings = G1_95_TYPICAL_MISMATCH_BENEFIT;

  const strategy = strategyById("G1.95");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client has ${fmt(Math.round(k1Active))} S-corp K-1 + SE. If shareholder terminates mid-year, ` +
      `§1377(a)(2) election closes books on termination date (2 short tax years). Beneficial when ` +
      `income/expense timing mismatches halves. Estimated benefit ${fmt(estSavings)} per case.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      k1ActiveIncome: Math.round(k1Active),
      netSeEarnings: Math.round(computed.detail.se.netSeEarnings),
      typicalMismatchBenefit: G1_95_TYPICAL_MISMATCH_BENEFIT,
      estSavings,
    },
    assumptions: [
      `HEURISTIC — engine cannot detect mid-year termination. CPA confirms.`,
      `Termination event per §1377(a)(2): shareholder disposes ENTIRE interest (sale, redemption, gift, death).`,
      `Election BY ALL AFFECTED shareholders (terminating + continuing) per Reg §1.1377-1(b)(2).`,
      `Reg §1.1377-1(b)(3) election made on Form 1120-S statement attached identifying termination date.`,
      `Books closed as of termination date — 2 short tax years for K-1 allocation.`,
      `Default = pro-rata per §1377(a)(1) — allocate by days of ownership.`,
      `§1366(a) flow-through unchanged; only ALLOCATION method differs.`,
      `Coordinate with G1.83 §338(h)(10) (full sale election) + G1.17 reasonable comp.`,
      `All affected shareholders must consent — unanimous OR fall back to pro-rata.`,
      `Heuristic $5,000 typical — actual depends on income timing mismatch.`,
    ],
  };
}

// ── G1.96 — §132(f) Qualified Transportation Fringe (heuristic) ─────────

// §132(f) monthly qualified-transportation-fringe cap (transit + parking each).
// 2026 = $340 per Rev. Proc. 2025-32.
const G1_96_MONTHLY_CAP: Record<TaxYear, number> = { 2024: 315, 2025: 325, 2026: 340 };
const G1_96_MIN_INCOME = 50_000;

function detectQualifiedTransportFringe(args: {
  computed: ComputedTaxReturn;
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { computed, baselineInputs } = args;
  if (computed.totalIncome < G1_96_MIN_INCOME) return null;
  // M3 (audit 2026-06-11) — §132(f) requires an EMPLOYER offering the benefit:
  // the client must have ACTUAL W-2 wages. The old `totalIncome − netSE` proxy
  // counted K-1/rental/investment income as wages, so a zero-W-2 K-1 owner got
  // an ENGINE-VERIFIED transit hit.
  const { hasW2, wages: wagesProxy } = w2WagesSignal(computed, baselineInputs);
  if (!hasW2) return null;
  if (wagesProxy < G1_96_MIN_INCOME) return null;

  const monthlyCap = G1_96_MONTHLY_CAP[resolveTaxYear(computed.taxYear)];
  const annualAmount = monthlyCap * 12;
  const fedRate = federalMarginalRate(computed);
  const estSavings = Math.round(annualAmount * fedRate);

  // H2: the §132(f) compensation-reduction election excludes `annualAmount`
  // from W-2 Box 1 wages — same income-tax arithmetic as a generic
  // above-the-line `deduction`. Engine re-run captures the bracket-exact
  // marginal rate + any phase-out / NIIT-cliff / state interaction the flat
  // heuristic misses. (The FICA savings is separate + not modeled here, same
  // as the heuristic.) Fixed statutory cap → no ±10% sensitivity.
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.96-transit-fringe",
    label: `§132(f) pre-tax transit/parking $${Math.round(annualAmount).toLocaleString("en-US")}`,
    mutations: [
      { kind: "add_adjustment", adjustmentType: "deduction", amount: Math.round(annualAmount) },
    ],
    semantics: "savings",
    varyAmount: false,
  });

  const strategy = strategyById("G1.96");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars: Record<string, number | string> = {
    monthlyAmount: monthlyCap,
    taxYear: computed.taxYear,
    capPerMo: monthlyCap,
    estSavings,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client W-2 wages ${fmt(Math.round(wagesProxy))}. §132(f) qualified transit/parking fringe: pre-tax ` +
      `${fmt(monthlyCap)}/mo cap × 12 = ${fmt(annualAmount)} excluded. Annual employee tax savings ${fmt(estSavings)} ` +
      `at ${Math.round(fedRate * 100)}% marginal.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      totalIncome: Math.round(computed.totalIncome),
      wagesProxy: Math.round(wagesProxy),
      monthlyCap,
      annualAmount,
      federalMarginalRate: fedRate,
      estSavings,
    },
    assumptions: [
      `TY2024 monthly cap $315 (transit + parking each, Notice 2023-75).`,
      `TY2025 monthly cap $325 (Notice 2024-80).`,
      `TY2026 monthly cap $340 (Rev. Proc. 2025-32).`,
      `Transit pass per §132(f)(5)(A) — token, fare card, voucher, similar instrument.`,
      `Commuter highway vehicle per §132(f)(5)(B) — vehicle seat ≥ 6 adults; 50%+ of mileage transports employees between home + workplace.`,
      `Qualified parking per §132(f)(5)(C) — on/near employer premises or near transit terminal employee uses for commute.`,
      `Bicycle commuting reimbursement per §132(f)(5)(F) — SUSPENDED TY2018-TY2025 by TCJA §11047.`,
      `TCJA §13304 repealed EMPLOYER deduction for §132(f) (other than safety) — pure employee benefit now.`,
      `Compensation-reduction election per §132(f)(4) — employee pre-tax election (no compensation cost to employer).`,
      `Coordinate with §125 cafeteria plan (different mechanism — typically health + dependent care).`,
      `State conformity varies (NY/CA may differ on parking).`,
      `Requires employer to OFFER the benefit — CPA confirms employer participates.`,
      `H2: engine models the pre-tax exclusion as an above-the-line deduction; whatIf delta is the bracket-exact income-tax savings (FICA savings is additional, not modeled).`,
    ],
    whatIf,
  };
}

// ── G1.97–G1.100 — OBBBA (P.L. 119-21) NEW temporary deductions (TY2025–2028) ──
// All four are above-the-line (available to itemizers AND non-itemizers), effective
// TY2025 through TY2028, each phasing out over MAGI:
//   G1.97  tips §224:           cap $25,000;         phase-out @ $150k/$300k, −$100/$1k
//   G1.98  overtime §225:       cap $12,500/$25,000; phase-out @ $150k/$300k, −$100/$1k
//   G1.99  car-loan §163(h)(4): cap $10,000;         phase-out @ $100k/$200k, −$200/$1k (20%)
//   G1.100 senior (§151(d) add-on): $6,000 / 65+ person; phase-out @ $75k/$150k, −6% of excess
// The first three read explicit CPA-supplied adjustment markers (qualified_tips /
// qualified_overtime / qualified_car_loan_interest) — the engine has no occupation /
// overtime-hours / auto-loan data, so surfacing those markers in the API enum + UI is a
// tracked production follow-up. G1.100 fires concretely on age (no marker needed).
const OBBBA_DED_MIN_YEAR = 2025;
const OBBBA_DED_MAX_YEAR = 2028;
function obbbaDedActive(taxYear: number): boolean {
  return taxYear >= OBBBA_DED_MIN_YEAR && taxYear <= OBBBA_DED_MAX_YEAR;
}
// Reduce `base` by `ratePerDollar` × (MAGI − threshold), floored at 0.
function phaseOutLinear(base: number, magi: number, threshold: number, ratePerDollar: number): number {
  if (magi <= threshold) return base;
  return Math.max(0, base - ratePerDollar * (magi - threshold));
}
const obbbaIsJoint = (fs: string): boolean =>
  fs === "married_filing_jointly" || fs === "qualifying_widow";
const fmtUsd0 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function detectTipsDeduction(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { client, computed, adjustments } = args;
  if (!obbbaDedActive(computed.taxYear)) return null;
  const tips = sumAdjustment(adjustments, "qualified_tips");
  if (tips <= 0) return null;
  const magi = computed.adjustedGrossIncome;
  const threshold = obbbaIsJoint(client.filingStatus) ? 300_000 : 150_000;
  const cappedTips = Math.min(tips, 25_000);
  const deduction = phaseOutLinear(cappedTips, magi, threshold, 0.10); // −$100 per $1,000
  if (deduction <= 0) return null;
  // The engine now APPLIES this deduction, so computed.taxableIncome is POST-deduction.
  // Value the deduction at the marginal rate it OFFSETS (pre-deduction taxable).
  const fedRate = federalMarginalRate({ ...computed, taxableIncome: computed.taxableIncome + deduction });
  const stateRate = stateMarginalRate(computed);
  const estSavings = Math.round(deduction * (fedRate + stateRate));
  if (estSavings <= 0) return null;
  const strategy = strategyById("G1.97");
  const vars: Record<string, number | string> = { deduction: Math.round(deduction), estSavings };
  return {
    strategyId: strategy.id, name: strategy.name, category: strategy.category,
    estSavings, confidence: strategy.confidence, cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client reported ${fmtUsd0(Math.round(tips))} of qualified tips. OBBBA §224 deducts up to ` +
      `${fmtUsd0(Math.min(tips, 25_000))} (cap $25,000), phased out $100 per $1,000 of MAGI over ` +
      `${fmtUsd0(threshold)} — deductible portion ${fmtUsd0(Math.round(deduction))} this year, above-the-line.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      filingStatus: client.filingStatus, magi: Math.round(magi), reportedTips: Math.round(tips),
      cap: 25_000, phaseOutThreshold: threshold, deductiblePortion: Math.round(deduction), estSavings,
    },
    assumptions: [
      `OBBBA (P.L. 119-21) §224 — NEW deduction, TY2025–2028 only; above-the-line (itemizers + non-itemizers).`,
      `Cap $25,000; phase-out $100 per $1,000 of MAGI over ${fmtUsd0(threshold)} (single $150k / MFJ $300k).`,
      `Occupation must have customarily + regularly received tips on/before 2024-12-31 (Treasury TTOC list); SSTB excluded. CPA confirms eligibility + the qualified-tip amount.`,
      `Engine has no occupation data — fires only on an explicit qualified_tips adjustment (CPA-supplied).`,
    ],
  };
}

function detectOvertimeDeduction(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { client, computed, adjustments } = args;
  if (!obbbaDedActive(computed.taxYear)) return null;
  const ot = sumAdjustment(adjustments, "qualified_overtime");
  if (ot <= 0) return null;
  const magi = computed.adjustedGrossIncome;
  const isJoint = obbbaIsJoint(client.filingStatus);
  const cap = isJoint ? 25_000 : 12_500;
  const threshold = isJoint ? 300_000 : 150_000;
  const cappedOt = Math.min(ot, cap);
  const deduction = phaseOutLinear(cappedOt, magi, threshold, 0.10); // −$100 per $1,000
  if (deduction <= 0) return null;
  // Pre-deduction marginal (engine applies the deduction, so computed is post-deduction).
  const fedRate = federalMarginalRate({ ...computed, taxableIncome: computed.taxableIncome + deduction });
  const stateRate = stateMarginalRate(computed);
  const estSavings = Math.round(deduction * (fedRate + stateRate));
  if (estSavings <= 0) return null;
  const strategy = strategyById("G1.98");
  const vars: Record<string, number | string> = { deduction: Math.round(deduction), estSavings };
  return {
    strategyId: strategy.id, name: strategy.name, category: strategy.category,
    estSavings, confidence: strategy.confidence, cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client reported ${fmtUsd0(Math.round(ot))} of qualified overtime premium. OBBBA §225 deducts up to ` +
      `${fmtUsd0(cap)} (${isJoint ? "MFJ" : "single"} cap), phased out $100 per $1,000 of MAGI over ` +
      `${fmtUsd0(threshold)} — deductible portion ${fmtUsd0(Math.round(deduction))} this year, above-the-line.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      filingStatus: client.filingStatus, magi: Math.round(magi), reportedOvertime: Math.round(ot),
      cap, phaseOutThreshold: threshold, deductiblePortion: Math.round(deduction), estSavings,
    },
    assumptions: [
      `OBBBA (P.L. 119-21) §225 — NEW deduction, TY2025–2028 only; above-the-line (itemizers + non-itemizers).`,
      `Cap $12,500 single / $25,000 MFJ; phase-out $100 per $1,000 of MAGI over ${fmtUsd0(threshold)}.`,
      `Only the FLSA premium "half" portion (pay in excess of the regular rate) qualifies — NOT the full time-and-a-half. CPA confirms the qualified-overtime amount from W-2 box reporting.`,
      `Engine has no overtime-hours data — fires only on an explicit qualified_overtime adjustment (CPA-supplied).`,
    ],
  };
}

function detectCarLoanInterestDeduction(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { client, computed, adjustments } = args;
  if (!obbbaDedActive(computed.taxYear)) return null;
  const interest = sumAdjustment(adjustments, "qualified_car_loan_interest");
  if (interest <= 0) return null;
  const magi = computed.adjustedGrossIncome;
  const threshold = obbbaIsJoint(client.filingStatus) ? 200_000 : 100_000;
  const capped = Math.min(interest, 10_000);
  const deduction = phaseOutLinear(capped, magi, threshold, 0.20); // −$200 per $1,000 (double rate)
  if (deduction <= 0) return null;
  // Pre-deduction marginal (engine applies the deduction, so computed is post-deduction).
  const fedRate = federalMarginalRate({ ...computed, taxableIncome: computed.taxableIncome + deduction });
  const stateRate = stateMarginalRate(computed);
  const estSavings = Math.round(deduction * (fedRate + stateRate));
  if (estSavings <= 0) return null;
  const strategy = strategyById("G1.99");
  const vars: Record<string, number | string> = { deduction: Math.round(deduction), estSavings };
  return {
    strategyId: strategy.id, name: strategy.name, category: strategy.category,
    estSavings, confidence: strategy.confidence, cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client reported ${fmtUsd0(Math.round(interest))} of qualified passenger-vehicle loan interest. OBBBA ` +
      `§163(h)(4) deducts up to ${fmtUsd0(10_000)}, phased out $200 per $1,000 of MAGI over ${fmtUsd0(threshold)} ` +
      `— deductible portion ${fmtUsd0(Math.round(deduction))} this year, above-the-line.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      filingStatus: client.filingStatus, magi: Math.round(magi), reportedInterest: Math.round(interest),
      cap: 10_000, phaseOutThreshold: threshold, deductiblePortion: Math.round(deduction), estSavings,
    },
    assumptions: [
      `OBBBA (P.L. 119-21) §163(h)(4) — NEW deduction, TY2025–2028 only; above-the-line (itemizers + non-itemizers).`,
      `Cap $10,000; phase-out $200 per $1,000 of MAGI over ${fmtUsd0(threshold)} (single $100k / MFJ $200k) — DOUBLE the tips/overtime rate.`,
      `Vehicle must be NEW (original use begins with taxpayer), personal-use, FINAL ASSEMBLY IN THE U.S., loan secured by first lien, VIN reported. Leases + used vehicles do NOT qualify. Loans originated after 2024-12-31.`,
      `Engine has no auto-loan data — fires only on an explicit qualified_car_loan_interest adjustment (CPA-supplied).`,
    ],
  };
}

function detectSeniorDeduction(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { client, computed } = args;
  if (!obbbaDedActive(computed.taxYear)) return null;
  const isJoint = obbbaIsJoint(client.filingStatus);
  const numSeniors =
    ((client.taxpayerAge ?? 0) >= 65 ? 1 : 0) +
    (isJoint && (client.spouseAge ?? 0) >= 65 ? 1 : 0);
  if (numSeniors <= 0) return null;
  const magi = computed.adjustedGrossIncome;
  const threshold = isJoint ? 150_000 : 75_000;
  const base = 6_000 * numSeniors;
  const deduction = phaseOutLinear(base, magi, threshold, 0.06); // −6% of MAGI over threshold
  if (deduction <= 0) return null;
  // Pre-deduction marginal (engine applies the deduction, so computed is post-deduction).
  const fedRate = federalMarginalRate({ ...computed, taxableIncome: computed.taxableIncome + deduction });
  const stateRate = stateMarginalRate(computed);
  const estSavings = Math.round(deduction * (fedRate + stateRate));
  if (estSavings <= 0) return null;
  const strategy = strategyById("G1.100");
  const vars: Record<string, number | string> = { deduction: Math.round(deduction), estSavings };
  return {
    strategyId: strategy.id, name: strategy.name, category: strategy.category,
    estSavings, confidence: strategy.confidence, cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `${numSeniors} taxpayer(s) age 65+ → OBBBA senior bonus deduction base ${fmtUsd0(base)} ` +
      `(${fmtUsd0(6_000)} each), reduced 6% of MAGI over ${fmtUsd0(threshold)} → ${fmtUsd0(Math.round(deduction))} ` +
      `deductible this year, above-the-line + on TOP of the existing age-65 additional standard deduction.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      filingStatus: client.filingStatus, magi: Math.round(magi), numSeniors,
      baseDeduction: base, phaseOutThreshold: threshold, deductiblePortion: Math.round(deduction), estSavings,
    },
    assumptions: [
      `OBBBA (P.L. 119-21) — NEW $6,000 senior deduction per qualifying individual age 65+, TY2025–2028 only.`,
      `Above-the-line (itemizers + non-itemizers) and STACKS on the existing age-65 additional standard deduction.`,
      `Phase-out: base reduced by 6% of MAGI over $75,000 single / $150,000 MFJ (fully phased at $175k single for one senior / $350k MFJ for two).`,
      `Fires concretely on taxpayerAge / spouseAge ≥ 65 — no marker needed.`,
    ],
  };
}

// ── Top-level evaluator ────────────────────────────────────────────────────

export interface PlanningInputs {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  /**
   * H2 — When present, detectors that support it will run a what-if
   * scenario through the pure engine and attach a verified `whatIfDelta`
   * to the OpportunityHit. Absent for callers that prefer speed over
   * verification (e.g., planning-hit-list which runs detectors over every
   * client in the firm).
   */
  baselineInputs?: TaxReturnInputs;
}

// ── Layer 3 — Composite scoring (Phase G2) ────────────────────────────────

/**
 * Per the Phase G plan. Higher-bracket clients are worth more (planning has
 * more leverage); more-complex engagements are stickier; recurring rules
 * compound. The weights are deliberately conservative — the deterministic
 * estSavings is the load-bearing number; this score only re-orders the hit
 * list for the CPA's "where do I focus first" view.
 */
export function marginalRateWeight(federalMarginalRate: number): number {
  return 1 + Math.max(0, federalMarginalRate - 0.22) * 5;
}

export function engagementComplexityWeight(numHits: number): number {
  return 1 + Math.log(1 + numHits) * 0.3;
}

export function stickinessWeight(recurring: boolean): number {
  return recurring ? 1.5 : 1.0;
}

/**
 * PlanningScore = (Σ hits of weighted savings) × marginalRateWeight ×
 *                  engagementComplexityWeight.
 *
 * The marginal-rate and engagement-complexity weights are client-level
 * (constant across hits), so they factor outside the sum. Stickiness is
 * per-hit (recurring rules compound differently from one-off rules).
 *
 * Returns 0 when there are no hits (no opportunity to upsell).
 */
export function planningScore(args: {
  hits: OpportunityHit[];
  federalMarginalRate: number;
}): number {
  const { hits, federalMarginalRate } = args;
  if (hits.length === 0) return 0;
  const weightedSavings = hits.reduce(
    (s, h) => s + headlineSavings(h) * h.confidence * stickinessWeight(h.recurring),
    0,
  );
  return weightedSavings * marginalRateWeight(federalMarginalRate) * engagementComplexityWeight(hits.length);
}

/**
 * PLAN-Q1 — the headline / ranking savings for a hit: the engine-verified
 * what-if delta when present, else the heuristic estimate.
 */
export function headlineSavings(hit: OpportunityHit): number {
  return hit.verifiedSavings ?? hit.estSavings;
}

/**
 * PLAN-Q1 — tag each hit's savings provenance and, for a "savings"-semantics hit
 * carrying an engine-verified what-if, expose the engine-computed delta as
 * `verifiedSavings`. The hit-list sort + the firm-wide planningScore then rank on
 * that verified number (via `headlineSavings`) instead of a heuristic
 * single-multiplier guess. `estSavings` is left intact, so both numbers + the
 * source travel on the hit and a consumer/UI can show "$X engine-verified" vs
 * "≈$Y estimate". "cost"-semantics hits (Roth) keep their heuristic headline.
 */
export function annotateVerifiedSavings(hits: OpportunityHit[]): void {
  for (const h of hits) {
    if (h.whatIf && h.whatIf.semantics === "savings") {
      // SIGN PRESERVED (audit 2026-06-11): combinedRefundDelta > 0 = the
      // scenario grows the refund = a saving. A NEGATIVE delta on a
      // "savings"-semantics hit is an engine-verified COST — it must stay
      // negative (the old Math.abs() displayed it as a positive saving and
      // ranked it accordingly).
      h.verifiedSavings = Math.round(h.whatIf.delta.combinedRefundDelta);
      h.savingsSource = "engine-verified";
    } else if (h.savingsSource === "engine-verified" && h.verifiedSavings != null) {
      // A detector that reads a value the engine already computed in the
      // baseline return (e.g. G1.65 §23 adoption credit, G1.30 §36B PTC
      // reconciliation) is engine-verified WITHOUT a what-if mutation — the
      // number is the engine's own output, not a heuristic. Keep its
      // annotation rather than downgrading it to an estimate.
    } else {
      h.savingsSource = "estimate";
    }
  }
}

/**
 * Run all detectors over a single client's computed tax return.
 * Returns hits sorted by `estSavings` descending so the highest-impact
 * opportunity is presented first in the Planning tab.
 */
// ── G1.101–G1.106 — Estate & gift planning touchpoints (qualitative) ──────
//
// The individual-1040 engine does NOT compute estate or gift tax, so these are
// INFORMATIONAL flags: they surface a wealth-transfer opportunity for an
// affluent client with a clearly-stated, conservative illustrative value and a
// LOW confidence (0.40–0.50) so they never outrank the engine-verified
// income-tax strategies. estSavings is an illustrative annual estate-tax
// reduction (or, for §1014, an income-tax saving); the CPA sizes it to the
// client's actual balance sheet via the prerequisiteData. These are NOT
// engine-verified what-ifs — the engine has no estate-tax model to verify them.

/** Annual gift-tax exclusion (§2503(b)). IRS Rev. Proc. 2023-34 / 2024-40 / 2025-32. */
const ANNUAL_GIFT_EXCLUSION: Record<TaxYear, number> = {
  2024: 18_000,
  2025: 19_000,
  2026: 19_000,
};

/** Estate/gift basic exclusion amount (BEA). 2024/2025 indexed; 2026 OBBBA $15M permanent. */
const ESTATE_BASIC_EXCLUSION: Record<TaxYear, number> = {
  2024: 13_610_000,
  2025: 13_990_000,
  2026: 15_000_000,
};

/** Flat top federal estate/gift-tax rate (§2001(c)). */
const ESTATE_TOP_RATE = 0.4;

// Illustrative assumptions for the bespoke-structure flags (SLAT/ILIT/GRAT/529).
// The CPA replaces these with the client's actual numbers — they only set the
// headline magnitude so the opportunity ranks sensibly below verified items.
const SUPERFUND_GROWTH_FACTOR = (Math.pow(1.06, 10) - 1) * 0.15; // 10-yr @6%, 15% LTCG ≈ 0.118627
const SLAT_ILLUSTRATIVE_FUNDING = 1_000_000;
const SLAT_GROWTH_ASSUMED = 0.06;
const ILIT_ILLUSTRATIVE_FACE = 2_000_000;
const ILIT_ANNUALIZE_YEARS = 25;
const GRAT_ILLUSTRATIVE_FUNDING = 1_000_000;
const GRAT_GROWTH_ASSUMED = 0.08;
const GRAT_SECTION_7520_RATE = 0.054;
const STEPUP_LTCG_RATE_ASSUMED = 0.15;

/** Shared affluent-estate wealth proxy (the engine can't see net worth). */
function estateWealthProxy(computed: ComputedTaxReturn, agiFloor: number, niiFloor: number): boolean {
  const agi = computed.adjustedGrossIncome ?? 0;
  const nii = computed.detail.niit?.investmentIncome ?? 0;
  return agi >= agiFloor || nii >= niiFloor;
}

function isMfjLike(client: ClientFacts): boolean {
  return (
    client.filingStatus === "married_filing_jointly" ||
    client.filingStatus === "qualifying_widow"
  );
}

// G1.101 — Annual-exclusion gifting (§2503(b)).
function detectAnnualExclusionGifting(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { client, computed } = args;
  if (!estateWealthProxy(computed, 400_000, 100_000)) return null;

  const year = resolveTaxYear(computed.taxYear);
  const exclusion = ANNUAL_GIFT_EXCLUSION[year];
  const bea = ESTATE_BASIC_EXCLUSION[year];
  const estSavings = Math.round(exclusion * ESTATE_TOP_RATE);
  const mfj = isMfjLike(client);
  const nii = Math.round(computed.detail.niit?.investmentIncome ?? 0);

  const strategy = strategyById("G1.101");
  const vars: Record<string, number | string> = { annualExclusion: exclusion, estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Affluent profile (AGI ${fmtUsd0(Math.round(computed.adjustedGrossIncome))}, net investment income ` +
      `${fmtUsd0(nii)}). Annual-exclusion gifting moves ${fmtUsd0(exclusion)} per donee per year — plus all ` +
      `future appreciation — out of a taxable estate, with no gift-tax return required.` +
      (mfj ? ` As MFJ, gift-splitting doubles the per-donee exclusion to ${fmtUsd0(exclusion * 2)}.` : ``),
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(computed.adjustedGrossIncome),
      netInvestmentIncome: nii,
      annualExclusion: exclusion,
      basicExclusionAmount: bea,
      estateTopRate: ESTATE_TOP_RATE,
      filingStatus: client.filingStatus,
    },
    assumptions: [
      `INFORMATIONAL estate flag — the individual-1040 engine does not size the estate. estSavings is the per-donee, per-year estate-tax reduction at the 40% top rate; it applies only if the estate exceeds the federal BEA (${fmtUsd0(bea)} for TY${computed.taxYear}) or a lower STATE estate/inheritance threshold (e.g. MA/OR ~$1-2M).`,
      `Annual exclusion ${fmtUsd0(exclusion)} per donee for TY${computed.taxYear} (§2503(b); IRS Rev. Proc.). No Form 709 required when each gift is at or below the exclusion.`,
      `MFJ gift-splitting (§2513) doubles the per-donee exclusion but DOES require a Form 709.`,
      `The real value compounds: the gifted asset's FUTURE appreciation also escapes the estate.`,
    ],
  };
}

// G1.102 — 529 plan superfunding (§529(c)(2)(B) 5-year election).
function detect529Superfunding(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { client, computed } = args;
  const dependents = (client.dependentsUnder17 ?? 0) + (client.otherDependents ?? 0);
  if (dependents < 1) return null;
  if (!estateWealthProxy(computed, 300_000, 50_000)) return null;

  const year = resolveTaxYear(computed.taxYear);
  const exclusion = ANNUAL_GIFT_EXCLUSION[year];
  const superfund = 5 * exclusion;
  const estSavings = Math.round(superfund * SUPERFUND_GROWTH_FACTOR);

  const strategy = strategyById("G1.102");
  const vars: Record<string, number | string> = { superfund, estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Affluent family with ${dependents} dependent${dependents === 1 ? "" : "s"}. The §529(c)(2)(B) election lets ` +
      `each donor front-load ${fmtUsd0(superfund)} (5× the ${fmtUsd0(exclusion)} annual exclusion) into a 529 in one ` +
      `year — gift-tax-free and immediately outside the estate — and the earnings then grow income-tax-free for education.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(computed.adjustedGrossIncome),
      dependents,
      annualExclusion: exclusion,
      superfund,
      estSavings,
    },
    assumptions: [
      `INFORMATIONAL flag. estSavings is the illustrative income-tax-free-growth value of the ${fmtUsd0(superfund)} front-load = superfund × ((1.06^10 − 1)) × 15% LTCG (a 10-year, 6%-growth, 15%-rate assumption). Actual value depends on the horizon, return, and the alternative taxable account.`,
      `5-year election (§529(c)(2)(B)) front-loads 5× the annual exclusion; spread ratably over 5 years on Form 709. If the donor dies within the 5 years, the unused years are pulled back into the estate.`,
      `Many states ALSO give a state income-tax deduction/credit for 529 contributions (varies by state — confirm).`,
      `SECURE 2.0 added a limited 529→Roth IRA rollover for long-held accounts — a backstop if the beneficiary doesn't need all the funds.`,
    ],
  };
}

// G1.103 — Spousal Lifetime Access Trust (SLAT).
function detectSlat(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { client, computed } = args;
  if (!isMfjLike(client)) return null;
  if (!estateWealthProxy(computed, 750_000, 250_000)) return null;

  const year = resolveTaxYear(computed.taxYear);
  const bea = ESTATE_BASIC_EXCLUSION[year];
  const estSavings = Math.round(SLAT_ILLUSTRATIVE_FUNDING * SLAT_GROWTH_ASSUMED * ESTATE_TOP_RATE);

  const strategy = strategyById("G1.103");
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `High-net-worth married couple (AGI ${fmtUsd0(Math.round(computed.adjustedGrossIncome))}). A Spousal Lifetime ` +
      `Access Trust removes appreciating assets — and all their future growth — from the taxable estate using one ` +
      `spouse's exclusion, while the beneficiary spouse retains indirect access to the funds if needed.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(computed.adjustedGrossIncome),
      netInvestmentIncome: Math.round(computed.detail.niit?.investmentIncome ?? 0),
      illustrativeFunding: SLAT_ILLUSTRATIVE_FUNDING,
      basicExclusionAmount: bea,
    },
    assumptions: [
      `INFORMATIONAL flag. estSavings is illustrative: ${fmtUsd0(SLAT_ILLUSTRATIVE_FUNDING)} of trust assets × 6%/yr appreciation × 40% estate rate = the future-appreciation removed from the estate each year. The CPA sizes it to the actual funding.`,
      `The BEA is now ${fmtUsd0(bea)} per person (OBBBA made the higher exclusion permanent) — a SLAT primarily helps estates expecting to exceed ${fmtUsd0(bea)} single / ${fmtUsd0(bea * 2)} per couple, OR a lower STATE estate-tax threshold.`,
      `SLAT is IRREVOCABLE; the grantor gives up direct control. Access is INDIRECT (through the beneficiary spouse) and ends at that spouse's death or divorce.`,
      `RECIPROCAL-TRUST DOCTRINE: if both spouses create near-identical SLATs, the IRS can unwind them — they must be meaningfully different.`,
    ],
  };
}

// G1.104 — Irrevocable Life Insurance Trust (ILIT).
function detectIlit(args: { computed: ComputedTaxReturn }): OpportunityHit | null {
  const { computed } = args;
  if (!estateWealthProxy(computed, 750_000, 250_000)) return null;

  const year = resolveTaxYear(computed.taxYear);
  const bea = ESTATE_BASIC_EXCLUSION[year];
  const estSavings = Math.round((ILIT_ILLUSTRATIVE_FACE * ESTATE_TOP_RATE) / ILIT_ANNUALIZE_YEARS);

  const strategy = strategyById("G1.104");
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `High-net-worth profile (AGI ${fmtUsd0(Math.round(computed.adjustedGrossIncome))}). Life-insurance proceeds are ` +
      `pulled INTO the taxable estate when the insured owns the policy (§2042). Holding the policy in an Irrevocable Life ` +
      `Insurance Trust keeps the full death benefit out of the estate — at a 40% rate that is real money on a large policy.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(computed.adjustedGrossIncome),
      netInvestmentIncome: Math.round(computed.detail.niit?.investmentIncome ?? 0),
      illustrativeFaceValue: ILIT_ILLUSTRATIVE_FACE,
      basicExclusionAmount: bea,
    },
    assumptions: [
      `INFORMATIONAL flag. estSavings is illustrative: an assumed ${fmtUsd0(ILIT_ILLUSTRATIVE_FACE)} death benefit × 40% estate rate, annualized over ${ILIT_ANNUALIZE_YEARS} years for comparability with the annual income-tax strategies. The benefit is realized once, at death; the CPA sizes it to the actual policy face.`,
      `Only helps an estate above the BEA (${fmtUsd0(bea)}) or a lower STATE estate-tax threshold.`,
      `§2035 THREE-YEAR LOOKBACK: transferring an EXISTING policy into the ILIT pulls it back into the estate if the insured dies within 3 years. A NEW policy bought by the ILIT avoids this.`,
      `Premiums are funded by annual gifts to the trust; Crummey withdrawal notices qualify them for the annual exclusion (administrative discipline required).`,
    ],
  };
}

// G1.105 — Grantor Retained Annuity Trust (GRAT).
function detectGrat(args: { computed: ComputedTaxReturn }): OpportunityHit | null {
  const { computed } = args;
  if (!estateWealthProxy(computed, 750_000, 250_000)) return null;
  const ltcg = computed.form1099Summary?.longTermCapitalGains ?? 0;
  if (ltcg < 100_000) return null;

  const excessGrowth = GRAT_GROWTH_ASSUMED - GRAT_SECTION_7520_RATE;
  const estSavings = Math.round(GRAT_ILLUSTRATIVE_FUNDING * excessGrowth * ESTATE_TOP_RATE);

  const strategy = strategyById("G1.105");
  const vars: Record<string, number | string> = { estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `High-net-worth client realizing ${fmtUsd0(Math.round(ltcg))} of long-term gains — a signal of concentrated, ` +
      `appreciating assets. A near-zeroed-out Grantor Retained Annuity Trust passes all appreciation ABOVE the §7520 ` +
      `hurdle rate to heirs gift-tax-free, using little or none of the lifetime exclusion.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(computed.adjustedGrossIncome),
      longTermCapitalGains: Math.round(ltcg),
      illustrativeFunding: GRAT_ILLUSTRATIVE_FUNDING,
      assumedGrowthRate: GRAT_GROWTH_ASSUMED,
      section7520Rate: GRAT_SECTION_7520_RATE,
    },
    assumptions: [
      `INFORMATIONAL flag. estSavings is illustrative: ${fmtUsd0(GRAT_ILLUSTRATIVE_FUNDING)} funding × (8% assumed growth − 5.4% §7520 hurdle) × 40% estate rate. The §7520 rate updates MONTHLY — confirm the current rate before modeling.`,
      `A "zeroed-out" GRAT (Walton) sets the retained annuity so the taxable gift ≈ $0 — only the EXCESS over the §7520 rate transfers, so there is little downside if the asset underperforms.`,
      `MORTALITY RISK: the grantor must OUTLIVE the GRAT term or the assets revert to the estate. Short-term, rolling GRATs mitigate this.`,
      `Works best with volatile / high-expected-return assets (pre-IPO stock, concentrated equity) where the growth most exceeds the hurdle.`,
    ],
  };
}

// G1.106 — Step-up-in-basis hold (§1014).
function detectStepUpBasisHold(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { client, computed } = args;
  const age = client.taxpayerAge ?? 0;
  if (age < 65) return null;
  const ltcg = computed.form1099Summary?.longTermCapitalGains ?? 0;
  if (ltcg < 50_000) return null;

  const estSavings = Math.round(ltcg * STEPUP_LTCG_RATE_ASSUMED);

  const strategy = strategyById("G1.106");
  const vars: Record<string, number | string> = { ltcg: Math.round(ltcg), estSavings };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings,
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client is ${age} and realized ${fmtUsd0(Math.round(ltcg))} of long-term gains. For appreciated assets the ` +
      `client does NOT need to sell, holding until death gives heirs a §1014 basis step-up to fair market value — the ` +
      `entire built-in gain is then never income-taxed. Weigh against diversification and liquidity needs.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      taxpayerAge: age,
      longTermCapitalGains: Math.round(ltcg),
      assumedLtcgRate: STEPUP_LTCG_RATE_ASSUMED,
    },
    assumptions: [
      `INFORMATIONAL flag (INCOME-tax, not estate). estSavings = realized LTCG × 15% — an illustrative proxy for the income tax a comparable block of held-to-death appreciated assets would avoid via the §1014 step-up. Use the client's actual LTCG rate (0/15/20% + 3.8% NIIT) and embedded gain for precision.`,
      `§1014 steps up basis to date-of-death FMV. This does NOT apply to "income in respect of a decedent" (traditional IRAs, annuities, NQDC) — those keep their built-in income.`,
      `Community-property states give a DOUBLE step-up (both halves) on the first spouse's death — a large benefit there.`,
      `This is a HOLD recommendation; it trades the step-up benefit against concentration risk and the client's liquidity needs.`,
    ],
  };
}

export function evaluatePlanningOpportunities(args: PlanningInputs): OpportunityHit[] {
  const hits: OpportunityHit[] = [];
  const { client, computed, adjustments, baselineInputs } = args;

  const sepIra = detectSepIra({ client, computed, adjustments, baselineInputs });
  if (sepIra) hits.push(sepIra);
  const ptet = detectPtetElection({ client, computed });
  if (ptet) hits.push(ptet);
  const ftc = detectForeignTaxCreditGap({ computed, adjustments, baselineInputs });
  if (ftc) hits.push(ftc);
  const bunching = detectBunching({ computed, adjustments, baselineInputs });
  if (bunching) hits.push(bunching);
  const daf = detectCharitableDaf({ computed, adjustments, baselineInputs });
  if (daf) hits.push(daf);
  const roth = detectRothConversion({ client, computed, baselineInputs });
  if (roth) hits.push(roth);
  const amtIso = detectAmtIsoTiming({ computed, adjustments, baselineInputs });
  if (amtIso) hits.push(amtIso);
  const niit = detectNiitCliff({ client, computed, baselineInputs });
  if (niit) hits.push(niit);
  const qbi = detectQbiPhaseIn({ computed, client });
  if (qbi) hits.push(qbi);
  const tlh = detectTaxLossHarvesting({ client, computed, baselineInputs });
  if (tlh) hits.push(tlh);
  // Phase H — H1 expansion (catalog v1.2): QCD, appreciated stock, Augusta, HSA.
  const qcd = detectQcd({ client, computed, adjustments, baselineInputs });
  if (qcd) hits.push(qcd);
  const apprStock = detectAppreciatedStockDonation({ computed, adjustments });
  if (apprStock) hits.push(apprStock);
  const augusta = detectAugustaRule({ computed, adjustments, baselineInputs });
  if (augusta) hits.push(augusta);
  const hsaMax = detectHsaMax({ client, computed, adjustments, baselineInputs });
  if (hsaMax) hits.push(hsaMax);
  // Phase H — H1 expansion (catalog v1.3): NUA / Mega-Backdoor Roth / S-corp
  // reasonable comp / REPS election / CRT framework / conservation easement.
  // The first two use H5 asset balances; latter four use computed/derived signals.
  const assetBalances = baselineInputs?.assetBalances;
  const nua = detectNua({ computed, assetBalances });
  if (nua) hits.push(nua);
  const megaRoth = detectMegaBackdoorRoth({ computed, adjustments, assetBalances });
  if (megaRoth) hits.push(megaRoth);
  const scorpComp = detectScorpReasonableComp({ client, computed, adjustments });
  if (scorpComp) hits.push(scorpComp);
  const reps = detectRepsElection({ client, computed });
  if (reps) hits.push(reps);
  const crt = detectCrtFramework({ computed, adjustments });
  if (crt) hits.push(crt);
  const consEasement = detectConservationEasement({ computed, adjustments });
  if (consEasement) hits.push(consEasement);
  // Phase H — H1 catalog v1.4: §1031 timing, pre-RMD Roth ladder,
  // cost-segregation, opportunity zones, backdoor Roth.
  const sec1031 = detectSection1031Timing({ computed, adjustments });
  if (sec1031) hits.push(sec1031);
  const preRmd = detectPreRmdRothLadder({ client, computed, assetBalances });
  if (preRmd) hits.push(preRmd);
  const costSeg = detectCostSegregation({ computed });
  if (costSeg) hits.push(costSeg);
  const qoz = detectOpportunityZone({ computed });
  if (qoz) hits.push(qoz);
  const backdoorRoth = detectBackdoorRoth({ client, computed, adjustments, assetBalances });
  if (backdoorRoth) hits.push(backdoorRoth);
  // Phase H — H1 catalog v1.5: G1.27 inherited IRA / G1.28 DB plan /
  // G1.33 EV credit / G1.34 §25D / G1.39 QSBS / G1.45 §121 home sale.
  const inheritedIra = detectInheritedIra({ client, computed, assetBalances });
  if (inheritedIra) hits.push(inheritedIra);
  const dbPlan = detectDefinedBenefitPlan({ client, computed, adjustments, baselineInputs });
  if (dbPlan) hits.push(dbPlan);
  const evCredit = detectEvCredit({ client, computed, adjustments, baselineInputs });
  if (evCredit) hits.push(evCredit);
  const cleanEnergy = detectResidentialCleanEnergy({ computed, adjustments, assetBalances, baselineInputs });
  if (cleanEnergy) hits.push(cleanEnergy);
  const qsbs = detectQsbsPlanning({ computed, adjustments });
  if (qsbs) hits.push(qsbs);
  const homeSale = detectSection121HomeSale({ client, computed, adjustments, assetBalances });
  if (homeSale) hits.push(homeSale);
  // Phase H — H1 catalog v1.6: G1.29 §529→Roth / G1.31 Saver's Credit /
  // G1.32 DCFSA / G1.36 R&D §41 / G1.37 §25C / G1.40 §1244.
  const five29ToRoth = detect529ToRoth({ computed, assetBalances });
  if (five29ToRoth) hits.push(five29ToRoth);
  const saversCredit = detectSaversCredit({ client, computed, adjustments, baselineInputs });
  if (saversCredit) hits.push(saversCredit);
  const dcfsa = detectDcfsaVsCredit({ client, computed, adjustments });
  if (dcfsa) hits.push(dcfsa);
  const rdCredit = detectRdCredit({ computed, adjustments });
  if (rdCredit) hits.push(rdCredit);
  const energy25c = detectEnergyEfficientHome({ computed, adjustments, assetBalances, baselineInputs });
  if (energy25c) hits.push(energy25c);
  const section1244 = detectSection1244({ client, computed, adjustments, baselineInputs });
  if (section1244) hits.push(section1244);
  // Phase H — H1 catalog v1.7: G1.46 spousal IRA / G1.47 §453 installment /
  // G1.48 §83(b) / G1.49 family employment / G1.51 AOC vs LLC.
  const spousalIra = detectSpousalIra({ client, computed, adjustments, baselineInputs });
  if (spousalIra) hits.push(spousalIra);
  const installmentSale = detectInstallmentSale({ computed, adjustments, assetBalances, baselineInputs });
  if (installmentSale) hits.push(installmentSale);
  const section83b = detectSection83b({ computed, assetBalances });
  if (section83b) hits.push(section83b);
  const familyEmployment = detectFamilyEmployment({ client, computed, adjustments, baselineInputs });
  if (familyEmployment) hits.push(familyEmployment);
  const aocVsLlc = detectAocVsLlc({ client, computed, adjustments, baselineInputs });
  if (aocVsLlc) hits.push(aocVsLlc);
  // Phase H — H1 catalog v1.8: G1.30 ACA PTC / G1.41 §1045 / G1.42 SEHI /
  // G1.43 wash sale proactive / G1.50 §72(t) SEPP.
  const acaPtc = detectAcaPtc({ computed, adjustments, baselineInputs });
  if (acaPtc) hits.push(acaPtc);
  const section1045 = detectSection1045Rollover({ computed, adjustments });
  if (section1045) hits.push(section1045);
  const sehi = detectSelfEmployedHealthIns({ computed, adjustments, baselineInputs });
  if (sehi) hits.push(sehi);
  const washSale = detectWashSaleAvoidance({ computed, adjustments });
  if (washSale) hits.push(washSale);
  const sepp = detectSection72tSepp({ client, computed, assetBalances });
  if (sepp) hits.push(sepp);
  // Phase H — H1 catalog v1.9: G1.52 est-tax safe harbor / G1.53 kiddie /
  // G1.54 §183 hobby / G1.55 custodial Roth / G1.56 specific-share-ID.
  const estTax = detectEstimatedTaxSafeHarbor({ computed, adjustments });
  if (estTax) hits.push(estTax);
  const kiddie = detectKiddieTax({ client, computed });
  if (kiddie) hits.push(kiddie);
  const hobby = detectHobbyLossQualification({ computed });
  if (hobby) hits.push(hobby);
  const custodialRoth = detectCustodialRothIra({ client, computed });
  if (custodialRoth) hits.push(custodialRoth);
  const specificShare = detectSpecificShareId({ computed });
  if (specificShare) hits.push(specificShare);
  // Phase H — H1 catalog v1.10: G1.57 NQDC §409A / G1.58 state residency /
  // G1.59 Coverdell ESA / G1.60 §41(h) R&D payroll / G1.61 §221 student loan.
  const nqdc = detectNqdc409a({ client, computed, baselineInputs });
  if (nqdc) hits.push(nqdc);
  const stateMove = detectStateResidencyChange({ client, computed });
  if (stateMove) hits.push(stateMove);
  const coverdell = detectCoverdellEsa({ client, computed, adjustments });
  if (coverdell) hits.push(coverdell);
  const rdPayroll = detectRdPayrollElection({ computed, adjustments });
  if (rdPayroll) hits.push(rdPayroll);
  const studentLoan = detectStudentLoanInterest({ client, computed, adjustments, baselineInputs });
  if (studentLoan) hits.push(studentLoan);
  // Phase H — H1 catalog v1.11: G1.62 §263A / G1.63 lot rotation /
  // G1.64 §168(k) opt-out / G1.65 adoption credit / G1.66 IRA→401k fix.
  const section263a = detectSection263aInventory({ computed, adjustments });
  if (section263a) hits.push(section263a);
  const lotRotation = detectLotRotation({ client, assetBalances });
  if (lotRotation) hits.push(lotRotation);
  const bonusOptOut = detectBonusDepreciationOptOut({ computed, adjustments });
  if (bonusOptOut) hits.push(bonusOptOut);
  const adoption = detectAdoptionCredit({ client, computed, adjustments });
  if (adoption) hits.push(adoption);
  const iraToK = detectRolloverIraTo401k({ client, computed, assetBalances });
  if (iraToK) hits.push(iraToK);
  // Phase H — H1 catalog v1.12: G1.67 in-plan Roth / G1.68 §174 R&D /
  // G1.69 year-end timing / G1.70 bargain sale / G1.71 ISO lot selection.
  const inPlanRoth = detectInPlanRothConversion({ client, computed, assetBalances, baselineInputs });
  if (inPlanRoth) hits.push(inPlanRoth);
  const section174 = detectSection174RdWorkaround({ computed, adjustments });
  if (section174) hits.push(section174);
  const yearEnd = detectYearEndTiming({ computed });
  if (yearEnd) hits.push(yearEnd);
  const bargainSale = detectBargainSale({ computed, adjustments, assetBalances });
  if (bargainSale) hits.push(bargainSale);
  const isoLot = detectIsoLotSelection({ computed, adjustments, assetBalances });
  if (isoLot) hits.push(isoLot);
  // Phase H — H1 catalog v1.13: G1.72 RSU sell-to-cover / G1.73 NUA in-service /
  // G1.74 §45S FMLA / G1.75 WOTC §51 / G1.76 §170(h) non-syndicated easement.
  const rsuCover = detectRsuSellToCover({ computed, baselineInputs });
  if (rsuCover) hits.push(rsuCover);
  const nuaInService = detectNuaInService({ client, assetBalances });
  if (nuaInService) hits.push(nuaInService);
  const fmlaCredit = detectFmlaCredit({ computed, adjustments });
  if (fmlaCredit) hits.push(fmlaCredit);
  const wotcCredit = detectWotcCredit({ computed, adjustments });
  if (wotcCredit) hits.push(wotcCredit);
  const nonSyndEasement = detectNonSyndicatedEasement({ computed, assetBalances });
  if (nonSyndEasement) hits.push(nonSyndEasement);
  // Phase H — H1 catalog v1.14: G1.77 self-rental grouping / G1.78 multi-state NR /
  // G1.79 §453 election out / G1.80 §47 historic rehab / G1.81 §44 disabled access.
  const selfRental = detectSelfRentalGrouping({ client, computed });
  if (selfRental) hits.push(selfRental);
  const w2States = (baselineInputs?.w2s ?? [])
    .map((w) => (w.stateCode ?? "").toString().toUpperCase())
    .filter(Boolean);
  const multiState = detectMultiStateNrAllocation({ client, computed, w2States });
  if (multiState) hits.push(multiState);
  const installmentOut = detectInstallmentElectionOut({ computed });
  if (installmentOut) hits.push(installmentOut);
  const historicRehab = detectHistoricRehabCredit({ computed, assetBalances });
  if (historicRehab) hits.push(historicRehab);
  const disabledAccess = detectDisabledAccessCredit({ computed, adjustments });
  if (disabledAccess) hits.push(disabledAccess);
  // Phase H — H1 catalog v1.15: G1.82 §1374 BIG / G1.83 §338(h)(10) /
  // G1.84 §351 / G1.85 §163(h)(3) mortgage / G1.86 CLT.
  const section1374 = detectSection1374Big({ computed });
  if (section1374) hits.push(section1374);
  const section338 = detectSection338h10({ computed });
  if (section338) hits.push(section338);
  const section351 = detectSection351Contribution({ assetBalances });
  if (section351) hits.push(section351);
  const mortgageInt = detectMortgageInterestOptim({ computed, adjustments });
  if (mortgageInt) hits.push(mortgageInt);
  const clt = detectCharitableLeadTrust({ computed, adjustments });
  if (clt) hits.push(clt);
  // Phase H — H1 catalog v1.16: G1.87 §401(a)(17) / G1.88 §199A SSTB /
  // G1.89 §199A aggregation / G1.90 PIF / G1.91 §139 disaster.
  const section401a17 = detectSection401a17Cap({ computed, adjustments, baselineInputs });
  if (section401a17) hits.push(section401a17);
  const sstbNav = detectSstbNavigation({ computed, adjustments });
  if (sstbNav) hits.push(sstbNav);
  const section199aAgg = detectSection199aAggregation({ computed, adjustments });
  if (section199aAgg) hits.push(section199aAgg);
  const pif = detectPooledIncomeFund({ client, computed, adjustments });
  if (pif) hits.push(pif);
  const disasterRelief = detectDisasterRelief({ client, computed, adjustments });
  if (disasterRelief) hits.push(disasterRelief);
  // Phase H — H1 catalog v1.17 (FINAL): G1.92 Solo 401(k) deferral / G1.93 §163(d) /
  // G1.94 §85 UI / G1.95 §1377(a)(2) S-corp close / G1.96 §132(f) transit.
  const solo401kDeferral = detectSolo401kDeferral({ client, computed, adjustments, baselineInputs });
  if (solo401kDeferral) hits.push(solo401kDeferral);
  const invInterestElection = detectInvestmentInterestElection({ computed, adjustments, baselineInputs });
  if (invInterestElection) hits.push(invInterestElection);
  const uiAnalysis = detectUnemploymentAnalysis({ computed });
  if (uiAnalysis) hits.push(uiAnalysis);
  const section1377 = detectSection1377Election({ computed });
  if (section1377) hits.push(section1377);
  const transitFringe = detectQualifiedTransportFringe({ computed, baselineInputs });
  if (transitFringe) hits.push(transitFringe);
  // OBBBA v1.19 — G1.97 tips / G1.98 overtime / G1.99 car-loan interest /
  // G1.100 senior bonus (NEW temporary deductions, TY2025–2028).
  const tipsDed = detectTipsDeduction({ client, computed, adjustments });
  if (tipsDed) hits.push(tipsDed);
  const overtimeDed = detectOvertimeDeduction({ client, computed, adjustments });
  if (overtimeDed) hits.push(overtimeDed);
  const carLoanDed = detectCarLoanInterestDeduction({ client, computed, adjustments });
  if (carLoanDed) hits.push(carLoanDed);
  const seniorDed = detectSeniorDeduction({ client, computed });
  if (seniorDed) hits.push(seniorDed);
  // T1.3 — G1.101–G1.106 estate & gift planning touchpoints (qualitative flags).
  const gifting = detectAnnualExclusionGifting({ client, computed });
  if (gifting) hits.push(gifting);
  const superfund529 = detect529Superfunding({ client, computed });
  if (superfund529) hits.push(superfund529);
  const slat = detectSlat({ client, computed });
  if (slat) hits.push(slat);
  const ilit = detectIlit({ computed });
  if (ilit) hits.push(ilit);
  const grat = detectGrat({ computed });
  if (grat) hits.push(grat);
  const stepUp = detectStepUpBasisHold({ client, computed });
  if (stepUp) hits.push(stepUp);
  // PLAN-08 — drop hits whose catalog entry has expired for this return's tax
  // year (stale TY-specific thresholds). Today every strategy is validUntil
  // 2026-12-31, so TY2024/2025 returns are unaffected; a TY2027+ return correctly
  // surfaces nothing until the catalog is refreshed.
  const liveHits = hits.filter((h) => {
    const strat = CATALOG_V1.strategies.find((x) => x.id === h.strategyId);
    return !strat || !isStrategyExpiredForYear(strat.validUntil, computed.taxYear);
  });
  // PLAN-Q1 — rank on the engine-verified delta where present, not the heuristic.
  annotateVerifiedSavings(liveHits);
  // T1.3 — attach a deadline-aware action date to each hit.
  annotateDeadlines(liveHits, computed.taxYear);
  liveHits.sort(compareHitsForRanking);
  return liveHits;
}

/**
 * T1.0g (M7, audit 2026-06-11) — hit-list ranking: ENGINE-VERIFIED hits with a
 * positive verified saving rank ABOVE every heuristic estimate; within each
 * tier, by headline savings descending. Rationale: heuristic mega-anchors
 * (G1.39 QSBS flat $238k "assumed $1M gain", G1.20 easement AGI×30%×37%, …)
 * were honest-but-hypothetical illustrations that outranked real
 * engine-computed dollars on every HNW pass-through client, making the top
 * Planning-tab recommendation a hypothetical. This is deliberately the
 * MINIMAL change: estSavings/verifiedSavings values are untouched (both still
 * travel on the hit), and the firm-wide `planningScore` already discounts
 * heuristics through its per-hit `confidence` weighting — only the
 * within-client presentation order changes.
 */
export function compareHitsForRanking(a: OpportunityHit, b: OpportunityHit): number {
  const tier = (h: OpportunityHit): number =>
    h.savingsSource === "engine-verified" && (h.verifiedSavings ?? 0) > 0 ? 1 : 0;
  const dt = tier(b) - tier(a);
  if (dt !== 0) return dt;
  return headlineSavings(b) - headlineSavings(a);
}

// ── Phase H — H7 cross-strategy interaction modeling ──────────────────────

/**
 * H7 — Combined effect of stacking all H2-wired "savings" strategies.
 *
 * Returns the joint engine delta (mutations applied together) and the
 * `interactionEffect` — the difference between the joint savings and the
 * sum of individual savings. NEGATIVE interactionEffect means bracket-
 * stacking eroded the savings (most common); POSITIVE means strategies
 * compound (less common, but possible — e.g. when one strategy moves the
 * client into a state where another credit suddenly applies).
 *
 * Only "savings" strategies are stacked. "Cost" strategies (Roth) and
 * heuristic-only strategies (G1.3 bunching, G1.8 DAF, G1.7 §199A) are
 * skipped because their mutations don't represent free tax savings.
 *
 * Returns undefined when fewer than 2 stackable strategies are present
 * (a single strategy's combined-effect equals its individual delta —
 * no insight gained).
 */
export interface CrossStrategySummary {
  stackedStrategyIds: string[];
  /** Engine-verified delta from applying ALL stacked mutations together. */
  combinedDelta: import("@workspace/planning-strategies").WhatIfDelta;
  /** Simple sum of |combinedRefundDelta| across each stacked hit's individual H2 result. */
  sumOfIndividualSavings: number;
  /**
   * Joint savings (|combinedDelta.combinedRefundDelta|) minus the sum of
   * individual savings. Negative = bracket stacking erodes savings. Zero
   * = strategies are perfectly additive (rare). Positive = compounding
   * benefit (rare).
   */
  interactionEffect: number;
}

export function evaluateCrossStrategyScenario(args: {
  hits: OpportunityHit[];
  baselineInputs: TaxReturnInputs;
}): CrossStrategySummary | undefined {
  const { hits, baselineInputs } = args;
  // Collect "savings" hits with whatIf data (skip "cost" + heuristic-only).
  const stackable = hits.filter(
    (h) => h.whatIf != null && h.whatIf.semantics === "savings",
  );
  if (stackable.length < 2) return undefined;

  // Flatten all mutations from stackable hits into one combined scenario.
  // Mutation order matches detector order in evaluatePlanningOpportunities,
  // which is sorted by estSavings desc.
  const allMutations: WhatIfMutation[] = [];
  for (const h of stackable) {
    if (h.whatIf) {
      allMutations.push(...h.whatIf.mutations);
    }
  }
  const combinedScenario = runWhatIfScenarios(baselineInputs, [
    {
      scenarioId: "H7-combined-all-strategies",
      label: `All ${stackable.length} strategies stacked`,
      mutations: allMutations,
    },
  ])[0];

  // SIGN PRESERVED (audit 2026-06-11): savings = +combinedRefundDelta. A
  // stack (or member) that nets a COST stays negative instead of |abs|
  // flipping it into a phantom positive saving.
  const sumOfIndividualSavings = stackable.reduce(
    (s, h) => s + h.whatIf!.delta.combinedRefundDelta,
    0,
  );
  const combinedSavings = combinedScenario.delta.combinedRefundDelta;
  const interactionEffect = combinedSavings - sumOfIndividualSavings;

  return {
    stackedStrategyIds: stackable.map((h) => h.strategyId),
    combinedDelta: combinedScenario.delta,
    sumOfIndividualSavings: Math.round(sumOfIndividualSavings),
    interactionEffect: Math.round(interactionEffect),
  };
}
