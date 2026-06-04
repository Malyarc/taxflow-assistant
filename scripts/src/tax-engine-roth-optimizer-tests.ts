/**
 * PLAN-B1 — multi-year Roth-conversion bracket-fill optimizer.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-roth-optimizer-tests.ts
 */
import { type TaxReturnInputs } from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { optimizeRothConversionLadder } from "../../artifacts/api-server/src/lib/rothOptimizer";

let passed = 0;
let failed = 0;
function check(label: string, actual: number, expected: number, tol = 0.5) {
  if (Math.abs(actual - expected) <= tol) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}: expected ${expected}, got ${actual}`); }
}
function assert(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); }
}

function retireeBaseline(): TaxReturnInputs {
  return {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
}

console.log("── year-0 bracket fill (single FL 2024, $50k income, $200k IRA) ──");
// AGI $50,000; std ded $14,600; taxable $35,400 → in the 12% bracket ($11,600–
// $47,150). Headroom = 47,150 − 35,400 = $11,750. Conversion = min(11,750,
// 200,000) = $11,750, all taxed at 12% → cost = 11,750 × 0.12 = $1,410.
// (Hand-calc: tax @35,400 = $4,016; tax @47,150 = $5,426; delta = $1,410.)
{
  const plan = optimizeRothConversionLadder(retireeBaseline(), { horizonYears: 1, traditionalIraBalance: 200000 });
  assert("1 year in the ladder", plan.years.length === 1);
  check("taxableIncomeBeforeConversion = $35,400", plan.years[0].taxableIncomeBeforeConversion, 35400, 1);
  check("bracketCeiling = $47,150 (top of 12% bracket)", plan.years[0].bracketCeiling, 47150, 1);
  check("marginalRate = 12%", plan.years[0].marginalRate, 0.12, 0.001);
  check("conversion = $11,750 (fills the 12% bracket)", plan.years[0].conversion, 11750, 1);
  check("conversionTaxCost = $1,410 (11,750 × 12%)", plan.years[0].conversionTaxCost, 1410, 2);
  check("iraBalanceRemaining = $188,250", plan.years[0].iraBalanceRemaining, 188250, 1);
  check("blendedConversionRate = 12%", plan.blendedConversionRate, 0.12, 0.001);
}

console.log("── conversion capped by the IRA balance ──");
// IRA only $5,000 < headroom $11,750 → convert $5,000; cost = 5,000 × 12% = $600.
{
  const plan = optimizeRothConversionLadder(retireeBaseline(), { horizonYears: 1, traditionalIraBalance: 5000 });
  check("conversion capped at the IRA balance $5,000", plan.years[0].conversion, 5000, 1);
  check("conversionTaxCost = $600", plan.years[0].conversionTaxCost, 600, 2);
  check("iraBalanceRemaining = $0", plan.years[0].iraBalanceRemaining, 0, 1);
}

console.log("── multi-year ladder structure (horizon 3) ──");
{
  const plan = optimizeRothConversionLadder(retireeBaseline(), { horizonYears: 3, traditionalIraBalance: 200000 });
  assert("3 years in the ladder", plan.years.length === 3);
  assert("every year converts a positive amount", plan.years.every((y) => y.conversion > 0));
  const sumConv = plan.years.reduce((s, y) => s + y.conversion, 0);
  const sumCost = plan.years.reduce((s, y) => s + y.conversionTaxCost, 0);
  check("totalConverted = Σ year conversions", plan.totalConverted, sumConv, 3);
  check("totalConversionTaxCost = Σ year costs", plan.totalConversionTaxCost, sumCost, 3);
  assert("blendedConversionRate in a sane 10–24% band", plan.blendedConversionRate > 0.10 && plan.blendedConversionRate < 0.24);
  // Filling exactly to the bracket top → all conversion is at the marginal rate.
  assert("each year: cost ≈ conversion × marginalRate (no spill into next bracket)",
    plan.years.every((y) => Math.abs(y.conversionTaxCost - y.conversion * y.marginalRate) <= 2));
}

console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL PLAN-B1 ROTH-OPTIMIZER CHECKS GREEN");
