/**
 * PLAN-B1 — multi-year Roth-conversion bracket-fill optimizer.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-roth-optimizer-tests.ts
 */
import { type TaxReturnInputs } from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { optimizeRothConversionLadder, projectRmdAvoidance } from "../../artifacts/api-server/src/lib/rothOptimizer";

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

// ════════════════════════════════════════════════════════════════════════════
// RMD-avoidance value model — fully hand-calc'd 2-year controlled scenario.
//
// Single FL retiree, age 73, $30k pension (1099-R), $265k IRA. No income/IRA
// growth (factors 1.0) to isolate the arithmetic. Convert $50k in year 0 only.
//
// IRA evolution (pure arithmetic):
//   BASELINE  y0: RMD = 265,000/26.5 = 10,000 → IRA 255,000
//             y1: RMD = 255,000/25.5 = 10,000 → IRA 245,000   (total RMD 20,000)
//   SCENARIO  y0: RMD = 265,000/26.5 = 10,000, −$50k conv → IRA 205,000
//             y1: RMD = 205,000/25.5 = 8,039.22 → IRA 196,960.78 (total RMD 18,039)
//
// Federal tax — a single age-73 filer gets the age-65 ADDITIONAL std ded
// (+$1,950 in 2024 / +$2,000 in 2025) AND the OBBBA senior deduction (+$6,000,
// TY2025–2028 only; phases out above $75k MAGI — N/A here):
//   2024 deductions = 14,600 + 1,950            = 16,550
//   2025 deductions = 15,750 + 2,000 + 6,000    = 23,750
//   BASELINE  y0 taxable 40,000−16,550 = 23,450 → 1,160 + 12%×11,850  = 2,582.00
//             y1 taxable 40,000−23,750 = 16,250 → 1,192.50 + 12%×4,325 = 1,711.50
//             Σ = 4,293.50 → $4,294
//   SCENARIO  y0 taxable 90,000−16,550 = 73,450 → 1,160+4,266+22%×26,300 = 11,212.00
//             y1 taxable 38,039−23,750 = 14,289 → 1,192.50 + 12%×2,364   = 1,476.18
//             Σ = 12,688.18 → $12,688
//   lifetimeFederalTaxSaved = 4,293.50 − 12,688.18 = −$8,395 (short window: the
//   up-front conversion tax dwarfs 2 years of RMD savings — value accrues over
//   decades + tax-free Roth growth, which this conservative model omits).
// ════════════════════════════════════════════════════════════════════════════
console.log("── RMD-avoidance value model (controlled 2-year hand-calc) ──");
{
  const retiree73: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 73 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "r", payerName: "Pension", taxableAmount: 30000, grossDistribution: 30000 }],
    adjustments: [],
    taxYear: 2024,
  };
  const v = projectRmdAvoidance(retiree73, {
    startingIraBalance: 265000,
    conversionsByYear: [50000, 0],
    valueHorizonYears: 2,
    incomeGrowth: 1.0,
    iraGrowth: 1.0,
  });
  assert("rmdAvoidance present when age known", v != null);
  if (v) {
    assert("firstRmdTaxYear = 2024", v.firstRmdTaxYear === 2024);
    check("baseline final IRA = $245,000", v.baselineFinalIraBalance, 245000, 1);
    check("scenario final IRA = $196,961 (smaller — converted out)", v.scenarioFinalIraBalance, 196961, 1);
    check("baseline RMD total = $20,000", v.baselineRmdTotal, 20000, 1);
    check("scenario RMD total = $18,039 (smaller IRA → smaller RMDs)", v.scenarioRmdTotal, 18039, 1);
    check("baseline lifetime federal tax = $4,294 (incl. age-65 + OBBBA senior ded)", v.baselineLifetimeFederalTax, 4294, 3);
    check("scenario lifetime federal tax = $12,688", v.scenarioLifetimeFederalTax, 12688, 3);
    check("lifetimeFederalTaxSaved = −$8,395 (2-yr window; cost up-front)", v.lifetimeFederalTaxSaved, -8395, 5);
    assert("scenario IRA < baseline IRA (conversions drain the traditional)", v.scenarioFinalIraBalance < v.baselineFinalIraBalance);
    assert("scenario RMD total < baseline RMD total", v.scenarioRmdTotal < v.baselineRmdTotal);
  }
}

// Optimizer integration — value model attaches when age is set, absent otherwise.
console.log("── optimizer attaches rmdAvoidance only when age is known ──");
{
  const aged: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 68 },
    w2s: [], form1099s: [{ taxYear: 2024, formType: "r", payerName: "Pension", taxableAmount: 40000, grossDistribution: 40000 }],
    adjustments: [], taxYear: 2024,
  };
  const withAge = optimizeRothConversionLadder(aged, { horizonYears: 5, traditionalIraBalance: 600000 });
  assert("optimizer attaches rmdAvoidance when taxpayerAge set", withAge.rmdAvoidance != null);
  if (withAge.rmdAvoidance) {
    assert("value horizon reaches the RMD years (>= 20)", withAge.rmdAvoidance.valueHorizonYears >= 20);
    assert("baseline RMD total > scenario RMD total (conversions shrink RMDs)",
      withAge.rmdAvoidance.baselineRmdTotal > withAge.rmdAvoidance.scenarioRmdTotal);
    assert("scenario final IRA < baseline final IRA",
      withAge.rmdAvoidance.scenarioFinalIraBalance < withAge.rmdAvoidance.baselineFinalIraBalance);
  }
  const noAge = optimizeRothConversionLadder(retireeBaseline(), { horizonYears: 3, traditionalIraBalance: 200000 });
  assert("optimizer omits rmdAvoidance when taxpayerAge absent", noAge.rmdAvoidance === null);
}

console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL PLAN-B1 ROTH-OPTIMIZER CHECKS GREEN");
