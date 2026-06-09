/**
 * T1.1c — State individual health-coverage mandate penalty (CA, NJ, RI, DC, MA)
 * — hand-calc'd against each jurisdiction's published rule.
 *
 * Pure engine; no API required.
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-state-mandate-tests.ts
 *
 * Sources:
 *   • CA — FTB Form 3853 (2024): $900/adult + $450/child, max $2,700; or 2.5%
 *     over the filing threshold; capped at $348/mo/person bronze. Prorated.
 *   • NJ/RI/DC — frozen 2018 federal SRP: $695/adult + $347.50/child, max $2,085;
 *     or 2.5% over the filing threshold (NJ: $10k single/MFS, $20k others).
 *   • MA — Schedule HC / TIR (2023 CONFIRMED): no penalty ≤150% FPL; per-ADULT
 *     monthly $24 (150.1-200%) / $46 (200.1-250%) / $68 (250.1-300%) / $183
 *     (>300%). 2023 FPL (1-person $14,580; +$5,140/person).
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { calculateStateIndividualMandatePenalty } from "../../artifacts/api-server/src/lib/stateMandate";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.01): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkStr(label: string, actual: string, expected: string): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

// ════════════════════════════════════════════════════════════════════════════
// PART 1 — calculateStateIndividualMandatePenalty (pure)
// ════════════════════════════════════════════════════════════════════════════

// M1 — CA single adult, 12 mo uninsured, low income → flat $900 binds.
//   flat=$900; pct=(30,000−14,600)·2.5%=$385; bronze=348·12·1=$4,176 → $900.
{
  const r = calculateStateIndividualMandatePenalty({ state: "CA", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0, householdIncome: 30000, filingThreshold: 14600, monthsUninsured: 12, taxYear: 2024 });
  check("M1 CA flat binds", r.penalty, 900);
  checkStr("M1 CA method flat", r.method, "flat");
}
// M2 — CA single, high income → percentage binds.
//   pct=(100,000−14,600)·2.5%=$2,135 > flat $900; bronze $4,176 → $2,135.
{
  const r = calculateStateIndividualMandatePenalty({ state: "CA", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0, householdIncome: 100000, filingThreshold: 14600, monthsUninsured: 12, taxYear: 2024 });
  check("M2 CA percentage binds", r.penalty, 2135);
  checkStr("M2 CA method percentage", r.method, "percentage");
}
// M3 — CA family of 4 (2 adults + 2 children) → flat hits the $2,700 max.
//   flat=min(2700, 2·900+2·450=2,700)=2,700; pct=(80,000−29,200)·2.5%=$1,270 → $2,700.
{
  const r = calculateStateIndividualMandatePenalty({ state: "CA", filingStatus: "married_filing_jointly", uninsuredAdults: 2, uninsuredChildren: 2, householdIncome: 80000, filingThreshold: 29200, monthsUninsured: 12, taxYear: 2024 });
  check("M3 CA flat capped at $2,700", r.penalty, 2700);
}
// M4 — CA single, 6 months uninsured → half of the annual flat.
{
  const r = calculateStateIndividualMandatePenalty({ state: "CA", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0, householdIncome: 30000, filingThreshold: 14600, monthsUninsured: 6, taxYear: 2024 });
  check("M4 CA proration 6/12", r.penalty, 450);
}
// M5 — CA single, very high income → bronze cap binds at $4,176.
//   pct=(1,000,000−14,600)·2.5%=$24,635 → capped at 348·12·1=$4,176.
{
  const r = calculateStateIndividualMandatePenalty({ state: "CA", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0, householdIncome: 1000000, filingThreshold: 14600, monthsUninsured: 12, taxYear: 2024 });
  check("M5 CA bronze cap binds", r.penalty, 4176);
  checkStr("M5 method reports bronze_cap (not the unbinding percentage)", r.method, "bronze_cap");
}

// M6 — NJ single, low income → flat $695. pct=(30,000−10,000)·2.5%=$500 < $695.
{
  const r = calculateStateIndividualMandatePenalty({ state: "NJ", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0, householdIncome: 30000, filingThreshold: 10000, monthsUninsured: 12, taxYear: 2024 });
  check("M6 NJ flat $695", r.penalty, 695);
}
// M7 — NJ MFJ 2 adults + 1 child → flat = 2·695 + 347.50 = $1,737.50 (> pct $750).
{
  const r = calculateStateIndividualMandatePenalty({ state: "NJ", filingStatus: "married_filing_jointly", uninsuredAdults: 2, uninsuredChildren: 1, householdIncome: 50000, filingThreshold: 20000, monthsUninsured: 12, taxYear: 2024 });
  check("M7 NJ 2 adults + 1 child flat", r.penalty, 1737.5);
}
// M8 — NJ 2 adults + 4 children → flat = min($2,085, 1390+1390=$2,780) = $2,085 max.
{
  const r = calculateStateIndividualMandatePenalty({ state: "NJ", filingStatus: "married_filing_jointly", uninsuredAdults: 2, uninsuredChildren: 4, householdIncome: 40000, filingThreshold: 20000, monthsUninsured: 12, taxYear: 2024 });
  check("M8 NJ flat capped at $2,085", r.penalty, 2085);
}
// M9 — RI single, low income → frozen federal $695. pct=(25,000−14,600)·2.5%=$260.
{
  const r = calculateStateIndividualMandatePenalty({ state: "RI", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0, householdIncome: 25000, filingThreshold: 14600, monthsUninsured: 12, taxYear: 2024 });
  check("M9 RI flat $695", r.penalty, 695);
}
// M10 — DC single, low income → frozen federal $695.
{
  const r = calculateStateIndividualMandatePenalty({ state: "DC", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0, householdIncome: 25000, filingThreshold: 14600, monthsUninsured: 12, taxYear: 2024 });
  check("M10 DC flat $695", r.penalty, 695);
}

// MA — 2023 confirmed schedule (FPL 1-person $14,580; +$5,140/person).
// M11 — MA single, income ≤ 150% FPL → $0. $20k = 137% → no penalty.
{
  const r = calculateStateIndividualMandatePenalty({ state: "MA", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0, householdIncome: 20000, filingThreshold: 0, monthsUninsured: 12, taxYear: 2023, householdSize: 1 });
  check("M11 MA ≤150% FPL no penalty", r.penalty, 0);
  checkStr("M11 MA method fpl_tier", r.method, "fpl_tier");
}
// M12 — MA single, $25k = 171% FPL → 150.1-200% tier $24/mo × 12 = $288.
{
  const r = calculateStateIndividualMandatePenalty({ state: "MA", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0, householdIncome: 25000, filingThreshold: 0, monthsUninsured: 12, taxYear: 2023, householdSize: 1 });
  check("M12 MA 150.1-200% tier", r.penalty, 288);
}
// M13 — MA single, $40k = 274% FPL → 250.1-300% tier $68/mo × 12 = $816.
{
  const r = calculateStateIndividualMandatePenalty({ state: "MA", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0, householdIncome: 40000, filingThreshold: 0, monthsUninsured: 12, taxYear: 2023, householdSize: 1 });
  check("M13 MA 250.1-300% tier", r.penalty, 816);
}
// M14 — MA single, $50k = 343% FPL → >300% tier $183/mo × 12 = $2,196.
{
  const r = calculateStateIndividualMandatePenalty({ state: "MA", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0, householdIncome: 50000, filingThreshold: 0, monthsUninsured: 12, taxYear: 2023, householdSize: 1 });
  check("M14 MA >300% tier", r.penalty, 2196);
}
// M15 — MA MFJ 2 adults uninsured, household 2, $44k = 223% FPL (FPL2=$19,720) →
//   200.1-250% tier $46/mo × 12 × 2 adults = $1,104.
{
  const r = calculateStateIndividualMandatePenalty({ state: "MA", filingStatus: "married_filing_jointly", uninsuredAdults: 2, uninsuredChildren: 0, householdIncome: 44000, filingThreshold: 0, monthsUninsured: 12, taxYear: 2023, householdSize: 2 });
  check("M15 MA 2 adults 200.1-250% tier", r.penalty, 1104);
}
// M16 — MA single, $60k = 411% FPL, 6 months → $183 × 6 = $1,098.
{
  const r = calculateStateIndividualMandatePenalty({ state: "MA", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0, householdIncome: 60000, filingThreshold: 0, monthsUninsured: 6, taxYear: 2023, householdSize: 1 });
  check("M16 MA monthly × 6 months", r.penalty, 1098);
}

// Edge cases.
// M17 — non-mandate state (TX) → $0.
{
  const r = calculateStateIndividualMandatePenalty({ state: "TX", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0, householdIncome: 100000, filingThreshold: 14600, monthsUninsured: 12, taxYear: 2024 });
  check("M17 non-mandate state $0", r.penalty, 0);
  checkStr("M17 method none", r.method, "none");
}
// M18 — fully covered (0 months) → $0.
{
  const r = calculateStateIndividualMandatePenalty({ state: "CA", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0, householdIncome: 100000, filingThreshold: 14600, monthsUninsured: 0, taxYear: 2024 });
  check("M18 fully covered $0", r.penalty, 0);
}
// M19 — no uninsured persons → $0.
{
  const r = calculateStateIndividualMandatePenalty({ state: "CA", filingStatus: "single", uninsuredAdults: 0, uninsuredChildren: 0, householdIncome: 100000, filingThreshold: 14600, monthsUninsured: 12, taxYear: 2024 });
  check("M19 no uninsured persons $0", r.penalty, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// PART 2 — End-to-end via computeTaxReturnPure
// ════════════════════════════════════════════════════════════════════════════

function baseInputs(state: string, wages: number, monthsUninsured: number, taxYear = 2024, filingStatus = "single", dependentsUnder17 = 0): TaxReturnInputs {
  const client = {
    id: 1, firstName: "Test", lastName: "Mandate", email: "t@e.com", phone: null,
    filingStatus, state, taxYear,
    dependentsUnder17, otherDependents: 0, dependentsForCareCredit: 0,
    taxpayerAge: 40, spouseAge: filingStatus === "married_filing_jointly" ? 40 : null, spouseEarnedIncome: null,
    hsaIsFamilyCoverage: false, iraCoveredByWorkplacePlan: false,
    eligibleEducatorCount: 0, acaAnnualPremium: null, acaAnnualSlcsp: null,
    acaAdvanceAptc: null, acaHouseholdSize: null,
    rentalActiveParticipant: true, rentalRealEstateProfessional: false,
    localityCode: null, socialSecurityBenefits: null,
    mfsLivedApartAllYear: false, isKiddieTaxFiler: false,
    parentsTopMarginalRate: null, priorYearItemized: null,
    residencyChangedInYear: false, formerState: null, residencyChangeDate: null,
    notes: null, createdAt: new Date(), updatedAt: new Date(),
  };
  const w2 = {
    id: 1, clientId: 1, taxYear, documentId: null,
    employerName: "Emp", employerEin: null,
    wagesBox1: String(wages), federalWithholdingBox2: "0",
    socialSecurityWagesBox3: String(wages), socialSecurityTaxBox4: "0",
    medicareWagesBox5: String(wages), medicareTaxBox6: "0",
    socialSecurityTipsBox7: "0", allocatedTipsBox8: "0",
    dependentCareBenefitsBox10: "0", nonqualifiedPlansBox11: "0",
    box12aCode: null, box12aAmount: "0", box12bCode: null, box12bAmount: "0",
    box12cCode: null, box12cAmount: "0", box12dCode: null, box12dAmount: "0",
    statutoryEmployeeBox13: false, retirementPlanBox13: false, thirdPartySickPayBox13: false,
    box14Description: null, box14Amount: "0",
    stateBox15: state, stateWagesBox16: String(wages), stateTaxBox17: "0",
    localWagesBox18: "0", localTaxBox19: "0", localityNameBox20: null,
    spouse: null, createdAt: new Date(), updatedAt: new Date(),
  };
  const adjustments = monthsUninsured > 0
    ? [{ id: 1, clientId: 1, adjustmentType: "months_without_minimum_coverage", amount: String(monthsUninsured), description: "uninsured", category: null, isApplied: true, createdAt: new Date(), updatedAt: new Date() }]
    : [];
  return {
    client: client as TaxReturnInputs["client"],
    w2s: [w2 as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: adjustments as unknown as TaxReturnInputs["adjustments"],
    taxYear,
  };
}

// E1 — CA resident, single, $30k W-2, 12 mo uninsured → $900 flat, raises owed.
{
  const covered = computeTaxReturnPure(baseInputs("CA", 30000, 0));
  const r = computeTaxReturnPure(baseInputs("CA", 30000, 12));
  check("E1 CA mandate penalty $900", r.stateIndividualMandatePenalty, 900);
  check("E1 CA penalty reduces state refund/raises owed by $900", covered.stateRefundOrOwed - r.stateRefundOrOwed, 900);
  // The penalty raises the effective rate (it is part of totalTaxBurden internally).
  check("E1 CA penalty raises effective rate", r.effectiveTaxRate > covered.effectiveTaxRate ? 1 : 0, 1);
}
// E2 — NJ resident, single, $30k W-2, 12 mo → $695 (flat > pct).
{
  const r = computeTaxReturnPure(baseInputs("NJ", 30000, 12));
  check("E2 NJ mandate penalty $695", r.stateIndividualMandatePenalty, 695);
}
// E3 — TX (no income tax, no mandate) with the adjustment present → $0.
{
  const r = computeTaxReturnPure(baseInputs("TX", 30000, 12));
  check("E3 TX no mandate penalty", r.stateIndividualMandatePenalty, 0);
}
// E4 — MA resident, single, $25k W-2 (171% FPL household 1), TY2023, 12 mo → $288.
{
  const r = computeTaxReturnPure(baseInputs("MA", 25000, 12, 2023));
  check("E4 MA mandate penalty $288", r.stateIndividualMandatePenalty, 288);
}
// E5 — CA covered (no adjustment) → $0 penalty, method none.
{
  const r = computeTaxReturnPure(baseInputs("CA", 30000, 0));
  check("E5 CA covered no penalty", r.stateIndividualMandatePenalty, 0);
  checkStr("E5 CA covered method none", r.stateMandate.method, "none");
}

console.log(`\nT1.1c — State individual-mandate penalty tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) FAIL.forEach((f) => console.log(`    ${f}`));
process.exit(FAIL.length > 0 ? 1 : 0);
