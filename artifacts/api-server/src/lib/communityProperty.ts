/**
 * T1.5 #6 — community-property income splitting for MFS (Form 8958).
 *
 * In the 9 community-property states, MFS spouses each report HALF of all
 * COMMUNITY income regardless of who earned it — not the "whoever earned it"
 * attribution that governs common-law states. This makes the MFJ-vs-MFS
 * optimizer legally correct there: a one-earner couple's MFS halves are two
 * equal lower-bracket returns, not one high-bracket + one empty return.
 *
 * SAFE-HALVING (post-/code-review): split only EXPLICIT DOLLAR fields on W-2 and
 * 1099 records — NEVER a blanket "halve every number". A blanket halve corrupted
 * non-dollar fields: 1099-R `distributionCode` ("1" → "0.5" dropped the §72(t)
 * penalty) and the polymorphic `AdjustmentFact.amount` (months / percentages /
 * codes for `months_without_minimum_coverage`, `ca_renter_months`,
 * `qsbs_exclusion_pct`, …). So:
 *   - W-2 / 1099: halve the enumerated dollar fields only.
 *   - ADJUSTMENTS: NOT community-split here (amount is polymorphic); they retain
 *     tag attribution — the CPA refines community adjustments via Form 8958.
 *   - Per-property facts (rentals / K-1 / capital transactions): not split here
 *     either (non-dollar fields: percentages, quantities, dates); they stay on
 *     the primary half — a documented Form 8958 refinement (a bigger caveat in a
 *     community state, surfaced in the optimizer's notes).
 *
 * The dominant community income (W-2 wages + 1099 SE/interest/dividends/gains) IS
 * split 50/50 — the core correctness fix. PURE + framework-free (Haven-portable).
 */
import type { TaxReturnInputs } from "./taxReturnEngine";

/** The 9 community-property states (AZ, CA, ID, LA, NV, NM, TX, WA, WI). */
export const COMMUNITY_PROPERTY_STATES: ReadonlySet<string> = new Set([
  "AZ", "CA", "ID", "LA", "NV", "NM", "TX", "WA", "WI",
]);

export function isCommunityPropertyState(state: string | null | undefined): boolean {
  return !!state && COMMUNITY_PROPERTY_STATES.has(state.toUpperCase());
}

/** W-2 scalar DOLLAR boxes (every other scalar is taxYear/string/array/bool). */
const W2_DOLLAR_FIELDS = [
  "wagesBox1", "federalTaxWithheldBox2", "socialSecurityWagesBox3", "socialSecurityTaxBox4",
  "medicareWagesBox5", "medicareTaxBox6", "stateTaxWithheldBox17",
  "box18LocalWages", "box19LocalIncomeTax", "box10DependentCare", "allocatedTips",
] as const;

/** 1099 DOLLAR fields — explicitly EXCLUDES distributionCode / formType / names.
 *  `nonemployeeCompensation` (1099-NEC) IS halved: in the MFS optimizer's
 *  community path each spouse receives the SAME halved array (filingStatusOptimizer
 *  `pick`), so the 50/50 Form 8958 split is achieved ENTIRELY by halving — removing
 *  a field from this list would make the FULL amount land on BOTH spouses
 *  (double-count). DOCUMENTED SUB-GAP (audit 2026-06-23): for SE-tax, §1402(a)(5)(A)
 *  attributes community trade/business income 100% to the spouse who carries it on
 *  (NOT 50/50 on Schedule SE), so halving the NEC slightly over-states the
 *  optimizer's SE tax when community SE income EXCEEDS the SS wage base (two
 *  half-bases capture more than one full base) — an advisory-tool imprecision that
 *  biases toward MFJ. A faithful fix needs per-spouse SE attribution the
 *  give-same-halved-array mechanism can't express; tracked, not yet built. */
const F1099_DOLLAR_FIELDS = [
  "nonemployeeCompensation", "interestIncome", "usTreasuryInterest", "taxExemptInterest",
  "earlyWithdrawalPenalty", "ordinaryDividends", "qualifiedDividends", "totalCapitalGainDistribution",
  "shortTermGainLoss", "longTermGainLoss", "taxableAmount", "grossDistribution",
  "unemploymentCompensation", "stateLocalRefund", "grossPaymentAmount", "rents", "royalties",
  "otherIncome", "fishingBoatProceeds", "medicalAndHealthcare", "federalTaxWithheld", "stateTaxWithheld",
] as const;

/** Halve a value that is a number or a pure-numeric string; keep its type. */
function halveValue(v: unknown): unknown {
  if (typeof v === "number") return v / 2;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return String(Number(v) / 2);
  return v;
}

/** Return a copy of `rec` with ONLY the allow-listed dollar fields halved. */
function halveAllowed<T extends Record<string, unknown>>(rec: T, fields: readonly string[]): T {
  const out: Record<string, unknown> = { ...rec };
  for (const f of fields) {
    if (f in out && out[f] != null) out[f] = halveValue(out[f]);
  }
  return out as T;
}

export function halveW2Community<T extends Record<string, unknown>>(w2: T): T {
  return halveAllowed(w2, W2_DOLLAR_FIELDS);
}
export function halve1099Community<T extends Record<string, unknown>>(f: T): T {
  return halveAllowed(f, F1099_DOLLAR_FIELDS);
}

/**
 * The 50/50 community split of the joint return's W-2 + 1099 income. BOTH MFS
 * spouses receive this same halved set. Adjustments + per-property facts are NOT
 * split here (see the module docstring).
 */
export function splitCommunityIncome(joint: TaxReturnInputs): {
  w2s: TaxReturnInputs["w2s"];
  form1099s: TaxReturnInputs["form1099s"];
} {
  return {
    w2s: (joint.w2s ?? []).map((w) => halveW2Community(w as unknown as Record<string, unknown>)) as unknown as TaxReturnInputs["w2s"],
    form1099s: (joint.form1099s ?? []).map((f) => halve1099Community(f as unknown as Record<string, unknown>)) as unknown as TaxReturnInputs["form1099s"],
  };
}
