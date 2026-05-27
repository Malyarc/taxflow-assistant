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
import {
  calculateFederalTaxWithBreakdown,
  calculateStateTaxWithBreakdown,
  getFederalStandardDeduction,
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
  const sensitivity: WhatIfSensitivity = {
    low: Math.round(Math.abs(results[0].delta.combinedRefundDelta)),
    mid: Math.round(Math.abs(results[1].delta.combinedRefundDelta)),
    high: Math.round(Math.abs(results[2].delta.combinedRefundDelta)),
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
 * employer-side). Per IRS Notice 2023-75 (TY2024) and Notice 2024-80 (TY2025).
 */
const SEP_ANNUAL_LIMIT: Record<number, number> = {
  2024: 69000,
  2025: 70000,
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
  if (client.filingStatus === "married_filing_separately") return null;

  const netSe = computed.detail.se.netSeEarnings;
  if (netSe < SEP_NET_SE_TRIGGER) return null;
  if (hasExistingSepOrSolo(adjustments)) return null;

  const halfSe = computed.detail.se.deductibleHalf;
  const sepCap = SEP_ANNUAL_LIMIT[computed.taxYear] ?? SEP_ANNUAL_LIMIT[2025];
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
 * States that have enacted a Pass-Through Entity Tax regime that lets
 * S-corp / partnership owners bypass the federal $10k SALT cap. List per the
 * Phase G plan (AICPA tracker as of 2026-05). New states are added as they
 * enact PTET; date-version the catalog when the list changes.
 */
const PTET_ELECTING_STATES: ReadonlySet<string> = new Set([
  "AL", "AZ", "AR", "CA", "CO", "CT", "GA", "HI", "IL", "IN",
  "IA", "KS", "KY", "LA", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NJ", "NM", "NY", "NC", "OH", "OK", "OR", "RI",
  "SC", "UT", "VA", "WV", "WI",
]);

function detectPtetElection(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { client, computed } = args;
  // Resident state must have a PTET regime.
  const state = (client.state ?? "").toUpperCase();
  if (!PTET_ELECTING_STATES.has(state)) return null;

  // Must be a K-1 client with active (i.e. non-passive) pass-through income.
  // Passive K-1 income doesn't benefit from PTET in the same way (the rule
  // is intended for owner-operators of S-corps / partnerships).
  const activeK1 = computed.scheduleK1?.totalActiveOrdinaryIncome ?? 0;
  if (activeK1 <= 0) return null;

  // Cap must actually bind: itemizing AND saltDeductible at the cap.
  if (computed.itemizedDeductions == null) return null;
  const saltCap = client.filingStatus === "married_filing_separately" ? 5000 : 10000;
  const { saltDeductible, saltUncapped } = computed.scheduleA;
  if (Math.round(saltDeductible) !== saltCap) return null;
  if (saltUncapped <= saltCap) return null;

  const fedRate = federalMarginalRate(computed);
  const recoverable = saltUncapped - saltCap;
  const estSavings = recoverable * fedRate;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.2");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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
      `Resident state ${state} has a PTET regime; SALT cap binds at ${fmt(saltCap)} but ` +
      `${fmt(Math.round(saltUncapped))} of state + property tax was paid. Electing PTET would deduct ` +
      `~${fmt(Math.round(recoverable))} at the entity level instead.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      state,
      activeK1Income: Math.round(activeK1),
      saltUncapped: Math.round(saltUncapped),
      saltCap,
      recoverableSalt: Math.round(recoverable),
      federalMarginalRate: fedRate,
    },
    assumptions: [
      `Resident state ${state} has enacted a PTET regime (AICPA state tracker, as of Phase G).`,
      `SALT cap binds at ${fmt(saltCap)} (TCJA $10k single/MFJ; $5k MFS — IRC §164(b)(6)).`,
      `Heuristic estSavings = (saltUncapped − saltCap) × federal marginal rate (recoverable SALT at entity level).`,
      `Engine does NOT model the PTET election as a first-class adjustment type — H2 verification deferred (would require multi-mutation: remove personal SALT + add PTE-level deduction + PTE-state-tax credit). Tracked as H1 catalog work.`,
      `Assumes active K-1 income (passive doesn't qualify the same way under most PTET regimes).`,
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
 */
const QBI_THRESHOLDS: Record<number, Record<string, { threshold: number; top: number }>> = {
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

  const cfg = QBI_THRESHOLDS[computed.taxYear];
  if (!cfg) return null;
  const tier = cfg[computed.filingStatus] ?? cfg.single;
  const taxableBeforeQbi = computed.taxableIncome + computed.qbiDeduction;
  if (taxableBeforeQbi <= tier.threshold) return null;
  if (taxableBeforeQbi > tier.top) return null;

  const fedRate = federalMarginalRate(computed);
  // Phase G plan proxy: 50% of QBI income is at risk of wage/UBIA-limit
  // erosion when in the phase-in band. The engine doesn't model the limit
  // (it applies the simplified flat 20%); proper Form 8995-A might reduce
  // the QBI deduction. Recoverable estSavings = lost_qbi × 0.20 × marginalRate.
  const lostQbi = qbi * 0.5;
  const estSavings = lostQbi * 0.20 * fedRate;
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
      `(${fmt(tier.threshold)}-${fmt(tier.top)}). Engine applies simplified 20% × QBI; proper ` +
      `Form 8995-A wage/UBIA structuring could recover up to ~${fmt(Math.round(estSavings))} of ` +
      `federal tax.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      taxableBeforeQbi: Math.round(taxableBeforeQbi),
      qbiAmount: Math.round(qbi),
      lostQbi: Math.round(lostQbi),
      threshold: tier.threshold,
      phaseInTop: tier.top,
      federalMarginalRate: fedRate,
    },
    assumptions: [
      `§199A wage/UBIA limit (Form 8995-A) is NOT modeled by the engine — it applies the simplified flat 20% × QBI.`,
      `Heuristic: assumes ~50% of QBI is at risk of erosion in the phase-in band; recoverable savings ≈ lost_qbi × 20% × marginal rate.`,
      `H2 verification deferred — would require the engine to model the wage-cap formula (Form 8995-A worksheet 12B). Engine sub-gap tracked in CLAUDE.md.`,
      `Phase-in band thresholds: TY${computed.taxYear}, ${client.filingStatus === "married_filing_jointly" || client.filingStatus === "qualifying_widow" ? "MFJ/QSS" : "single/HoH/MFS"} per Rev. Proc. 2023-34 / 2024-40.`,
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
 * 2024 (SECURE 2.0 Act §307). 2025 indexing per IRS Notice TBD-2024.
 */
const QCD_CAP: Record<number, number> = {
  2024: 105_000,
  2025: 108_000,
};

const QCD_MIN_AGE = 70.5;

function detectQcd(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, adjustments, baselineInputs } = args;
  const age = client.taxpayerAge;
  // Must be 70½ on the distribution date. Engine doesn't track distribution
  // dates per-1099-R, so use whole-year age as proxy (conservative: fires
  // when age ≥ 71 to avoid false-positive for 70½ split-year clients;
  // CPA can override). For MVP we use 71+ for clarity.
  if (age == null || age < 71) return null;
  // Must have IRA / retirement-plan income (the QCD source).
  const retIncome = computed.form1099Summary?.retirementIncome ?? 0;
  if (retIncome <= 0) return null;
  // Must have charitable giving in scope (otherwise no donation to convert).
  const charitableCash = sumAdjustment(adjustments, "charitable_cash");
  if (charitableCash <= 0) return null;

  const cap = QCD_CAP[computed.taxYear] ?? QCD_CAP[2025];
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
      retirementIncome: Math.round(retIncome),
      charitableCash: Math.round(charitableCash),
      qcdCap: cap,
      qcdAmount: Math.round(qcdAmount),
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
    },
    assumptions: [
      `Client must be age 70½+ on the distribution date — detector fires at age 71+ for safety; CPA verifies for 70½ split-year clients.`,
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

const HSA_CAP: Record<number, { self: number; family: number; catchup55: number }> = {
  2024: { self: 4_150, family: 8_300, catchup55: 1_000 },
  2025: { self: 4_300, family: 8_550, catchup55: 1_000 },
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

  const cfg = HSA_CAP[computed.taxYear] ?? HSA_CAP[2025];
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

const G1_16_415C_LIMIT: Record<number, number> = {
  2024: 69_000,
  2025: 70_000,
};
const G1_16_402G_ELECTIVE: Record<number, number> = {
  2024: 23_000,
  2025: 23_500,
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

  const cap415c = G1_16_415C_LIMIT[computed.taxYear] ?? G1_16_415C_LIMIT[2025];
  const electiveCap = G1_16_402G_ELECTIVE[computed.taxYear] ?? G1_16_402G_ELECTIVE[2025];
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
}): OpportunityHit | null {
  const { client, computed } = args;
  void client; // unused — reserved for future spouse-attribution
  const k1Summary = computed.scheduleK1;
  if (!k1Summary) return null;
  // Estimate S-corp income from active K-1 ordinary income. The engine
  // doesn't currently track per-K-1 entity type cleanly in summary, so we
  // use totalActiveOrdinaryIncome as proxy (assumes most active income
  // comes from S-corp for clients where this matters).
  const sCorpIncome = k1Summary.totalActiveOrdinaryIncome ?? 0;
  if (sCorpIncome < G1_17_MIN_S_CORP_INCOME) return null;

  const reasonableComp = sCorpIncome * G1_17_REASONABLE_COMP_PCT;
  const distributions = sCorpIncome - reasonableComp;
  // FICA savings on the distribution portion. SS portion is capped at the
  // 2024 wage base ($168,600); Medicare uncapped. Simplify: 15.3% × dist,
  // capped at $25,789 (= 0.153 × 168600).
  const ssWageBase = computed.taxYear === 2024 ? 168_600 : 176_100;
  const cappedFicaBase = Math.min(distributions, ssWageBase);
  const estSavings = cappedFicaBase * G1_17_FICA_TOTAL;
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
      distributions: Math.round(distributions),
      cappedFicaBase: Math.round(cappedFicaBase),
      ficaRate: G1_17_FICA_TOTAL,
    },
    assumptions: [
      `Default split assumption: 40% reasonable W-2 wages / 60% distributions. CPA refines based on RC Reports / BLS / industry.`,
      `FICA rate ${(G1_17_FICA_TOTAL * 100).toFixed(1)}% (both sides — employer + employee). SS portion capped at ${fmt(ssWageBase)} TY${computed.taxYear} wage base.`,
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
const G1_23_BONUS_RATE: Record<number, number> = {
  2024: 0.60,
  2025: 0.40,
};

function detectCostSegregation(args: {
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { computed } = args;
  const rentalGross = Math.abs(computed.scheduleERentalGrossNet ?? 0);
  if (rentalGross < G1_23_MIN_RENTAL_GROSS) return null;
  const fedRate = federalMarginalRate(computed);
  if (fedRate < G1_23_MIN_MARGINAL) return null;
  const bonusRate = G1_23_BONUS_RATE[computed.taxYear] ?? 0.40;

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
      `Original deferral elimination date is 2026-12-31 (statutory). Investments made now defer until that date; new deferrals beyond are not currently available without legislation.`,
      `QOF must invest ≥ 90% of assets in a Qualified Opportunity Zone (audited semi-annually).`,
      `H2 verification deferred — engine doesn't model QOF deferral or 10-year basis step-up.`,
    ],
  };
}

// ── G1.26 — Backdoor Roth IRA (high-income filer) ────────────────────────

const G1_26_ROTH_PHASEOUT_TOP: Record<string, number> = {
  single: 161_000,
  head_of_household: 161_000,
  married_filing_jointly: 240_000,
  qualifying_widow: 240_000,
  married_filing_separately: 10_000,
};
const G1_26_IRA_CAP_BASE = 7_000;
const G1_26_IRA_CAP_CATCHUP = 8_000;

function detectBackdoorRoth(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  assetBalances?: AssetBalanceFact[];
}): OpportunityHit | null {
  const { client, computed, adjustments, assetBalances } = args;
  // AGI must exceed direct-Roth contribution phase-out top.
  const phaseOutTop = G1_26_ROTH_PHASEOUT_TOP[client.filingStatus] ?? G1_26_ROTH_PHASEOUT_TOP.single;
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
  const contribAmount = age >= 50 ? G1_26_IRA_CAP_CATCHUP : G1_26_IRA_CAP_BASE;
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

  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.33-ev-credit",
    label: `EV credit $${G1_33_NEW_EV_MAX_CREDIT.toLocaleString("en-US")}`,
    mutations: [
      { kind: "add_adjustment", adjustmentType: "credit", amount: G1_33_NEW_EV_MAX_CREDIT },
    ],
    semantics: "savings",
    varyAmount: false,
  });

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
      `${fmt(cap)} for ${client.filingStatus}. If client buys a qualifying new EV this year, ` +
      `claim up to ${fmt(estSavings)} via Form 8936.`,
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
const G1_34_CREDIT_RATE: Record<number, number> = {
  2024: 0.30,
  2025: 0.30,
  2026: 0.30,
  2027: 0.30,
  2028: 0.30,
  2029: 0.30,
  2030: 0.30,
  2031: 0.30,
  2032: 0.30,
  2033: 0.26,
  2034: 0.22,
};
const G1_34_MIN_AGI = 50_000;

function detectResidentialCleanEnergy(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  assetBalances?: AssetBalanceFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { computed, adjustments, assetBalances, baselineInputs } = args;
  if (computed.adjustedGrossIncome < G1_34_MIN_AGI) return null;
  // Suppress if existing residential_clean_energy adjustment already present.
  if (sumAdjustment(adjustments, "residential_clean_energy") > 0) return null;
  // Heuristic owner-of-home detection: either H5 primary_residence asset OR
  // mortgage_interest adjustment (proxy for owning home).
  const hasResidence = (assetBalances ?? []).some((a) => a.assetType === "primary_residence");
  const hasMortgage = sumAdjustment(adjustments, "mortgage_interest") > 0;
  if (!hasResidence && !hasMortgage) return null;

  const rate = G1_34_CREDIT_RATE[computed.taxYear] ?? 0.30;
  const credit = Math.round(G1_34_ASSUMED_INSTALL * rate);
  // Must have enough federal tax to use the (non-refundable) credit. Engine
  // allows carryforward, so partial benefit is OK — but suppress for very
  // low federal tax filers to avoid noise.
  if (computed.federalTaxLiability < 1_000) return null;

  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.34-clean-energy",
    label: `§25D credit $${credit.toLocaleString("en-US")}`,
    mutations: [
      { kind: "add_adjustment", adjustmentType: "residential_clean_energy", amount: credit },
    ],
    semantics: "savings",
    varyAmount: true,
  });

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
      `~${fmt(credit)} of federal credit + indefinite carryforward of any unused portion.`,
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
      `Credit rate by tax year (IRA 2022 §13302): 30% through 2032; 26% in 2033; 22% in 2034; expires after 2034.`,
      `Assumed install cost $20,000 (heuristic). Real installs range $15k-$40k depending on system size + battery storage.`,
      `NO income cap — anyone with sufficient federal tax can use the credit (indefinite carryforward for unused portion).`,
      `Qualifying equipment: solar PV, solar water heating, geothermal heat pump, small wind, fuel cell, battery storage ≥ 3 kWh.`,
      `Heat pumps for primary residence go under §25C Energy Efficient Home Improvement Credit (separate $1,200/yr cap) — NOT §25D.`,
      `Rental properties DO NOT qualify — primary or secondary residence only.`,
      `H2 mutation adds the credit as a residential_clean_energy adjustment which the engine routes through the credit-ordering pipeline.`,
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

const G1_31_AGI_BANDS: Record<string, Array<{ rate: number; maxAgi: number }>> = {
  single: [
    { rate: 0.50, maxAgi: 23_000 },
    { rate: 0.20, maxAgi: 25_000 },
    { rate: 0.10, maxAgi: 38_250 },
  ],
  married_filing_separately: [
    { rate: 0.50, maxAgi: 23_000 },
    { rate: 0.20, maxAgi: 25_000 },
    { rate: 0.10, maxAgi: 38_250 },
  ],
  head_of_household: [
    { rate: 0.50, maxAgi: 34_500 },
    { rate: 0.20, maxAgi: 37_500 },
    { rate: 0.10, maxAgi: 57_375 },
  ],
  married_filing_jointly: [
    { rate: 0.50, maxAgi: 46_000 },
    { rate: 0.20, maxAgi: 50_000 },
    { rate: 0.10, maxAgi: 76_500 },
  ],
  qualifying_widow: [
    { rate: 0.50, maxAgi: 46_000 },
    { rate: 0.20, maxAgi: 50_000 },
    { rate: 0.10, maxAgi: 76_500 },
  ],
};
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
  // Need some sign of retirement contribution (so the credit applies to something).
  const anyRetirement =
    sumAdjustment(adjustments, "ira_contribution_traditional") +
    sumAdjustment(adjustments, "ira_contribution_roth") +
    sumAdjustment(adjustments, "self_employed_retirement") +
    sumAdjustment(adjustments, "hsa_contribution");
  if (anyRetirement <= 0) return null;

  // Determine applicable rate from AGI bracket.
  const bands = G1_31_AGI_BANDS[client.filingStatus] ?? G1_31_AGI_BANDS.single;
  const agi = computed.adjustedGrossIncome;
  const matchedBand = bands.find((b) => agi <= b.maxAgi);
  if (!matchedBand) return null;

  const cap = client.filingStatus === "married_filing_jointly" ||
              client.filingStatus === "qualifying_widow"
    ? G1_31_CONTRIB_CAP_MFJ
    : G1_31_CONTRIB_CAP_SINGLE;
  const qualifyingContrib = Math.min(anyRetirement, cap);
  const estSavings = Math.round(qualifyingContrib * matchedBand.rate);
  if (estSavings <= 0) return null;

  // Cap by federal tax liability (non-refundable).
  const cappedSavings = Math.min(estSavings, Math.round(computed.federalTaxLiability));
  if (cappedSavings <= 0) return null;

  // H2 mutation: add retirement_contributions_savers = cap. Engine
  // computes the credit via the credit-ordering pipeline.
  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.31-savers-credit",
    label: `Saver's Credit cap $${cap.toLocaleString("en-US")}`,
    mutations: [
      { kind: "add_adjustment", adjustmentType: "retirement_contributions_savers", amount: cap },
    ],
    semantics: "savings",
    varyAmount: false,
  });

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
      `${(matchedBand.rate * 100).toFixed(0)}% band. Existing retirement contributions ` +
      `${fmt(Math.round(anyRetirement))} qualify (cap ${fmt(cap)}). Credit ~${fmt(cappedSavings)} ` +
      `via Form 8880 — many CPAs miss this for low/mid-income clients with retirement savings.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(agi),
      filingStatus: client.filingStatus,
      bandRate: matchedBand.rate,
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
  const { computed, adjustments, assetBalances, baselineInputs } = args;
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

  const whatIf = runDetectorWhatIf({
    baselineInputs,
    scenarioId: "G1.37-25c",
    label: `§25C heat pump credit $${credit.toLocaleString("en-US")}`,
    mutations: [
      { kind: "add_adjustment", adjustmentType: "energy_efficient_heatpump", amount: G1_37_ASSUMED_HEATPUMP_COST },
    ],
    semantics: "savings",
    varyAmount: true,
  });

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
      `(30% × cost, capped at $2,000 for heat pumps).`,
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
      `IRA 2022 §13301 raised credit to 30% with annual caps; expires 2032-12-31.`,
      `Annual cap STRUCTURE: $1,200 general (windows $600, doors $250/$500 max, audit $150, AC/furnace/boiler $600); $2,000 separately for heat pumps + heat-pump water heaters + biomass stoves. Combined max ~$3,200.`,
      `NO carryforward — use-it-or-lose-it each year (vs §25D residential clean energy which IS carryforward-able).`,
      `Heuristic uses heat-pump example ($5k install). Other items (windows, doors) have lower caps + different rates.`,
      `ENERGY STAR certification required (Notice 2024-09).`,
      `Rental property does NOT qualify — primary or secondary residence only.`,
      `H2 mutation adds energy_efficient_heatpump = $5,000 install cost — engine computes 30% × cost capped at $2,000.`,
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
}): OpportunityHit | null {
  const { client, computed, adjustments } = args;
  if (computed.totalIncome < 100_000) return null;
  const capLossCf = sumAdjustment(adjustments, "capital_loss_carryforward_short") +
                    sumAdjustment(adjustments, "capital_loss_carryforward_long");
  if (capLossCf < G1_40_MIN_CAP_LOSS_CF) return null;

  const cap = client.filingStatus === "married_filing_jointly" ||
              client.filingStatus === "qualifying_widow"
    ? G1_40_ORDINARY_CAP_MFJ
    : G1_40_ORDINARY_CAP_SINGLE;
  // Recharacterizable portion = min(carryforward, cap).
  const recharacterizable = Math.min(capLossCf, cap);
  const estSavings = Math.round(recharacterizable * G1_40_RATE_SPREAD);
  if (estSavings <= 0) return null;

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
      `HEURISTIC — engine cannot verify §1244 qualifying-stock status. CPA confirms all 5 requirements.`,
      `Annual ordinary-loss cap: $50,000 single/MFS/HoH/QSS; $100,000 MFJ. Excess flows to capital loss (Sch D).`,
      `Stock must be: (1) DOMESTIC C-CORP, (2) issued for money/property (not services), (3) ORIGINAL ISSUANCE to client, (4) corp raised ≤ $1M equity at issuance, (5) corp had > 50% gross receipts from active T/B in 5 yrs preceding loss.`,
      `Rate spread heuristic 17% — approximate gap between ordinary marginal (24-37%) and LTCG (0-20%). Real spread varies.`,
      `Loss must be from sale, exchange, or worthlessness (Form 4797 Part I, NOT Sch D).`,
      `Strategy is REACTIVE — applies to loss already incurred. Forward planning: structure equity rounds to preserve §1244 eligibility (< $1M raised).`,
    ],
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

  // Heuristic: total earnings (W-2 + net SE) > $7k. Engine can't verify
  // per-spouse split — CPA confirms one spouse has $0 earned income.
  const totalEarnings = computed.totalIncome - (computed.form1099Summary?.retirementIncome ?? 0)
                       - (computed.form1099Summary?.unemploymentCompensation ?? 0);
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
}): OpportunityHit | null {
  const { computed, adjustments, assetBalances } = args;
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
  const estSavings = Math.round(embeddedGain * G1_47_TIMING_BENEFIT_FACTOR);
  if (estSavings <= 0) return null;

  const annualGain = Math.round(embeddedGain / G1_47_DEFAULT_INSTALLMENT_YEARS);

  const strategy = strategyById("G1.47");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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
    },
    assumptions: [
      `Heuristic timing-benefit 5% — conservative estimate. Actual savings depend on the bracket arbitrage achievable across the installment years (could be 2-15% of gain).`,
      `5-year planning horizon assumed. Real installment can be 2-30+ years per contract.`,
      `Publicly traded securities + dealer dispositions do NOT qualify per §453(b)(2).`,
      `Depreciation recapture (§1250) RECOGNIZED IN YEAR OF SALE — only excess flows through installment method.`,
      `Imputed interest (§483 / §1274) on long-term notes — interest portion separately ordinary.`,
      `Election to opt OUT exists — file by due date if all-cash recognition preferred (e.g., low-bracket year, buyer credit concern).`,
      `H2 verification deferred — multi-year scenario, requires H3 wiring of installment-payment stream which the engine doesn't model.`,
    ],
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

function detectFamilyEmployment(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs?: TaxReturnInputs;
}): OpportunityHit | null {
  const { client, computed, adjustments, baselineInputs } = args;
  const netSe = computed.detail.se.netSeEarnings;
  if (netSe < G1_49_MIN_NET_SE) return null;
  // Need children under 17 (engine field). dependentsUnder17 is a count.
  const kidsUnder17 = client.dependentsUnder17 ?? 0;
  if (kidsUnder17 <= 0) return null;
  // Suppress if existing family_employment marker. Use generic "deduction"
  // with a magic amount as a proxy.
  const existingFamEmp = adjustments.find((a) =>
    (a.adjustmentType ?? "").toLowerCase().includes("family_employment"),
  );
  if (existingFamEmp) return null;

  const numChildren = Math.min(kidsUnder17, G1_49_DEFAULT_NUM_CHILDREN);
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
      `Sole prop with ${fmt(Math.round(netSe))} net SE income + ${kidsUnder17} dependent(s) under 17. ` +
      `Employing child(ren) under 18 in the business shields wages from FICA per §3121(b)(3)(A) ` +
      `AND the child's standard deduction (${fmt(G1_49_CHILD_STD_DED_2024)}) shields the wages from ` +
      `federal income tax. Net savings ~${fmt(estSavings)} per year per child.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      dependentsUnder17: kidsUnder17,
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
    (s, h) => s + h.estSavings * h.confidence * stickinessWeight(h.recurring),
    0,
  );
  return weightedSavings * marginalRateWeight(federalMarginalRate) * engagementComplexityWeight(hits.length);
}

/**
 * Run all detectors over a single client's computed tax return.
 * Returns hits sorted by `estSavings` descending so the highest-impact
 * opportunity is presented first in the Planning tab.
 */
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
  const scorpComp = detectScorpReasonableComp({ client, computed });
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
  const section1244 = detectSection1244({ client, computed, adjustments });
  if (section1244) hits.push(section1244);
  // Phase H — H1 catalog v1.7: G1.46 spousal IRA / G1.47 §453 installment /
  // G1.48 §83(b) / G1.49 family employment / G1.51 AOC vs LLC.
  const spousalIra = detectSpousalIra({ client, computed, adjustments, baselineInputs });
  if (spousalIra) hits.push(spousalIra);
  const installmentSale = detectInstallmentSale({ computed, adjustments, assetBalances });
  if (installmentSale) hits.push(installmentSale);
  const section83b = detectSection83b({ computed, assetBalances });
  if (section83b) hits.push(section83b);
  const familyEmployment = detectFamilyEmployment({ client, computed, adjustments, baselineInputs });
  if (familyEmployment) hits.push(familyEmployment);
  const aocVsLlc = detectAocVsLlc({ client, computed, adjustments, baselineInputs });
  if (aocVsLlc) hits.push(aocVsLlc);
  hits.sort((a, b) => b.estSavings - a.estSavings);
  return hits;
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

  const sumOfIndividualSavings = stackable.reduce(
    (s, h) => s + Math.abs(h.whatIf!.delta.combinedRefundDelta),
    0,
  );
  const combinedSavings = Math.abs(combinedScenario.delta.combinedRefundDelta);
  const interactionEffect = combinedSavings - sumOfIndividualSavings;

  return {
    stackedStrategyIds: stackable.map((h) => h.strategyId),
    combinedDelta: combinedScenario.delta,
    sumOfIndividualSavings: Math.round(sumOfIndividualSavings),
    interactionEffect: Math.round(interactionEffect),
  };
}
