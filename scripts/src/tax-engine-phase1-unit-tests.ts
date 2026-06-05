/**
 * Phase 1 unit tests — Schedule A, EITC, education credits, retirement
 * deductions, saver's credit, dependent care credit.
 */

import {
  calculateScheduleA,
  calculateEitc,
  calculateEducationCredits,
  calculateRetirementDeductions,
  calculateSaversCredit,
  calculateDependentCareCredit,
} from "../../artifacts/api-server/src/lib/taxCalculator";

const PASS: string[] = [];
const FAIL: string[] = [];

function near(a: number, b: number, tol = 0.01) { return Math.abs(a - b) <= tol; }
function check(label: string, actual: number, expected: number, tol = 0.01) {
  if (near(actual, expected, tol)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(4)}, got ${actual.toFixed(4)}`);
}
function checkExact<T>(label: string, actual: T, expected: T) {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

// ── Schedule A ──
header("Schedule A — itemized deductions");
{
  // AGI $100k, medical $10k → 7.5% × 100k = $7,500. Deductible = $10k - $7,500 = $2,500
  const r = calculateScheduleA({
    agi: 100000, filingStatus: "single", taxYear: 2024,
    inputs: { medicalExpenses: 10000 },
  });
  check("Medical: $10k expenses, AGI $100k → $2,500 deductible", r.medicalDeductible, 2500);
}
{
  // AGI $50k, medical $3k → threshold $3,750. Deductible = $0 (below threshold)
  const r = calculateScheduleA({
    agi: 50000, filingStatus: "single", taxYear: 2024,
    inputs: { medicalExpenses: 3000 },
  });
  checkExact("Medical below 7.5% threshold → $0", r.medicalDeductible, 0);
}
{
  // SALT: $8k state + $4k property = $12k → cap to $10k
  const r = calculateScheduleA({
    agi: 100000, filingStatus: "single", taxYear: 2024,
    inputs: { stateIncomeTax: 8000, statePropertyTax: 4000 },
  });
  checkExact("SALT $12k → capped at $10k", r.saltDeductible, 10000);
}
{
  // SALT MFS: $4k state + $4k property = $8k → cap to $5k
  const r = calculateScheduleA({
    agi: 100000, filingStatus: "married_filing_separately", taxYear: 2024,
    inputs: { stateIncomeTax: 4000, statePropertyTax: 4000 },
  });
  checkExact("SALT MFS $8k → capped at $5k", r.saltDeductible, 5000);
}
{
  // SALT under cap
  const r = calculateScheduleA({
    agi: 100000, filingStatus: "single", taxYear: 2024,
    inputs: { stateIncomeTax: 3000, statePropertyTax: 2000 },
  });
  checkExact("SALT $5k → no cap", r.saltDeductible, 5000);
}
{
  // Sales tax option (taxpayer picks larger of income vs sales)
  const r = calculateScheduleA({
    agi: 100000, filingStatus: "single", taxYear: 2024,
    inputs: { stateIncomeTax: 2000, stateSalesTax: 5000, statePropertyTax: 1000 },
  });
  // Picks $5k sales over $2k income, then + $1k property = $6k
  checkExact("Sales tax option chosen if larger", r.saltDeductible, 6000);
}
{
  // Charitable cash: $30k cash, AGI $50k → 60% of $50k = $30k cap, no reduction
  const r = calculateScheduleA({
    agi: 50000, filingStatus: "single", taxYear: 2024,
    inputs: { charitableCash: 30000 },
  });
  checkExact("Charitable cash $30k AGI $50k → $30k", r.charitableDeductible, 30000);
}
{
  // Charitable cash above 60% AGI limit
  const r = calculateScheduleA({
    agi: 50000, filingStatus: "single", taxYear: 2024,
    inputs: { charitableCash: 40000 },
  });
  // 60% × $50k = $30k cap
  checkExact("Charitable cash $40k AGI $50k → $30k (60% cap)", r.charitableDeductible, 30000);
}
{
  // Itemizing better than standard
  const r = calculateScheduleA({
    agi: 200000, filingStatus: "single", taxYear: 2024,
    inputs: { mortgageInterest: 15000, stateIncomeTax: 8000, statePropertyTax: 4000, charitableCash: 5000 },
  });
  // Mortgage $15k + SALT $10k (capped) + Charity $5k = $30k itemized
  // Std single 2024 = $14,600. Itemizing wins.
  check("Total itemized $30k > std $14,600", r.totalItemized, 30000);
  checkExact("Itemizing better", r.itemizingBetter, true);
  checkExact("Use $30k", r.deductionToUse, 30000);
}
{
  // Standard better than itemizing
  const r = calculateScheduleA({
    agi: 100000, filingStatus: "single", taxYear: 2024,
    inputs: { stateIncomeTax: 3000, charitableCash: 1000 },
  });
  // Itemized = $4k. Std = $14,600. Std wins.
  checkExact("Std $14,600 > itemized", r.deductionToUse, 14600);
  checkExact("Itemizing not better", r.itemizingBetter, false);
}

// ── EITC ──
header("EITC — Earned Income Tax Credit");
{
  // Single, no children, earned $10k, AGI $10k, no investment.
  // 2024: max $632 at $8,260; $10k > $8,260 → $632. Phase-out starts at $10,330. Below → $632.
  const r = calculateEitc({ filingStatus: "single", qualifyingChildren: 0, earnedIncome: 10000, agi: 10000, investmentIncome: 0, taxYear: 2024 });
  check("EITC single 0 kids @ $10k", r.appliedCredit, 632, 1);
}
{
  // Single, 2 children, earned $20k, AGI $20k.
  // 2024: phase-in 40% × $17,400 = $6,960 max. $20k > $17,400 → $6,960. Phase-out from $22,720. $20k < threshold → full $6,960.
  const r = calculateEitc({ filingStatus: "single", qualifyingChildren: 2, earnedIncome: 20000, agi: 20000, investmentIncome: 0, taxYear: 2024 });
  check("EITC single 2 kids @ $20k", r.appliedCredit, 6960, 1);
}
{
  // Single, 2 children, earned $30k, AGI $30k. Phase-out kicks in: $30k - $22,720 = $7,280 over.
  // Reduction = $7,280 × 0.2106 = $1,533.17. Credit = $6,960 - $1,533.17 = $5,426.83
  const r = calculateEitc({ filingStatus: "single", qualifyingChildren: 2, earnedIncome: 30000, agi: 30000, investmentIncome: 0, taxYear: 2024 });
  check("EITC single 2 kids @ $30k (partial phase-out)", r.appliedCredit, 5426.83, 1);
}
{
  // Single, 2 children, AGI $60k → fully phased out
  const r = calculateEitc({ filingStatus: "single", qualifyingChildren: 2, earnedIncome: 60000, agi: 60000, investmentIncome: 0, taxYear: 2024 });
  checkExact("EITC fully phased out at $60k", r.appliedCredit, 0);
}
{
  // Investment income disqualifies
  const r = calculateEitc({ filingStatus: "single", qualifyingChildren: 2, earnedIncome: 20000, agi: 20000, investmentIncome: 12000, taxYear: 2024 });
  checkExact("EITC: investment over $11,600 → ineligible", r.appliedCredit, 0);
  checkExact("Reason: investment income too high", r.eligible, false);
}
{
  // MFS not eligible
  const r = calculateEitc({ filingStatus: "married_filing_separately", qualifyingChildren: 2, earnedIncome: 20000, agi: 20000, investmentIncome: 0, taxYear: 2024 });
  checkExact("EITC: MFS not eligible", r.appliedCredit, 0);
}
{
  // Phase-in (very low earnings)
  // Single, 1 child, earned $5k. Below max-at-income $12,390. Credit = $5k × 34% = $1,700
  const r = calculateEitc({ filingStatus: "single", qualifyingChildren: 1, earnedIncome: 5000, agi: 5000, investmentIncome: 0, taxYear: 2024 });
  check("EITC: phase-in 34% × $5k = $1,700", r.appliedCredit, 1700);
}

// ── Education credits ──
header("Education credits — AOC + LLC");
{
  // 1 student, $4,000 expenses. AOC = 100%×$2k + 25%×$2k = $2,500. AGI $50k (no phase-out).
  const r = calculateEducationCredits({
    agi: 50000, filingStatus: "single",
    aocExpenses: [4000], llcExpenses: 0,
  });
  checkExact("AOC: 1 student $4k → $2,500 max", r.aocPreliminary, 2500);
  checkExact("Full credit (no phase-out)", r.aocApplied, 2500);
  checkExact("Refundable portion 40%", r.aocRefundable, 1000);
  checkExact("Non-refundable portion 60%", r.aocNonRefundable, 1500);
}
{
  // 2 students, both with $4k expenses → 2 × $2,500 = $5,000
  const r = calculateEducationCredits({
    agi: 50000, filingStatus: "married_filing_jointly",
    aocExpenses: [4000, 4000], llcExpenses: 0,
  });
  checkExact("AOC: 2 students × $2,500 = $5,000", r.aocPreliminary, 5000);
}
{
  // Phase-out: single AGI $85k, halfway through $80k-$90k range → 50% reduction
  const r = calculateEducationCredits({
    agi: 85000, filingStatus: "single",
    aocExpenses: [4000], llcExpenses: 0,
  });
  check("AOC phase-out at $85k → 50%", r.aocApplied, 1250, 0.5);
}
{
  // Fully phased out
  const r = calculateEducationCredits({
    agi: 90000, filingStatus: "single",
    aocExpenses: [4000], llcExpenses: 0,
  });
  checkExact("AOC fully phased out at $90k", r.aocApplied, 0);
}
{
  // LLC: 20% × $10k = $2,000 max
  const r = calculateEducationCredits({
    agi: 50000, filingStatus: "single",
    aocExpenses: [], llcExpenses: 10000,
  });
  checkExact("LLC: 20% × $10k = $2,000 max", r.llcApplied, 2000);
}
{
  // LLC capped at $10k of expenses
  const r = calculateEducationCredits({
    agi: 50000, filingStatus: "single",
    aocExpenses: [], llcExpenses: 50000,
  });
  checkExact("LLC capped at $10k expenses → $2,000", r.llcApplied, 2000);
}

// ── HSA + IRA deductions ──
header("HSA + IRA — retirement deductions");
{
  // HSA self-only 2024: limit $4,150
  const r = calculateRetirementDeductions({
    hsaContribution: 5000, hsaIsFamilyCoverage: false,
    iraContribution: 0, iraCoveredByWorkplacePlan: false,
    age: 40, agi: 50000, filingStatus: "single", taxYear: 2024,
  });
  checkExact("HSA self-only 2024 cap $4,150", r.hsaDeductible, 4150);
}
{
  // HSA family 2024: $8,300, with catch-up at 55+
  const r = calculateRetirementDeductions({
    hsaContribution: 10000, hsaIsFamilyCoverage: true,
    iraContribution: 0, iraCoveredByWorkplacePlan: false,
    age: 56, agi: 100000, filingStatus: "married_filing_jointly", taxYear: 2024,
  });
  checkExact("HSA family + 55+ catch-up: $8,300 + $1,000 = $9,300", r.hsaDeductible, 9300);
}
{
  // IRA full deduction (not covered by workplace plan)
  const r = calculateRetirementDeductions({
    hsaContribution: 0, hsaIsFamilyCoverage: false,
    iraContribution: 7000, iraCoveredByWorkplacePlan: false,
    age: 30, agi: 200000, filingStatus: "single", taxYear: 2024,
  });
  checkExact("IRA full deduction (not covered by plan)", r.iraDeductible, 7000);
}
{
  // IRA covered by plan, AGI in phase-out (single $77k-$87k)
  const r = calculateRetirementDeductions({
    hsaContribution: 0, hsaIsFamilyCoverage: false,
    iraContribution: 7000, iraCoveredByWorkplacePlan: true,
    age: 30, agi: 82000, filingStatus: "single", taxYear: 2024,
  });
  // 50% phased out: $87k-$82k = $5k remaining of $10k range = 50% deductible
  check("IRA phase-out at AGI $82k single → 50%", r.iraDeductible, 3500, 1);
}
{
  // IRA fully phased out at $87k single
  const r = calculateRetirementDeductions({
    hsaContribution: 0, hsaIsFamilyCoverage: false,
    iraContribution: 7000, iraCoveredByWorkplacePlan: true,
    age: 30, agi: 87000, filingStatus: "single", taxYear: 2024,
  });
  checkExact("IRA fully phased out at $87k single", r.iraDeductible, 0);
}

// ── Saver's Credit ──
header("Saver's Credit");
{
  // Single, AGI $20k, $2k IRA contribution → 50% × $2k = $1,000
  const r = calculateSaversCredit({ filingStatus: "single", agi: 20000, retirementContributions: 2000, taxYear: 2024 });
  checkExact("Saver's credit 50% × $2k", r.appliedCredit, 1000);
}
{
  // Single, AGI $24k → 20% rate
  const r = calculateSaversCredit({ filingStatus: "single", agi: 24000, retirementContributions: 2000, taxYear: 2024 });
  checkExact("Saver's credit 20% × $2k", r.appliedCredit, 400);
}
{
  // Single, AGI $30k → 10% rate
  const r = calculateSaversCredit({ filingStatus: "single", agi: 30000, retirementContributions: 2000, taxYear: 2024 });
  checkExact("Saver's credit 10% × $2k", r.appliedCredit, 200);
}
{
  // Single, AGI $40k → above $38,250, rate = 0%
  const r = calculateSaversCredit({ filingStatus: "single", agi: 40000, retirementContributions: 2000, taxYear: 2024 });
  checkExact("Saver's credit 0% (above threshold)", r.appliedCredit, 0);
}
{
  // MFJ, AGI $40k, $5k contribution → 50% × $4k cap = $2,000
  const r = calculateSaversCredit({ filingStatus: "married_filing_jointly", agi: 40000, retirementContributions: 5000, taxYear: 2024 });
  checkExact("MFJ saver's credit 50% × $4k cap = $2,000", r.appliedCredit, 2000);
}

// ── Dependent care credit ──
header("Dependent Care Credit");
{
  // 1 child, $5k expenses, AGI $30k, 1 worker @ $30k earned. Limit = $3k.
  // Form 2441 §21(a)(2): reductions = ceil(($30k - $15k)/$2k) = ceil(7.5) = 8
  // ("OR fraction thereof"). Rate = 35% - 8% = 27% ($30k sits in the $29k-$31k
  // band). Eligible = min($5k, $3k, $30k) = $3k. Credit = $3k × 27% = $810.
  const r = calculateDependentCareCredit({
    expenses: 5000, qualifyingDependents: 1, earnedIncomeTaxpayer: 30000, agi: 30000, filingStatus: "single",
  });
  check("Dependent care: 1 child, $5k exp, AGI $30k, rate 27%", r.appliedCredit, 810);
}
{
  // 2 children, $7k expenses, AGI $50k MFJ both work. Limit = $6k. Rate = 20% (above $43k AGI).
  // Credit = $6k × 20% = $1,200
  const r = calculateDependentCareCredit({
    expenses: 7000, qualifyingDependents: 2,
    earnedIncomeTaxpayer: 30000, earnedIncomeSpouse: 30000,
    agi: 50000, filingStatus: "married_filing_jointly",
  });
  checkExact("Dependent care 2 kids @ $50k AGI → 20% × $6k = $1,200", r.appliedCredit, 1200);
}
{
  // MFJ but spouse has $0 earned → no credit
  const r = calculateDependentCareCredit({
    expenses: 5000, qualifyingDependents: 1,
    earnedIncomeTaxpayer: 100000, earnedIncomeSpouse: 0,
    agi: 100000, filingStatus: "married_filing_jointly",
  });
  checkExact("Dependent care: MFJ + spouse $0 earned → $0", r.appliedCredit, 0);
}
{
  // 0 dependents → $0
  const r = calculateDependentCareCredit({
    expenses: 5000, qualifyingDependents: 0, earnedIncomeTaxpayer: 50000, agi: 50000, filingStatus: "single",
  });
  checkExact("Dependent care: 0 kids → $0", r.appliedCredit, 0);
}

// ── Summary ──
console.log("\n");
console.log("══════════════════════════════════════════════════════════════════");
console.log(`  PHASE 1 UNIT RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
console.log("══════════════════════════════════════════════════════════════════");
if (FAIL.length > 0) {
  for (const f of FAIL) console.log("  " + f);
  process.exit(1);
}
process.exit(0);
