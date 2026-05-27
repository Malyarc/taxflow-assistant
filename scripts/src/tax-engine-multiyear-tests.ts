/**
 * Phase H — H3: multi-year scenario engine — hand-calc'd tests.
 *
 * Pure engine; no API required.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-multiyear-tests.ts
 */
import {
  projectYearForward,
  runMultiYearTrajectory,
  compareMultiYearTrajectories,
  DEFAULT_INCOME_GROWTH,
} from "../../artifacts/api-server/src/lib/multiYearEngine";
import { computeTaxReturnPure, type TaxReturnInputs } from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 1): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTruthy(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

/** Minimal-viable single FL $80k W-2 baseline. */
function baseInputs(): TaxReturnInputs {
  return {
    client: {
      filingStatus: "single", state: "FL", taxYear: 2024,
      taxpayerAge: 45, dependentsUnder17: 0, otherDependents: 0,
    } as unknown as TaxReturnInputs["client"],
    w2s: [{
      wagesBox1: "80000", federalTaxWithheldBox2: "0",
      socialSecurityWagesBox3: "80000", medicareWagesBox5: "80000",
      stateCode: "FL", taxYear: 2024,
    } as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
}

// ── Case 1: projectYearForward(0) is identity-ish (fresh adjustments array) ─
{
  const baseline = baseInputs();
  const next = projectYearForward(baseline, 0);
  checkTruthy("Case 1 year 0 returns new object", next !== baseline);
  checkTruthy("Case 1 year 0 adjustments array is fresh", next.adjustments !== baseline.adjustments);
  // No change to wages
  check(
    "Case 1 year 0 wages unchanged",
    Number((next.w2s[0] as unknown as { wagesBox1?: string }).wagesBox1),
    80000,
  );
}

// ── Case 2: projectYearForward(5) scales wages by 1.03^5 ≈ 1.159 ──────────
// $80,000 × 1.03^5 = $92,742.
{
  const next = projectYearForward(baseInputs(), 5);
  check("Case 2 taxYear advanced 5 years (2024 + 5 = 2029)", next.taxYear, 2029);
  check(
    "Case 2 wages scaled by 1.03^5",
    Number((next.w2s[0] as unknown as { wagesBox1?: string }).wagesBox1),
    80000 * Math.pow(1.03, 5),
    1,
  );
}

// ── Case 3: 1099-NEC scales correctly ──────────────────────────────────────
{
  const baseline = baseInputs();
  baseline.w2s = [];
  baseline.form1099s = [{
    formType: "nec",
    nonemployeeCompensation: "100000",
    taxYear: 2024,
  } as unknown as TaxReturnInputs["form1099s"][number]];
  const next = projectYearForward(baseline, 3);
  // $100k × 1.03^3 = $109,273
  check(
    "Case 3 1099-NEC scaled by 1.03^3",
    Number((next.form1099s[0] as unknown as { nonemployeeCompensation?: string }).nonemployeeCompensation),
    100000 * Math.pow(1.03, 3),
    1,
  );
}

// ── Case 4: Carry-forward adjustments NOT scaled ──────────────────────────
{
  const baseline = baseInputs();
  baseline.adjustments = [
    { adjustmentType: "capital_loss_carryforward_short", amount: "5000", isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
    { adjustmentType: "deduction", amount: "2000", isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
  ];
  const next = projectYearForward(baseline, 3);
  const cf = next.adjustments.find((a) => a.adjustmentType === "capital_loss_carryforward_short");
  const ded = next.adjustments.find((a) => a.adjustmentType === "deduction");
  check("Case 4 cap-loss carryforward unchanged", Number(cf?.amount), 5000);
  check("Case 4 deduction scaled", Number(ded?.amount), 2000 * Math.pow(1.03, 3), 1);
}

// ── Case 5: runMultiYearTrajectory(5) → 5 yearReturns ────────────────────
{
  const traj = runMultiYearTrajectory(baseInputs(), 5);
  check("Case 5 yearReturns length = 5", traj.yearReturns.length, 5);
  check("Case 5 yearInputs length = 5", traj.yearInputs.length, 5);
  checkTruthy("Case 5 totalTaxBurden > 0", traj.totalTaxBurden > 0);
  check("Case 5 incomeGrowth = default", traj.incomeGrowth, DEFAULT_INCOME_GROWTH);
}

// ── Case 6: Multi-year trajectory tax grows year over year ────────────────
// With 3% income growth and clamped TY2025 brackets, federal tax should
// grow ~modestly each year (bracket-creep wouldn't be modeled in MVP).
{
  const traj = runMultiYearTrajectory(baseInputs(), 5);
  const y0Tax = traj.yearReturns[0].federalTaxLiability;
  const y4Tax = traj.yearReturns[4].federalTaxLiability;
  checkTruthy("Case 6 year-4 tax > year-0 tax (income growth)", y4Tax > y0Tax);
  // Income grew 1.03^4 = 1.126x. Tax should grow about as fast OR faster
  // because of bracket creep on the higher slices. We expect at least 1.10x.
  checkTruthy(
    "Case 6 tax growth >= 10% (bracket creep adds to income growth)",
    y4Tax / y0Tax >= 1.10,
  );
}

// ── Case 7: Per-year mutations applied — Roth conversion year 0 only ─────
// Scenario: year-0 Roth conversion of $20k (add additional_income).
// Years 1-4: no mutation. Trajectory baseline runs without any conversion.
{
  const baseline = runMultiYearTrajectory(baseInputs(), 5);
  const scenario = runMultiYearTrajectory(baseInputs(), 5, {
    mutationsByYear: [
      [{ kind: "add_adjustment", adjustmentType: "additional_income", amount: 20000 }],
      undefined, undefined, undefined, undefined,
    ],
  });
  const delta = compareMultiYearTrajectories(baseline, scenario);
  // Year 0: federal tax up by ~22% × $20k = $4,400
  check(
    "Case 7 year-0 federal delta ≈ +$4,400 (Roth conversion cost)",
    delta.yearByYearFederal[0],
    4400,
    100,
  );
  // Years 1-4: no mutation → ~zero delta
  for (let y = 1; y <= 4; y++) {
    check(
      `Case 7 year-${y} federal delta ≈ 0 (no mutation)`,
      delta.yearByYearFederal[y],
      0,
      5,
    );
  }
  // Total cost over 5 years ≈ $4,400 (just the year-0 cost, since no
  // year 1+ mutations to remove future taxable IRA distributions).
  check(
    "Case 7 total combined delta ≈ +$4,400 (year-0 cost only)",
    delta.totalCombinedDelta,
    4400,
    150,
  );
}

// ── Case 8: Custom income growth (5%) scales faster ──────────────────────
{
  const traj = runMultiYearTrajectory(baseInputs(), 3, { incomeGrowth: 1.05 });
  // Year 2 wages: $80k × 1.05^2 = $88,200
  const y2Wages = Number((traj.yearInputs[2].w2s[0] as unknown as { wagesBox1?: string }).wagesBox1);
  check("Case 8 5% growth at year 2 → $88,200", y2Wages, 88200, 1);
}

// ── Case 9: yearsAhead < 1 throws ────────────────────────────────────────
{
  let caught = false;
  try {
    runMultiYearTrajectory(baseInputs(), 0);
  } catch (e) {
    caught = String((e as Error).message).includes(">= 1");
  }
  checkTruthy("Case 9 throws on yearsAhead < 1", caught);
}

// ── Case 10: Mismatched horizon comparison throws ────────────────────────
{
  const t5 = runMultiYearTrajectory(baseInputs(), 5);
  const t3 = runMultiYearTrajectory(baseInputs(), 3);
  let caught = false;
  try {
    compareMultiYearTrajectories(t5, t3);
  } catch (e) {
    caught = String((e as Error).message).includes("horizons must match");
  }
  checkTruthy("Case 10 throws on mismatched horizons", caught);
}

// ── Case 11: projectYearForward doesn't mutate baseline ──────────────────
{
  const baseline = baseInputs();
  const baselineWagesBefore = Number((baseline.w2s[0] as unknown as { wagesBox1?: string }).wagesBox1);
  projectYearForward(baseline, 5);
  const baselineWagesAfter = Number((baseline.w2s[0] as unknown as { wagesBox1?: string }).wagesBox1);
  check("Case 11 baseline wages unchanged after projection", baselineWagesAfter, baselineWagesBefore);
}

// ── Case 12: Multi-year sum matches baseline run independently ───────────
// Sanity: the trajectory's yearReturns[0] equals computeTaxReturnPure(baseline).
{
  const inputs = baseInputs();
  const traj = runMultiYearTrajectory(inputs, 3);
  const direct = computeTaxReturnPure(inputs);
  check(
    "Case 12 trajectory year-0 fed tax matches direct compute",
    traj.yearReturns[0].federalTaxLiability,
    direct.federalTaxLiability,
  );
}

// ── Print results ─────────────────────────────────────────────────────────
console.log(`\nH3 Multi-year engine tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) {
  FAIL.forEach((f) => console.log(`    ${f}`));
}
process.exit(FAIL.length > 0 ? 1 : 0);
