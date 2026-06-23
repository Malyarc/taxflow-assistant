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
import type { WhatIfDelta, WhatIfMutation } from "@workspace/planning-strategies";

// Re-export the canonical types from `@workspace/planning-strategies` so other
// api-server modules can `import { WhatIfDelta, WhatIfMutation }` from
// whatIfEngine alongside the runner. The OpenAPI spec is the source of truth
// for these shapes; the definitions live in `@workspace/planning-strategies`
// because OpportunityHit on the API wire references them — putting them there
// avoids a circular dep between this module and planning-strategies.
export type { WhatIfDelta, WhatIfMutation };

// ── Mutations ──────────────────────────────────────────────────────────────

/**
 * The OpenAPI / planning-strategies `WhatIfMutation` is a flat object with
 * `kind` + optional `adjustmentType` / `amount` / `field` / `value`. We
 * validate per-kind required fields at the runtime boundary (the
 * `applyWhatIfMutations` switch + the route handler's coerceWhatIfMutations).
 *
 * Internal detectors construct strict mutations by passing all required
 * fields; the type system can't enforce per-kind requirements with the loose
 * shape, so we lean on tests + the switch to catch invalid combinations.
 */

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
 * `WhatIfDelta` shape is declared in `@workspace/planning-strategies` (and
 * re-exported above). It lives there because OpportunityHit carries it
 * across the API wire and would otherwise create a circular module dep.
 *
 * Per-field arithmetic delta (scenario − baseline). Positive on a tax field
 * means the scenario INCREASED that tax; negative = decreased.
 * `combinedTaxDelta` (federal + state liability delta) is the headline
 * planning number — negative = scenario reduces tax = savings.
 */

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

// ── Input DoS bounds (T0.2 C4, 2026-06-22 audit) ────────────────────────────
// The what-if endpoint accepted an UNBOUNDED `mutations` array with no per-
// mutation numeric/string caps. Each scenario re-runs the full pure engine, so
// a multi-thousand-element array (or pathological huge amounts/strings) is a CPU
// DoS vector. Bound it at the route seam (mirrors the SEC2 horizonYears cap).
export const WHATIF_LIMITS = {
  /** A hand-built scenario is a handful of levers; 100 is far above any real use. */
  maxMutations: 100,
  /** The engine clamps toNum at ±1e13; reject inputs an order of magnitude below that. */
  maxAbsAmount: 1e12,
  /** adjustmentType is a short enum-like key; field/value are short identifiers. */
  maxStringLen: 256,
} as const;

/**
 * Validate the size + per-element bounds of a client-supplied mutations array
 * BEFORE it reaches the engine. Throws a descriptive Error (→ HTTP 400) on any
 * violation. Pure; exported for unit testing.
 */
export function assertWhatIfInputBounds(
  raw: ReadonlyArray<{ kind?: string; adjustmentType?: string; amount?: number; field?: string; value?: unknown }>,
): void {
  if (raw.length > WHATIF_LIMITS.maxMutations) {
    throw new Error(`too many mutations: ${raw.length} (max ${WHATIF_LIMITS.maxMutations})`);
  }
  raw.forEach((m, i) => {
    if (m.amount != null && (!Number.isFinite(m.amount) || Math.abs(m.amount) > WHATIF_LIMITS.maxAbsAmount)) {
      throw new Error(
        `mutation[${i}] amount out of range (must be finite, |amount| ≤ ${WHATIF_LIMITS.maxAbsAmount})`,
      );
    }
    if (typeof m.adjustmentType === "string" && m.adjustmentType.length > WHATIF_LIMITS.maxStringLen) {
      throw new Error(`mutation[${i}] adjustmentType too long (max ${WHATIF_LIMITS.maxStringLen} chars)`);
    }
    if (typeof m.field === "string" && m.field.length > WHATIF_LIMITS.maxStringLen) {
      throw new Error(`mutation[${i}] field too long (max ${WHATIF_LIMITS.maxStringLen} chars)`);
    }
    if (typeof m.value === "string" && m.value.length > WHATIF_LIMITS.maxStringLen) {
      throw new Error(`mutation[${i}] value too long (max ${WHATIF_LIMITS.maxStringLen} chars)`);
    }
  });
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
        if (m.adjustmentType == null || m.amount == null) {
          throw new Error("set_adjustment requires adjustmentType + amount");
        }
        adjustments = adjustments.filter((a) => a.adjustmentType !== m.adjustmentType);
        adjustments.push({
          adjustmentType: m.adjustmentType,
          amount: String(m.amount),
          isApplied: true,
        } as AdjustmentFact);
        break;
      }
      case "add_adjustment": {
        if (m.adjustmentType == null || m.amount == null) {
          throw new Error("add_adjustment requires adjustmentType + amount");
        }
        adjustments.push({
          adjustmentType: m.adjustmentType,
          amount: String(m.amount),
          isApplied: true,
        } as AdjustmentFact);
        break;
      }
      case "remove_adjustment": {
        if (m.adjustmentType == null) {
          throw new Error("remove_adjustment requires adjustmentType");
        }
        adjustments = adjustments.filter((a) => a.adjustmentType !== m.adjustmentType);
        break;
      }
      case "set_client_field": {
        if (m.field == null) {
          throw new Error("set_client_field requires field");
        }
        const field = String(m.field);
        // SEC-03: set_client_field is meant to overwrite a known ClientFacts
        // key (filingStatus, state, taxpayerAge, …). Reject prototype-pollution
        // keys so an arbitrary client-supplied `field` can't reach the object
        // prototype chain.
        if (field === "__proto__" || field === "constructor" || field === "prototype") {
          throw new Error(`set_client_field: illegal field "${field}"`);
        }
        const c = ensureClientClone();
        c[field] = m.value ?? null;
        break;
      }
      default: {
        throw new Error(
          `whatIfEngine: unsupported mutation kind ${(m as { kind?: string }).kind}`,
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
