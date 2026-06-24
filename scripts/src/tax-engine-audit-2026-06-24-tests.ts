/**
 * FULL-APP AUDIT — ROUND 2 (2026-06-24). Hand-calc'd regression pins for the
 * confirmed correctness/consistency bugs found in the second full-app audit pass.
 * Every expected value below was hand-derived against the primary source FIRST,
 * then cross-checked against the engine (see the per-block Hand-calc comments).
 *
 *   Q1  §199A(e)(1) QBI taxable-income CAP BASE must subtract the OBBBA
 *       Schedule 1-A (line 13b) deductions. Form 8995 line 11 ("taxable income
 *       before QBI deduction") is computed WITHOUT regard to §199A only — every
 *       OTHER deduction, including the new OBBBA tips/overtime/car-loan/senior
 *       deductions, still reduces the cap base. The pre-fix engine over-deducted
 *       QBI whenever the income cap binds AND an OBBBA deduction is present.
 *
 *   P1  Planning OBBBA detectors (G1.97 tips / G1.98 overtime / G1.100 senior)
 *       must return null for MFS — the engine zeroes those deductions for a
 *       married-filing-separately filer (§224(f)/§225(e)/§151(d)(5); Notice
 *       2025-69). §163(h)(4) car-loan interest (G1.99) has NO such bar.
 *
 *   P2  obbbaIsJoint(): QSS ("qualifying_widow") is NOT a "joint return" for the
 *       OBBBA doubled caps — it gets the SINGLE cap (overtime $12,500, not the
 *       $25,000 joint cap), matching the engine (audit #2 A8). Only MFJ doubles.
 *
 *   P3  Saver's-Credit detector (G1.31) defers to the engine's §25B
 *       saversCredit.appliedCredit — which enforces the §25B(c)(2)(B)
 *       claimed-as-dependent bar (rate → 0). The pre-fix heuristic surfaced a
 *       phantom credit for a dependent.
 *
 *   S-MO  Missouri TY2025 top rate 4.8% → 4.7% (SB3 trigger) + $1,313-step
 *         brackets (MO DOR 2025 Tax Chart: top = "$256 + 4.7% over $9,191").
 *   S-OR  Oregon TY2025 inflation-indexed brackets ($4,400/$11,100 single;
 *         $8,800/$22,200 MFJ) + std ded $2,835/$5,670/$4,560 (OR-40 2025).
 *   M-AA  MD Anne Arundel TY2025+ graduated local rates: middle 2.81% → 2.94%,
 *         top 3.20% → 3.30% (MD Comptroller 2025 legislative-session alert).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-audit-2026-06-24-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
  type AdjustmentFact,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  calculateStateTax,
  calculateMultiStateTax,
} from "../../artifacts/api-server/src/lib/taxCalculator";
import { evaluatePlanningOpportunities } from "../../artifacts/api-server/src/lib/planningEngine";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.01): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) passed++;
  else {
    failed++;
    failures.push(`  X ${label}: expected ${expected}±${tol}, got ${actual}`);
  }
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    failures.push(`  X ${label}`);
  }
}
function header(t: string): void {
  console.log(`\n-- ${t} --`);
}
const A = (t: string, amt: number): AdjustmentFact => ({ adjustmentType: t, amount: amt, isApplied: true });

function planHits(client: any, adjustments: AdjustmentFact[], w2s: any[] = []) {
  const computed = computeTaxReturnPure({
    client, w2s, form1099s: [], adjustments, taxYear: client.taxYear,
  } as TaxReturnInputs);
  const hits = evaluatePlanningOpportunities({ client, computed, adjustments });
  return { computed, hits };
}
const fires = (hits: { strategyId: string }[], id: string) => hits.some((h) => h.strategyId === id);

// ════════════════════════════════════════════════════════════════════════════
// Q1 — §199A QBI cap base subtracts the OBBBA Schedule 1-A deductions.
// ════════════════════════════════════════════════════════════════════════════
header("Q1 — QBI taxable-income cap base nets out OBBBA line-13b deductions");
{
  // Single, TY2025, Schedule C net $80,000 + $12,500 qualified overtime (§225).
  // Hand-calc: SE tax = 80,000 × .9235 × .153 = 11,303.64; ½ = 5,651.82.
  //   AGI = 80,000 − 5,651.82 = 74,348.18 ; QBI = 74,348.18 (no SEHI/retirement).
  //   TI before QBI & before OBBBA = AGI − std ded 15,750 = 58,598.18.
  //   qbiCapBase = 58,598.18 − 12,500 (OBBBA overtime) = 46,098.18  ← the fix.
  //   QBI ded = min(20%×74,348.18=14,869.64, 20%×46,098.18=9,219.64) = 9,219.64 (cap binds).
  const withObbba = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2025 },
    w2s: [], form1099s: [],
    adjustments: [A("self_employment_income", 80000), A("qualified_overtime", 12500)],
    taxYear: 2025,
  } as TaxReturnInputs);
  check("Q1 OBBBA total = 12,500", (withObbba as any).obbbaSchedule1A.total, 12500);
  check("Q1 cap base = TI − OBBBA = 46,098.18", (withObbba as any).detail.qbi.taxableIncomeBeforeQbi, 46098.18, 0.05);
  check("Q1 QBI deduction = 20% × 46,098.18 = 9,219.64 (cap binds)", withObbba.qbiDeduction, 9219.64, 0.05);

  // Control: identical return WITHOUT the OBBBA deduction → cap base = full
  // 58,598.18, QBI ded = 11,719.64. The OBBBA presence costs exactly 20%×12,500.
  const noObbba = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2025 },
    w2s: [], form1099s: [],
    adjustments: [A("self_employment_income", 80000)],
    taxYear: 2025,
  } as TaxReturnInputs);
  check("Q1 control cap base = 58,598.18", (noObbba as any).detail.qbi.taxableIncomeBeforeQbi, 58598.18, 0.05);
  check("Q1 control QBI deduction = 11,719.64", noObbba.qbiDeduction, 11719.64, 0.05);
  check("Q1 identity: QBI-ded drop = 20% × 12,500 = 2,500", noObbba.qbiDeduction - withObbba.qbiDeduction, 2500, 0.05);
}

// ════════════════════════════════════════════════════════════════════════════
// P1 — OBBBA planning detectors barred for MFS (car-loan exempt).
// ════════════════════════════════════════════════════════════════════════════
header("P1 — OBBBA detectors null for MFS; car-loan (G1.99) has no MFS bar");
{
  // MFS + $10,000 overtime: engine zeroes the §225 deduction → G1.98 must not fire.
  const mfsOt = planHits(
    { filingStatus: "married_filing_separately", state: "FL", taxYear: 2025 },
    [A("qualified_overtime", 10000)],
  );
  check("P1 MFS engine overtime deduction = 0", (mfsOt.computed as any).obbbaSchedule1A.overtime, 0);
  checkTrue("P1 MFS overtime detector G1.98 suppressed", !fires(mfsOt.hits, "G1.98"));
  // MFS + $5,000 car-loan interest + SE $90k: §163(h)(4) has NO MFS bar → fires.
  const mfsCar = planHits(
    { filingStatus: "married_filing_separately", state: "FL", taxYear: 2025 },
    [A("qualified_car_loan_interest", 5000), A("self_employment_income", 90000)],
  );
  check("P1 MFS engine car-loan deduction = 5,000 (no bar)", (mfsCar.computed as any).obbbaSchedule1A.carLoanInterest, 5000);
  checkTrue("P1 MFS car-loan detector G1.99 fires", fires(mfsCar.hits, "G1.99"));
}

// ════════════════════════════════════════════════════════════════════════════
// P2 — QSS gets the SINGLE OBBBA cap (overtime $12,500), not the $25k joint cap.
// ════════════════════════════════════════════════════════════════════════════
header("P2 — QSS OBBBA overtime capped at single $12,500 (engine + detector)");
{
  // QSS + $20,000 overtime + SE $120k: §225 deduction caps at the SINGLE
  // $12,500 (QSS is not a "joint return"). MFJ control gets the full $20,000.
  const qss = planHits(
    { filingStatus: "qualifying_widow", state: "FL", taxYear: 2025 },
    [A("qualified_overtime", 20000), A("self_employment_income", 120000)],
  );
  check("P2 QSS engine overtime deduction = 12,500 (single cap)", (qss.computed as any).obbbaSchedule1A.overtime, 12500);
  checkTrue("P2 QSS overtime detector G1.98 fires", fires(qss.hits, "G1.98"));
  const mfj = planHits(
    { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2025 },
    [A("qualified_overtime", 20000), A("self_employment_income", 120000)],
  );
  check("P2 MFJ engine overtime deduction = 20,000 (under $25k joint cap)", (mfj.computed as any).obbbaSchedule1A.overtime, 20000);
}

// ════════════════════════════════════════════════════════════════════════════
// P3 — Saver's-Credit detector defers to the engine §25B dependent bar.
// ════════════════════════════════════════════════════════════════════════════
header("P3 — G1.31 suppressed for a claimed-as-dependent filer (§25B(c)(2)(B))");
{
  // Single, $25,000 W-2, $2,000 Roth IRA (counts for §25B, non-deductible →
  // AGI clean). 2025 single saver's rate at AGI $25,000 = 20%.
  const w2 = [{ taxYear: 2025, wagesBox1: 25000, stateCode: "FL" }];
  const dep = planHits(
    { filingStatus: "single", state: "FL", taxYear: 2025, claimedAsDependent: true },
    [A("ira_contribution_roth", 2000)], w2,
  );
  check("P3 dependent engine saver's credit = 0 (bar → rate 0)", (dep.computed as any).saversCredit.appliedCredit, 0);
  checkTrue("P3 dependent detector G1.31 suppressed", !fires(dep.hits, "G1.31"));
  const nondep = planHits(
    { filingStatus: "single", state: "FL", taxYear: 2025, claimedAsDependent: false },
    [A("ira_contribution_roth", 2000)], w2,
  );
  check("P3 non-dependent engine saver's credit = 20% × 2,000 = 400", (nondep.computed as any).saversCredit.appliedCredit, 400);
  checkTrue("P3 non-dependent detector G1.31 fires", fires(nondep.hits, "G1.31"));
}

// ════════════════════════════════════════════════════════════════════════════
// S-MO — Missouri TY2025 top rate 4.7% + $1,313-step brackets.
// ════════════════════════════════════════════════════════════════════════════
header("S-MO — Missouri TY2025 4.7% top rate / $1,313-step brackets");
{
  // base $50,000 = AGI $65,750 − federal-conforming std ded $15,750. MO 2025:
  // cumulative tax through the 4.5% band = $256.035; + 4.7%×(50,000−9,191)=1,918.023
  // → $2,174.06. (2024 = $2,275.71 at 4.8% + the lower $14,600 std ded.)
  check("S-MO 2025 AGI $65,750 single = $2,174.06", calculateStateTax(65750, "MO", "single", 2025), 2174.06, 0.05);
  checkTrue("S-MO 2025 tax < 2024 tax (rate cut)", calculateStateTax(65750, "MO", "single", 2025) < calculateStateTax(65750, "MO", "single", 2024));
}

// ════════════════════════════════════════════════════════════════════════════
// S-OR — Oregon TY2025 inflation-indexed brackets + std ded.
// ════════════════════════════════════════════════════════════════════════════
header("S-OR — Oregon TY2025 brackets $4,400/$11,100 + std ded $2,835");
{
  // base $50,000 = AGI $52,835 − std ded $2,835. OR 2025 single:
  // 4.75%×4,400 + 6.75%×6,700 + 8.75%×38,900 = 209 + 452.25 + 3,403.75 = $4,065.00.
  check("S-OR 2025 AGI $52,835 single = $4,065.00", calculateStateTax(52835, "OR", "single", 2025), 4065.0, 0.05);
  checkTrue("S-OR 2025 tax < 2024 tax (higher std ded)", calculateStateTax(52835, "OR", "single", 2025) < calculateStateTax(52835, "OR", "single", 2024));
}

// ════════════════════════════════════════════════════════════════════════════
// M-AA — MD Anne Arundel TY2025+ graduated local rates (2.94% / 3.30%).
// ════════════════════════════════════════════════════════════════════════════
header("M-AA — MD Anne Arundel TY2025 local 2.70/2.94/3.30%; 2024 unchanged");
{
  const aa = (agi: number, status: string, year: number) =>
    calculateMultiStateTax({
      residentState: "MD", federalAgi: agi, filingStatus: status, taxYear: year,
      perStateWages: [{ stateCode: "MD", wages: agi }], localityCode: "MD-ANNE_ARUNDEL", totalWages: agi,
    }).localTax?.netLocalTax ?? 0;
  // 2025 single, MD base $100,000 (AGI − $3,350 std ded): 2.70%×50k + 2.94%×50k = $2,820.
  check("M-AA single 2025 base $100k = $2,820 (2.94% middle)", aa(103350, "single", 2025), 2820.0, 0.05);
  // 2025 MFJ, base $100,000 (AGI − $6,700): 2.70%×75k + 2.94%×25k = $2,760.
  check("M-AA MFJ 2025 base $100k = $2,760", aa(106700, "married_filing_jointly", 2025), 2760.0, 0.05);
  // 2025 single, base $500,000: 2.70%×50k + 2.94%×350k + 3.30%×100k = $14,940 (top band 3.30%).
  check("M-AA single 2025 base $500k = $14,940 (3.30% top)", aa(503350, "single", 2025), 14940.0, 0.05);
  // 2024 regression: middle band STILL 2.81% (year-indexing must not touch 2024).
  check("M-AA single 2024 base $100k = $2,755 (2.81% unchanged)", aa(102700, "single", 2024), 2755.0, 0.05);
}

// ── Summary ──
console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log(f);
  process.exit(1);
}
console.log("ALL AUDIT-2026-06-24 ROUND-2 ASSERTIONS PASS");
