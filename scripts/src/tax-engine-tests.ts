/**
 * Comprehensive correctness tests for the tax engine.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-tests.ts
 *
 * Categories:
 *   A. Federal bracket math (all filing statuses × 2024/2025)
 *   B. Federal standard deduction values
 *   C. Federal known-answer scenarios (cross-checked against published IRS examples)
 *   D. State tax — every state, including no-tax / flat / progressive / surtax
 *   E. Adjustments — each type's effect on AGI / withholding / credits
 *   F. CTC — including phase-outs and Other Dependents
 *   G. Edge cases
 */

import {
  calculateFederalTax,
  getFederalStandardDeduction,
  calculateStateTax,
  calculateChildTaxCredit,
  runTaxCalculation,
  resolveTaxYear,
} from "../../artifacts/api-server/src/lib/taxCalculator";
import { STATE_TAX_DATA_BY_YEAR } from "../../artifacts/api-server/src/lib/stateTaxData";

// ── Test harness ─────────────────────────────────────────────────────────────
const PASS: string[] = [];
const FAIL: string[] = [];

function near(actual: number, expected: number, tol = 0.01): boolean {
  return Math.abs(actual - expected) <= tol;
}

function check(label: string, actual: number, expected: number, tol = 0.01) {
  if (near(actual, expected, tol)) {
    PASS.push(`✓ ${label}`);
  } else {
    FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)} (diff ${(actual - expected).toFixed(2)})`);
  }
}

function checkExact(label: string, actual: number, expected: number) {
  if (actual === expected) {
    PASS.push(`✓ ${label}`);
  } else {
    FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
  }
}

function header(name: string) {
  console.log(`\n── ${name} ─────────────────────────────────────`);
}

// ── A. Federal bracket math ─────────────────────────────────────────────────
header("A. Federal bracket math: 2024 single");
// 2024 single brackets: 10% to 11600, 12% to 47150, 22% to 100525, 24% to 191950, 32% to 243725, 35% to 609350, 37% above
check("Single 2024 $0 → $0", calculateFederalTax(0, "single", 2024), 0);
check("Single 2024 $5,000 → $500", calculateFederalTax(5000, "single", 2024), 500);
check("Single 2024 $11,600 (top of 10%)", calculateFederalTax(11600, "single", 2024), 1160);
check("Single 2024 $20,000", calculateFederalTax(20000, "single", 2024), 1160 + (20000 - 11600) * 0.12);
check("Single 2024 $47,150 (top of 12%)", calculateFederalTax(47150, "single", 2024), 1160 + (47150 - 11600) * 0.12);
check("Single 2024 $50,000", calculateFederalTax(50000, "single", 2024), 1160 + (47150 - 11600) * 0.12 + (50000 - 47150) * 0.22);
check("Single 2024 $100,525 (top of 22%)", calculateFederalTax(100525, "single", 2024), 1160 + (47150 - 11600) * 0.12 + (100525 - 47150) * 0.22);
check("Single 2024 $200,000", calculateFederalTax(200000, "single", 2024),
  1160 + (47150 - 11600) * 0.12 + (100525 - 47150) * 0.22 + (191950 - 100525) * 0.24 + (200000 - 191950) * 0.32);
check("Single 2024 $1,000,000 (top bracket)", calculateFederalTax(1000000, "single", 2024),
  1160 + (47150 - 11600) * 0.12 + (100525 - 47150) * 0.22 + (191950 - 100525) * 0.24 + (243725 - 191950) * 0.32 + (609350 - 243725) * 0.35 + (1000000 - 609350) * 0.37);

header("A. Federal bracket math: 2024 MFJ");
// 2024 MFJ: 10% to 23200, 12% to 94300, 22% to 201050, 24% to 383900, 32% to 487450, 35% to 731200, 37% above
check("MFJ 2024 $0", calculateFederalTax(0, "married_filing_jointly", 2024), 0);
check("MFJ 2024 $23,200 (top of 10%)", calculateFederalTax(23200, "married_filing_jointly", 2024), 2320);
check("MFJ 2024 $50,000", calculateFederalTax(50000, "married_filing_jointly", 2024), 2320 + (50000 - 23200) * 0.12);
check("MFJ 2024 $100,000", calculateFederalTax(100000, "married_filing_jointly", 2024), 2320 + (94300 - 23200) * 0.12 + (100000 - 94300) * 0.22);
check("MFJ 2024 $500,000", calculateFederalTax(500000, "married_filing_jointly", 2024),
  2320 + (94300 - 23200) * 0.12 + (201050 - 94300) * 0.22 + (383900 - 201050) * 0.24 + (487450 - 383900) * 0.32 + (500000 - 487450) * 0.35);

header("A. Federal bracket math: 2024 HoH");
check("HoH 2024 $16,550 (top of 10%)", calculateFederalTax(16550, "head_of_household", 2024), 1655);
check("HoH 2024 $80,000", calculateFederalTax(80000, "head_of_household", 2024), 1655 + (63100 - 16550) * 0.12 + (80000 - 63100) * 0.22);

header("A. Federal bracket math: 2024 MFS");
check("MFS 2024 $11,600 (top of 10%)", calculateFederalTax(11600, "married_filing_separately", 2024), 1160);
check("MFS 2024 $400,000 (in 35%)", calculateFederalTax(400000, "married_filing_separately", 2024),
  1160 + (47150 - 11600) * 0.12 + (100525 - 47150) * 0.22 + (191950 - 100525) * 0.24 + (243725 - 191950) * 0.32 + (365600 - 243725) * 0.35 + (400000 - 365600) * 0.37);

header("A. Federal bracket math: 2025 single");
// 2025: std $15k, brackets 10%/$11925, 12%/$48475, 22%/$103350, 24%/$197300, 32%/$250525, 35%/$626350, 37%
check("Single 2025 $11,925 (top of 10%)", calculateFederalTax(11925, "single", 2025), 1192.5);
check("Single 2025 $50,000", calculateFederalTax(50000, "single", 2025), 1192.5 + (48475 - 11925) * 0.12 + (50000 - 48475) * 0.22);
check("Single 2025 $200,000", calculateFederalTax(200000, "single", 2025),
  1192.5 + (48475 - 11925) * 0.12 + (103350 - 48475) * 0.22 + (197300 - 103350) * 0.24 + (200000 - 197300) * 0.32);

header("A. Federal bracket math: 2025 MFJ");
check("MFJ 2025 $23,850 (top of 10%)", calculateFederalTax(23850, "married_filing_jointly", 2025), 2385);
check("MFJ 2025 $250,000", calculateFederalTax(250000, "married_filing_jointly", 2025),
  2385 + (96950 - 23850) * 0.12 + (206700 - 96950) * 0.22 + (250000 - 206700) * 0.24);

// ── B. Federal standard deduction values ───────────────────────────────────
header("B. Federal standard deductions");
checkExact("Single 2024 std", getFederalStandardDeduction("single", 2024), 14600);
checkExact("MFJ 2024 std", getFederalStandardDeduction("married_filing_jointly", 2024), 29200);
checkExact("MFS 2024 std", getFederalStandardDeduction("married_filing_separately", 2024), 14600);
checkExact("HoH 2024 std", getFederalStandardDeduction("head_of_household", 2024), 21900);
checkExact("QW 2024 std", getFederalStandardDeduction("qualifying_widow", 2024), 29200);
checkExact("Single 2025 std", getFederalStandardDeduction("single", 2025), 15000);
checkExact("MFJ 2025 std", getFederalStandardDeduction("married_filing_jointly", 2025), 30000);
checkExact("MFS 2025 std", getFederalStandardDeduction("married_filing_separately", 2025), 15000);
checkExact("HoH 2025 std", getFederalStandardDeduction("head_of_household", 2025), 22500);
checkExact("QW 2025 std", getFederalStandardDeduction("qualifying_widow", 2025), 30000);

// ── C. Federal known-answer scenarios ───────────────────────────────────────
header("C. Federal known-answer scenarios");
// IRS 2024 tax tables (approx / formula method):
// $40,000 single, std deduction → $40,000 - $14,600 = $25,400 taxable
// 1160 + (25400 - 11600) * 0.12 = 1160 + 1656 = 2816
const single40k = runTaxCalculation({
  totalWages: 40000, additionalIncome: 0, filingStatus: "single", stateCode: "FL",
  useItemizedDeductions: false, itemizedDeductions: 0, adjustments: 0, taxYear: 2024,
});
check("Single 2024 $40k wages → fed tax $2,816", single40k.federalTaxLiability, 2816);
checkExact("Single 2024 $40k → $0 state tax (FL)", single40k.stateTaxLiability, 0);

// $150,000 MFJ wages → AGI $150k, taxable $120,800
// 2320 + (94300 - 23200) * 0.12 + (120800 - 94300) * 0.22 = 2320 + 8532 + 5830 = 16,682
const mfj150k = runTaxCalculation({
  totalWages: 150000, additionalIncome: 0, filingStatus: "married_filing_jointly", stateCode: "FL",
  useItemizedDeductions: false, itemizedDeductions: 0, adjustments: 0, taxYear: 2024,
});
check("MFJ 2024 $150k wages → fed tax $16,682", mfj150k.federalTaxLiability, 16682);

// ── D. State tax tests ─────────────────────────────────────────────────────
header("D. State tax: no-income-tax states");
const NO_TAX_STATES = ["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"];
for (const st of NO_TAX_STATES) {
  checkExact(`${st} returns $0 at $80k single`, calculateStateTax(80000, st, "single", 2024), 0);
}

header("D. State tax: flat-rate states 2024");
// Each: AGI $80,000 single, 2024 → expected = (80,000 - state_std) × rate
const FLAT_STATES_2024: Array<[string, number, number]> = [
  // [state, rate, std deduction (single)]
  ["AZ", 0.025, 14600],
  ["CO", 0.044, 14600],
  ["GA", 0.0539, 12000],
  ["ID", 0.058, 14600],
  ["IL", 0.0495, 0],
  ["IN", 0.0305, 0],
  ["KY", 0.04, 3160],
  ["MI", 0.0425, 0],
  ["MS", 0.047, 12300],
  ["NC", 0.045, 12750],
  ["PA", 0.0307, 0],
  ["UT", 0.0455, 0],
];
for (const [st, rate, stdDed] of FLAT_STATES_2024) {
  const expected = Math.max(0, (80000 - stdDed)) * rate;
  check(`${st} 2024 $80k → ${(rate * 100).toFixed(2)}%`, calculateStateTax(80000, st, "single", 2024), expected);
}

// MA flat 5% but no std deduction
check("MA 2024 $80k single", calculateStateTax(80000, "MA", "single", 2024), 4000);
// MA millionaire's tax: AGI $1.5M → 5% on full + 4% surtax on (1.5M - 1.0537M)
const maMillion = calculateStateTax(1500000, "MA", "single", 2024);
const expectedMaMillion = 1500000 * 0.05 + (1500000 - 1053750) * 0.04;
check("MA 2024 $1.5M → 5% + 4% surtax over $1.05M", maMillion, expectedMaMillion);

header("D. State tax: progressive — California 2024");
// CA single 2024 std $5,540
// AGI $80k → state taxable $74,460
// 1% × 10,756 + 2% × 14,743 + 4% × 14,746 + 6% × 15,621 + 8% × 14,740 + 9.3% × (74460 - 70606)
const caExp = 10756 * 0.01 + 14743 * 0.02 + 14746 * 0.04 + 15621 * 0.06 + 14740 * 0.08 + (74460 - 70606) * 0.093;
check("CA 2024 $80k single", calculateStateTax(80000, "CA", "single", 2024), caExp);

// CA MFJ 2024 std $11,080, AGI $200k → taxable $188,920
// 1% × 21,512 + 2% × 29,486 + 4% × 30,376 + 6% × 31,242 + 8% × 29,480 + 9.3% × (188920 - 141212)
const caMfjExp = 21512 * 0.01 + (50998 - 21512) * 0.02 + (80490 - 50998) * 0.04 + (111732 - 80490) * 0.06 + (141212 - 111732) * 0.08 + (188920 - 141212) * 0.093;
check("CA 2024 $200k MFJ", calculateStateTax(200000, "CA", "married_filing_jointly", 2024), caMfjExp);

// CA mental health 1% surtax over $1M
// AGI $1.5M → 5% surtax baseline + bracket math + (500k × 1%) surtax
// Just verify the surtax adds correctly relative to a baseline below threshold
const ca999k = calculateStateTax(999000, "CA", "single", 2024);
const ca1500k = calculateStateTax(1500000, "CA", "single", 2024);
// The surtax adds $5,000 (500k × 1%); the bracket math adds (501k × 12.3%) for bracket-only difference
const expectedDiff = (1500000 - 999000) * 0.123 + (1500000 - 1000000) * 0.01;
check("CA 2024 surtax: $1.5M − $999k delta", ca1500k - ca999k, expectedDiff);

header("D. State tax: progressive — New York 2024");
// NY single 2024 std $8,000, AGI $80k → taxable $72,000
// 4% × 8500 + 4.5% × 3200 + 5.25% × 2200 + 5.5% × (72000-13900)
const nyExp = 8500 * 0.04 + 3200 * 0.045 + 2200 * 0.0525 + (72000 - 13900) * 0.055;
check("NY 2024 $80k single", calculateStateTax(80000, "NY", "single", 2024), nyExp);

// NY MFJ 2024 std $16,050, AGI $250k → taxable $233,950
// 4% × 17150 + 4.5% × 6450 + 5.25% × 4300 + 5.5% × (161550-27900) + 6% × (233950-161550)
const nyMfjExp = 17150 * 0.04 + 6450 * 0.045 + 4300 * 0.0525 + (161550 - 27900) * 0.055 + (233950 - 161550) * 0.06;
check("NY 2024 $250k MFJ", calculateStateTax(250000, "NY", "married_filing_jointly", 2024), nyMfjExp);

header("D. State tax: progressive — Oregon 2024");
// OR single 2024 std $2,745, AGI $80k → taxable $77,255
// 4.75% × 4300 + 6.75% × (10750-4300) + 8.75% × (77255-10750)
const orExp = 4300 * 0.0475 + (10750 - 4300) * 0.0675 + (77255 - 10750) * 0.0875;
check("OR 2024 $80k single", calculateStateTax(80000, "OR", "single", 2024), orExp);

header("D. State tax: progressive — Hawaii 2024");
// HI single 2024 std $4,400, AGI $80k → taxable $75,600
// 1.4%×2400 + 3.2%×2400 + 5.5%×4800 + 6.4%×4800 + 6.8%×4800 + 7.2%×4800 + 7.6%×12000 + 7.9%×12000 + 8.25% × (75600-48000)
const hiExp = 2400 * 0.014 + 2400 * 0.032 + 4800 * 0.055 + 4800 * 0.064 + 4800 * 0.068 + 4800 * 0.072 + 12000 * 0.076 + 12000 * 0.079 + (75600 - 48000) * 0.0825;
check("HI 2024 $80k single", calculateStateTax(80000, "HI", "single", 2024), hiExp);

header("D. State tax: every state at $50k single (smoke test)");
const ALL_STATES = Object.keys(STATE_TAX_DATA_BY_YEAR[2024]).sort();
let stateRunTotal = 0;
for (const st of ALL_STATES) {
  const tax = calculateStateTax(50000, st, "single", 2024);
  if (Number.isNaN(tax) || tax < 0 || !Number.isFinite(tax)) {
    FAIL.push(`✗ ${st} produced invalid tax: ${tax}`);
  } else {
    stateRunTotal += tax;
    PASS.push(`✓ ${st} 2024 $50k single = $${tax.toFixed(2)}`);
  }
}
console.log(`  All ${ALL_STATES.length} states ran without error. Total tax across states (sanity only): $${stateRunTotal.toFixed(0)}`);

header("D. State tax: 2025 — known rate changes from TY2024");
// IN dropped 3.05% → 3.00% in 2025
check("IN 2025 $80k single (3.0%)", calculateStateTax(80000, "IN", "single", 2025), 80000 * 0.03);
// KY dropped 4.0% → 3.5%, std $3,270
check("KY 2025 $80k single (3.5% over std $3,270)", calculateStateTax(80000, "KY", "single", 2025), (80000 - 3270) * 0.035);
// MS dropped to 4.4%
check("MS 2025 $80k single (4.4%)", calculateStateTax(80000, "MS", "single", 2025), (80000 - 12300) * 0.044);
// NC dropped to 4.25%
check("NC 2025 $80k single (4.25%)", calculateStateTax(80000, "NC", "single", 2025), (80000 - 12750) * 0.0425);
// LA flat 3% with std $12,500
check("LA 2025 $80k single (3% over std $12,500)", calculateStateTax(80000, "LA", "single", 2025), (80000 - 12500) * 0.03);
// IA flat 3.8%
check("IA 2025 $80k single (3.8%)", calculateStateTax(80000, "IA", "single", 2025), (80000 - 2630) * 0.038);
// UT dropped to 4.5%
check("UT 2025 $80k single (4.5%)", calculateStateTax(80000, "UT", "single", 2025), 80000 * 0.045);
// GA dropped to 5.19%
check("GA 2025 $80k single (5.19%)", calculateStateTax(80000, "GA", "single", 2025), (80000 - 12000) * 0.0519);

// ── E. Adjustments behavior (via runTaxCalculation) ─────────────────────────
header("E. Adjustments behavior: runTaxCalculation");
// Baseline: single, $100k wages, FL, no adjustments
const baseline = runTaxCalculation({
  totalWages: 100000, additionalIncome: 0, filingStatus: "single", stateCode: "FL",
  useItemizedDeductions: false, itemizedDeductions: 0, adjustments: 0, taxYear: 2024,
});
checkExact("Baseline AGI = totalWages", baseline.adjustedGrossIncome, 100000);
checkExact("Baseline taxable = 100k - 14.6k = 85.4k", baseline.taxableIncome, 85400);
// Federal: 1160 + (47150 - 11600)*0.12 + (85400 - 47150)*0.22 = 1160 + 4266 + 8415 = 13841
check("Baseline federal tax", baseline.federalTaxLiability, 13841);

// Above-the-line adjustments reduce AGI
const withAdj = runTaxCalculation({
  totalWages: 100000, additionalIncome: 0, filingStatus: "single", stateCode: "FL",
  useItemizedDeductions: false, itemizedDeductions: 0, adjustments: 5000, taxYear: 2024,
});
checkExact("Adjustments reduce AGI: $100k - $5k = $95k", withAdj.adjustedGrossIncome, 95000);
checkExact("Adjustments → taxable = $95k - $14.6k = $80.4k", withAdj.taxableIncome, 80400);

// Itemized deductions REPLACE standard when greater
const itemizedHigher = runTaxCalculation({
  totalWages: 100000, additionalIncome: 0, filingStatus: "single", stateCode: "FL",
  useItemizedDeductions: true, itemizedDeductions: 25000, adjustments: 0, taxYear: 2024,
});
checkExact("Itemized $25k > std $14.6k: deduction = $25k", itemizedHigher.standardDeduction, 25000);
checkExact("Itemized → taxable = $100k - $25k = $75k", itemizedHigher.taxableIncome, 75000);

// Itemized < standard → standard wins
const itemizedLower = runTaxCalculation({
  totalWages: 100000, additionalIncome: 0, filingStatus: "single", stateCode: "FL",
  useItemizedDeductions: true, itemizedDeductions: 5000, adjustments: 0, taxYear: 2024,
});
checkExact("Itemized $5k < std $14.6k: deduction = $14.6k (std wins)", itemizedLower.standardDeduction, 14600);

// Additional income raises AGI
const withAddlIncome = runTaxCalculation({
  totalWages: 100000, additionalIncome: 15000, filingStatus: "single", stateCode: "FL",
  useItemizedDeductions: false, itemizedDeductions: 0, adjustments: 0, taxYear: 2024,
});
checkExact("Additional income $15k → AGI = $115k", withAddlIncome.adjustedGrossIncome, 115000);

// ── F. CTC permutations ────────────────────────────────────────────────────
header("F. Child Tax Credit permutations");
// 0 dependents
{
  const r = calculateChildTaxCredit({ qualifyingChildren: 0, otherDependents: 0, agi: 50000, filingStatus: "single", taxYear: 2024 });
  checkExact("0 deps → applied $0", r.appliedCredit, 0);
  checkExact("0 deps → preliminary $0", r.preliminaryCredit, 0);
}
// 1 child, low income
{
  const r = calculateChildTaxCredit({ qualifyingChildren: 1, otherDependents: 0, agi: 50000, filingStatus: "single", taxYear: 2024 });
  checkExact("1 child @ $50k single → $2,000", r.appliedCredit, 2000);
}
// 3 children @ $80k MFJ
{
  const r = calculateChildTaxCredit({ qualifyingChildren: 3, otherDependents: 0, agi: 80000, filingStatus: "married_filing_jointly", taxYear: 2024 });
  checkExact("3 children @ $80k MFJ → $6,000", r.appliedCredit, 6000);
  checkExact("MFJ threshold → $400,000", r.phaseOutThreshold, 400000);
}
// Phase-out scenarios
// Single AGI $245k, 2 children: ceil(45/1)*50 = $2,250 reduction; $4,000 - $2,250 = $1,750
{
  const r = calculateChildTaxCredit({ qualifyingChildren: 2, otherDependents: 0, agi: 245000, filingStatus: "single", taxYear: 2024 });
  checkExact("Single AGI $245k, 2 ch → $1,750", r.appliedCredit, 1750);
  checkExact("Phase-out reduction $2,250", r.phaseOutReduction, 2250);
}
// Single AGI $200,001 (just above threshold): $4,000 - $50 = $3,950
{
  const r = calculateChildTaxCredit({ qualifyingChildren: 2, otherDependents: 0, agi: 200001, filingStatus: "single", taxYear: 2024 });
  checkExact("Single AGI $200,001, 2 ch → $3,950 ($50 phase-out)", r.appliedCredit, 3950);
}
// Full phase-out: 1 child, AGI $300k single
// Phase-out = ceil(100/1)*50 = $5,000 → $2,000 - $5,000 → max(0, ...) = $0
{
  const r = calculateChildTaxCredit({ qualifyingChildren: 1, otherDependents: 0, agi: 300000, filingStatus: "single", taxYear: 2024 });
  checkExact("Single AGI $300k, 1 ch → $0 (fully phased out)", r.appliedCredit, 0);
}
// MFJ $250k, 2 ch (under $400k MFJ threshold)
{
  const r = calculateChildTaxCredit({ qualifyingChildren: 2, otherDependents: 0, agi: 250000, filingStatus: "married_filing_jointly", taxYear: 2024 });
  checkExact("MFJ $250k, 2 ch → $4,000 (no phase-out)", r.appliedCredit, 4000);
}
// MFJ $410k, 2 ch (over threshold by $10k → $500 reduction)
{
  const r = calculateChildTaxCredit({ qualifyingChildren: 2, otherDependents: 0, agi: 410000, filingStatus: "married_filing_jointly", taxYear: 2024 });
  checkExact("MFJ $410k, 2 ch → $3,500", r.appliedCredit, 3500);
}
// Other Dependents: $500 each
{
  const r = calculateChildTaxCredit({ qualifyingChildren: 0, otherDependents: 2, agi: 50000, filingStatus: "single", taxYear: 2024 });
  checkExact("0 children + 2 other deps @ $50k → $1,000", r.appliedCredit, 1000);
}
// Combined: 2 children + 1 other dependent
{
  const r = calculateChildTaxCredit({ qualifyingChildren: 2, otherDependents: 1, agi: 50000, filingStatus: "single", taxYear: 2024 });
  checkExact("2 children + 1 other @ $50k → $4,500", r.appliedCredit, 4500);
}

// ── G. Edge cases ──────────────────────────────────────────────────────────
header("G. Edge cases");
checkExact("Zero income, no adjustments → $0 fed", runTaxCalculation({
  totalWages: 0, additionalIncome: 0, filingStatus: "single", stateCode: "FL",
  useItemizedDeductions: false, itemizedDeductions: 0, adjustments: 0, taxYear: 2024,
}).federalTaxLiability, 0);

checkExact("Negative effective rate doesn't go negative (no income)", runTaxCalculation({
  totalWages: 0, additionalIncome: 0, filingStatus: "single", stateCode: "FL",
  useItemizedDeductions: false, itemizedDeductions: 0, adjustments: 0, taxYear: 2024,
}).effectiveTaxRate, 0);

checkExact("Adjustments exceeding income don't cause negative AGI", runTaxCalculation({
  totalWages: 30000, additionalIncome: 0, filingStatus: "single", stateCode: "FL",
  useItemizedDeductions: false, itemizedDeductions: 0, adjustments: 100000, taxYear: 2024,
}).adjustedGrossIncome, 0);

// Tax year resolution
checkExact("Year 2030 → resolves to 2025", resolveTaxYear(2030), 2025);
checkExact("Year 2010 → resolves to 2024", resolveTaxYear(2010), 2024);
checkExact("Year null → resolves to 2025", resolveTaxYear(null), 2025);

// Invalid state code returns $0
checkExact("Invalid state 'XX' → $0", calculateStateTax(80000, "XX", "single", 2024), 0);

// Filing status that doesn't exist falls back to single
check("Unknown filing status falls back to single", calculateFederalTax(50000, "weird_status", 2024), calculateFederalTax(50000, "single", 2024));

// ── Summary ────────────────────────────────────────────────────────────────
console.log("\n");
console.log("══════════════════════════════════════════════════════════════════");
console.log(`  RESULTS: ${PASS.length} passed, ${FAIL.length} failed (${PASS.length + FAIL.length} total)`);
console.log("══════════════════════════════════════════════════════════════════");
if (FAIL.length > 0) {
  console.log("\nFAILURES:");
  for (const f of FAIL) console.log("  " + f);
  process.exit(1);
}
process.exit(0);
