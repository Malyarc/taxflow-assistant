/**
 * Phase G4 — Multi-year tax-planning detection.
 *
 * Sibling to planningEngine.ts (G1 — current-year detectors). This module
 * consumes a *history* of computed tax_returns rows (most-recent year first)
 * and emits OpportunityHit[] that fire on multi-year *patterns* rather than
 * single-year facts.
 *
 * Architectural invariants (same as G1):
 *   - Pure function. Same inputs → same hits. No I/O, no Date.now().
 *   - No LLM. All $-amounts are computed here from IRS-cited formulas.
 *   - Each detector reads only the fields it needs from TaxReturnSnapshot,
 *     never from the database directly.
 *
 * Adding a new G4 rule:
 *   1. Add a catalog entry in lib/planning-strategies/src/strategies-v1.json
 *      with id "G4.x" (validator enforces /^G\d+\.\d+$/).
 *   2. Add a `detectXXX(...)` function below returning OpportunityHit | null.
 *   3. Wire it into `evaluateMultiYearOpportunities` so it runs on every
 *      client with sufficient history.
 *   4. Add ≥ 3 positive + ≥ 2 negative + ≥ 1 boundary test in
 *      scripts/src/tax-engine-planning-multi-year-tests.ts. Hand-calc every
 *      expected value against the IRC citation.
 */

import {
  CATALOG_V1,
  type OpportunityHit,
  type PlanningStrategy,
} from "@workspace/planning-strategies";
import type { ClientFacts } from "./taxReturnEngine";
import {
  calculateFederalTaxWithBreakdown,
  getFederalStandardDeduction,
} from "./taxCalculator";

// ── Inputs ─────────────────────────────────────────────────────────────────

/**
 * One year of the engine's persisted tax_returns output. Built by the route
 * handler from a Drizzle row (numeric strings coerced to plain numbers).
 *
 * Detectors read fields they need; missing/zero values produce a non-firing
 * detector rather than a crash. This matches the engine's lenient policy
 * elsewhere (numeric nulls in the schema treated as zero).
 */
export interface TaxReturnSnapshot {
  taxYear: number;
  filingStatus: string;
  adjustedGrossIncome: number;
  taxableIncome: number;
  /** Sched A line-item total. Zero when the filer took the standard deduction. */
  itemizedDeductions: number;
  amtTax: number;
  niitTax: number;
  /** Sched A cash charity total (used by G4.3 — only fire bunching when charity > 0). */
  charitableDeductible: number;
  capitalLossCarryforwardShort: number;
  capitalLossCarryforwardLong: number;
  scheduleEPassiveLossSuspended: number;
  k1PassiveLossSuspended: number;
}

export interface MultiYearPlanningInputs {
  client: ClientFacts;
  /**
   * Snapshots ordered MOST RECENT FIRST (index 0 = current year). Detectors
   * read history[0] as "current" and history[1..] as "prior years". Must
   * contain ≥ 2 entries for any multi-year detector to fire.
   */
  history: TaxReturnSnapshot[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function strategyById(id: string): PlanningStrategy {
  const s = CATALOG_V1.strategies.find((x) => x.id === id);
  if (!s) throw new Error(`planningEngineMultiYear: catalog missing strategy ${id}`);
  return s;
}

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function interpolate(template: string, vars: Record<string, number | string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key];
    if (v == null) return `{{${key}}}`;
    if (typeof v === "number") return fmtUsd(v);
    return String(v);
  });
}

function federalMarginalRate(snapshot: TaxReturnSnapshot): number {
  const { marginalRate } = calculateFederalTaxWithBreakdown(
    snapshot.taxableIncome,
    snapshot.filingStatus,
    snapshot.taxYear,
  );
  return marginalRate;
}

function totalCapitalLossCarryforward(s: TaxReturnSnapshot): number {
  return s.capitalLossCarryforwardShort + s.capitalLossCarryforwardLong;
}

function totalSuspendedPal(s: TaxReturnSnapshot): number {
  return s.scheduleEPassiveLossSuspended + s.k1PassiveLossSuspended;
}

// ── G4.1 — Persistent NIIT exposure ────────────────────────────────────────

/**
 * Fire when NIIT > 0 in the current year AND in at least one prior year.
 * That makes it a recurring exposure — single-year NIIT is what G1.6 covers
 * as a cliff-avoidance opportunity. Multi-year NIIT calls for structural
 * advice (entity restructure, deferred-comp shifting, systematic harvesting),
 * which is a stickier upsell.
 *
 * estSavings = avg(niitTax across the firing years) × 0.5. The 50% factor is
 * deliberately conservative: structural changes typically recover the
 * majority of NIIT but not all of it. Documented in the catalog formula.
 */
function detectPersistentNiit(history: TaxReturnSnapshot[]): OpportunityHit | null {
  const current = history[0];
  if (current.niitTax <= 0) return null;
  const priorWithNiit = history.slice(1).filter((s) => s.niitTax > 0);
  if (priorWithNiit.length === 0) return null;

  const firingYears = [current, ...priorWithNiit];
  const avgNiit = firingYears.reduce((s, y) => s + y.niitTax, 0) / firingYears.length;
  const estSavings = avgNiit * 0.5;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G4.1");
  const years = firingYears.length;
  const vars = {
    years,
    avgNiit: Math.round(avgNiit),
    estSavings: Math.round(estSavings),
  };
  const yearList = firingYears.map((y) => y.taxYear).sort((a, b) => a - b).join(", ");
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `NIIT applied in ${years} years (${yearList}), averaging ${fmtUsd(Math.round(avgNiit))}/year. ` +
      `Recurring exposure indicates structural — not timing — opportunity.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      yearsWithNiit: years,
      yearsCovered: yearList,
      avgNiit: Math.round(avgNiit),
      currentNiit: Math.round(current.niitTax),
    },
  };
}

// ── G4.2 — Persistent AMT exposure ─────────────────────────────────────────

/**
 * AMT is harder to plan around than NIIT — preferences are structural
 * (depreciation method, ISO grants, state tax). Recoverable fraction (0.4)
 * is more conservative than G4.1 NIIT.
 */
function detectPersistentAmt(history: TaxReturnSnapshot[]): OpportunityHit | null {
  const current = history[0];
  if (current.amtTax <= 0) return null;
  const priorWithAmt = history.slice(1).filter((s) => s.amtTax > 0);
  if (priorWithAmt.length === 0) return null;

  const firingYears = [current, ...priorWithAmt];
  const avgAmt = firingYears.reduce((s, y) => s + y.amtTax, 0) / firingYears.length;
  const estSavings = avgAmt * 0.4;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G4.2");
  const years = firingYears.length;
  const vars = {
    years,
    avgAmt: Math.round(avgAmt),
    estSavings: Math.round(estSavings),
  };
  const yearList = firingYears.map((y) => y.taxYear).sort((a, b) => a - b).join(", ");
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `AMT applied in ${years} years (${yearList}), averaging ${fmtUsd(Math.round(avgAmt))}/year. ` +
      `Recurring AMT typically traces to structural preferences (ISO grants, depreciation, state tax).`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      yearsWithAmt: years,
      yearsCovered: yearList,
      avgAmt: Math.round(avgAmt),
      currentAmt: Math.round(current.amtTax),
    },
  };
}

// ── G4.3 — Permanent bunching strategy (persistent std-ded cliff) ─────────

const G4_3_BAND = 0.15; // +/- 15% of std ded

function isNearStdDedCliff(s: TaxReturnSnapshot): boolean {
  // Only meaningful when there's some Sched A activity — pure-std-ded filers
  // who have NEVER itemized aren't "near the cliff".
  if (s.itemizedDeductions <= 0) return false;
  const stdDed = getFederalStandardDeduction(s.filingStatus, s.taxYear);
  if (stdDed <= 0) return false;
  const low = stdDed * (1 - G4_3_BAND);
  const high = stdDed * (1 + G4_3_BAND);
  return s.itemizedDeductions >= low && s.itemizedDeductions <= high;
}

function detectPersistentBunching(history: TaxReturnSnapshot[]): OpportunityHit | null {
  const current = history[0];
  // Must have charitable in current year (the actionable bunching lever).
  if (current.charitableDeductible <= 0) return null;
  if (!isNearStdDedCliff(current)) return null;

  const priorAtCliff = history.slice(1).filter(isNearStdDedCliff);
  if (priorAtCliff.length === 0) return null;

  const firingYears = [current, ...priorAtCliff];
  const stdDedCurrent = getFederalStandardDeduction(current.filingStatus, current.taxYear);
  const fedRate = federalMarginalRate(current);
  // Same single-cycle benefit formula as G1.3 (Phase G plan). Multi-year
  // pattern raises confidence (0.90 vs 0.80) but not the per-cycle $-amount.
  const estSavings = stdDedCurrent * 0.25 * fedRate;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G4.3");
  const years = firingYears.length;
  const yearList = firingYears.map((y) => y.taxYear).sort((a, b) => a - b).join(", ");
  const vars = {
    years,
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
      `Itemized deductions have stayed within +/- 15% of the standard deduction for ${years} years ` +
      `(${yearList}). The cliff is a structural pattern, not a one-off — bunching should become a permanent ` +
      `strategy (DAF or alternating-year prepay).`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      yearsAtCliff: years,
      yearsCovered: yearList,
      currentItemized: Math.round(current.itemizedDeductions),
      currentStdDed: stdDedCurrent,
      currentCharitable: Math.round(current.charitableDeductible),
      federalMarginalRate: fedRate,
    },
  };
}

// ── G4.4 — Capital loss carryforward unused ────────────────────────────────

const G4_4_MIN_CARRYFORWARD = 20000;
/**
 * "Not materially declining" — delta within $3,500/yr. The threshold is just
 * above the maximum natural decline from the IRC §1211 $3,000-against-
 * ordinary deduction ($1,500 MFS). A larger YoY decline indicates the client
 * is actively absorbing the carryforward against realized gains; in that
 * case the rule is moot (recommendation already implemented).
 */
const G4_4_DECLINE_TOLERANCE = 3500;

function detectCapitalLossCarryforwardUnused(history: TaxReturnSnapshot[]): OpportunityHit | null {
  const current = history[0];
  const prior = history[1];
  if (!prior) return null;

  const currentCf = totalCapitalLossCarryforward(current);
  if (currentCf < G4_4_MIN_CARRYFORWARD) return null;
  const priorCf = totalCapitalLossCarryforward(prior);
  // Fire only when the carryforward did NOT materially decline. If client is
  // actively absorbing losses (cf going down by > $1k), the rule is moot.
  if (priorCf - currentCf > G4_4_DECLINE_TOLERANCE) return null;

  const fedRate = federalMarginalRate(current);
  // Potential benefit: absorb up to $20k of realized gains using the
  // carryforward. Bounded by the carryforward itself (you can't offset more
  // gains than the carryforward has).
  const absorbable = Math.min(currentCf, G4_4_MIN_CARRYFORWARD);
  const estSavings = absorbable * fedRate;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G4.4");
  // Count consecutive prior years where cf was also ≥ threshold (just for
  // narrative — not used in formula).
  let yearsStuck = 1; // include current year
  for (let i = 1; i < history.length; i++) {
    if (totalCapitalLossCarryforward(history[i]) >= G4_4_MIN_CARRYFORWARD) yearsStuck++;
    else break;
  }
  const vars = {
    carryforward: Math.round(currentCf),
    years: yearsStuck,
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
      `Capital loss carryforward of ${fmtUsd(Math.round(currentCf))} has been stuck (no material decline) ` +
      `for ${yearsStuck} year${yearsStuck === 1 ? "" : "s"}. Up to ${fmtUsd(absorbable)} could be absorbed ` +
      `by realizing gains.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      currentCarryforward: Math.round(currentCf),
      priorCarryforward: Math.round(priorCf),
      yearsStuck,
      absorbable,
      federalMarginalRate: fedRate,
    },
  };
}

// ── G4.5 — Passive activity loss suspension growing ────────────────────────

const G4_5_MIN_SUSPENDED = 5000;

function detectPassiveLossGrowing(history: TaxReturnSnapshot[]): OpportunityHit | null {
  const current = history[0];
  const prior = history[1];
  if (!prior) return null;

  const currentPal = totalSuspendedPal(current);
  const priorPal = totalSuspendedPal(prior);
  if (currentPal < G4_5_MIN_SUSPENDED) return null;
  const growth = currentPal - priorPal;
  if (growth <= 0) return null; // suspension is shrinking → no growing-problem signal

  const fedRate = federalMarginalRate(current);
  // estSavings = growth × marginalRate × 0.5. The 0.5 reflects that releasing
  // the suspension typically requires either a disposition (one-time) OR a
  // RE-professional qualification (multi-year discipline); the per-year
  // recovery is a fraction of the growth.
  const estSavings = growth * fedRate * 0.5;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G4.5");
  const vars = {
    growth: Math.round(growth),
    currentSuspended: Math.round(currentPal),
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
      `Suspended passive losses under §469 grew from ${fmtUsd(Math.round(priorPal))} to ${fmtUsd(Math.round(currentPal))} ` +
      `(${fmtUsd(Math.round(growth))} year-over-year). Without an exit, the suspension compounds annually.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      currentSuspended: Math.round(currentPal),
      priorSuspended: Math.round(priorPal),
      growth: Math.round(growth),
      federalMarginalRate: fedRate,
    },
  };
}

// ── Top-level evaluator ────────────────────────────────────────────────────

/**
 * Run all G4 detectors over a client's multi-year history. Returns hits
 * sorted by estSavings descending. Empty array when fewer than 2 years are
 * available (no multi-year pattern can fire).
 */
export function evaluateMultiYearOpportunities(args: MultiYearPlanningInputs): OpportunityHit[] {
  if (args.history.length < 2) return [];
  const hits: OpportunityHit[] = [];

  const niit = detectPersistentNiit(args.history);
  if (niit) hits.push(niit);
  const amt = detectPersistentAmt(args.history);
  if (amt) hits.push(amt);
  const bunching = detectPersistentBunching(args.history);
  if (bunching) hits.push(bunching);
  const capLoss = detectCapitalLossCarryforwardUnused(args.history);
  if (capLoss) hits.push(capLoss);
  const pal = detectPassiveLossGrowing(args.history);
  if (pal) hits.push(pal);

  hits.sort((a, b) => b.estSavings - a.estSavings);
  return hits;
}
