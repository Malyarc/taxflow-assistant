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
  type OpportunityWhatIf,
  type PlanningStrategy,
  type WhatIfMutation,
  type WhatIfSensitivity,
} from "@workspace/planning-strategies";
import type {
  ComputedTaxReturn,
  ClientFacts,
  AdjustmentFact,
  TaxReturnInputs,
} from "./taxReturnEngine";
import {
  calculateFederalTaxWithBreakdown,
  calculateStateTaxWithBreakdown,
  getFederalStandardDeduction,
} from "./taxCalculator";
import { runWhatIfScenarios } from "./whatIfEngine";

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
}): OpportunityHit | null {
  const { computed, adjustments } = args;
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
  const estSavings = stdDed * 0.25 * fedRate;
  if (estSavings <= 0) return null;

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
    },
    assumptions: [
      `Bunching is a MULTI-YEAR strategy (alternate itemize / standard each year) — single-year H2 mutation can't capture the multi-year cycle.`,
      `Heuristic estSavings = stdDed × 0.25 × marginal rate, approximating the average annual benefit of the alternating cycle.`,
      `Fires within ±15% of std-ded threshold where bunching has the highest leverage.`,
      `H2 verification deferred — needs H3 multi-year scenario modeling (Phase H roadmap).`,
    ],
  };
}

// ── G1.8 — Charitable Donor-Advised Fund bunching ─────────────────────────

const G1_8_MIN_CHARITABLE = 5000;
const G1_8_MIN_MARGINAL_RATE = 0.32;

function detectCharitableDaf(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  const charitableCash = sumAdjustment(adjustments, "charitable_cash");
  if (charitableCash <= G1_8_MIN_CHARITABLE) return null;

  const fedRate = federalMarginalRate(computed);
  if (fedRate < G1_8_MIN_MARGINAL_RATE) return null;

  // Phase G plan formula: (charitableCash × 2) × marginalRate × 0.2.
  // The 2× reflects bunching 2-3 years into one; the 0.2 reflects the
  // fraction recoverable above the standard-deduction floor in the bunch
  // year (empirical from the AICPA tax-planning playbook).
  const estSavings = charitableCash * 2 * fedRate * 0.2;
  if (estSavings <= 0) return null;

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
    },
    assumptions: [
      `Donor-Advised Fund bunching is a MULTI-YEAR strategy (front-load 2-3 years of giving into one tax year, take std-ded in the off years).`,
      `Heuristic estSavings = charitable × 2 × marginal rate × 0.2 — the 2× reflects bunching cycle, 0.2 the recovery above std-ded floor in the bunch year (AICPA playbook).`,
      `Fires at $5k+ charitable AND 32%+ marginal rate — the threshold where DAF logistics + tax benefit exceed implementation friction.`,
      `H2 verification deferred — needs H3 multi-year scenario modeling.`,
    ],
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
      `Future marginal rate assumed at ${(G1_4_EXPECTED_FUTURE_RATE * 100).toFixed(0)}% (Phase G plan baseline — CPA judgment call to refine).`,
      `H2 delta represents the CURRENT-YEAR TAX COST of the conversion. Long-term net benefit (heuristic estSavings) = conversion × (futureRate − currentRate).`,
      `Engine modeled as added "additional_income" — same arithmetic effect as 1099-R taxable distribution from traditional IRA.`,
      `Pro-rata rule for after-tax basis (§408(d)(2)) NOT modeled — assumes 100% pre-tax IRA balance (requires Form 8606 — H6).`,
      `Sensitivity range computed at ±10% of the conversion amount.`,
    ],
    whatIf,
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
  const bunching = detectBunching({ computed, adjustments });
  if (bunching) hits.push(bunching);
  const daf = detectCharitableDaf({ computed, adjustments });
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
