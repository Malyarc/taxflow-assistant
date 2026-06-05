/**
 * H3 multi-year HARDENING suite (no API) — hand-calc'd against IRS rules.
 *
 *  - RMD: IRS Uniform Lifetime Table (Pub 590-B Table III) divisors + the
 *    RMD formula (prior-year-end balance / divisor), trigger age 73 (SECURE 2.0).
 *  - Carryforward THREADING: capture each year's remaining carryforward off the
 *    computed return and feed it into the next year (deplete) instead of freezing
 *    the year-0 amount. Opt-in (chainCarryforwards); default behavior unchanged.
 *  - RMD INJECTION in a trajectory: opt-in rmd option injects the RMD as ordinary
 *    income each year the client is >= 73, evolving the IRA balance.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-multiyear-hardening-tests.ts
 */

import {
  RMD_TRIGGER_AGE,
  UNIFORM_LIFETIME_DIVISORS,
  rmdDivisorForAge,
  requiredMinimumDistribution,
  captureCarryforwards,
  applyCarryforwards,
  runMultiYearTrajectory,
  type CarryforwardState,
} from "../../artifacts/api-server/src/lib/multiYearEngine";
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.5): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkExact<T>(label: string, actual: T, expected: T): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function checkTruthy(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}
function header(t: string): void { console.log(`\n-- ${t} --`); }

// ════════════════════════════════════════════════════════════════════════════
// RMD — Uniform Lifetime Table divisors + RMD formula
// ════════════════════════════════════════════════════════════════════════════
header("RMD — Uniform Lifetime Table (Pub 590-B Table III)");
checkExact("trigger age = 73 (SECURE 2.0)", RMD_TRIGGER_AGE, 73);
// Spot-check verified divisors at the band a Roth ladder actually traverses.
checkExact("divisor age 73 = 26.5", rmdDivisorForAge(73), 26.5);
checkExact("divisor age 74 = 25.5", rmdDivisorForAge(74), 25.5);
checkExact("divisor age 75 = 24.6", rmdDivisorForAge(75), 24.6);
checkExact("divisor age 80 = 20.2", rmdDivisorForAge(80), 20.2);
checkExact("divisor age 90 = 12.2", rmdDivisorForAge(90), 12.2);
checkExact("divisor age 100 = 6.4", rmdDivisorForAge(100), 6.4);
checkExact("age 72 → null (no RMD until 73)", rmdDivisorForAge(72), null);
checkExact("age 60 → null", rmdDivisorForAge(60), null);
checkExact("age 105 clamps to age-100 divisor 6.4", rmdDivisorForAge(105), 6.4);
checkExact("table has all 29 ages 72-100", Object.keys(UNIFORM_LIFETIME_DIVISORS).length, 29);
// Divisors strictly decrease with age (sanity — a stale/typo'd entry breaks this).
{
  let monotone = true;
  for (let a = 73; a <= 100; a++) {
    if (!(UNIFORM_LIFETIME_DIVISORS[a] < UNIFORM_LIFETIME_DIVISORS[a - 1])) monotone = false;
  }
  checkTruthy("divisors strictly decrease 72→100", monotone);
}

header("RMD — formula (prior-year-end balance / divisor)");
check("RMD $265,000 @ 73 = 265000/26.5 = $10,000", requiredMinimumDistribution(265000, 73), 10000, 0.01);
check("RMD $500,000 @ 73 = 500000/26.5 = $18,867.92", requiredMinimumDistribution(500000, 73), 18867.92, 0.01);
check("RMD $1,000,000 @ 80 = 1000000/20.2 = $49,504.95", requiredMinimumDistribution(1000000, 80), 49504.95, 0.01);
checkExact("RMD @ 72 = 0 (not yet required)", requiredMinimumDistribution(500000, 72), 0);
checkExact("RMD on $0 balance = 0", requiredMinimumDistribution(0, 80), 0);

// ════════════════════════════════════════════════════════════════════════════
// RMD INJECTION in a trajectory (opt-in rmd option)
//
// Single retiree, age 73, $50k pension (1099-R taxable) baseline + $500k IRA.
// rmdByYear[0] = round(500000 / 26.5) = round(18,867.92) = 18,868.
// Balance evolves: (500,000 − 18,867.92) × 1.05 = 481,132.0755 × 1.05 = 505,188.68.
// rmdByYear[1] = round(505,188.68 / 25.5) = round(19,811.32) = 19,811.
// ════════════════════════════════════════════════════════════════════════════
header("RMD injection — rmdByYear + tax impact");
{
  const retiree: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 73 } as TaxReturnInputs["client"],
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "r", payerName: "Pension", taxableAmount: 50000, grossDistribution: 50000 } as unknown as TaxReturnInputs["form1099s"][number]],
    adjustments: [],
    taxYear: 2024,
  };
  const withRmd = runMultiYearTrajectory(retiree, 3, { incomeGrowth: 1.03, rmd: { startingIraBalance: 500000, iraGrowth: 1.05 } });
  const noRmd = runMultiYearTrajectory(retiree, 3, { incomeGrowth: 1.03 });

  check("rmdByYear[0] = $18,868 (500000/26.5)", withRmd.rmdByYear[0], 18868, 0.5);
  check("rmdByYear[1] = $19,811 (evolved balance @ 25.5)", withRmd.rmdByYear[1], 19811, 1);
  checkTruthy("no-rmd trajectory injects $0 RMD", noRmd.rmdByYear.every((v) => v === 0));
  checkTruthy("RMD raises total federal tax vs no-RMD (more ordinary income)",
    withRmd.totalFederalTax > noRmd.totalFederalTax);
  // RMD is ordinary income on top of the $50k pension → year-0 taxable rises by ~the RMD.
  check("year-0 taxable rises by ~RMD ($18,868)",
    withRmd.yearReturns[0].taxableIncome - noRmd.yearReturns[0].taxableIncome, 18868, 5);
}

// A young client (age 45) must NOT trigger any RMD even with the rmd option set.
header("RMD injection — under-73 client triggers nothing");
{
  const young: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 45 } as TaxReturnInputs["client"],
    w2s: [{ taxYear: 2024, wagesBox1: 90000, stateCode: "FL" } as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [], adjustments: [], taxYear: 2024,
  };
  const traj = runMultiYearTrajectory(young, 5, { rmd: { startingIraBalance: 500000 } });
  checkTruthy("age-45 client: every rmdByYear = 0", traj.rmdByYear.every((v) => v === 0));
}

// ════════════════════════════════════════════════════════════════════════════
// CARRYFORWARD capture + apply (unit)
// ════════════════════════════════════════════════════════════════════════════
header("Carryforward — capture from a computed return");
{
  // Single W-2 $100k + a $100k NOL carryforward. taxable-before-NOL = AGI − std ded.
  // NOL deduction capped at 80% of that; remaining = 100,000 − 0.8 × (taxableBeforeNol).
  const base: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 } as TaxReturnInputs["client"],
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" } as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [], adjustments: [], taxYear: 2024,
  };
  const noNol = computeTaxReturnPure(base);
  const taxableBeforeNol = noNol.taxableIncome; // 100,000 − std ded (no QBI)
  const withNol = computeTaxReturnPure({
    ...base,
    adjustments: [{ adjustmentType: "nol_carryforward", amount: 100000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number]],
  });
  const cap = captureCarryforwards(withNol);
  const expectedRemaining = 100000 - 0.8 * taxableBeforeNol;
  check("captured NOL remaining = 100000 − 0.8×taxableBeforeNol", cap.nol, expectedRemaining, 1);
  checkExact("captured NOL == engine nolCarryforwardRemaining", cap.nol, Math.max(0, withNol.nolCarryforwardRemaining ?? 0));
}

header("Carryforward — applyCarryforwards rewrites the right adjustments");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 } as TaxReturnInputs["client"],
    w2s: [], form1099s: [],
    adjustments: [
      { adjustmentType: "nol_carryforward", amount: 999, isApplied: true },
      { adjustmentType: "charitable_cash", amount: 5000, isApplied: true }, // non-carryforward — must survive
    ] as unknown as TaxReturnInputs["adjustments"],
    taxYear: 2024,
  };
  const state: CarryforwardState = {
    nol: 31680, capitalLossShort: 0, capitalLossLong: 2000, charitableCash: 0,
    section163j: 0, amtCredit: 0, amtNol: 0, passiveLossScheduleE: 0,
  };
  const out = applyCarryforwards(inputs, state);
  const byType = (t: string) => out.adjustments.filter((a) => a.adjustmentType === t).map((a) => Number(a.amount));
  checkExact("old frozen nol_carryforward (999) dropped, replaced by threaded 31680", byType("nol_carryforward").join(","), "31680");
  checkExact("threaded long cap-loss carryforward added (2000)", byType("capital_loss_carryforward_long").join(","), "2000");
  checkExact("zero-amount carryforwards NOT added (charitable_carryforward_cash)", byType("charitable_carryforward_cash").length, 0);
  checkExact("non-carryforward adjustment (charitable_cash) survives untouched", byType("charitable_cash").join(","), "5000");
}

// ════════════════════════════════════════════════════════════════════════════
// CARRYFORWARD THREADING end-to-end — chained DEPLETES; frozen re-supplies.
//
// Single, W-2 $100k, $100k NOL. Year 0 (both modes identical):
//   taxableBeforeNol = 100,000 − $14,600 (2024 std ded) = 85,400
//   NOL deduction = 0.8 × 85,400 = 68,320 → remaining = 31,680.
// CHAINED year 1: only 31,680 NOL left; income $103k, std $15,750 (2025) →
//   taxableBeforeNol 87,250; cap 69,800 ≥ 31,680 → all used → remaining 0.
// FROZEN year 1: re-uses the full $100k → remaining = 100,000 − 0.8×87,250 = 30,200.
// So chained depletes to 0 by year 1; frozen never depletes (stays ~30k).
// ════════════════════════════════════════════════════════════════════════════
header("Carryforward THREADING — chained depletes, frozen re-supplies");
{
  const nolClient: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 } as TaxReturnInputs["client"],
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" } as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [{ adjustmentType: "nol_carryforward", amount: 100000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number]],
    taxYear: 2024,
  };
  const chained = runMultiYearTrajectory(nolClient, 3, { incomeGrowth: 1.03, chainCarryforwards: true });
  const frozen = runMultiYearTrajectory(nolClient, 3, { incomeGrowth: 1.03 }); // default = frozen

  const cNol = chained.yearReturns.map((r) => Math.max(0, r.nolCarryforwardRemaining ?? 0));
  const fNol = frozen.yearReturns.map((r) => Math.max(0, r.nolCarryforwardRemaining ?? 0));

  // Year 0 identical in both modes (no prior year to thread).
  check("year-0 NOL remaining = $31,680 (both modes)", cNol[0], 31680, 1);
  checkExact("year-0 identical chained vs frozen", cNol[0], fNol[0]);
  // Chained depletes to 0 by year 1; frozen keeps ~$30k (re-supplies the full 100k).
  check("CHAINED year-1 NOL remaining = $0 (depleted)", cNol[1], 0, 1);
  checkTruthy("FROZEN year-1 NOL remaining still > $25k (not depleted)", fNol[1] > 25000);
  checkTruthy("chained year-1 taxable > frozen year-1 taxable (no NOL left to deduct)",
    chained.yearReturns[1].taxableIncome > frozen.yearReturns[1].taxableIncome);
  checkExact("chained NOL fully gone by year 2", cNol[2], 0);
}

console.log(`\n========================================`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed  (multi-year hardening)`);
if (FAIL.length) {
  console.log(`\nFAILURES:`);
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log(`ALL MULTI-YEAR HARDENING ASSERTIONS PASS`);
