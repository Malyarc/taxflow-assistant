/**
 * Tax Planning strategy catalog — Layer 1 (curated, versioned knowledge base).
 *
 * Each entry describes ONE opportunity the deterministic detection engine
 * (planningEngine.ts, Layer 2) can fire on a client. The catalog itself is
 * dumb data; all detection logic lives in the planning engine.
 *
 * Architectural invariant: the LLM never reads from this file. It only
 * narrates structured OpportunityHit[] produced by the engine.
 */

export type StrategyCategory =
  | "retirement"
  | "state"
  | "charitable"
  | "timing"
  | "business"
  | "investment"
  | "credits";

/**
 * One strategy entry. `id` is stable forever; the math is implemented by a
 * matching detector function in planningEngine.ts. Bumping `formulaRev` flags
 * a behavior change for the audit log.
 */
export interface PlanningStrategy {
  /** Stable identifier. e.g. "G1.1". Engine keys detectors off this. */
  id: string;
  /** Human label for the UI card. */
  name: string;
  category: StrategyCategory;
  /** IRC section reference (display + audit). e.g. "IRC §408(k)". */
  ircSection: string;
  /** IRS publication / form. e.g. "Pub 560 (TY2024 max $69k)". */
  irsPub: string;
  /**
   * High-level machine-readable trigger description. NOT evaluated at runtime
   * — the detector function carries the real trigger. This string is the
   * audit-log-friendly summary for CPAs reviewing the rule catalog.
   */
  trigger: string;
  /**
   * Plain-English summary of the savings formula. Display + audit only.
   * The detector function computes the actual estSavings.
   */
  formula: string;
  /** Engine confidence [0, 1]. Used by Layer 3 scoring. */
  confidence: number;
  /** Estimated CPA hours to deliver this engagement (for pricing). */
  cpaEffortHours: number;
  /** Whether this opportunity recurs annually (stickier upsell). */
  recurring: boolean;
  /**
   * Tax-year date past which this catalog entry stops being authoritative.
   * Format YYYY-MM-DD. Detection engine refuses to fire past this date.
   */
  validUntil: string;
  /** Field names the CPA still needs to gather from the client. */
  prerequisiteData: string[];
  /**
   * Action template — what the CPA does. Becomes the body of the opportunity
   * card and feeds the LLM memo prompt. May reference {{placeholders}} the
   * detector fills in.
   */
  action: string;
  /** Revision counter for the formula. Bump when math changes. */
  formulaRev: number;
}

/** Catalog version metadata. */
export interface PlanningStrategyCatalog {
  version: string;
  /** ISO date the catalog was last reviewed by a CPA. */
  reviewedAt: string;
  strategies: PlanningStrategy[];
}

/**
 * H2 — Engine-verified per-field delta (scenario − baseline) for a tax
 * planning what-if scenario. Same shape as the delta returned by the
 * POST /clients/{id}/what-if endpoint; documented in OpenAPI.
 *
 * `combinedTaxDelta` is the headline planning number (federal + state
 * tax liability delta). NEGATIVE = scenario reduces tax = savings;
 * POSITIVE = scenario increases tax = cost (e.g., a Roth conversion
 * adds taxable income today in exchange for long-term benefit).
 */
export interface WhatIfDelta {
  adjustedGrossIncome: number;
  taxableIncome: number;
  standardDeduction: number;
  itemizedDeductions: number;
  qbiDeduction: number;
  federalTaxLiability: number;
  stateTaxLiability: number;
  selfEmploymentTax: number;
  niitTax: number;
  amtTax: number;
  additionalMedicareTax: number;
  eitc: number;
  additionalChildTaxCredit: number;
  federalRefundOrOwed: number;
  stateRefundOrOwed: number;
  effectiveTaxRate: number;
  /** Federal + state tax liability delta. Negative = savings. */
  combinedTaxDelta: number;
  /** Federal + state refund delta. Positive = larger combined refund. */
  combinedRefundDelta: number;
}

/**
 * H2 — One mutation applied to the baseline TaxReturnInputs to model a
 * planning strategy. Discriminated by `kind`. Mirrors the OpenAPI
 * WhatIfMutation schema.
 */
export interface WhatIfMutation {
  kind: "set_adjustment" | "add_adjustment" | "remove_adjustment" | "set_client_field";
  adjustmentType?: string;
  amount?: number;
  field?: string;
  value?: unknown;
}

/**
 * H12 — Sensitivity range from running the strategy's mutation at ±10%
 * of the recommended amount. Useful for variable-amount strategies (SEP
 * contribution, Roth conversion, NIIT defer amount). All values are
 * `|combinedTaxDelta|` rounded to whole dollars.
 *
 * Fixed-amount strategies (TLH $3k cap, FTC unclaimed-fixed-gap) omit
 * this field — the result wouldn't vary meaningfully.
 */
export interface WhatIfSensitivity {
  /** Result at 90% of the recommended mutation amount. */
  low: number;
  /** Result at 100% (the recommended amount). Matches |whatIf.delta.combinedTaxDelta|. */
  mid: number;
  /** Result at 110% of the recommended mutation amount. */
  high: number;
}

/**
 * H2 + H12 — Engine-verified data attached to an OpportunityHit by
 * detectors that have a clean single-year mutation model. The frontend
 * shows the delta as the headline number when `semantics === "savings"`
 * and as a "current-year cost" sub-callout when `semantics === "cost"`.
 *
 * Absent on detectors with no clean single-year mutation (e.g.,
 * G1.3 bunching, G1.8 DAF — multi-year strategies; G1.7 §199A
 * wage/UBIA — engine doesn't model the limit yet).
 */
export interface OpportunityWhatIf {
  /** Exact mutations the engine ran. Transparent for audit. */
  mutations: WhatIfMutation[];
  /** Per-field scenario−baseline delta from the pure engine. */
  delta: WhatIfDelta;
  /**
   * Whether `delta.combinedTaxDelta` represents the strategy's *savings*
   * (negative = good for the client) or its *current-year cost*
   * (positive = the price of doing the strategy, which has a long-term
   * benefit captured in `OpportunityHit.estSavings`).
   *
   * - "savings": SEP / NIIT / TLH / FTC / AMT-ISO. Headline shows
   *   `|delta.combinedTaxDelta|` in emerald.
   * - "cost": Roth conversion. Headline stays on `estSavings` (the
   *   heuristic long-term benefit); delta is shown as a clearly-labeled
   *   "current-year tax cost" sub-callout.
   */
  semantics: "savings" | "cost";
  /** H12 — ±10% sensitivity range. Omitted for fixed-amount strategies. */
  sensitivity?: WhatIfSensitivity;
}

/**
 * One detected opportunity for a specific client. Produced by Layer 2
 * (deterministic detection engine). Consumed by Layer 3 (scoring),
 * Layer 4 (LLM memo), and the frontend Planning tab.
 */
export interface OpportunityHit {
  /** Matches PlanningStrategy.id. */
  strategyId: string;
  name: string;
  category: StrategyCategory;
  /** Estimated tax savings in dollars. Deterministic — never LLM-derived. */
  estSavings: number;
  confidence: number;
  cpaEffortHours: number;
  recurring: boolean;
  /**
   * One-sentence specifics for this client, e.g.
   * "Net SE $80,000 supports a SEP-IRA contribution of ~$14,873".
   */
  rationale: string;
  /** What the CPA does next. */
  action: string;
  /** Field names still required from the client. */
  prerequisiteData: string[];
  /** IRS citation for the audit log + memo footer. */
  citation: string;
  /** Detector-supplied diagnostic numbers (transparent to CPA review). */
  inputs: Record<string, number | string | boolean | null>;
  /**
   * H12 — Plain-English assumptions / approximations the detector made
   * when computing this opportunity. Each entry is one short statement.
   * Rendered as a bulleted "Assumptions" section under the opportunity
   * card so CPAs can audit the math.
   *
   * Examples:
   *  - "TY2024 §415(c) annual additions cap $69,000 per Notice 2023-75"
   *  - "Future marginal rate assumed at 32% (Phase G plan baseline)"
   *  - "Mutation: cap-loss carryforward of $3,000 (IRC §1211 annual cap)"
   */
  assumptions?: string[];
  /**
   * H2 + H12 — Engine-verified what-if data when the detector has a
   * clean single-year mutation. Replaces the deprecated `whatIfDelta`
   * field with a unified `{ mutations, delta, semantics, sensitivity? }`
   * shape. Absent for detectors with no clean mutation.
   */
  whatIf?: OpportunityWhatIf;
}
