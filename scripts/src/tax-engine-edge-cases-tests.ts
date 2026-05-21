/**
 * Edge-case + boundary-condition tests.
 *
 * Hunts for off-by-one and edge-cliff bugs at all the places the IRS
 * publishes thresholds: bracket boundaries, phase-out start/end, credit
 * tier transitions, age-based catch-up flips, MFS exclusion rules,
 * AGI=0 clamping, etc.
 *
 * These are pure-engine tests (no DB, no API). Run:
 *   pnpm --filter @workspace/scripts exec tsx src/tax-engine-edge-cases-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  calculateFederalTax,
  calculateEitc,
  calculateSaversCredit,
  calculateRetirementDeductions,
  calculateDependentCareCredit,
  calculateEducationCredits,
  getFederalStandardDeduction,
} from "../../artifacts/api-server/src/lib/taxCalculator";

const PASS: string[] = [];
const FAIL: string[] = [];

function near(a: number, b: number, tol = 0.01) { return Math.abs(a - b) <= tol; }
function check(label: string, actual: number, expected: number, tol = 0.01) {
  if (near(actual, expected, tol)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(4)}, got ${actual.toFixed(4)} (diff ${(actual - expected).toFixed(4)})`);
}
function checkExact<T>(label: string, actual: T, expected: T) {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function checkBool(label: string, actual: boolean, expected: boolean) {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

// Helper: minimal pure-engine input for a single-filer wage scenario.
function singleWageInputs(wages: number, taxYear = 2024, extras: Partial<TaxReturnInputs> = {}): TaxReturnInputs {
  return {
    client: { filingStatus: "single", state: "FL", taxYear },
    w2s: [{ taxYear, wagesBox1: wages, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    taxYear,
    ...extras,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Federal bracket EXACT boundaries (2024 single)
//    IRS rule: "Over X but not over Y" — at exactly Y you're still in the
//    lower bracket. So $11,600 taxable = top of 10% bracket = $1,160 tax.
//    $11,600.01 taxable = first $0.01 in 12% bracket = $1,160.0012.
// ════════════════════════════════════════════════════════════════════════════
header("Federal bracket boundaries — TY2024 single");
{
  // 2024 single brackets:
  //   $0-$11,600 (10%) → top of 10% = $1,160
  //   $11,600-$47,150 (12%) → top of 12% = $1,160 + $4,266 = $5,426
  //   $47,150-$100,525 (22%) → top of 22% = $5,426 + $11,742.50 = $17,168.50
  //   $100,525-$191,950 (24%) → top = $17,168.50 + $21,942 = $39,110.50
  //   $191,950-$243,725 (32%) → top = $39,110.50 + $16,568 = $55,678.50
  //   $243,725-$609,350 (35%) → top = $55,678.50 + $127,968.75 = $183,647.25
  //   $609,350+ (37%)
  check("Tax at $0", calculateFederalTax(0, "single", 2024), 0);
  check("Tax at $1", calculateFederalTax(1, "single", 2024), 0.10);
  check("Tax at $11,600 (top of 10%)", calculateFederalTax(11600, "single", 2024), 1160);
  check("Tax at $11,600.01 (1¢ into 12%)", calculateFederalTax(11600.01, "single", 2024), 1160 + 0.01 * 0.12, 0.001);
  check("Tax at $47,150 (top of 12%)", calculateFederalTax(47150, "single", 2024), 5426);
  check("Tax at $47,150.01 (1¢ into 22%)", calculateFederalTax(47150.01, "single", 2024), 5426 + 0.01 * 0.22, 0.001);
  check("Tax at $100,525 (top of 22%)", calculateFederalTax(100525, "single", 2024), 17168.50);
  check("Tax at $100,525.01 (1¢ into 24%)", calculateFederalTax(100525.01, "single", 2024), 17168.50 + 0.01 * 0.24, 0.001);
  check("Tax at $191,950 (top of 24%)", calculateFederalTax(191950, "single", 2024), 39110.50);
  check("Tax at $243,725 (top of 32%)", calculateFederalTax(243725, "single", 2024), 55678.50);
  check("Tax at $609,350 (top of 35%)", calculateFederalTax(609350, "single", 2024), 183647.25);
  check("Tax at $1,000,000 (deep in 37%)", calculateFederalTax(1000000, "single", 2024), 183647.25 + (1000000 - 609350) * 0.37);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Federal bracket boundaries — TY2024 MFJ
//    Brackets are exactly double single below the top brackets, except 32%.
// ════════════════════════════════════════════════════════════════════════════
header("Federal bracket boundaries — TY2024 MFJ");
{
  // 2024 MFJ: 10% to $23,200, 12% to $94,300, 22% to $201,050,
  //           24% to $383,900, 32% to $487,450, 35% to $731,200, 37% above
  check("MFJ tax at $23,200 (top of 10%)", calculateFederalTax(23200, "married_filing_jointly", 2024), 2320);
  check("MFJ tax at $94,300 (top of 12%)", calculateFederalTax(94300, "married_filing_jointly", 2024), 10852);
  check("MFJ tax at $201,050 (top of 22%)", calculateFederalTax(201050, "married_filing_jointly", 2024), 34337);
  check("MFJ tax at $383,900 (top of 24%)", calculateFederalTax(383900, "married_filing_jointly", 2024), 78221);
  check("MFJ tax at $487,450 (top of 32%)", calculateFederalTax(487450, "married_filing_jointly", 2024), 111357);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Federal bracket boundaries — TY2025 single (verifies brackets indexed)
// ════════════════════════════════════════════════════════════════════════════
header("Federal bracket boundaries — TY2025 single");
{
  // 2025 single: 10% to $11,925, 12% to $48,475, 22% to $103,350
  //              24% to $197,300, 32% to $250,525, 35% to $626,350, 37% above
  check("TY2025 tax at $11,925 (top of 10%)", calculateFederalTax(11925, "single", 2025), 1192.50);
  check("TY2025 tax at $48,475 (top of 12%)", calculateFederalTax(48475, "single", 2025), 5578.50);
  check("TY2025 tax at $103,350 (top of 22%)", calculateFederalTax(103350, "single", 2025), 17651);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Standard deduction by filing status — TY2024 + TY2025
// ════════════════════════════════════════════════════════════════════════════
header("Standard deduction — all filing statuses");
{
  check("Single 2024 std ded", getFederalStandardDeduction("single", 2024), 14600);
  check("MFJ 2024 std ded", getFederalStandardDeduction("married_filing_jointly", 2024), 29200);
  check("HoH 2024 std ded", getFederalStandardDeduction("head_of_household", 2024), 21900);
  check("MFS 2024 std ded", getFederalStandardDeduction("married_filing_separately", 2024), 14600);
  check("QW 2024 std ded", getFederalStandardDeduction("qualifying_widow", 2024), 29200);
  check("Single 2025 std ded", getFederalStandardDeduction("single", 2025), 15000);
  check("MFJ 2025 std ded", getFederalStandardDeduction("married_filing_jointly", 2025), 30000);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. EITC investment income cliff at exactly $11,600 (TY2024)
//    IRS rule: investment income MUST be $11,600 OR LESS.
//    So at $11,600 → eligible. At $11,600.01 → ineligible cliff.
// ════════════════════════════════════════════════════════════════════════════
header("EITC investment income cliff — $11,600 exactly (TY2024)");
{
  const baseParams = {
    filingStatus: "single",
    qualifyingChildren: 1,
    earnedIncome: 25000,
    agi: 25000,
    taxYear: 2024,
  };
  const atLimit = calculateEitc({ ...baseParams, investmentIncome: 11600 });
  const overLimit = calculateEitc({ ...baseParams, investmentIncome: 11600.01 });
  checkBool("$11,600 invest income → eligible (at limit)", atLimit.eligible, true);
  checkBool("$11,600.01 invest income → ineligible (1¢ over)", overLimit.eligible, false);
  checkExact("Over-limit ineligibility reason mentions limit", String(overLimit.ineligibilityReason).includes("11600"), true);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. EITC — MFS ineligibility
// ════════════════════════════════════════════════════════════════════════════
header("EITC — MFS ineligibility");
{
  const r = calculateEitc({
    filingStatus: "married_filing_separately",
    qualifyingChildren: 2,
    earnedIncome: 25000,
    agi: 25000,
    investmentIncome: 500,
    taxYear: 2024,
  });
  checkBool("MFS → EITC ineligible", r.eligible, false);
  checkExact("MFS reason mentions MFS", String(r.ineligibilityReason).toLowerCase().includes("mfs"), true);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. Saver's credit tier transitions — TY2024 single
//    Tiers (single): 50% ≤ $23,000 < 20% ≤ $25,000 < 10% ≤ $38,250 < 0%
//    These use "<=" (i.e. at $23,000 → 50%, $23,000.01 → 20%)
// ════════════════════════════════════════════════════════════════════════════
header("Saver's credit tier transitions — TY2024 single");
{
  const baseParams = { filingStatus: "single", retirementContributions: 2000, taxYear: 2024 };
  const at23k = calculateSaversCredit({ ...baseParams, agi: 23000 });
  const just_over_23k = calculateSaversCredit({ ...baseParams, agi: 23000.01 });
  const at25k = calculateSaversCredit({ ...baseParams, agi: 25000 });
  const just_over_25k = calculateSaversCredit({ ...baseParams, agi: 25000.01 });
  const at38_25k = calculateSaversCredit({ ...baseParams, agi: 38250 });
  const just_over_38_25k = calculateSaversCredit({ ...baseParams, agi: 38250.01 });

  check("AGI $23,000 → 50% × $2,000 = $1,000", at23k.appliedCredit, 1000);
  check("AGI $23,000.01 → 20% × $2,000 = $400", just_over_23k.appliedCredit, 400);
  check("AGI $25,000 → 20% × $2,000 = $400", at25k.appliedCredit, 400);
  check("AGI $25,000.01 → 10% × $2,000 = $200", just_over_25k.appliedCredit, 200);
  check("AGI $38,250 → 10% × $2,000 = $200", at38_25k.appliedCredit, 200);
  check("AGI $38,250.01 → 0% (no credit)", just_over_38_25k.appliedCredit, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 8. Education credits — AOC phase-out boundary single $80k-$90k
//    Below $80k AGI: full. Above $90k: zero. Linear in between.
// ════════════════════════════════════════════════════════════════════════════
header("Education credits — AOC phase-out cliff");
{
  const base = { filingStatus: "single", aocExpenses: [4000], llcExpenses: 0 };
  const at80k = calculateEducationCredits({ ...base, agi: 80000 });
  const at85k = calculateEducationCredits({ ...base, agi: 85000 });
  const at90k = calculateEducationCredits({ ...base, agi: 90000 });
  const at90_01k = calculateEducationCredits({ ...base, agi: 90000.01 });
  check("AGI $80k AOC → $2,500 (full credit)", at80k.aocApplied, 2500);
  check("AGI $85k AOC → 50% phase-out = $1,250", at85k.aocApplied, 1250);
  check("AGI $90k AOC → $0 (top of phase-out)", at90k.aocApplied, 0);
  check("AGI $90,000.01 AOC → still $0", at90_01k.aocApplied, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 9. Education credits — MFS ineligibility
// ════════════════════════════════════════════════════════════════════════════
header("Education credits — MFS ineligibility");
{
  const r = calculateEducationCredits({
    agi: 30000,
    filingStatus: "married_filing_separately",
    aocExpenses: [4000],
    llcExpenses: 5000,
  });
  check("MFS AOC = 0", r.aocApplied, 0);
  check("MFS LLC = 0", r.llcApplied, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 10. IRA deduction — phase-out single covered by workplace plan
//     2024 single: $77,000 full → $87,000 zero (linear)
//     At $82k AGI → 50% phase-out → $7,000 × 0.5 = $3,500
// ════════════════════════════════════════════════════════════════════════════
header("IRA deduction phase-out — covered by plan, single TY2024");
{
  const base = {
    filingStatus: "single",
    age: 30,
    hsaIsFamilyCoverage: false,
    hsaContribution: 0,
    iraContribution: 7000,
    iraCoveredByWorkplacePlan: true,
    taxYear: 2024,
  };
  const at77k = calculateRetirementDeductions({ ...base, agi: 77000 });
  const at82k = calculateRetirementDeductions({ ...base, agi: 82000 });
  const at87k = calculateRetirementDeductions({ ...base, agi: 87000 });
  const at87_01k = calculateRetirementDeductions({ ...base, agi: 87000.01 });
  check("AGI $77k → full $7,000 IRA", at77k.iraDeductible, 7000);
  check("AGI $82k → 50% × $7,000 = $3,500", at82k.iraDeductible, 3500);
  check("AGI $87k → $0 (top of phase-out)", at87k.iraDeductible, 0);
  check("AGI $87,000.01 → $0", at87_01k.iraDeductible, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 11. IRA catch-up at age 50
//     Age 49 → $7,000 limit. Age 50 → $7,000 + $1,000 catch-up = $8,000.
// ════════════════════════════════════════════════════════════════════════════
header("IRA catch-up — age 50 boundary");
{
  const base = {
    filingStatus: "single", agi: 60000,
    hsaIsFamilyCoverage: false, hsaContribution: 0,
    iraContribution: 8000,
    iraCoveredByWorkplacePlan: false,
    taxYear: 2024,
  };
  const age49 = calculateRetirementDeductions({ ...base, age: 49 });
  const age50 = calculateRetirementDeductions({ ...base, age: 50 });
  check("Age 49 → $7,000 cap (no catch-up)", age49.iraDeductible, 7000);
  check("Age 50 → $8,000 cap (catch-up)", age50.iraDeductible, 8000);
}

// ════════════════════════════════════════════════════════════════════════════
// 12. HSA catch-up at age 55
//     Age 54 self-only → $4,150. Age 55 self-only → $4,150 + $1,000 = $5,150.
// ════════════════════════════════════════════════════════════════════════════
header("HSA catch-up — age 55 boundary");
{
  const base = {
    filingStatus: "single", agi: 60000,
    hsaIsFamilyCoverage: false, hsaContribution: 5150,
    iraContribution: 0,
    iraCoveredByWorkplacePlan: false,
    taxYear: 2024,
  };
  const age54 = calculateRetirementDeductions({ ...base, age: 54 });
  const age55 = calculateRetirementDeductions({ ...base, age: 55 });
  check("Age 54 → $4,150 HSA cap (no catch-up)", age54.hsaDeductible, 4150);
  check("Age 55 → $5,150 HSA cap (catch-up applies)", age55.hsaDeductible, 5150);
}

// ════════════════════════════════════════════════════════════════════════════
// 13. Dep care credit AGI rate transitions
//     35% at AGI ≤ $15k, drops 1% per $2k, floor 20% at AGI ≥ $43k
// ════════════════════════════════════════════════════════════════════════════
header("Dep care credit AGI rate transitions");
{
  const base = {
    filingStatus: "single",
    qualifyingDependents: 1,
    expenses: 3000,
    earnedIncomeTaxpayer: 50000,
    earnedIncomeSpouse: 0,
  };
  // At $15k AGI: 35% × $3,000 = $1,050
  const at15k = calculateDependentCareCredit({ ...base, agi: 15000 });
  check("AGI $15k → 35% × $3k expense = $1,050", at15k.appliedCredit, 1050);
  // At $15,001-$17,000 AGI: 34% (one $2k bracket up from $15k → 34%)
  const at17k = calculateDependentCareCredit({ ...base, agi: 17000 });
  check("AGI $17k → 34% × $3k = $1,020", at17k.appliedCredit, 1020);
  // At $43k AGI: 20% floor
  const at43k = calculateDependentCareCredit({ ...base, agi: 43000 });
  check("AGI $43k → 20% × $3k = $600", at43k.appliedCredit, 600);
  // At $100k AGI: still 20% floor
  const at100k = calculateDependentCareCredit({ ...base, agi: 100000 });
  check("AGI $100k → 20% floor still applies = $600", at100k.appliedCredit, 600);
}

// ════════════════════════════════════════════════════════════════════════════
// 14. SE tax — $400 threshold cliff
//     Under $400 net SE → no SE tax. Over → SE tax kicks in.
// ════════════════════════════════════════════════════════════════════════════
header("SE tax $400 net earnings threshold (Schedule SE Line 4c cliff)");
{
  // 1099-NEC × 0.9235 = net SE earnings. If net < $400, no SE tax owed.
  // $400 NEC → 369.40 net (under) → SE tax $0.
  // $432 NEC → 399.0 net (under by $1) → SE tax $0.
  // $433 NEC → 399.87 net (under by 13¢) → SE tax $0.
  // $434 NEC → 400.80 net → SE tax kicks in (15.3% × 400.80 ≈ $61.32).
  const buildSe = (nec: number) => {
    const inp: TaxReturnInputs = {
      client: { filingStatus: "single", state: "FL", taxYear: 2024 },
      w2s: [],
      form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: nec, payerName: "X" }],
      adjustments: [],
      taxYear: 2024,
    };
    return computeTaxReturnPure(inp);
  };
  check("NEC $400 → net $369 → SE tax $0 (under threshold)", buildSe(400).selfEmploymentTax, 0);
  check("NEC $432 → net $399 → SE tax $0 (still under)", buildSe(432).selfEmploymentTax, 0);
  check("NEC $433 → net $399.87 → SE tax $0 (still under)", buildSe(433).selfEmploymentTax, 0);
  // At NEC $434: net 400.80 → 15.3% = $61.32
  check("NEC $434 → net $400.80 → SE tax $61.32 (kicks in)", buildSe(434).selfEmploymentTax, 400.80 * 0.153, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// 15. Capital loss cap MFS — $1,500 not $3,000
// ════════════════════════════════════════════════════════════════════════════
header("Capital loss cap MFS ($1,500 instead of $3,000)");
{
  const buildCapLoss = (status: string, stLoss: number) => {
    const inp: TaxReturnInputs = {
      client: { filingStatus: status, state: "FL", taxYear: 2024 },
      w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
      form1099s: [{ taxYear: 2024, formType: "b", shortTermGainLoss: -stLoss, payerName: "Broker" }],
      adjustments: [],
      taxYear: 2024,
    };
    return computeTaxReturnPure(inp);
  };
  const single5k = buildCapLoss("single", 5000);
  const mfs5k = buildCapLoss("married_filing_separately", 5000);
  check("Single $5k ST loss → $3k cap, $2k STCG carryforward", single5k.capitalLossDeducted, 3000);
  check("Single STCG carryforward = $2k", single5k.capitalLossCarryforwardShort, 2000);
  check("MFS $5k ST loss → $1.5k cap, $3.5k STCG carryforward", mfs5k.capitalLossDeducted, 1500);
  check("MFS STCG carryforward = $3.5k", mfs5k.capitalLossCarryforwardShort, 3500);
}

// ════════════════════════════════════════════════════════════════════════════
// 16. AGI clamp at $0 — large above-the-line deductions
//     Filer with $5k wages + $7k IRA contribution → AGI cannot go negative.
//     Actually $7k IRA is capped by earned income, so deductible = $5k.
//     Real test: small wage + HSA + Schedule C loss.
// ════════════════════════════════════════════════════════════════════════════
header("AGI clamp at $0 — extreme above-the-line via additionalDeductions override");
{
  // Use the legacy additionalDeductions override (catch-all deduction) to drive
  // a clamp scenario. $10k wages, $50k catch-all deductions → AGI clamps at 0.
  // (Schedule C losses are intentionally dropped per known limitation; that's
  // why we use the override here.)
  const inp: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 10000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [{ adjustmentType: "deduction", amount: 50000, isApplied: true }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inp);
  // Manual deduction adjustments flow into AGI subtraction.
  // $10k wages - $50k catch-all = -$40k → clamped at $0.
  checkExact("AGI clamps at $0 (not negative)", r.adjustedGrossIncome >= 0, true);
  check("AGI = $0", r.adjustedGrossIncome, 0, 0.01);
  check("Taxable = $0 (after std ded)", r.taxableIncome, 0, 0.01);
  check("Federal tax = $0", r.federalTaxLiability, 0, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// 17. NIIT MAGI thresholds
//     Single: $200k. MFJ: $250k. MFS: $125k.
//     Below threshold → no NIIT. Above → 3.8% on net investment income or
//     MAGI excess, whichever is lower.
// ════════════════════════════════════════════════════════════════════════════
header("NIIT MAGI threshold — single $200k");
{
  const buildNiit = (wages: number, qdiv: number) => {
    const inp: TaxReturnInputs = {
      client: { filingStatus: "single", state: "FL", taxYear: 2024 },
      w2s: [{ taxYear: 2024, wagesBox1: wages, stateCode: "FL" }],
      form1099s: [{ taxYear: 2024, formType: "div", ordinaryDividends: qdiv, qualifiedDividends: qdiv, payerName: "Fund" }],
      adjustments: [],
      taxYear: 2024,
    };
    return computeTaxReturnPure(inp);
  };
  const under = buildNiit(190000, 9000); // AGI ~199k, below NIIT threshold
  const at = buildNiit(190000, 10000);   // AGI ~200k, at threshold
  const over = buildNiit(195000, 10000); // AGI ~205k, $5k over → NIIT = 3.8% × min($5k, $10k inv inc) = 3.8% × $5k = $190
  check("AGI just under $200k → NIIT $0", under.niitTax, 0);
  check("AGI exactly $200k → NIIT $0 (at threshold, not over)", at.niitTax, 0);
  check("AGI $205k with $10k inv inc → NIIT $190 (3.8% × $5k excess)", over.niitTax, 190, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// 18. LTCG preferential 0% threshold — TY2024 single $47,025
//     Ordinary taxable to $47,025 = 0% rate on LTCG/QDIV that fills below it.
//     Above → 15% on the part above.
// ════════════════════════════════════════════════════════════════════════════
header("LTCG 0% threshold — TY2024 single $47,025");
{
  // Build: W-2 wages only $20k + LTCG $20k → AGI $40k, std ded $14.6k → taxable $25.4k
  // Of that, $20k is LTCG. Ordinary portion $5.4k. LTCG fills $5.4k → $47,025 = $41,625 of 0% room.
  // All $20k LTCG taxed at 0%. Federal tax on ordinary $5.4k = $540. Cap gain tax = $0.
  const inp: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 20000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: 20000, payerName: "Broker" }],
    adjustments: [],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inp);
  check("AGI = $40k (wages + LTCG)", r.adjustedGrossIncome, 40000);
  check("Cap gain tax = $0 (fully in 0% bracket)", r.capitalGainsTax, 0, 0.5);
}

// Above the 0% threshold:
{
  // Wages $50k + LTCG $20k. AGI = $70k. Std ded $14.6k → taxable $55.4k.
  // Ordinary portion = $35.4k. LTCG $20k flows preferentially.
  // 0% room = $47,025 - $35,400 = $11,625. So $11,625 at 0%, remaining $8,375 at 15% = $1,256.25.
  const inp: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: 20000, payerName: "Broker" }],
    adjustments: [],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inp);
  check("Cap gain tax at boundary scenario: ~$1,256", r.capitalGainsTax, 1256.25, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// 19. CTC phase-out — single $200k threshold
//     2 kids = $4,000 preliminary credit.
//     Above $200k AGI: $50 reduction per $1k AGI over (or fraction).
//     At AGI $200k → no phase-out. At $204k → phase out $200 (4×$50).
// ════════════════════════════════════════════════════════════════════════════
header("CTC phase-out — single $200k threshold");
{
  const buildCtc = (wages: number) => {
    const inp: TaxReturnInputs = {
      client: { filingStatus: "single", state: "FL", taxYear: 2024, dependentsUnder17: 2 },
      w2s: [{ taxYear: 2024, wagesBox1: wages, stateCode: "FL" }],
      form1099s: [],
      adjustments: [],
      taxYear: 2024,
    };
    return computeTaxReturnPure(inp);
  };
  const at200 = buildCtc(200000);
  const at204 = buildCtc(204000);
  const at240 = buildCtc(240000);
  const at280 = buildCtc(280000);
  // At $200k → full $4k CTC (2 kids × $2k)
  check("AGI $200k → full CTC $4k", at200.childTaxCredit.appliedCredit, 4000);
  // At $204k → $4k over → 4 × $50 = $200 reduction → $3,800
  check("AGI $204k → CTC reduced by $200 = $3,800", at204.childTaxCredit.appliedCredit, 3800);
  // At $240k → $40k over → 40 × $50 = $2,000 reduction → $2,000 remains
  check("AGI $240k → CTC reduced by $2k = $2,000 remaining", at240.childTaxCredit.appliedCredit, 2000);
  // At $280k → $80k over → 80 × $50 = $4,000 reduction → fully phased to $0
  check("AGI $280k → CTC fully phased to $0", at280.childTaxCredit.appliedCredit, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 20. Filing-status transitions — same data, single → MFS → MFJ
//     Tests that the engine correctly applies status-dependent rules.
// ════════════════════════════════════════════════════════════════════════════
header("Filing-status transitions — same income, different statuses");
{
  const buildFor = (status: string) => {
    const inp: TaxReturnInputs = {
      client: { filingStatus: status, state: "FL", taxYear: 2024 },
      w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
      form1099s: [],
      adjustments: [],
      taxYear: 2024,
    };
    return computeTaxReturnPure(inp);
  };
  const single = buildFor("single");
  const mfj = buildFor("married_filing_jointly");
  const mfs = buildFor("married_filing_separately");
  const hoh = buildFor("head_of_household");

  // Std ded should match
  check("Single std ded $14,600", single.standardDeduction, 14600);
  check("MFJ std ded $29,200", mfj.standardDeduction, 29200);
  check("MFS std ded $14,600", mfs.standardDeduction, 14600);
  check("HoH std ded $21,900", hoh.standardDeduction, 21900);
  // Single and MFS should have different taxable but same std ded
  check("Single taxable = $50k - $14,600 = $35,400", single.taxableIncome, 35400);
  check("MFS taxable = $50k - $14,600 = $35,400", mfs.taxableIncome, 35400);
  check("MFJ taxable = $50k - $29,200 = $20,800", mfj.taxableIncome, 20800);
  // MFS uses single brackets (same as single in IRC for low income, except wider — actually
  // MFS brackets are different from single). At taxable $35,400 MFS uses its own table.
  // 2024 MFS: 10% to $11,600, 12% to $47,150 → same brackets as single below $47,150.
  // So at taxable $35,400, single tax = MFS tax = same amount.
  check("Single and MFS tax identical at low income", single.federalTaxLiability, mfs.federalTaxLiability, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// 21. Saver's credit — MFS eligibility (yes, eligible but with own tier)
// ════════════════════════════════════════════════════════════════════════════
header("Saver's credit — MFS uses 'single' tiers (allowed)");
{
  const r = calculateSaversCredit({
    filingStatus: "married_filing_separately",
    agi: 20000,
    retirementContributions: 1000,
    taxYear: 2024,
  });
  check("MFS AGI $20k contribution $1k → 50% = $500", r.appliedCredit, 500);
}

// ════════════════════════════════════════════════════════════════════════════
// 22. Std deduction itemize coexistence: if Schedule A < std ded, use std
// ════════════════════════════════════════════════════════════════════════════
header("Itemized vs standard — auto-pick");
{
  // Single with $5k charitable cash = $5k itemized < $14,600 std → use std
  const inp: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 60000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [{ adjustmentType: "charitable_cash", amount: 5000, isApplied: true }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inp);
  // taxable should be $60k - $14,600 = $45,400 (std ded picked)
  check("Sched A < std ded → std ded picked", r.taxableIncome, 45400);
}

{
  // Single with $20k SALT + $10k mortgage = $20k itemized (after $10k SALT cap) > $14.6k → use itemized
  const inp: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 60000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 20000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 10000, isApplied: true },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inp);
  // SALT capped at $10k + $10k mortgage = $20k itemized
  // taxable should be $60k - $20k = $40k
  check("Itemized $20k > std → itemized picked", r.taxableIncome, 40000);
}

// ════════════════════════════════════════════════════════════════════════════
// 23. Zero-income edge — no W-2, no 1099, no anything
// ════════════════════════════════════════════════════════════════════════════
header("Zero-income filer");
{
  const inp: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [], adjustments: [],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inp);
  check("Total income $0", r.totalIncome, 0);
  check("AGI $0", r.adjustedGrossIncome, 0);
  check("Federal tax $0", r.federalTaxLiability, 0);
  check("EITC $0 (no earned income)", r.eitc.appliedCredit, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 24. Cross-netting capital gains — ST loss exceeds LT gain
//     ST loss $10k, LT gain $4k → cross-net: ST loss reduces LT gain to 0,
//     remaining ST loss $6k. $3k against ordinary, $3k carryforward as ST.
// ════════════════════════════════════════════════════════════════════════════
header("Cross-netting capital gains — ST loss eats LT gain");
{
  const inp: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 60000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", shortTermGainLoss: -10000, longTermGainLoss: 4000, payerName: "Broker" }],
    adjustments: [],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inp);
  // Cross-net: ST $-10k cross-nets LT $4k → ST -$6k, LT 0
  // Then -$6k loss: $3k against ordinary, $3k carryforward as ST
  check("Cap loss against ordinary = $3k", r.capitalLossDeducted, 3000);
  check("STCG carryforward = $3k (preserves ST char)", r.capitalLossCarryforwardShort, 3000);
  check("LTCG carryforward = $0", r.capitalLossCarryforwardLong, 0);
  check("Cap gain tax = $0 (no preferential income)", r.capitalGainsTax, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════════
console.log("\n══════════════════════ Edge Case Test Summary ══════════════════════");
console.log(`PASS: ${PASS.length}`);
console.log(`FAIL: ${FAIL.length}`);
if (FAIL.length > 0) {
  console.log("\nFAILURES:");
  for (const f of FAIL) console.log("  " + f);
  process.exit(1);
} else {
  console.log("\n✓ All edge case tests pass");
  process.exit(0);
}
