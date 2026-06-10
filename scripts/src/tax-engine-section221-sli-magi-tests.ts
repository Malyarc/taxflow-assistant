/**
 * §221 student-loan-interest MAGI — regression for the 2026-06-10 fix.
 *
 * BUG (pre-fix): the SLI MAGI (`magiForSli`) omitted the traditional-IRA
 * deduction, so a deductible IRA inflated MAGI and over-phased-out the §221
 * deduction near the $80k single / $165k MFJ phase-out band.
 *
 * FIX: per IRS Pub 970 Worksheet 4-1, SLI MAGI = AGI figured WITHOUT the SLI
 * deduction (i.e. NET of the IRA deduction) + the §911 FEIE/foreign-housing
 * exclusion added back. The engine now computes the IRA deduction FIRST (its
 * Pub 590-A MAGI is independent of SLI) and subtracts it from the SLI MAGI.
 *
 * Every expected value is HAND-CALC'D against the published rule.
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-section221-sli-magi-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.02): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

// ════════════════════════════════════════════════════════════════════════════
// S1 — THE BUG REPRO: single, $90k SE, $4k traditional IRA, $1,500 SLI (TY2024).
//   half-SE      = 90,000 × 0.9235 × 0.153 ÷ 2 = $6,358.30
//   IRA          = $4,000 (single, non-covered → fully deductible)
//   SLI MAGI     = 90,000 − 6,358.30 − 4,000   = $79,641.70  (< $80,000 start)
//   → §221 deduction = FULL $1,500.   (Pre-fix MAGI omitted the IRA →
//     $83,641.70 > $80,000 → over-phased-out to $1,135.83.)
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 90000 }],
    adjustments: [
      { adjustmentType: "ira_contribution_traditional", amount: 4000, isApplied: true },
      { adjustmentType: "student_loan_interest", amount: 1500, isApplied: true },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("S1 §221 deduction FULL $1,500 (IRA now subtracted from MAGI)", r.studentLoanInterest.deductible, 1500);
  check("S1 IRA deduction $4,000 (unchanged)", r.retirementDeductions.iraDeductible, 4000);
  check("S1 AGI $78,141.70 (90k − 6,358.30 − 4,000 − 1,500)", r.adjustedGrossIncome, 78141.70);
}

// ════════════════════════════════════════════════════════════════════════════
// S2 — CONTROL (no IRA): single, $90k SE, $1,500 SLI, NO IRA.
//   SLI MAGI = 90,000 − 6,358.30 = $83,641.70 → phase-out fraction
//     (83,641.70 − 80,000) ÷ 15,000 = 0.242780 → deduction
//     1,500 × (1 − 0.242780) = $1,135.83.
//   Proves the fix is TARGETED: filers without a deductible IRA are unchanged.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 90000 }],
    adjustments: [{ adjustmentType: "student_loan_interest", amount: 1500, isApplied: true }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("S2 no-IRA §221 deduction $1,135.83 (UNCHANGED by the fix)", r.studentLoanInterest.deductible, 1135.83);
}

// ════════════════════════════════════════════════════════════════════════════
// S3 — MFJ band: $180k SE, $7k IRA, $2,500 SLI (TY2024).
//   half-SE  = 180,000 × 0.9235 × 0.153 ÷ 2 = $12,716.60
//   IRA      = $7,000 (MFJ non-covered → fully deductible)
//   SLI MAGI = 180,000 − 12,716.60 − 7,000  = $160,283.40 (< $165,000 MFJ start)
//   → §221 deduction = FULL $2,500.   (Pre-fix MAGI = $167,283.40 > $165,000 →
//     would have been over-phased-out to $2,309.72.)
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 180000 }],
    adjustments: [
      { adjustmentType: "ira_contribution_traditional", amount: 7000, isApplied: true },
      { adjustmentType: "student_loan_interest", amount: 2500, isApplied: true },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("S3 MFJ §221 deduction FULL $2,500", r.studentLoanInterest.deductible, 2500);
  check("S3 MFJ IRA deduction $7,000 (unchanged)", r.retirementDeductions.iraDeductible, 7000);
  check("S3 MFJ AGI $157,783.40", r.adjustedGrossIncome, 157783.40);
}

// ════════════════════════════════════════════════════════════════════════════
// S4 — IRA-deduction PRESERVATION (the reorder must not disturb the IRA calc):
//   covered single, $80k W-2, $7k IRA (TY2024 covered phase-out $77k–$87k).
//   IRA MAGI = 80,000 (no other ATL) → fraction (87,000 − 80,000) ÷ 10,000 = 0.70
//   → IRA deduction = 7,000 × 0.70 = $4,900.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024, iraCoveredByWorkplacePlan: true },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 0 }],
    form1099s: [],
    adjustments: [{ adjustmentType: "ira_contribution_traditional", amount: 7000, isApplied: true }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("S4 covered-IRA deduction $4,900 (reorder preserves Pub 590-A phase-out)", r.retirementDeductions.iraDeductible, 4900);
}

// ════════════════════════════════════════════════════════════════════════════
// S5 — FEIE add-back (Pub 970): single, $50k US W-2 + $90k foreign earned income
//   (FEIE excludes all $90k), $1,500 SLI (TY2024).
//   SLI MAGI = AGI-without-SLI ($50,000) + FEIE add-back ($90,000) = $140,000
//   → well over the $95,000 full-phase-out ceiling → §221 deduction = $0.
//   (Without the add-back, MAGI would be $50,000 → a wrong full $1,500.)
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 0 }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "foreign_earned_income", amount: 90000, isApplied: true },
      { adjustmentType: "student_loan_interest", amount: 1500, isApplied: true },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("S5 FEIE add-back fully phases out §221 → $0", r.studentLoanInterest.deductible, 0);
  check("S5 FEIE total exclusion $90,000", r.feie.totalExclusion, 90000);
}

console.log(`\n§221 student-loan-interest MAGI — regression for the 2026-06-10 IRA-subtraction fix:`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.error(`  ${f}`); process.exit(1); }
for (const p of PASS) console.log(`  ${p}`);
process.exit(0);
