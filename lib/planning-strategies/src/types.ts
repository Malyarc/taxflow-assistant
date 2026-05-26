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
}
