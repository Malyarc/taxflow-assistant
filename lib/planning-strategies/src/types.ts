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
  | "credits"
  | "estate";

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
 * H3 — Multi-year scenario projection attached to an OpportunityHit by
 * detectors whose value only materializes across multiple years
 * (G1.3 bunching, G1.8 DAF, G1.4 Roth conversion long-term). The frontend
 * renders this as a per-year burden trajectory + headline `totalSavings`.
 *
 * Sign convention: `totalSavings` is POSITIVE when the scenario reduces
 * combined (fed + state) tax over the projection window. This is the
 * opposite of `OpportunityWhatIf.delta.combinedTaxDelta` (where negative
 * = savings), because the multi-year card always presents a "savings"
 * number to the CPA and dual-sign semantics are confusing in a per-year
 * table.
 */
export interface OpportunityMultiYear {
  /** Horizon (inclusive of year 0). Typical: 2 (bunching), 3 (DAF), 5 (Roth). */
  horizonYears: number;
  /** Combined (fed + state) tax per year for the baseline trajectory. */
  baselineYearTax: number[];
  /** Combined (fed + state) tax per year for the scenario trajectory. */
  scenarioYearTax: number[];
  /** Per-year scenario−baseline delta. Negative = scenario saves that year. */
  yearByYearDelta: number[];
  /**
   * Multi-year savings = −sum(yearByYearDelta). POSITIVE = scenario saves
   * tax over the window; NEGATIVE = costs more. The headline planning
   * number for multi-year strategies.
   */
  totalSavings: number;
  /** Income growth factor used (1.03 = 3%/year). */
  growthAssumption: number;
  /**
   * Strategy-specific multi-year assumptions (distinct from the
   * single-year `assumptions`). Examples:
   *   - "Modeled as a 2-year alternating cycle (year 0 bunched, year 1 off)"
   *   - "Year-5 projected RMD added to baseline at 7% growth"
   *   - "Income scaled at 3%/year compound"
   */
  multiYearAssumptions: string[];
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
  /**
   * H3 — Multi-year projection for strategies whose value only
   * materializes across multiple years (bunching, DAF front-loading,
   * Roth conversion long-term). Present on G1.3 / G1.8 / G1.4 when
   * baselineInputs are provided to the planning engine.
   */
  multiYear?: OpportunityMultiYear;
  /**
   * PLAN-Q1 — provenance of the headline savings. "engine-verified" = the hit
   * carries a real engine-computed what-if delta (`verifiedSavings`, also the
   * ranking number); "estimate" = a heuristic single-multiplier approximation
   * (`estSavings` only). Set by `annotateVerifiedSavings()` after detection.
   */
  savingsSource?: "engine-verified" | "estimate";
  /**
   * PLAN-Q1 — the engine-verified current-year savings, |whatIf refund delta|,
   * present iff savingsSource === "engine-verified". The hit-list sort + the
   * firm-wide planningScore rank on this (via `headlineSavings`) when present.
   * `estSavings` is left intact so both numbers + the source travel on the hit.
   */
  verifiedSavings?: number;
  /**
   * T1.3 — Deadline-aware planning calendar. The actionable deadline for this
   * strategy given the return's tax year (when the action must be COMPLETED to
   * affect this year's tax). Attached by the planning engine post-detection.
   */
  deadline?: StrategyDeadline;
}

/**
 * T1.3 — When a planning action must be completed to affect a given tax year.
 *   - "year_end"          — must act by Dec 31 of the tax year (Roth conversion,
 *                           tax-loss harvesting, QCD, DAF, gifting, RMD, 401(k)
 *                           employee deferral).
 *   - "filing_deadline"   — by the unextended return due date, ~Apr 15 of the
 *                           NEXT year (IRA/HSA contributions, backdoor Roth).
 *   - "extended_due_date" — by the extended due date, ~Oct 15 of the next year
 *                           (SEP-IRA, Solo-401(k) employer contribution, DB plan).
 *   - "quarterly"         — recurring estimated-tax dates (safe-harbor planning).
 *   - "ongoing"           — structural, no single hard deadline (entity choice,
 *                           state-residency, multi-year structural moves).
 */
export type DeadlineType =
  | "year_end"
  | "filing_deadline"
  | "extended_due_date"
  | "quarterly"
  | "ongoing";

export interface StrategyDeadline {
  type: DeadlineType;
  /** ISO date (YYYY-MM-DD) the action is due, or null for "ongoing". */
  isoDate: string | null;
  /** Human-readable label, e.g. "December 31, 2024". */
  label: string;
  /**
   * Deterministic ordering key — days from Dec 31 of the tax year to the
   * deadline (year_end = 0; filing ≈ 105; extended ≈ 288). Sorts the calendar
   * soonest-first without reading the wall clock (keeps the engine pure).
   */
  daysFromYearEnd: number;
}
