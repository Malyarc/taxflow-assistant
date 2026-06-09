// ───────────────────────────────────────────────────────────────────────────
// State individual health-coverage mandate penalty (T1.1c)
//
// Five jurisdictions impose a state-level "shared responsibility payment" on
// residents who lack minimum essential coverage (MEC): CA, NJ, RI, DC (the
// post-2018-federal "greater-of-flat-or-percentage, capped at the statewide
// average bronze premium" model) and MA (its own pre-ACA FPL-tier model).
//
// Pure module (no Date/random/DB) — part of the Haven migration seam.
//
// Primary sources (TY2024 unless noted):
//   • CA — FTB Form 3853 + 2024 Instructions: flat $900/adult + $450/child
//     (max 3× adult = $2,700), or 2.5% of income over the CA filing threshold;
//     capped at the avg bronze premium ($348/mo/person for 2024). Prorated by
//     uninsured months.
//   • NJ — N.J.S.A. 54A:11; NJ Treasury SRP: the FROZEN 2018 federal amounts —
//     $695/adult + $347.50/child (max $2,085), or 2.5% over the NJ gross-income
//     filing threshold ($10k single/MFS, $20k others); capped at avg bronze.
//   • RI — R.I. Gen. Laws §44-30-101; DC — D.C. Code §47-5102 (Schedule HSR):
//     both adopt the frozen 2018 federal methodology (same $695/$347.50/2.5%).
//   • MA — G.L. c. 111M; DOR TIR 24-1 / Schedule HC: NO penalty ≤150% FPL; for
//     150.1%+ FPL, a per-ADULT monthly amount = ½ the lowest-cost ConnectorCare
//     (or, >500% FPL, bronze) premium for the income tier. 2023 amounts are
//     CONFIRMED; 2024/2025 are PROVISIONAL pending the annual TIR (see table).
//
// Scope notes (documented sub-gaps): the penalty assumes the whole tax household
// is uninsured for `monthsUninsured` months (per-person partial-year coverage is
// the CPA's refinement). The CA filing threshold varies by household size/age —
// the engine passes a documented proxy; a CPA can override. The bronze cap is a
// high ceiling that rarely binds below the top income decile.
// ───────────────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** The five jurisdictions with an active individual mandate (TY2024). */
export const STATES_WITH_INDIVIDUAL_MANDATE = new Set(["CA", "NJ", "RI", "DC", "MA"]);

interface GreaterOfParams {
  adultFlat: number;
  childFlat: number;
  /** Max flat amount (= 3× the adult flat per the federal cap). */
  flatMax: number;
  /** Percentage-of-income rate (2.5% everywhere). */
  pct: number;
  /** Statewide average bronze premium, per person per MONTH (annual cap = ×12×people). */
  bronzeMonthlyPerPerson: number;
}

// CA indexes annually (FTB Pub 3853); NJ/RI/DC froze the 2018 federal dollars.
// Keyed by the latest CONFIRMED value (held flat across years unless a newer
// confirmed figure is seeded). Bronze monthly figures are documented statewide
// averages and act as a high ceiling.
const GREATER_OF_PARAMS: Record<string, GreaterOfParams> = {
  // CA 2024 (FTB 3853): $900/$450, max $2,700, 2.5%, bronze $348/mo/person.
  CA: { adultFlat: 900, childFlat: 450, flatMax: 2700, pct: 0.025, bronzeMonthlyPerPerson: 348 },
  // NJ/RI/DC: frozen 2018 federal $695/$347.50, max $2,085, 2.5%.
  NJ: { adultFlat: 695, childFlat: 347.5, flatMax: 2085, pct: 0.025, bronzeMonthlyPerPerson: 361 },
  RI: { adultFlat: 695, childFlat: 347.5, flatMax: 2085, pct: 0.025, bronzeMonthlyPerPerson: 339 },
  DC: { adultFlat: 695, childFlat: 347.5, flatMax: 2085, pct: 0.025, bronzeMonthlyPerPerson: 379 },
};

// MA — per-ADULT monthly penalty by income tier (% of FPL). 150% or below → $0.
// 2023 amounts CONFIRMED (Mercer/DOR TIR 22-17). 2024/2025 PROVISIONAL — the
// FY2024 budget expanded ConnectorCare to 500% FPL; confirm the dollar amounts
// against the annual MA DOR TIR 24-1/25-1 before relying on them. Tests assert
// only the confirmed 2023 schedule.
const MA_TIERS_2023: ReadonlyArray<{ maxFplPct: number; monthly: number }> = [
  { maxFplPct: 150, monthly: 0 },
  { maxFplPct: 200, monthly: 24 },
  { maxFplPct: 250, monthly: 46 },
  { maxFplPct: 300, monthly: 68 },
  { maxFplPct: Infinity, monthly: 183 },
];
// 2024/2025 are PROVISIONAL — they REUSE the confirmed 2023 schedule as a single
// shared array (so an editor can't update one year and miss the others). REPLACE
// with the published MA DOR TIR 24-1/25-1 amounts (give each its own array) once
// verified. Tests assert only the confirmed 2023 schedule.
const MA_PENALTY_TIERS_BY_YEAR: Record<number, ReadonlyArray<{ maxFplPct: number; monthly: number }>> = {
  2023: MA_TIERS_2023,
  2024: MA_TIERS_2023,
  2025: MA_TIERS_2023,
};

export interface StateMandateParams {
  /** 2-letter resident state code. */
  state: string;
  filingStatus: string;
  /** Uninsured adults (18+) in the tax household (e.g. 1 single, 2 MFJ both uninsured). */
  uninsuredAdults: number;
  /** Uninsured dependent children (<18). */
  uninsuredChildren: number;
  /** Household income for the percentage method (≈ state AGI). */
  householdIncome: number;
  /** The applicable income filing threshold for the percentage method. */
  filingThreshold: number;
  /** Months without minimum essential coverage (0–12). */
  monthsUninsured: number;
  taxYear: number;
  /** MA only — tax-household size, for the income-vs-FPL tier lookup. */
  householdSize?: number;
  /** Optional override of the annual bronze-premium cap (CA/NJ/RI/DC). */
  bronzeAnnualCapOverride?: number;
}

// HHS Federal Poverty Guidelines for the 48 contiguous states + DC (MA is
// contiguous). MA uses the guidelines in effect on Jan 1 of the coverage year.
const FPL_GUIDELINE_BY_YEAR: Record<number, { base: number; perAdditional: number }> = {
  2023: { base: 14580, perAdditional: 5140 },
  2024: { base: 15060, perAdditional: 5380 },
  2025: { base: 15650, perAdditional: 5500 },
};

function householdFplPercent(income: number, householdSize: number, taxYear: number): number {
  const g = FPL_GUIDELINE_BY_YEAR[taxYear] ?? FPL_GUIDELINE_BY_YEAR[2024];
  const size = Math.max(1, Math.round(householdSize || 1));
  const fpl = g.base + g.perAdditional * (size - 1);
  return fpl > 0 ? (Math.max(0, income) / fpl) * 100 : 0;
}

export interface StateMandateResult {
  penalty: number;
  state: string;
  method: "flat" | "percentage" | "bronze_cap" | "fpl_tier" | "none";
  flatAmount: number;
  percentageAmount: number;
  bronzeCapAmount: number;
  monthsUninsured: number;
}

const NONE = (state: string): StateMandateResult => ({
  penalty: 0, state, method: "none", flatAmount: 0,
  percentageAmount: 0, bronzeCapAmount: 0, monthsUninsured: 0,
});

/**
 * Compute the state individual-mandate (shared-responsibility) penalty for a
 * resident. Returns a zeroed result for any non-mandate state, full coverage,
 * or no uninsured persons.
 */
export function calculateStateIndividualMandatePenalty(p: StateMandateParams): StateMandateResult {
  const state = (p.state ?? "").toUpperCase().trim();
  const months = Math.max(0, Math.min(12, Math.round(num(p.monthsUninsured))));
  const adults = Math.max(0, Math.round(num(p.uninsuredAdults)));
  const children = Math.max(0, Math.round(num(p.uninsuredChildren)));
  if (!STATES_WITH_INDIVIDUAL_MANDATE.has(state) || months <= 0 || adults + children <= 0) {
    return NONE(state);
  }

  // ── MA — FPL-tier monthly model (per adult; children are not penalized) ──
  if (state === "MA") {
    const tiers = MA_PENALTY_TIERS_BY_YEAR[p.taxYear] ?? MA_PENALTY_TIERS_BY_YEAR[2023];
    const fplPct = householdFplPercent(num(p.householdIncome), num(p.householdSize) || adults + children, p.taxYear);
    if (fplPct <= 150) return { ...NONE(state), method: "fpl_tier" };
    const monthly = (tiers.find((t) => fplPct <= t.maxFplPct) ?? tiers[tiers.length - 1]).monthly;
    const penalty = round2(adults * monthly * months);
    return {
      penalty, state, method: "fpl_tier",
      flatAmount: 0, percentageAmount: 0, bronzeCapAmount: 0, monthsUninsured: months,
    };
  }

  // ── CA / NJ / RI / DC — greater-of(flat, percentage), capped at bronze ──
  const cfg = GREATER_OF_PARAMS[state];
  if (!cfg) return NONE(state);
  const flatAnnual = Math.min(cfg.flatMax, adults * cfg.adultFlat + children * cfg.childFlat);
  const pctAnnual = Math.max(0, num(p.householdIncome) - num(p.filingThreshold)) * cfg.pct;
  const people = adults + children;
  const bronzeAnnual =
    p.bronzeAnnualCapOverride != null && p.bronzeAnnualCapOverride > 0
      ? p.bronzeAnnualCapOverride
      : cfg.bronzeMonthlyPerPerson * 12 * people;

  const greaterOf = Math.max(flatAnnual, pctAnnual);
  const cappedAnnual = Math.min(greaterOf, bronzeAnnual);
  const penalty = round2(cappedAnnual * (months / 12));

  return {
    penalty,
    state,
    // Report what actually DROVE the number: the bronze cap when it binds (or
    // ties the greater-of), else the greater of the flat / percentage method.
    method: bronzeAnnual <= greaterOf ? "bronze_cap" : pctAnnual > flatAnnual ? "percentage" : "flat",
    flatAmount: round2(flatAnnual * (months / 12)),
    percentageAmount: round2(pctAnnual * (months / 12)),
    bronzeCapAmount: round2(bronzeAnnual * (months / 12)),
    monthsUninsured: months,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
