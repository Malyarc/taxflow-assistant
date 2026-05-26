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
  type PlanningStrategy,
} from "@workspace/planning-strategies";
import type { ComputedTaxReturn, ClientFacts, AdjustmentFact } from "./taxReturnEngine";
import {
  calculateFederalTaxWithBreakdown,
  calculateStateTaxWithBreakdown,
} from "./taxCalculator";

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
function federalMarginalRate(computed: ComputedTaxReturn): number {
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
}): OpportunityHit | null {
  const { client, computed, adjustments } = args;
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
  };
}

// ── Top-level evaluator ────────────────────────────────────────────────────

export interface PlanningInputs {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}

/**
 * Run all detectors over a single client's computed tax return.
 * Returns hits sorted by `estSavings` descending so the highest-impact
 * opportunity is presented first in the Planning tab.
 */
export function evaluatePlanningOpportunities(args: PlanningInputs): OpportunityHit[] {
  const hits: OpportunityHit[] = [];
  const sepIra = detectSepIra(args);
  if (sepIra) hits.push(sepIra);
  // future detectors land here (G1.2 - G1.10)
  hits.sort((a, b) => b.estSavings - a.estSavings);
  return hits;
}
