/**
 * Pure engine tests — invoke computeTaxReturnPure directly with hand-built
 * inputs. NO database, NO API server required. Proves the engine is
 * Haven-portable (drops into any TS codebase as a pure function).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-pure-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function near(a: number, b: number, tol = 0.01) { return Math.abs(a - b) <= tol; }
function check(label: string, actual: number, expected: number, tol = 0.01) {
  if (near(actual, expected, tol)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}
function checkExact<T>(label: string, actual: T, expected: T) {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

// ════════════════════════════════════════════════════════════════════════════
// Haven portability — pure invocation with plain JS objects
// ════════════════════════════════════════════════════════════════════════════
header("Pure invocation — single $50k W-2, no deductions");
{
  // Single, $50k W-2, no adjustments, FL (no state tax).
  // AGI = $50,000. Std ded = $14,600. Taxable = $35,400.
  // Tax: $1,160 (10% bracket) + ($35,400 - $11,600) × 0.12 = $1,160 + $2,856 = $4,016.
  // Refund = $5,000 withheld - $4,016 = $984.
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "single",
      state: "FL",
      taxYear: 2024,
    },
    w2s: [
      { taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" },
    ],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };

  const r = computeTaxReturnPure(inputs);
  check("Total income $50,000", r.totalIncome, 50000, 1);
  check("AGI $50,000", r.adjustedGrossIncome, 50000, 1);
  check("Std ded $14,600", r.standardDeduction, 14600, 1);
  check("Taxable $35,400", r.taxableIncome, 35400, 1);
  check("Federal tax $4,016", r.federalTaxLiability, 4016, 2);
  check("Federal refund $984", r.federalRefundOrOwed, 984, 2);
  checkExact("FL state tax = $0 (no income tax)", r.stateTaxLiability, 0);
  checkExact("State code = FL", r.stateCode, "FL");
  checkExact("W-2 count = 1", r.w2Count, 1);
  checkExact("Form 1099 count = 0", r.form1099Count, 0);
}

header("Pure invocation — accepts both string and number numeric fields");
{
  // Same scenario but with W-2 fields as strings (mimicking Drizzle row shape).
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "single",
      state: "FL",
      taxYear: 2024,
    },
    w2s: [
      { taxYear: 2024, wagesBox1: "50000", federalTaxWithheldBox2: "5000", stateCode: "FL" },
    ],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };

  const r = computeTaxReturnPure(inputs);
  check("Same tax with string-typed inputs (Drizzle compat)", r.federalTaxLiability, 4016, 2);
}

header("Pure invocation — multi-feature: MFJ with CTC + EITC + IRA");
{
  // MFJ $30k W-2, 2 kids, $2k IRA contribution.
  // AGI = $30,000 - $2,000 = $28,000 (IRA above-the-line, not covered by plan).
  // Std ded MFJ = $29,200. Taxable = $0. Fed tax = $0.
  // CTC: 2 × $2,000 = $4,000. Tax = $0, so non-refundable = $0; ACTC refundable
  //   = min($4,000 × 15% earned-income, $1,700/child × 2 = $3,400) — at earned $30k
  //   (15% of ($30k - $2,500)) = $4,125 → capped at $3,400.
  // EITC: MFJ 2 kids 2024, earned income $30k → max plateau at $27,700, phase-out
  //   begins at $29,640 MFJ. EITC ≈ ~$6,884 (max for 2 kids 2024).
  //   Phaseout from $29,640: (30,000 - 29,640) × 21.06% = $76 → EITC = $6,884 - $76 = $6,808.
  //   Actually EITC plateau max for 2 kids 2024 = $6,960. Let me not assert the
  //   exact EITC value (calc gives it), just verify refund is positive.
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "married_filing_jointly",
      state: "FL",
      taxYear: 2024,
      dependentsUnder17: 2,
      iraCoveredByWorkplacePlan: false,
    },
    w2s: [
      { taxYear: 2024, wagesBox1: 30000, federalTaxWithheldBox2: 1500, stateCode: "FL" },
    ],
    form1099s: [],
    adjustments: [
      { adjustmentType: "ira_contribution_traditional", amount: 2000, isApplied: true },
    ],
    taxYear: 2024,
  };

  const r = computeTaxReturnPure(inputs);
  check("AGI $28,000 (after IRA)", r.adjustedGrossIncome, 28000, 1);
  check("IRA deduction $2,000", r.retirementDeductions.iraDeductible, 2000, 1);
  checkExact("Taxable income $0 (under std ded)", r.taxableIncome, 0);
  checkExact("Federal tax $0 (no taxable income)", r.federalTaxLiability, 0);
  // EITC + ACTC drive a large refund
  if (r.eitc.appliedCredit > 6000) PASS.push(`✓ EITC > $6,000 (MFJ 2 kids low income): $${r.eitc.appliedCredit.toFixed(0)}`);
  else FAIL.push(`✗ EITC expected > $6,000, got $${r.eitc.appliedCredit.toFixed(0)}`);
  if (r.federalRefundOrOwed > 7000) PASS.push(`✓ Federal refund > $7,000 (EITC + ACTC dominate)`);
  else FAIL.push(`✗ Federal refund expected > $7,000, got $${r.federalRefundOrOwed.toFixed(0)}`);
}

header("Pure invocation — 1099-NEC with Schedule C expenses + SE tax");
{
  // Single, $80k 1099-NEC + $30k Schedule C expenses → net SE $50k.
  // SE tax on net SE income: 15.3% × ($50,000 × 92.35%) = $7,065. Half = $3,532.50 deductible.
  // AGI = $50,000 (net SE) - $3,532.50 = $46,467.50.
  // Std ded $14,600. Pre-QBI taxable = $31,867.50.
  // POST C3 QBI auto-default (2026-05-27 PM):
  //   QBI candidate = net SE $50k − half SE $3,532.50 = $46,467.50
  //   Preliminary = 20% × $46,467.50 = $9,293.50
  //   Cap = 20% × pre-QBI taxable $31,867.50 = $6,373.50
  //   QBI deduction = min($9,293.50, $6,373.50) = $6,373.50
  // Post-QBI taxable = $31,867.50 − $6,373.50 = $25,494.
  // Federal regular tax = $1,160 + 12% × ($25,494 − $11,600) = $1,160 + $1,667.28 = $2,827.28.
  // Total fed liability = $2,827.28 + $7,065 SE = $9,892.28.
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [
      { taxYear: 2024, formType: "nec", nonemployeeCompensation: 80000 },
    ],
    adjustments: [
      { adjustmentType: "schedule_c_expenses", amount: 30000, isApplied: true },
    ],
    taxYear: 2024,
  };

  const r = computeTaxReturnPure(inputs);
  check("Schedule C expenses $30,000", r.scheduleCExpenses, 30000, 1);
  check("Form1099 count = 1", r.form1099Count, 1);
  check("AGI ~$46,467.50 (net SE - SE/2)", r.adjustedGrossIncome, 46467.50, 1);
  check("SE tax ~$7,065", r.selfEmploymentTax, 7065, 5);
  check("Total federal liability ~$9,892 (post-QBI auto-default)", r.federalTaxLiability, 9892.28, 10);
}

header("Pure invocation — adjustments respect isApplied = false");
{
  // Same as first test but with an UNAPPLIED IRA adjustment that should be skipped.
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [
      { taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" },
    ],
    form1099s: [],
    adjustments: [
      { adjustmentType: "ira_contribution_traditional", amount: 5000, isApplied: false },
    ],
    taxYear: 2024,
  };

  const r = computeTaxReturnPure(inputs);
  checkExact("Unapplied IRA → zero deduction", r.retirementDeductions.iraDeductible, 0);
  check("AGI unchanged $50,000", r.adjustedGrossIncome, 50000, 1);
}

header("Pure invocation — multi-year (2024 vs 2025 brackets)");
{
  // Single, $100k, all years
  const make = (taxYear: 2024 | 2025) => ({
    client: { filingStatus: "single", state: "FL", taxYear } as const,
    w2s: [{ taxYear, wagesBox1: 100000, federalTaxWithheldBox2: 15000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    taxYear,
  });

  const r24 = computeTaxReturnPure(make(2024) as any);
  const r25 = computeTaxReturnPure(make(2025) as any);

  // 2024: AGI $100k, std ded $14,600, taxable $85,400.
  //   Tax = $1,160 + ($47,150-$11,600)×0.12 + ($85,400-$47,150)×0.22
  //       = $1,160 + $4,266 + $8,415 = $13,841.
  // 2025: AGI $100k, std ded $15,750 (OBBBA P.L. 119-21, raised from $15,000), taxable $84,250.
  //   Tax = $1,192.50 + ($48,475-$11,925)×0.12 + ($84,250-$48,475)×0.22
  //       = $1,192.50 + $4,386 + $7,870.50 = $13,449.
  check("2024 federal tax = $13,841", r24.federalTaxLiability, 13841, 2);
  check("2025 federal tax = $13,449", r25.federalTaxLiability, 13449, 2);
  if (r25.federalTaxLiability < r24.federalTaxLiability) PASS.push("✓ 2025 brackets lower tax (inflation adjustment)");
  else FAIL.push("✗ 2025 should have lower tax than 2024 for same $100k income");
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log("\n══════════════════════ Pure Engine Test Summary ══════════════════════");
console.log(`PASS: ${PASS.length}`);
console.log(`FAIL: ${FAIL.length}`);
if (FAIL.length > 0) {
  console.log("\nFailures:");
  for (const f of FAIL) console.log("  " + f);
  process.exit(1);
} else {
  console.log("\n✓ All pure engine tests pass — engine is Haven-portable");
}
