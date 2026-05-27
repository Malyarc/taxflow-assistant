/**
 * H2 — What-if scenario engine.
 *
 * Generalizes the C4 amendment-diff pattern. Given a TaxReturnInputs (the
 * same shape `computeTaxReturnPure` accepts) and a list of mutations
 * describing a tax-planning strategy ("add a $20k SEP contribution",
 * "convert $50k Trad→Roth", "elect PTET"), re-runs the pure engine and
 * reports the actual federal + state tax delta.
 *
 * Architecture:
 *   - Pure. No DB, no LLM, no I/O. Same engine the persisted return uses.
 *   - Inputs are NOT mutated. Mutations apply to a copy.
 *   - Foundation primitive for Phase H planning quantification — each G1
 *     detector can now emit an actual delta-dollar value instead of a
 *     heuristic estimate.
 *
 * Wiring into a detector (planningEngine.ts):
 *   1. Detector decides the strategy fires (same logic as today).
 *   2. Detector constructs a WhatIfScenario describing the mutation
 *      (e.g., add a self_employed_retirement adjustment of $14,800).
 *   3. Engine runs the scenario → attaches whatIfDelta to OpportunityHit.
 *   4. Frontend shows actual federal+state delta on the card.
 *
 * Composability: a scenario can stack multiple mutations. PTET is "remove
 * the SALT itemized deduction AND add the PTE entity-level tax credit" —
 * two mutations in one scenario.
 */

import {
  computeTaxReturnPure,
  type ComputedTaxReturn,
  type TaxReturnInputs,
  type ClientFacts,
  type AdjustmentFact,
} from "./taxReturnEngine";

// ── Mutations ──────────────────────────────────────────────────────────────

/**
 * A single change to apply to the baseline inputs. Discriminated by `kind`.
 *
 * Invariant: add new kinds at the bottom; never repurpose an existing kind.
 * Doing so would invalidate any historical scenario records (and frontend
 * exhaustiveness checks).
 */
export type WhatIfMutation =
  | {
      /** Replace ALL existing adjustments of this type with a single new entry. */
      kind: "set_adjustment";
      adjustmentType: string;
      amount: number;
    }
  | {
      /** Add a new adjustment row alongside existing ones (engine sums them). */
      kind: "add_adjustment";
      adjustmentType: string;
      amount: number;
    }
  | {
      /** Remove every adjustment of this type. */
      kind: "remove_adjustment";
      adjustmentType: string;
    }
  | {
      /** Override a top-level field on ClientFacts (e.g., filingStatus). */
      kind: "set_client_field";
      field: keyof ClientFacts;
      value: unknown;
    };

/**
 * A scenario — a labeled set of mutations describing one planning strategy.
 *
 * `scenarioId` is optional; callers that want a stable identifier (e.g.
 * "G1.1-sep") can set it to correlate results across runs.
 */
export interface WhatIfScenario {
  scenarioId?: string;
  label: string;
  mutations: WhatIfMutation[];
}

// ── Delta + result ─────────────────────────────────────────────────────────

/**
 * Per-field arithmetic delta (scenario − baseline). Positive on a tax field
 * means the scenario INCREASED that tax. Negative = decreased.
 *
 * `combinedTaxDelta` is the headline planning number: federal + state tax
 * liability delta. Negative = scenario reduces tax = savings.
 */
export interface WhatIfDelta {
  // Income / deduction
  adjustedGrossIncome: number;
  taxableIncome: number;
  standardDeduction: number;
  itemizedDeductions: number;
  qbiDeduction: number;

  // Tax components
  federalTaxLiability: number;
  stateTaxLiability: number;
  selfEmploymentTax: number;
  niitTax: number;
  amtTax: number;
  additionalMedicareTax: number;

  // Refundable credits (additive to refund)
  eitc: number;
  additionalChildTaxCredit: number;

  // Refund / owed (positive = larger refund or smaller owed)
  federalRefundOrOwed: number;
  stateRefundOrOwed: number;
  effectiveTaxRate: number;

  // Aggregates
  /** Federal + state tax liability delta. Negative = savings. */
  combinedTaxDelta: number;
  /** Federal + state refund/owed delta. Positive = larger combined refund. */
  combinedRefundDelta: number;
}

/**
 * Full result of running one scenario against a baseline. Includes both
 * computed returns so callers can render a side-by-side 1040 view if they
 * want, plus the headline delta for the common case.
 */
export interface WhatIfResult {
  scenarioId: string | null;
  label: string;
  mutations: WhatIfMutation[];
  baseline: ComputedTaxReturn;
  scenario: ComputedTaxReturn;
  delta: WhatIfDelta;
}

// ── Mutation application ───────────────────────────────────────────────────

function cloneAdjustments(rows: AdjustmentFact[]): AdjustmentFact[] {
  return rows.map((a) => ({ ...a }));
}

/**
 * Apply a list of mutations to baseline inputs. Returns a new TaxReturnInputs;
 * the baseline argument is not mutated (tests rely on this).
 */
export function applyWhatIfMutations(
  baseline: TaxReturnInputs,
  mutations: readonly WhatIfMutation[],
): TaxReturnInputs {
  let adjustments = cloneAdjustments(baseline.adjustments);
  let client: ClientFacts = baseline.client;
  let clientCloned = false;
  const ensureClientClone = (): Record<string, unknown> => {
    if (!clientCloned) {
      client = { ...baseline.client };
      clientCloned = true;
    }
    return client as unknown as Record<string, unknown>;
  };

  for (const m of mutations) {
    switch (m.kind) {
      case "set_adjustment": {
        adjustments = adjustments.filter((a) => a.adjustmentType !== m.adjustmentType);
        adjustments.push({
          adjustmentType: m.adjustmentType,
          amount: String(m.amount),
          isApplied: true,
        } as AdjustmentFact);
        break;
      }
      case "add_adjustment": {
        adjustments.push({
          adjustmentType: m.adjustmentType,
          amount: String(m.amount),
          isApplied: true,
        } as AdjustmentFact);
        break;
      }
      case "remove_adjustment": {
        adjustments = adjustments.filter((a) => a.adjustmentType !== m.adjustmentType);
        break;
      }
      case "set_client_field": {
        const c = ensureClientClone();
        c[String(m.field)] = m.value;
        break;
      }
      default: {
        const exhaustive: never = m;
        throw new Error(
          `whatIfEngine: unsupported mutation kind ${(exhaustive as { kind?: string }).kind}`,
        );
      }
    }
  }

  return {
    ...baseline,
    adjustments,
    client,
  };
}

// ── Delta computation ──────────────────────────────────────────────────────

const toNum = (v: number | null | undefined): number =>
  v == null || !Number.isFinite(v) ? 0 : v;

/**
 * Pure diff of two computed returns. Field-level subtraction (scenario −
 * baseline). Itemized deduction may be null when std-ded was chosen — null
 * coerces to 0 for the diff.
 */
export function computeWhatIfDelta(
  baseline: ComputedTaxReturn,
  scenario: ComputedTaxReturn,
): WhatIfDelta {
  const d = (key: keyof ComputedTaxReturn): number =>
    toNum(scenario[key] as number) - toNum(baseline[key] as number);

  const itemizedBaseline = toNum(baseline.itemizedDeductions as number | null);
  const itemizedScenario = toNum(scenario.itemizedDeductions as number | null);

  const federalTaxLiability = d("federalTaxLiability");
  const stateTaxLiability = d("stateTaxLiability");
  const federalRefundOrOwed = d("federalRefundOrOwed");
  const stateRefundOrOwed = d("stateRefundOrOwed");

  return {
    adjustedGrossIncome: d("adjustedGrossIncome"),
    taxableIncome: d("taxableIncome"),
    standardDeduction: d("standardDeduction"),
    itemizedDeductions: itemizedScenario - itemizedBaseline,
    qbiDeduction: d("qbiDeduction"),
    federalTaxLiability,
    stateTaxLiability,
    selfEmploymentTax: d("selfEmploymentTax"),
    niitTax: d("niitTax"),
    amtTax: d("amtTax"),
    additionalMedicareTax: d("additionalMedicareTax"),
    eitc: d("eitc"),
    additionalChildTaxCredit: d("additionalChildTaxCredit"),
    federalRefundOrOwed,
    stateRefundOrOwed,
    effectiveTaxRate: d("effectiveTaxRate"),
    combinedTaxDelta: federalTaxLiability + stateTaxLiability,
    combinedRefundDelta: federalRefundOrOwed + stateRefundOrOwed,
  };
}

// ── Top-level scenario runners ─────────────────────────────────────────────

/**
 * Run a single what-if scenario. Computes both baseline and scenario from
 * the supplied inputs. For batch use against the same baseline, prefer
 * `runWhatIfScenarios` to share the baseline computation.
 */
export function runWhatIfScenario(
  baseline: TaxReturnInputs,
  scenario: WhatIfScenario,
): WhatIfResult {
  const baselineComputed = computeTaxReturnPure(baseline);
  const mutatedInputs = applyWhatIfMutations(baseline, scenario.mutations);
  const scenarioComputed = computeTaxReturnPure(mutatedInputs);
  return {
    scenarioId: scenario.scenarioId ?? null,
    label: scenario.label,
    mutations: scenario.mutations,
    baseline: baselineComputed,
    scenario: scenarioComputed,
    delta: computeWhatIfDelta(baselineComputed, scenarioComputed),
  };
}

/**
 * Run multiple what-if scenarios against a single baseline. The baseline is
 * computed once and re-used; each scenario runs the engine on its own
 * mutated inputs.
 */
export function runWhatIfScenarios(
  baseline: TaxReturnInputs,
  scenarios: readonly WhatIfScenario[],
): WhatIfResult[] {
  const baselineComputed = computeTaxReturnPure(baseline);
  return scenarios.map((s) => {
    const mutatedInputs = applyWhatIfMutations(baseline, s.mutations);
    const scenarioComputed = computeTaxReturnPure(mutatedInputs);
    return {
      scenarioId: s.scenarioId ?? null,
      label: s.label,
      mutations: s.mutations,
      baseline: baselineComputed,
      scenario: scenarioComputed,
      delta: computeWhatIfDelta(baselineComputed, scenarioComputed),
    };
  });
}
