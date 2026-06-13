/**
 * T1.5 #9 — Filing-status trait table: ONE source of truth for "how is each
 * filing status classified for provision X?".
 *
 * The 2026-06-11 audit found a whole CLUSTER of bugs because ~40 sites each
 * re-encoded "is a qualifying surviving spouse (QSS) treated like a joint return
 * here?" inline — and several got it wrong (Additional Medicare, §86 Social
 * Security, §21 dependent care, §25A education, §32 EITC, §221 SLI, §904(j) FTC,
 * OBBBA senior deduction all wrongly treated QSS as MFJ). The answer is
 * PROVISION-SPECIFIC:
 *
 *   - QSS uses the JOINT amounts where the statute keys off SPOUSE/SURVIVING-
 *     SPOUSE status: §1 brackets, §63 std ded, §1411 NIIT, §121 home-sale,
 *     §461(l), §199A band, §219 IRA band, §24 CTC, §55 AMT exemption.
 *   - QSS uses the SINGLE/HoH amounts where the statute keys off filing a
 *     "JOINT RETURN" (which a QSS does NOT): §3101(b)(2) Add'l Medicare,
 *     §86(c) SS base, §21 dependent-care spouse-EI floor, §25A education band,
 *     §32 EITC column, §221 SLI band, §904(j) FTC simplified limit, OBBBA senior.
 *   - MFS gets the HALVED / barred treatment per provision.
 *
 * This module is the CANONICAL REFERENCE for that table; the property test
 * (tax-engine-filing-status-traits-tests.ts) pins every cell against the statute
 * so a future edit can't silently drift.
 *
 * ADOPTION (honest status): the audit-critical federal threshold functions read
 * from it today — niitThreshold, additionalMedicareThreshold (the oracle-found
 * bug), §86 SS base, §904(j) FTC, §121 cap, §164 SALT cap (saltCapHalved), and
 * the ACA household head-count (isMarriedJoint). The remaining provisions still
 * decide inline at their (already audit-correct) call sites; new code and future
 * refactors should READ the trait here rather than re-encode the rule, and
 * migrate the inline sites incrementally. The table documents the right answer
 * for ALL provisions even where a call site hasn't adopted it yet.
 *
 * PURE + framework-free (Haven-portable). Encodes the engine's CURRENT
 * audit-corrected behavior exactly — refactoring call sites to it is provably
 * behavior-preserving (the full no-API battery is the regression guard).
 */

export type FilingStatusName =
  | "single"
  | "married_filing_jointly"
  | "married_filing_separately"
  | "head_of_household"
  | "qualifying_widow";

export interface FilingStatusTraits {
  /** MFJ only — an actual joint return. */
  isMarriedJoint: boolean;
  /** Qualifying surviving spouse (QSS / "qualifying widow(er)"). */
  isSurvivingSpouse: boolean;
  /** Married filing separately. */
  isMfs: boolean;
  /** Single or HoH (the "any other case" group, excluding MFS). */
  isSingleOrHoh: boolean;

  // ── Provision classifications. `jointFor*` === "gets the MFJ/doubled amount". ──
  // QSS=JOINT (statute keys off spouse status):
  /** §1 brackets / §63 standard deduction basis. */
  bracketBasis: "joint" | "single" | "hoh" | "mfs";
  /** §1411 NIIT MAGI threshold ($250k joint / $125k MFS / $200k other). */
  jointForNiit: boolean;
  /** §121 home-sale exclusion ($500k joint vs $250k). */
  jointForSection121: boolean;
  /** §461(l) excess-business-loss threshold (doubled for joint). */
  jointForSection461l: boolean;
  /** §199A QBI phase-in band (doubled "threshold amount" for joint). */
  jointForSection199a: boolean;
  /** §219 IRA-deduction active-participant phase-out band. */
  jointForIraPhaseOut: boolean;

  // QSS=NOT joint (statute keys off filing a "joint return"):
  /** §3101(b)(2) Additional Medicare ($250k joint / $125k MFS / $200k other). */
  jointForAddlMedicare: boolean;
  /** §86(c) Social Security taxability base ($32k/$44k joint vs $25k/$34k). */
  jointForSsBase: boolean;
  /** §25A education-credit MAGI phase-out band (doubled for joint). */
  jointForEducationBand: boolean;
  /** §32 EITC phase-out column (the joint +$ increase). */
  jointForEitcColumn: boolean;
  /** §221 student-loan-interest MAGI band (doubled for joint). */
  jointForSliBand: boolean;
  /** §904(j) FTC simplified limit ($600 joint vs $300). */
  jointForFtcSimplified: boolean;
  /** §21 dependent-care earned-income floor uses the LESSER of both spouses' EI. */
  dependentCareUsesSpouseEarnedIncome: boolean;
  /** OBBBA Schedule 1-A senior deduction counts the spouse's 65+/blind box. */
  obbbaSeniorCountsSpouse: boolean;

  // ── MFS specials / eligibility bars ──
  /** §164(b)(6)/(7) SALT cap is HALVED for MFS. */
  saltCapHalved: boolean;
  /** §32(d) EITC base eligibility (false for MFS unless lived-apart — caller gates that). */
  eitcEligibleBase: boolean;
  /** §25A(g)(6) education credits barred for MFS. */
  educationCreditEligible: boolean;
  /** §221(e)(2) SLI barred for MFS. */
  sliEligible: boolean;
}

const T = (o: FilingStatusTraits): FilingStatusTraits => o;

const TRAITS: Record<FilingStatusName, FilingStatusTraits> = {
  single: T({
    isMarriedJoint: false, isSurvivingSpouse: false, isMfs: false, isSingleOrHoh: true,
    bracketBasis: "single",
    jointForNiit: false, jointForSection121: false, jointForSection461l: false,
    jointForSection199a: false, jointForIraPhaseOut: false,
    jointForAddlMedicare: false, jointForSsBase: false, jointForEducationBand: false,
    jointForEitcColumn: false, jointForSliBand: false, jointForFtcSimplified: false,
    dependentCareUsesSpouseEarnedIncome: false, obbbaSeniorCountsSpouse: false,
    saltCapHalved: false, eitcEligibleBase: true, educationCreditEligible: true, sliEligible: true,
  }),
  head_of_household: T({
    isMarriedJoint: false, isSurvivingSpouse: false, isMfs: false, isSingleOrHoh: true,
    bracketBasis: "hoh",
    jointForNiit: false, jointForSection121: false, jointForSection461l: false,
    jointForSection199a: false, jointForIraPhaseOut: false,
    jointForAddlMedicare: false, jointForSsBase: false, jointForEducationBand: false,
    jointForEitcColumn: false, jointForSliBand: false, jointForFtcSimplified: false,
    dependentCareUsesSpouseEarnedIncome: false, obbbaSeniorCountsSpouse: false,
    saltCapHalved: false, eitcEligibleBase: true, educationCreditEligible: true, sliEligible: true,
  }),
  married_filing_jointly: T({
    isMarriedJoint: true, isSurvivingSpouse: false, isMfs: false, isSingleOrHoh: false,
    bracketBasis: "joint",
    jointForNiit: true, jointForSection121: true, jointForSection461l: true,
    jointForSection199a: true, jointForIraPhaseOut: true,
    jointForAddlMedicare: true, jointForSsBase: true, jointForEducationBand: true,
    jointForEitcColumn: true, jointForSliBand: true, jointForFtcSimplified: true,
    dependentCareUsesSpouseEarnedIncome: true, obbbaSeniorCountsSpouse: true,
    saltCapHalved: false, eitcEligibleBase: true, educationCreditEligible: true, sliEligible: true,
  }),
  qualifying_widow: T({
    isMarriedJoint: false, isSurvivingSpouse: true, isMfs: false, isSingleOrHoh: false,
    bracketBasis: "joint",
    // QSS = JOINT where the statute keys off spouse status:
    jointForNiit: true, jointForSection121: true, jointForSection461l: true,
    jointForSection199a: true, jointForIraPhaseOut: true,
    // QSS = NOT joint where the statute keys off filing a "joint return":
    jointForAddlMedicare: false, jointForSsBase: false, jointForEducationBand: false,
    jointForEitcColumn: false, jointForSliBand: false, jointForFtcSimplified: false,
    dependentCareUsesSpouseEarnedIncome: false, obbbaSeniorCountsSpouse: false,
    saltCapHalved: false, eitcEligibleBase: true, educationCreditEligible: true, sliEligible: true,
  }),
  married_filing_separately: T({
    isMarriedJoint: false, isSurvivingSpouse: false, isMfs: true, isSingleOrHoh: false,
    bracketBasis: "mfs",
    jointForNiit: false, jointForSection121: false, jointForSection461l: false,
    jointForSection199a: false, jointForIraPhaseOut: false,
    jointForAddlMedicare: false, jointForSsBase: false, jointForEducationBand: false,
    jointForEitcColumn: false, jointForSliBand: false, jointForFtcSimplified: false,
    dependentCareUsesSpouseEarnedIncome: false, obbbaSeniorCountsSpouse: false,
    saltCapHalved: true, eitcEligibleBase: false, educationCreditEligible: false, sliEligible: false,
  }),
};

/** Single source of truth for filing-status classification. Unknown → single. */
export function filingStatusTraits(status: string): FilingStatusTraits {
  return TRAITS[status as FilingStatusName] ?? TRAITS.single;
}

/** Convenience: does this status get the JOINT (MFJ) treatment for §1 brackets / §63 std ded? */
export function usesJointBrackets(status: string): boolean {
  return filingStatusTraits(status).bracketBasis === "joint";
}
