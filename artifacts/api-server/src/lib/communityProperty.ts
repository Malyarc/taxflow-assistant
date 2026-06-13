/**
 * T1.5 #6 — community-property income splitting for MFS (Form 8958).
 *
 * In the 9 community-property states, spouses who file MFS must each report HALF
 * of all COMMUNITY income (income earned during the marriage), regardless of
 * which spouse earned it — not the "whoever earned it" attribution that governs
 * common-law states. This makes the MFJ-vs-MFS optimizer legally correct there:
 * a one-earner couple's MFS halves are two equal lower-bracket returns, not one
 * high-bracket + one empty return.
 *
 * MODEL (documented default): treat ALL W-2 / 1099 / adjustment income as
 * COMMUNITY and split it 50/50 (the standard simplification — most income earned
 * during marriage is community). SEPARATE-property income (separate assets,
 * gifts, inheritance) and the per-property facts (rentals / K-1 / capital
 * transactions) are the CPA's Form 8958 refinement and are left on the primary
 * half — a documented sub-gap, same as the optimizer's existing per-property note.
 *
 * PURE + framework-free (Haven-portable).
 */
import type { TaxReturnInputs } from "./taxReturnEngine";

/** The 9 community-property states (AZ, CA, ID, LA, NV, NM, TX, WA, WI). */
export const COMMUNITY_PROPERTY_STATES: ReadonlySet<string> = new Set([
  "AZ", "CA", "ID", "LA", "NV", "NM", "TX", "WA", "WI",
]);

export function isCommunityPropertyState(state: string | null | undefined): boolean {
  return !!state && COMMUNITY_PROPERTY_STATES.has(state.toUpperCase());
}

const PURE_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Halve every DOLLAR field of an income record (W-2 / 1099 / adjustment) for the
 * 50/50 community split. Halves numbers and pure-numeric strings (Drizzle
 * decimals), but never `taxYear` (the only non-dollar numeric on these records),
 * and leaves strings/booleans/arrays/objects untouched. These record types have
 * no percentage/quantity fields (unlike per-property assets), so a blanket halve
 * of the scalar dollar fields is exact.
 */
export function halveCommunityDollars<T extends Record<string, unknown>>(rec: T): T {
  const out: Record<string, unknown> = { ...rec };
  for (const [k, v] of Object.entries(out)) {
    if (k === "taxYear") continue;
    if (typeof v === "number") out[k] = v / 2;
    else if (typeof v === "string" && PURE_NUMBER.test(v.trim())) out[k] = String(Number(v) / 2);
  }
  return out as T;
}

/**
 * The 50/50 community split of the joint return's halvable income arrays
 * (W-2, 1099, adjustments). BOTH MFS spouses receive this same halved set.
 */
export function splitCommunityIncome(joint: TaxReturnInputs): {
  w2s: TaxReturnInputs["w2s"];
  form1099s: TaxReturnInputs["form1099s"];
  adjustments: TaxReturnInputs["adjustments"];
} {
  const halve = (o: unknown) => halveCommunityDollars(o as Record<string, unknown>);
  return {
    w2s: (joint.w2s ?? []).map(halve) as unknown as TaxReturnInputs["w2s"],
    form1099s: (joint.form1099s ?? []).map(halve) as unknown as TaxReturnInputs["form1099s"],
    adjustments: (joint.adjustments ?? []).map(halve) as unknown as TaxReturnInputs["adjustments"],
  };
}
