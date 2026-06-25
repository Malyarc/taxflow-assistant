/**
 * Phase 1.5 unit tests — calculator-level tests with hand-calc IRS rules.
 *
 * Coverage:
 *   - Educator expenses (IRC §62(a)(2)(D))
 *   - Student loan interest deduction (IRC §221, phase-out)
 *   - Foreign tax credit (IRC §901, simplified path)
 *   - Residential energy credits (§25D / §25C / §30C, Form 5695 + 8911)
 *   - ACA Premium Tax Credit (IRC §36B, Form 8962, ARPA/IRA enhanced)
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-phase15-unit-tests.ts
 */

import {
  calculateEducatorExpenses,
  calculateStudentLoanInterest,
  calculateForeignTaxCredit,
  calculateResidentialEnergyCredits,
  calculatePremiumTaxCredit,
  calculateOregonFederalTaxSubtraction,
  calculateStateTax,
  calculateDependentCareCredit,
} from "../../artifacts/api-server/src/lib/taxCalculator";

const PASS: string[] = [];
const FAIL: string[] = [];

function near(a: number, b: number, tol = 0.01) {
  return Math.abs(a - b) <= tol;
}
function check(label: string, actual: number, expected: number, tol = 0.01) {
  if (near(actual, expected, tol)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(4)}, got ${actual.toFixed(4)}`);
}
function checkExact<T>(label: string, actual: T, expected: T) {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

// ════════════════════════════════════════════════════════════════════════════
// EDUCATOR EXPENSES — IRC §62(a)(2)(D)
// ════════════════════════════════════════════════════════════════════════════
header("Educator expenses");
{
  // 1 eligible educator, $200 of expenses: deducts $200 (under $300 cap)
  const r = calculateEducatorExpenses({ expenses: 200, eligibleEducatorCount: 1, taxYear: 2024 });
  check("Single educator $200 expenses → $200 deductible", r.deductible, 200);
  check("Cap = $300 for 1 educator", r.cap, 300);
}
{
  // 1 eligible educator, $500 of expenses: capped at $300
  const r = calculateEducatorExpenses({ expenses: 500, eligibleEducatorCount: 1, taxYear: 2024 });
  check("Single educator $500 → capped $300", r.deductible, 300);
}
{
  // 2 eligible educators (MFJ), $800 of expenses: capped at $600 combined
  const r = calculateEducatorExpenses({ expenses: 800, eligibleEducatorCount: 2, taxYear: 2024 });
  check("MFJ 2 educators $800 → $600 cap", r.deductible, 600);
  check("Cap = $600 for 2 educators", r.cap, 600);
}
{
  // 0 eligible educators: $0 deductible regardless of expenses
  const r = calculateEducatorExpenses({ expenses: 1000, eligibleEducatorCount: 0, taxYear: 2024 });
  checkExact("No eligible educator → $0", r.deductible, 0);
}
{
  // Negative expenses: clamped to 0
  const r = calculateEducatorExpenses({ expenses: -100, eligibleEducatorCount: 1, taxYear: 2024 });
  checkExact("Negative expenses → $0", r.deductible, 0);
}
{
  // 2025: cap still $300/educator
  const r = calculateEducatorExpenses({ expenses: 1000, eligibleEducatorCount: 2, taxYear: 2025 });
  check("2025: MFJ 2 educators $1000 → $600 cap", r.deductible, 600);
}
{
  // 3 educators clamped to 2 — sanity check input clamping
  const r = calculateEducatorExpenses({ expenses: 1000, eligibleEducatorCount: 3, taxYear: 2024 });
  check("3 educators → clamped to 2 ($600 cap)", r.deductible, 600);
}

// ════════════════════════════════════════════════════════════════════════════
// STUDENT LOAN INTEREST — IRC §221
// ════════════════════════════════════════════════════════════════════════════
header("Student loan interest deduction");
{
  // Single, MAGI $50k, paid $1,800 interest → full $1,800 (under $2,500 cap, under $80k phase-out start)
  const r = calculateStudentLoanInterest({ interestPaid: 1800, magi: 50000, filingStatus: "single", taxYear: 2024 });
  check("Single $50k MAGI, $1,800 interest → $1,800", r.deductible, 1800);
  check("Phase-out fraction = 1.0", r.phaseOutFraction, 1);
}
{
  // Single, MAGI $50k, paid $3,500 interest → capped at $2,500 statutory max
  const r = calculateStudentLoanInterest({ interestPaid: 3500, magi: 50000, filingStatus: "single", taxYear: 2024 });
  check("Single $50k MAGI, $3,500 interest → $2,500 cap", r.deductible, 2500);
}
{
  // Single, MAGI $85k (midpoint of $80k-$95k 2024 phase-out): fraction = (95k-85k)/15k = 0.6667
  // $2,500 cap × 0.6667 = $1,666.67
  const r = calculateStudentLoanInterest({ interestPaid: 2500, magi: 85000, filingStatus: "single", taxYear: 2024 });
  check("Single MAGI $85k → phase-out fraction 0.6667", r.phaseOutFraction, 10000 / 15000, 0.0001);
  check("Single MAGI $85k, $2,500 → $1,666.67", r.deductible, (10000 / 15000) * 2500, 0.01);
}
{
  // Single, MAGI $95k or above (2024): full phase-out
  const r = calculateStudentLoanInterest({ interestPaid: 2500, magi: 95000, filingStatus: "single", taxYear: 2024 });
  checkExact("Single MAGI $95k → $0 (full phase-out)", r.deductible, 0);
}
{
  // Single, MAGI $80k (start): still full deduction
  const r = calculateStudentLoanInterest({ interestPaid: 2500, magi: 80000, filingStatus: "single", taxYear: 2024 });
  check("Single MAGI $80k (phase-out start) → $2,500", r.deductible, 2500);
  check("Phase-out fraction = 1.0 at start threshold", r.phaseOutFraction, 1);
}
{
  // MFJ, MAGI $180k (midpoint of $165-$195k 2024): fraction = (195-180)/30 = 0.5
  // $2,500 × 0.5 = $1,250
  const r = calculateStudentLoanInterest({ interestPaid: 2500, magi: 180000, filingStatus: "married_filing_jointly", taxYear: 2024 });
  check("MFJ MAGI $180k → fraction 0.5", r.phaseOutFraction, 0.5, 0.001);
  check("MFJ MAGI $180k, $2,500 → $1,250", r.deductible, 1250, 0.01);
}
{
  // MFS → ineligible
  const r = calculateStudentLoanInterest({ interestPaid: 2500, magi: 50000, filingStatus: "married_filing_separately", taxYear: 2024 });
  checkExact("MFS → ineligible ($0)", r.deductible, 0);
  checkExact("MFS eligible flag = false", r.eligible, false);
}
{
  // HoH, MAGI $90k: midpoint of $80k-$95k → fraction = (95-90)/15 = 1/3
  // $2,000 × 1/3 = $666.67
  const r = calculateStudentLoanInterest({ interestPaid: 2000, magi: 90000, filingStatus: "head_of_household", taxYear: 2024 });
  check("HoH MAGI $90k, $2,000 → $666.67", r.deductible, 2000 * (5000 / 15000), 0.01);
}
{
  // 2025: single MAGI $92.5k (midpoint of $85k-$100k): fraction = (100-92.5)/15 = 0.5
  // $2,500 × 0.5 = $1,250
  const r = calculateStudentLoanInterest({ interestPaid: 2500, magi: 92500, filingStatus: "single", taxYear: 2025 });
  check("2025 single MAGI $92.5k → $1,250", r.deductible, 1250, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// FOREIGN TAX CREDIT — IRC §901/§904
// ════════════════════════════════════════════════════════════════════════════
header("Foreign tax credit");
{
  // Single, $150 foreign tax → simplified path (≤ $300), full credit
  const r = calculateForeignTaxCredit({ foreignTaxPaid: 150, filingStatus: "single" });
  check("Single $150 FTC → $150 (simplified)", r.credit, 150);
  checkExact("Simplified path used", r.usedSimplifiedPath, true);
}
{
  // Single, $300 foreign tax → still simplified path (at limit, ≤)
  const r = calculateForeignTaxCredit({ foreignTaxPaid: 300, filingStatus: "single" });
  check("Single $300 FTC → $300 (at limit)", r.credit, 300);
  checkExact("Simplified path used at limit", r.usedSimplifiedPath, true);
}
{
  // Single, $350 foreign tax → over simplified limit, still credited (Form 1116 limit not modeled)
  const r = calculateForeignTaxCredit({ foreignTaxPaid: 350, filingStatus: "single" });
  check("Single $350 FTC → $350 (over simplified limit)", r.credit, 350);
  checkExact("Simplified path NOT used (over limit)", r.usedSimplifiedPath, false);
  checkExact("Exceeded simplified limit flag", r.exceededSimplifiedLimit, true);
}
{
  // MFJ, $600 foreign tax → still simplified (limit is $600)
  const r = calculateForeignTaxCredit({ foreignTaxPaid: 600, filingStatus: "married_filing_jointly" });
  check("MFJ $600 FTC → $600 (at simplified limit)", r.credit, 600);
  checkExact("MFJ simplified path used at limit", r.usedSimplifiedPath, true);
}
{
  // §904(j)(2)(C): the $600 simplified limit is for "a joint return" only; a
  // §2(a) qualifying surviving spouse files singly → $300 (NOT the MFJ $600).
  const r = calculateForeignTaxCredit({ foreignTaxPaid: 250, filingStatus: "qualifying_widow" });
  check("QW FTC simplified limit = $300 (single, not joint)", r.simplifiedLimit, 300);
  checkExact("QW $250 ≤ $300 → simplified path", r.exceededSimplifiedLimit, false);
}
{
  // Negative input → 0
  const r = calculateForeignTaxCredit({ foreignTaxPaid: -50, filingStatus: "single" });
  checkExact("Negative FTC → $0", r.credit, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// RESIDENTIAL ENERGY CREDITS — §25D / §25C / §30C
// ════════════════════════════════════════════════════════════════════════════
header("Residential energy credits");
{
  // §25D: $20k solar PV → 30% = $6,000 (no cap)
  const r = calculateResidentialEnergyCredits({ cleanEnergySpend: 20000, efficientHomeSpend: 0, heatPumpSpend: 0, evChargerSpend: 0, taxYear: 2024 });
  check("Solar $20k → $6,000 (30% no cap)", r.cleanEnergyCredit, 6000);
  check("Total = $6,000", r.total, 6000);
}
{
  // §25D: $100k solar → 30% = $30,000 (no cap)
  const r = calculateResidentialEnergyCredits({ cleanEnergySpend: 100000, efficientHomeSpend: 0, heatPumpSpend: 0, evChargerSpend: 0, taxYear: 2024 });
  check("Big solar $100k → $30,000 (no cap)", r.cleanEnergyCredit, 30000);
}
{
  // §25C general: $2,000 of windows/insulation → 30% × $2,000 = $600 (under $1,200 cap)
  const r = calculateResidentialEnergyCredits({ cleanEnergySpend: 0, efficientHomeSpend: 2000, heatPumpSpend: 0, evChargerSpend: 0, taxYear: 2024 });
  check("§25C $2k → $600 (30%, under $1,200 cap)", r.efficientHomeCredit, 600);
}
{
  // §25C general: $5,000 of qualifying spend → 30% × $5,000 = $1,500 → capped at $1,200
  const r = calculateResidentialEnergyCredits({ cleanEnergySpend: 0, efficientHomeSpend: 5000, heatPumpSpend: 0, evChargerSpend: 0, taxYear: 2024 });
  check("§25C $5k → $1,200 (general cap)", r.efficientHomeCredit, 1200);
}
{
  // §25C heat pump: $5,000 → 30% × $5,000 = $1,500 (under $2,000 heat pump cap)
  const r = calculateResidentialEnergyCredits({ cleanEnergySpend: 0, efficientHomeSpend: 0, heatPumpSpend: 5000, evChargerSpend: 0, taxYear: 2024 });
  check("Heat pump $5k → $1,500 (under $2k cap)", r.heatPumpCredit, 1500);
}
{
  // §25C heat pump: $10,000 → 30% × $10,000 = $3,000 → capped at $2,000
  const r = calculateResidentialEnergyCredits({ cleanEnergySpend: 0, efficientHomeSpend: 0, heatPumpSpend: 10000, evChargerSpend: 0, taxYear: 2024 });
  check("Heat pump $10k → $2,000 (heat pump cap)", r.heatPumpCredit, 2000);
}
{
  // §30C EV charger: $2,000 → 30% × $2,000 = $600 (under $1,000 cap)
  const r = calculateResidentialEnergyCredits({ cleanEnergySpend: 0, efficientHomeSpend: 0, heatPumpSpend: 0, evChargerSpend: 2000, taxYear: 2024 });
  check("EV charger $2k → $600 (under $1k cap)", r.evChargerCredit, 600);
}
{
  // §30C EV charger: $5,000 → 30% × $5,000 = $1,500 → capped at $1,000
  const r = calculateResidentialEnergyCredits({ cleanEnergySpend: 0, efficientHomeSpend: 0, heatPumpSpend: 0, evChargerSpend: 5000, taxYear: 2024 });
  check("EV charger $5k → $1,000 (charger cap)", r.evChargerCredit, 1000);
}
{
  // Combined: solar $30k + windows $5k + heat pump $10k + EV charger $5k
  // §25D: $30k × 30% = $9,000
  // §25C general: min(30%×$5k, $1,200) = $1,200
  // §25C heat pump: min(30%×$10k, $2,000) = $2,000
  // §30C: min(30%×$5k, $1,000) = $1,000
  // Total = $9,000 + $1,200 + $2,000 + $1,000 = $13,200
  const r = calculateResidentialEnergyCredits({ cleanEnergySpend: 30000, efficientHomeSpend: 5000, heatPumpSpend: 10000, evChargerSpend: 5000, taxYear: 2024 });
  check("All four — combined", r.total, 13200);
  check("§25D portion", r.cleanEnergyCredit, 9000);
  check("§25C general portion", r.efficientHomeCredit, 1200);
  check("§25C heat pump portion", r.heatPumpCredit, 2000);
  check("§30C portion", r.evChargerCredit, 1000);
}

// ════════════════════════════════════════════════════════════════════════════
// ACA PREMIUM TAX CREDIT — IRC §36B (Form 8962)
// ════════════════════════════════════════════════════════════════════════════
header("ACA Premium Tax Credit");
{
  // Single, household 1, MAGI $25k, premium $6,000, SLCSP $6,500, advance $4,000.
  // 2023 FPL (used for 2024 PTC) single = $14,580. FPL% = 25000/14580 = 171.4%.
  // FPL% in 1.50-2.00 tier → linear 0% to 2% across [1.50, 2.00].
  // Position in tier: (1.714 - 1.50)/0.50 = 0.428. Applicable figure = 0 + 0.428 × 0.02 = 0.00857.
  // Expected contribution = $25,000 × 0.00857 = $214.27.
  // PTC uncapped = max(0, $6,500 - $214.27) = $6,285.73.
  // PTC computed = min($6,000 premium, $6,285.73) = $6,000.
  // Net PTC = $6,000 - $4,000 advance = $2,000 refundable.
  const r = calculatePremiumTaxCredit({
    annualPremium: 6000, annualSlcsp: 6500, advanceAptc: 4000,
    modifiedAgi: 25000, householdSize: 1, filingStatus: "single", taxYear: 2024,
  });
  check("FPL guideline single 2024", r.fplGuideline, 14580);
  check("FPL fraction ~1.714", r.fplFraction, 25000 / 14580, 0.0001);
  check("Applicable figure ~0.00857", r.applicableFigure, ((25000 / 14580 - 1.50) / 0.50) * 0.02, 0.0001);
  check("Expected contribution ~$214", r.expectedContribution, 25000 * (((25000 / 14580 - 1.50) / 0.50) * 0.02), 0.5);
  check("Computed PTC capped at premium $6,000", r.computedPtc, 6000, 0.5);
  check("Net PTC = $2,000 refundable", r.netPtc, 2000, 1);
}
{
  // FC-22 (re-derived 2026-06-11) — single, MAGI $14k, household 1, TY2024.
  // Hand-calc: $14,000 / $14,580 = 0.9602 < 100% FPL → §36B(c)(1)(A): NOT an
  // applicable taxpayer (household income must be at least 100% of FPL —
  // ARPA removed only the 400% ceiling, never the floor). No APTC advanced →
  // PTC = $0, net = $0. (The old "$6,000 full premium" expectation predated
  // the FC-22 floor and was WRONG — it granted a PTC to a Medicaid-range
  // filer.)
  const r = calculatePremiumTaxCredit({
    annualPremium: 6000, annualSlcsp: 6500, advanceAptc: 0,
    modifiedAgi: 14000, householdSize: 1, filingStatus: "single", taxYear: 2024,
  });
  check("Below 100% FPL: no PTC (§36B(c)(1)(A) floor)", r.computedPtc, 0);
  check("Below 100% FPL: net PTC = 0 (no advance)", r.netPtc, 0, 0.01);
  checkExact("Below 100% FPL: eligible = false", r.eligible, false);
}
{
  // Control (FC-22) — single, MAGI $16k, household 1, TY2024.
  // Hand-calc: $16,000 / $14,580 = 1.0974 → ≥100% and <150% FPL → ARPA
  // applicable figure = 0 → expected contribution $0 → PTC uncapped =
  // $6,500 − $0 = $6,500 → capped at premium $6,000. No advance → net $6,000.
  const r = calculatePremiumTaxCredit({
    annualPremium: 6000, annualSlcsp: 6500, advanceAptc: 0,
    modifiedAgi: 16000, householdSize: 1, filingStatus: "single", taxYear: 2024,
  });
  check("100-150% FPL (ARPA): applicable figure = 0", r.applicableFigure, 0);
  check("100-150% FPL (ARPA): net PTC = full premium $6,000", r.netPtc, 6000, 1);
}
{
  // MFJ, household 4, MAGI $80k. 2023 FPL 4-person = $14,580 + 3×$5,140 = $30,000.
  // FPL% = 80000/30000 = 266.67%.
  // Tier 2.50-3.00: applicable figure = interpolate(2.667, 2.50, 3.00, 0.04, 0.06)
  //   = 0.04 + ((2.667-2.50)/0.50) × 0.02 = 0.04 + 0.333 × 0.02 = 0.0467 (rounded).
  // Expected contribution = $80,000 × 0.0467 = $3,733.
  // Annual premium $14,400, SLCSP $15,600, advance $11,000.
  // PTC uncapped = max(0, $15,600 - $3,733) = $11,867.
  // PTC computed = min($14,400, $11,867) = $11,867.
  // Net = $11,867 - $11,000 = $867.
  const r = calculatePremiumTaxCredit({
    annualPremium: 14400, annualSlcsp: 15600, advanceAptc: 11000,
    modifiedAgi: 80000, householdSize: 4, filingStatus: "married_filing_jointly", taxYear: 2024,
  });
  check("FPL guideline MFJ 4 person", r.fplGuideline, 14580 + 3 * 5140);
  const expectedFraction = 80000 / 30000;
  check("FPL fraction ~2.667", r.fplFraction, expectedFraction, 0.001);
  const expectedFigure = 0.04 + ((expectedFraction - 2.5) / 0.5) * 0.02;
  check("Applicable figure ~0.0467", r.applicableFigure, expectedFigure, 0.0001);
  const expectedContrib = 80000 * expectedFigure;
  check("Expected contribution", r.expectedContribution, expectedContrib, 1);
  const expectedPtc = Math.min(14400, Math.max(0, 15600 - expectedContrib));
  check("Computed PTC", r.computedPtc, expectedPtc, 1);
  check("Net PTC = computed - advance", r.netPtc, expectedPtc - 11000, 1);
}
{
  // MFJ, MAGI $50k, household 2. FPL = $14,580 + $5,140 = $19,720.
  // FPL% = 50000/19720 = 253.5%. → tier 2.50-3.00
  // applicable figure = interpolate(2.535, 2.50, 3.00, 0.04, 0.06)
  //   = 0.04 + (0.035/0.50) × 0.02 = 0.04 + 0.00141 = 0.04141 (approx)
  // Expected contribution = $50,000 × 0.04141 = $2,070.
  // Premium $10,000, SLCSP $11,000, advance $12,000 (overstated by user).
  // PTC uncapped = max(0, 11000 - 2070) = $8,930.
  // PTC = min(10000, 8930) = $8,930.
  // Net = $8,930 - $12,000 = -$3,070 owed.
  // FPL 253.5% (200–<300% tier) → MFJ/other-statuses cap = $1,900 (R3-C13;
  // 2024 Form 8962 Table 5 §36B(f)(2)(B) — $950/$1,900 single/other, not $975/$1,950).
  // Capped: max(-3070, -1900) = -$1,900 owed.
  const r = calculatePremiumTaxCredit({
    annualPremium: 10000, annualSlcsp: 11000, advanceAptc: 12000,
    modifiedAgi: 50000, householdSize: 2, filingStatus: "married_filing_jointly", taxYear: 2024,
  });
  check("Repayment capped at $1,900 (MFJ, FPL%<300)", r.netPtc, -1900, 1);
  check("Repayment cap value = $1,900", r.repaymentCap ?? -1, 1900); // null = no-cap sentinel (T1.0d #14)
}
{
  // Single, MAGI $60k, household 1. FPL%= 60000/14580 = 411% → ≥ 400%.
  // Applicable figure = 0.085 (8.5%, ARPA/IRA top rate).
  // Expected contribution = $60,000 × 0.085 = $5,100.
  // Premium $8,000, SLCSP $7,500, advance $9,000.
  // PTC uncapped = max(0, 7500 - 5100) = $2,400.
  // PTC = min(8000, 2400) = $2,400.
  // Net = $2,400 - $9,000 = -$6,600 owed.
  // FPL% ≥ 400% → no cap, full repayment of $6,600.
  const r = calculatePremiumTaxCredit({
    annualPremium: 8000, annualSlcsp: 7500, advanceAptc: 9000,
    modifiedAgi: 60000, householdSize: 1, filingStatus: "single", taxYear: 2024,
  });
  check("Applicable figure at 8.5% top", r.applicableFigure, 0.085);
  check("Full repayment $6,600 (FPL>400%)", r.netPtc, -6600, 1);
  // T1.0d #14 (2026-06-11): the >=400%-FPL "no cap" sentinel is now NULL, not
  // Infinity — the engine-totality rule (SEC1) forbids non-finite outputs
  // (Infinity JSON-serializes to null anyway). Semantics unchanged: full repayment.
  checkExact("Repayment cap = null (no cap above 400% — full repayment)", r.repaymentCap, null);
}
{
  // FC-10 (re-derived 2026-06-11) — MFS: ineligible for the PTC
  // (§36B(c)(1)(C)) but the §36B(f)(2)(B) repayment limitation APPLIES (8962
  // instructions: Table 5 "appl[ies] to you and your spouse separately based
  // on the household income reported on each tax return").
  // Hand-calc: MAGI $30,000 / FPL $14,580 (household 1) = 2.0576 → the
  // 200–<300% tier; MFS is NOT a §1(c) single → "all other filing statuses"
  // column = $1,900 (R3-C13; 2024 Form 8962 Table 5 §36B(f)(2)(B), not $1,950).
  // Excess APTC = $3,000 − $0 = $3,000 → capped at $1,900. (The old uncapped
  // −$3,000 expectation predated FC-10 and was WRONG.)
  const r = calculatePremiumTaxCredit({
    annualPremium: 6000, annualSlcsp: 6500, advanceAptc: 3000,
    modifiedAgi: 30000, householdSize: 1, filingStatus: "married_filing_separately", taxYear: 2024,
  });
  checkExact("MFS ineligible", r.eligible, false);
  check("MFS repayment capped at $1,900 (Table 5 other-statuses column)", r.netPtc, -1900, 0.01);
  check("MFS repayment cap value", r.repaymentCap ?? -1, 1900);
}
{
  // No premium → no eligibility (not enrolled in Marketplace)
  const r = calculatePremiumTaxCredit({
    annualPremium: 0, annualSlcsp: 0, advanceAptc: 0,
    modifiedAgi: 30000, householdSize: 1, filingStatus: "single", taxYear: 2024,
  });
  checkExact("No premium → ineligible", r.eligible, false);
  check("No premium → net PTC = 0", r.netPtc, 0);
}
{
  // 2025: same family at MAGI $80k, household 4. 2024 FPL 4 = $15,060 + 3×$5,380 = $31,200.
  // FPL% = 80000/31200 = 2.564.
  // Tier 2.50-3.00: figure = 0.04 + ((2.564-2.5)/0.5)×0.02 = 0.04 + 0.064×0.04 = 0.0426
  //   Actually: (2.564-2.5)/0.5 = 0.128. 0.04 + 0.128×0.02 = 0.04256.
  // Expected contribution = $80,000 × 0.04256 = $3,405.
  const r = calculatePremiumTaxCredit({
    annualPremium: 14400, annualSlcsp: 15600, advanceAptc: 11000,
    modifiedAgi: 80000, householdSize: 4, filingStatus: "married_filing_jointly", taxYear: 2025,
  });
  check("2025 FPL guideline MFJ 4 = $31,200", r.fplGuideline, 31200);
  const expectedFraction = 80000 / 31200;
  const expectedFigure = 0.04 + ((expectedFraction - 2.5) / 0.5) * 0.02;
  check("2025 applicable figure", r.applicableFigure, expectedFigure, 0.0001);
}

// ════════════════════════════════════════════════════════════════════════════
// OREGON FEDERAL-TAX-PAID SUBTRACTION — Form 40 Line 13
// ════════════════════════════════════════════════════════════════════════════
header("Oregon federal-tax-paid subtraction");
{
  // Single, AGI $80k (below phase-out), fed tax $10k → cap $8,250 (less than $10k actual)
  const r = calculateOregonFederalTaxSubtraction({
    federalIncomeTaxPaid: 10000, federalAgi: 80000, filingStatus: "single", taxYear: 2024,
  });
  check("OR single AGI $80k, fed tax $10k → $8,250 cap", r.subtraction, 8250);
  check("Phase-out fraction = 1.0", r.phaseOutFraction, 1);
}
{
  // Single, AGI $80k, fed tax $5k (less than cap) → full $5k subtraction
  const r = calculateOregonFederalTaxSubtraction({
    federalIncomeTaxPaid: 5000, federalAgi: 80000, filingStatus: "single", taxYear: 2024,
  });
  check("OR single fed tax $5k (under cap) → $5,000 subtraction", r.subtraction, 5000);
}
{
  // Single, AGI $135k (midpoint of $125k-$145k phase-out): fraction = (145-135)/20 = 0.5
  // Subtraction = min($8,250, $10k) × 0.5 = $4,125
  const r = calculateOregonFederalTaxSubtraction({
    federalIncomeTaxPaid: 10000, federalAgi: 135000, filingStatus: "single", taxYear: 2024,
  });
  check("OR single AGI $135k → fraction 0.5", r.phaseOutFraction, 0.5, 0.001);
  check("OR single $135k → $4,125 subtraction", r.subtraction, 4125, 1);
}
{
  // Single, AGI $145k or higher → full phase-out
  const r = calculateOregonFederalTaxSubtraction({
    federalIncomeTaxPaid: 10000, federalAgi: 145000, filingStatus: "single", taxYear: 2024,
  });
  checkExact("OR single AGI $145k → $0 subtraction", r.subtraction, 0);
}
{
  // MFS: cap is half ($4,125)
  const r = calculateOregonFederalTaxSubtraction({
    federalIncomeTaxPaid: 10000, federalAgi: 80000, filingStatus: "married_filing_separately", taxYear: 2024,
  });
  check("OR MFS cap = $4,125", r.subtraction, 4125);
  checkExact("OR MFS cap value = $4,125", r.cap, 4125);
}
{
  // MFJ, AGI $80k: full $8,250 subtraction
  const r = calculateOregonFederalTaxSubtraction({
    federalIncomeTaxPaid: 15000, federalAgi: 80000, filingStatus: "married_filing_jointly", taxYear: 2024,
  });
  check("OR MFJ AGI $80k, fed tax $15k → $8,250 cap", r.subtraction, 8250);
}

// Now verify the subtraction flows through calculateStateTax with proper recompute
{
  // OR single, AGI $80k. Without subtraction:
  //   Std ded = $2,745. Taxable = 80000 - 2745 = $77,255.
  //   Brackets: 4300×0.0475 + (10750-4300)×0.0675 + (77255-10750)×0.0875
  //     = 204.25 + 435.38 + 5819.19 = $6,458.82
  // With $5k federal tax subtraction:
  //   Std ded $2,745 + subtraction $5,000 = $7,745 deductions.
  //   Taxable = 80000 - 7745 = $72,255.
  //   4300×0.0475 + (10750-4300)×0.0675 + (72255-10750)×0.0875
  //     = 204.25 + 435.38 + 5381.69 = $6,021.32
  const baseline = calculateStateTax(80000, "OR", "single", 2024);
  const withFedTax = calculateStateTax(80000, "OR", "single", 2024, { federalIncomeTaxPaid: 5000 });
  check("OR baseline state tax (no fed subtraction)", baseline, 6458.83, 0.5);
  check("OR state tax with $5k fed subtraction", withFedTax, 6021.31, 0.5);
  // Verify difference matches subtraction × marginal rate ($5k × 8.75% = $437.50)
  check("OR state-tax reduction ≈ subtraction × 8.75%", baseline - withFedTax, 437.5, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// DEPENDENT CARE — MFJ taxpayer-only earned income split (regression test)
// ════════════════════════════════════════════════════════════════════════════
header("Dependent care MFJ earned-income split (pipeline-level concern)");
// The pipeline used to pass household combined wages as `earnedIncomeTaxpayer`,
// which overstates the credit when the spouse outearns the taxpayer.
// Calculator-level test: passing the correct taxpayer-only amount.
{
  // MFJ, taxpayer earns $30k, spouse earns $70k. 1 child, $3k expenses, AGI $100k.
  // Earned-income limit (MFJ) = min(taxpayer=$30k, spouse=$70k) = $30k.
  // Expense cap (1 child) = $3,000. Eligible = min($3k, $3k, $30k) = $3,000.
  // AGI $100k → rate = 20% (above $43k floor).
  // Credit = $3,000 × 20% = $600.
  const r = calculateDependentCareCredit({
    expenses: 3000, qualifyingDependents: 1,
    earnedIncomeTaxpayer: 30000, earnedIncomeSpouse: 70000,
    agi: 100000, filingStatus: "married_filing_jointly",
  });
  check("MFJ taxpayer $30k / spouse $70k → $600 credit", r.appliedCredit, 600);
  check("Earned-income limit = taxpayer's $30k", r.earnedIncomeLimit, 30000);
}
{
  // Regression demonstration: if we incorrectly passed combined wages ($100k)
  // as earnedIncomeTaxpayer, the limit would be spouse's $70k → eligible expenses
  // still capped at $3k by expense limit → credit still $600 (same).
  // For credit to change, expenses must exceed the lesser earned income.
  // Scenario: taxpayer $5k / spouse $50k, 2 kids, expenses $10k, AGI $60k.
  // Limit (correct) = min($5k, $50k) = $5,000. Eligible = min($10k, $6k cap, $5k) = $5,000.
  // Rate at AGI $60k = 20%. Credit = $5,000 × 20% = $1,000.
  const r = calculateDependentCareCredit({
    expenses: 10000, qualifyingDependents: 2,
    earnedIncomeTaxpayer: 5000, earnedIncomeSpouse: 50000,
    agi: 60000, filingStatus: "married_filing_jointly",
  });
  check("MFJ taxpayer $5k / spouse $50k, 2 kids → $1,000 (was overstated)", r.appliedCredit, 1000);
  check("Limit binds at $5k (taxpayer's earnings)", r.earnedIncomeLimit, 5000);
}
{
  // The bug case: bad caller passes combined $55k as taxpayer, $50k as spouse.
  // min($55k, $50k) = $50k. Eligible expenses = min($10k, $6k, $50k) = $6k.
  // Credit = $6,000 × 20% = $1,200 (overstated by $200 vs correct $1,000).
  // This documents the OLD broken behavior for regression awareness.
  const buggy = calculateDependentCareCredit({
    expenses: 10000, qualifyingDependents: 2,
    earnedIncomeTaxpayer: 55000, earnedIncomeSpouse: 50000,
    agi: 60000, filingStatus: "married_filing_jointly",
  });
  check("Buggy (combined-as-taxpayer) overstates → $1,200", buggy.appliedCredit, 1200);
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log("\n══════════════════════ Summary ══════════════════════");
console.log(`PASS: ${PASS.length}`);
console.log(`FAIL: ${FAIL.length}`);
if (FAIL.length > 0) {
  console.log("\nFailures:");
  for (const f of FAIL) console.log(f);
  process.exit(1);
} else {
  console.log("\n✓ All Phase 1.5 unit tests pass");
}
