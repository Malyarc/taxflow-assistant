/**
 * C2 — State Additional Credits tests (NY/CA/IL).
 *
 * Each credit hand-calc'd against TY2024 published form/schedule.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx ./src/tax-engine-c2-state-credits-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { calculateStateAdditionalCredits } from "../../artifacts/api-server/src/lib/taxCalculator";

const PASS: string[] = [];
const FAIL: Array<{ rule: string; label: string; expected: number | string; actual: number | string; delta?: number }> = [];

function check(rule: string, label: string, actual: number, expected: number, tol = 0.5): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK [${rule}] ${label}`);
  else FAIL.push({ rule, label, expected, actual, delta: Math.round((actual - expected) * 100) / 100 });
}

function checkTruthy(rule: string, label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`OK [${rule}] ${label}`);
  else FAIL.push({ rule, label, expected: String(expected), actual: String(actual) });
}

function header(t: string) { console.log(`\n── ${t} ──`); }
function section(t: string) { console.log(`\n========== ${t} ==========`); }

// ============================================================================
// NY — Empire State Child Credit (IT-213)
// ============================================================================
section("NY Empire State Child Credit (IT-213)");

// TY2024: $330/child < 17. Phase-out -$16.50/$1k above threshold.
// Threshold: $75k single/HoH, $110k MFJ, $55k MFS.

header("NY ESC + 1: Single AGI $60k, 2 kids → $660 (no phase-out)");
{
  const r = calculateStateAdditionalCredits({
    state: "NY", taxYear: 2024, agi: 60_000, filingStatus: "single",
    dependentsUnder17: 2,
  });
  const esc = r.entries.find((e) => e.id === "ny-empire-state-child-credit");
  check("NY ESC+1", "credit = $660 (2 × $330)", esc?.amount ?? -1, 660);
}

header("NY ESC + 2: MFJ AGI $120k, 1 child → $165 ($330 − $165 phase-out)");
{
  // AGI $120k - $110k = $10k excess → 10 thousands × $16.50 = $165
  // Per child: $330 - $165 = $165
  const r = calculateStateAdditionalCredits({
    state: "NY", taxYear: 2024, agi: 120_000, filingStatus: "married_filing_jointly",
    dependentsUnder17: 1,
  });
  const esc = r.entries.find((e) => e.id === "ny-empire-state-child-credit");
  check("NY ESC+2", "credit = $165", esc?.amount ?? -1, 165);
}

header("NY ESC - 1: AGI fully phased out → $0");
{
  // Single AGI $130k → 55 thousands excess × $16.50 = $907.50; $330 - $907 < 0 → $0
  const r = calculateStateAdditionalCredits({
    state: "NY", taxYear: 2024, agi: 130_000, filingStatus: "single",
    dependentsUnder17: 1,
  });
  const esc = r.entries.find((e) => e.id === "ny-empire-state-child-credit");
  check("NY ESC-1", "credit = $0 (fully phased)", esc?.amount ?? -1, 0);
}

header("NY ESC - 2: No qualifying children → $0");
{
  const r = calculateStateAdditionalCredits({
    state: "NY", taxYear: 2024, agi: 50_000, filingStatus: "single",
    dependentsUnder17: 0,
  });
  const esc = r.entries.find((e) => e.id === "ny-empire-state-child-credit");
  check("NY ESC-2", "credit = $0", esc?.amount ?? -1, 0);
  checkTruthy("NY ESC-2", "ineligibilityReason set", esc?.ineligibilityReason != null, true);
}

// ============================================================================
// NY — Child & Dependent Care Credit (IT-216)
// ============================================================================
section("NY Child & Dependent Care Credit (IT-216)");

header("NY CDCC + 1: AGI $20k + federal CDCC $1,000 → $1,100 (110% rate)");
{
  const r = calculateStateAdditionalCredits({
    state: "NY", taxYear: 2024, agi: 20_000, filingStatus: "single",
    dependentsUnder17: 0, federalCdccApplied: 1000,
  });
  const cdcc = r.entries.find((e) => e.id === "ny-child-dependent-care-credit");
  check("NY CDCC+1", "credit = $1,100 (110% rate)", cdcc?.amount ?? -1, 1100);
}

header("NY CDCC + 2: AGI $45k + federal CDCC $1,000 → $800 (80% rate)");
{
  const r = calculateStateAdditionalCredits({
    state: "NY", taxYear: 2024, agi: 45_000, filingStatus: "single",
    dependentsUnder17: 0, federalCdccApplied: 1000,
  });
  const cdcc = r.entries.find((e) => e.id === "ny-child-dependent-care-credit");
  check("NY CDCC+2", "credit = $800 (80% rate)", cdcc?.amount ?? -1, 800);
}

header("NY CDCC - 1: AGI $200k → $0 (over $150k cap)");
{
  const r = calculateStateAdditionalCredits({
    state: "NY", taxYear: 2024, agi: 200_000, filingStatus: "single",
    dependentsUnder17: 0, federalCdccApplied: 1000,
  });
  const cdcc = r.entries.find((e) => e.id === "ny-child-dependent-care-credit");
  check("NY CDCC-1", "credit = $0", cdcc?.amount ?? -1, 0);
}

// ============================================================================
// NY — College Tuition Credit (IT-272)
// ============================================================================
section("NY College Tuition Credit (IT-272)");

header("NY CT + 1: $5,000 tuition → $200 credit (4% × $5k)");
{
  const r = calculateStateAdditionalCredits({
    state: "NY", taxYear: 2024, agi: 80_000, filingStatus: "single",
    dependentsUnder17: 0, collegeTuitionExpenses: 5000,
  });
  const ct = r.entries.find((e) => e.id === "ny-college-tuition-credit");
  check("NY CT+1", "credit = $200 (4% × $5k)", ct?.amount ?? -1, 200);
}

header("NY CT + 2: $15,000 tuition → $400 cap");
{
  const r = calculateStateAdditionalCredits({
    state: "NY", taxYear: 2024, agi: 80_000, filingStatus: "single",
    dependentsUnder17: 0, collegeTuitionExpenses: 15000,
  });
  const ct = r.entries.find((e) => e.id === "ny-college-tuition-credit");
  check("NY CT+2", "credit = $400 (capped)", ct?.amount ?? -1, 400);
}

// ============================================================================
// CA — Nonrefundable Renter's Credit
// ============================================================================
section("CA Nonrefundable Renter's Credit");

header("CA Renter + 1: Single AGI $30k + 12 mo rented → $60");
{
  const r = calculateStateAdditionalCredits({
    state: "CA", taxYear: 2024, agi: 30_000, filingStatus: "single",
    dependentsUnder17: 0, monthsRented: 12,
  });
  const renter = r.entries.find((e) => e.id === "ca-nonrefundable-renters-credit");
  check("CA Renter+1", "credit = $60", renter?.amount ?? -1, 60);
}

header("CA Renter + 2: MFJ AGI $80k + 12 mo rented → $120");
{
  const r = calculateStateAdditionalCredits({
    state: "CA", taxYear: 2024, agi: 80_000, filingStatus: "married_filing_jointly",
    dependentsUnder17: 0, monthsRented: 12,
  });
  const renter = r.entries.find((e) => e.id === "ca-nonrefundable-renters-credit");
  check("CA Renter+2", "credit = $120", renter?.amount ?? -1, 120);
}

header("CA Renter - 1: AGI $60k single → $0 (over $52,421 cap)");
{
  const r = calculateStateAdditionalCredits({
    state: "CA", taxYear: 2024, agi: 60_000, filingStatus: "single",
    dependentsUnder17: 0, monthsRented: 12,
  });
  const renter = r.entries.find((e) => e.id === "ca-nonrefundable-renters-credit");
  check("CA Renter-1", "credit = $0", renter?.amount ?? -1, 0);
}

header("CA Renter - 2: Only 3 months rented → $0");
{
  const r = calculateStateAdditionalCredits({
    state: "CA", taxYear: 2024, agi: 30_000, filingStatus: "single",
    dependentsUnder17: 0, monthsRented: 3,
  });
  const renter = r.entries.find((e) => e.id === "ca-nonrefundable-renters-credit");
  check("CA Renter-2", "credit = $0", renter?.amount ?? -1, 0);
}

// ============================================================================
// CA — Child & Dependent Care Credit (Form 3506)
// ============================================================================
section("CA Child & Dependent Care Credit (Form 3506)");

header("CA CDCC + 1: AGI $35k + federal CDCC $1,000 → $500 (50% rate)");
{
  const r = calculateStateAdditionalCredits({
    state: "CA", taxYear: 2024, agi: 35_000, filingStatus: "single",
    dependentsUnder17: 0, federalCdccApplied: 1000,
  });
  const cdcc = r.entries.find((e) => e.id === "ca-child-dependent-care-credit");
  check("CA CDCC+1", "credit = $500 (50% rate)", cdcc?.amount ?? -1, 500);
}

header("CA CDCC + 2: AGI $60k + federal CDCC $1,000 → $430 (43% rate)");
{
  const r = calculateStateAdditionalCredits({
    state: "CA", taxYear: 2024, agi: 60_000, filingStatus: "single",
    dependentsUnder17: 0, federalCdccApplied: 1000,
  });
  const cdcc = r.entries.find((e) => e.id === "ca-child-dependent-care-credit");
  check("CA CDCC+2", "credit = $430 (43% rate)", cdcc?.amount ?? -1, 430);
}

header("CA CDCC - 1: AGI $150k → $0 (over $100k cap)");
{
  const r = calculateStateAdditionalCredits({
    state: "CA", taxYear: 2024, agi: 150_000, filingStatus: "single",
    dependentsUnder17: 0, federalCdccApplied: 1000,
  });
  const cdcc = r.entries.find((e) => e.id === "ca-child-dependent-care-credit");
  check("CA CDCC-1", "credit = $0", cdcc?.amount ?? -1, 0);
}

// ============================================================================
// IL — Property Tax Credit (Schedule ICR)
// ============================================================================
section("IL Property Tax Credit (Schedule ICR Line 4)");

header("IL PT + 1: Single AGI $80k + $5,000 property tax → $250 (5%)");
{
  const r = calculateStateAdditionalCredits({
    state: "IL", taxYear: 2024, agi: 80_000, filingStatus: "single",
    dependentsUnder17: 0, propertyTaxPaid: 5000,
  });
  const pt = r.entries.find((e) => e.id === "il-property-tax-credit");
  check("IL PT+1", "credit = $250 (5% × $5k)", pt?.amount ?? -1, 250);
}

header("IL PT - 1: Single AGI $300k → $0 (over $250k cap)");
{
  const r = calculateStateAdditionalCredits({
    state: "IL", taxYear: 2024, agi: 300_000, filingStatus: "single",
    dependentsUnder17: 0, propertyTaxPaid: 10_000,
  });
  const pt = r.entries.find((e) => e.id === "il-property-tax-credit");
  check("IL PT-1", "credit = $0 (over AGI cap)", pt?.amount ?? -1, 0);
}

header("IL PT - 2: No property tax → $0");
{
  const r = calculateStateAdditionalCredits({
    state: "IL", taxYear: 2024, agi: 80_000, filingStatus: "single",
    dependentsUnder17: 0, propertyTaxPaid: 0,
  });
  const pt = r.entries.find((e) => e.id === "il-property-tax-credit");
  check("IL PT-2", "credit = $0", pt?.amount ?? -1, 0);
}

// ============================================================================
// IL — K-12 Education Expense Credit (Schedule ICR Line 11)
// ============================================================================
section("IL K-12 Education Expense Credit (Schedule ICR Line 11)");

header("IL K-12 + 1: MFJ AGI $100k + $1,250 expenses + 2 kids → $250 (25% × $1k)");
{
  // ($1,250 - $250) × 25% = $250
  const r = calculateStateAdditionalCredits({
    state: "IL", taxYear: 2024, agi: 100_000, filingStatus: "married_filing_jointly",
    dependentsUnder17: 2, k12QualifiedExpenses: 1250,
  });
  const k12 = r.entries.find((e) => e.id === "il-k12-education-expense-credit");
  check("IL K-12+1", "credit = $250 (25% × $1k)", k12?.amount ?? -1, 250);
}

header("IL K-12 + 2: $4,000 expenses → $750 cap");
{
  // ($4k - $250) × 25% = $937.50 → capped at $750
  const r = calculateStateAdditionalCredits({
    state: "IL", taxYear: 2024, agi: 100_000, filingStatus: "married_filing_jointly",
    dependentsUnder17: 1, k12QualifiedExpenses: 4000,
  });
  const k12 = r.entries.find((e) => e.id === "il-k12-education-expense-credit");
  check("IL K-12+2", "credit = $750 cap", k12?.amount ?? -1, 750);
}

header("IL K-12 - 1: Expenses ≤ $250 floor → $0");
{
  const r = calculateStateAdditionalCredits({
    state: "IL", taxYear: 2024, agi: 100_000, filingStatus: "married_filing_jointly",
    dependentsUnder17: 1, k12QualifiedExpenses: 200,
  });
  const k12 = r.entries.find((e) => e.id === "il-k12-education-expense-credit");
  check("IL K-12-1", "credit = $0", k12?.amount ?? -1, 0);
}

header("IL K-12 - 2: Single AGI $300k → $0 (over $250k cap)");
{
  const r = calculateStateAdditionalCredits({
    state: "IL", taxYear: 2024, agi: 300_000, filingStatus: "single",
    dependentsUnder17: 1, k12QualifiedExpenses: 1000,
  });
  const k12 = r.entries.find((e) => e.id === "il-k12-education-expense-credit");
  check("IL K-12-2", "credit = $0", k12?.amount ?? -1, 0);
}

// ============================================================================
// End-to-end pipeline integration tests
// ============================================================================
section("End-to-end pipeline integration — credits flow through to state refund");

header("E2E NY: full return with ESC + verify state refund delta");
{
  // MFJ NY $80k W-2, 2 kids under 17 → ESC = 2 × $330 = $660 (no phase-out since AGI $80k < $110k MFJ).
  const inputs: TaxReturnInputs = {
    w2s: [{ taxYear: 2024, wagesBox1: 80000, stateCode: "NY" } as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
    client: {
      filingStatus: "married_filing_jointly",
      state: "NY",
      taxYear: 2024,
      dependentsUnder17: 2,
    } as TaxReturnInputs["client"],
  };
  const result = computeTaxReturnPure(inputs);
  // Verify ESC fired (engine should add to state refund — we check via stateRefundOrOwed
  // increasing by approximately ESC amount vs a comparable single-state-no-kids scenario).
  const baseline = computeTaxReturnPure({
    ...inputs,
    client: { ...inputs.client, dependentsUnder17: 0 } as TaxReturnInputs["client"],
  });
  const delta = result.stateRefundOrOwed - baseline.stateRefundOrOwed;
  // delta should be ~$660 ESC + possibly CTC effect; check ESC component dominates
  checkTruthy("E2E NY ESC fires", `state refund delta >= $660 (got ${delta.toFixed(0)})`, delta >= 660, true);
}

header("E2E IL: $7k property tax via adjustment → IL Property Tax Credit reduces state tax");
{
  const inputs: TaxReturnInputs = {
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "IL" } as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [
      { adjustmentType: "state_property_tax", amount: 7000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
    ],
    taxYear: 2024,
    client: {
      filingStatus: "single", state: "IL", taxYear: 2024,
    } as TaxReturnInputs["client"],
  };
  const result = computeTaxReturnPure(inputs);
  const baseline = computeTaxReturnPure({
    ...inputs,
    adjustments: [],
  });
  // IL Property Tax Credit = 5% × $7k = $350. Refund delta = +$350
  // (less owed). state_property_tax adjustment doesn't affect AGI so
  // state tax liability is unchanged; the credit flows through to refund.
  const refundDelta = result.stateRefundOrOwed - baseline.stateRefundOrOwed;
  check("E2E IL PTC", `refund delta = $350 (got ${refundDelta.toFixed(0)})`,
    refundDelta, 350, 5);
}

// ============================================================================
// RESULTS
// ============================================================================

console.log(`\nPASSED: ${PASS.length}`);
if (FAIL.length > 0) {
  console.log(`\nFAILED: ${FAIL.length}`);
  for (const f of FAIL) {
    console.log(`  [${f.rule}] ${f.label}`);
    console.log(`    expected=${f.expected}  actual=${f.actual}  delta=${f.delta ?? ""}`);
  }
  process.exit(1);
}
console.log("\nALL C2 STATE-CREDIT ASSERTIONS PASS");
