/**
 * T1.5 #5 — per-dependent data model + EXACT credit-gating derivation.
 *
 * The engine historically took dependent COUNTS (dependentsUnder17,
 * eitcQualifyingChildren, dependentsForCareCredit, childrenUnder6, otherDependents)
 * as separate scalar inputs — relying on the CPA to enter the right count for
 * each credit's distinct age/SSN/relationship test. This models each dependent
 * ONCE (DOB, SSN-present, relationship, residency, student/disabled status) and
 * DERIVES every credit's count from the statute, so CTC vs ODC vs EITC-child vs
 * §21 dependent-care vs the under-6 state-CTC tier are gated EXACTLY and can't
 * drift apart.
 *
 * PURE + framework-free (Haven-portable). Age is "age at the END of the tax
 * year" = taxYear − birthYear (no current-date dependency — the engine stays
 * Date-free). When `TaxReturnInputs.dependents` is absent the engine uses the
 * legacy scalar counts unchanged (full back-compat).
 *
 * Rules encoded:
 *  - §152(c) qualifying CHILD relationship: son/daughter/stepchild/foster/
 *    sibling (+half/step) or a DESCENDANT of any (grandchild/niece/nephew).
 *  - §24 CTC: qualifying child, age < 17 at year-end, valid SSN, residency.
 *  - §24(h)(4) ODC ($500): any dependent who is NOT a CTC qualifying child
 *    (a 17+ child, an ITIN child, or a qualifying relative).
 *  - §32(c)(3) EITC qualifying child: qualifying child with a valid SSN, age < 19
 *    (or < 24 if a full-time student, or any age if permanently disabled), and
 *    (when the taxpayer's birth year is supplied) younger than the taxpayer.
 *  - §21 dependent care: a qualifying person under 13 (or disabled), residency.
 *  - state under-6 CTC tier: qualifying child age < 6.
 */

export type DependentRelationship =
  | "son" | "daughter" | "stepchild" | "foster_child" | "grandchild"
  | "sibling" | "half_sibling" | "step_sibling" | "niece" | "nephew" | "descendant"
  | "parent" | "grandparent" | "other_relative" | "other";

export interface DependentFact {
  /** Birth year, OR an ISO date-of-birth (only the year is used for age-at-year-end). */
  birthYear?: number | null;
  dateOfBirth?: string | null;
  /** Has an SSN valid for employment (vs ITIN/ATIN) — required for CTC + EITC. */
  hasSsn?: boolean | null;
  /** Relationship to the taxpayer (drives the qualifying-CHILD vs RELATIVE test). */
  relationship?: DependentRelationship | string | null;
  /** Months the dependent lived in the taxpayer's home (residency test). */
  monthsInHome?: number | null;
  /** Full-time student (extends the EITC qualifying age to < 24). */
  isStudent?: boolean | null;
  /** Permanently and totally disabled (qualifying child at ANY age; care-eligible). */
  isPermanentlyDisabled?: boolean | null;
}

export interface DerivedDependentCounts {
  dependentsUnder17: number;      // §24 CTC qualifying children
  otherDependents: number;        // §24(h)(4) ODC ($500)
  eitcQualifyingChildren: number; // §32(c)(3)
  dependentsForCareCredit: number;// §21 (under 13 / disabled)
  childrenUnder6: number;         // state under-6 CTC tier
}

const QUALIFYING_CHILD_RELATIONSHIPS: ReadonlySet<string> = new Set([
  "son", "daughter", "stepchild", "foster_child", "grandchild",
  "sibling", "half_sibling", "step_sibling", "niece", "nephew", "descendant",
]);

/** Age at the END of the tax year. Returns null when no birth year is known. */
export function ageAtYearEnd(dep: DependentFact, taxYear: number): number | null {
  let by = dep.birthYear ?? null;
  if (by == null && dep.dateOfBirth) {
    const m = /^(\d{4})/.exec(String(dep.dateOfBirth).trim());
    if (m) by = Number(m[1]);
  }
  if (by == null || !Number.isFinite(by)) return null;
  return taxYear - by;
}

function isQualifyingChildRelationship(rel: string | null | undefined): boolean {
  // Unknown relationship defaults to a qualifying child (the common case is a
  // taxpayer's own child); a qualifying RELATIVE must be tagged explicitly.
  if (rel == null || rel === "") return true;
  return QUALIFYING_CHILD_RELATIONSHIPS.has(rel);
}

/** Residency test: lived with the taxpayer more than half the year. Unknown → met. */
function residencyMet(dep: DependentFact): boolean {
  return dep.monthsInHome == null || dep.monthsInHome >= 7;
}

/**
 * Derive every credit's dependent count from the per-dependent facts. Pure.
 * @param taxpayerBirthYear optional — enables the EITC "younger than the taxpayer" test.
 */
export function deriveDependentCounts(
  dependents: DependentFact[],
  taxYear: number,
  taxpayerBirthYear?: number | null,
): DerivedDependentCounts {
  let ctc = 0, eitc = 0, care = 0, under6 = 0;
  for (const dep of dependents) {
    const age = ageAtYearEnd(dep, taxYear);
    const qualChildRel = isQualifyingChildRelationship(dep.relationship);
    const resident = residencyMet(dep);
    const hasSsn = dep.hasSsn !== false; // default true unless explicitly an ITIN
    const disabled = dep.isPermanentlyDisabled === true;
    const student = dep.isStudent === true;

    // §24 CTC: qualifying child < 17 with a valid SSN + residency.
    if (qualChildRel && resident && hasSsn && age != null && age < 17) ctc++;
    // state under-6 tier.
    if (qualChildRel && resident && age != null && age < 6) under6++;

    // §32 EITC qualifying child: < 19, or < 24 student, or any age if disabled;
    // valid SSN + residency + (if known) younger than the taxpayer.
    const eitcAgeOk =
      disabled || (age != null && (age < 19 || (age < 24 && student)));
    const youngerThanTaxpayer =
      taxpayerBirthYear == null || age == null || age < (taxYear - taxpayerBirthYear);
    if (qualChildRel && resident && hasSsn && eitcAgeOk && youngerThanTaxpayer) eitc++;

    // §21 dependent care: under 13 (or disabled) + residency.
    if (resident && (disabled || (age != null && age < 13))) care++;
  }
  // §24(h)(4) ODC: every dependent who is NOT a CTC qualifying child.
  const otherDependents = Math.max(0, dependents.length - ctc);
  return {
    dependentsUnder17: ctc,
    otherDependents,
    eitcQualifyingChildren: eitc,
    dependentsForCareCredit: care,
    childrenUnder6: under6,
  };
}
