/**
 * Schedule C asset-level depreciation calculator — hand-calc'd tests (P2, 2026-06-06h).
 *
 * Covers `computeScheduleCAssetDepreciation` (Form 4562: §179 with the §179(b)(3)
 * business-income limit + carryforward, §168(k) bonus, and personal-property
 * GDS MACRS — Pub 946 Table A-1, half-year convention) AND its end-to-end effect
 * via `computeTaxReturnPure` (`scheduleCAssets` → the SE-base-reducing
 * schedule_c_depreciation total).
 *
 * Every MACRS percentage is from IRS Pub 946 Appendix A Table A-1 (verified; each
 * class sums to 100%); every expected value is hand-calc'd against the rule below.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-schedule-c-asset-depreciation-tests.ts
 */
import {
  computeScheduleCAssetDepreciation,
  type ScheduleCAsset,
  type ScheduleCAssetDepreciationParams,
} from "../../artifacts/api-server/src/lib/taxCalculator";
import {
  computeTaxReturnPure,
  SECTION_179_CAPS,
  type TaxReturnInputs,
  type AdjustmentFact,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.01): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}±${tol}, got ${actual}`);
}
function checkBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function header(t: string) { console.log(`\n-- ${t} --`); }

// §168(k) bonus rate by acquisition year (matches the engine's
// BONUS_RATE_BY_ACQUISITION_YEAR), for the pure-calculator cases.
const BONUS: Record<number, number> = {
  2018: 1.0, 2022: 1.0, 2023: 0.8, 2024: 0.6, 2025: 0.4, 2026: 1.0,
};
// §179 2024 caps (Rev. Proc. 2023-34: $1.22M cap / $3.05M phase-out); non-binding
// for these small-asset cases.
function calc(
  assets: ScheduleCAsset[],
  opts: Partial<ScheduleCAssetDepreciationParams> = {},
) {
  return computeScheduleCAssetDepreciation({
    assets,
    taxYear: 2024,
    businessIncomeForSection179: 1_000_000, // plenty unless overridden
    section179Cap: 1_220_000,
    section179PhaseStart: 3_050_000,
    bonusRateByYear: BONUS,
    ...opts,
  });
}

// ════════════════════════ Pure calculator ════════════════════════
// ── A1: 5-yr asset, current year, BONUS only ──
// cost $10,000, 5-yr, 2024, bonus. bonus = 60% × 10,000 = $6,000.
// MACRS basis = 10,000 − 6,000 = 4,000; year-1 (5-yr) = 20.00% × 4,000 = $800.
// total = 6,000 + 800 = $6,800.
header("A1: 5-yr $10k bonus → $6,000 bonus + $800 MACRS = $6,800");
{
  const r = calc([{ cost: 10000, recoveryYears: 5, placedInServiceYear: 2024, bonus: true }]);
  check("A1 bonus = $6,000", r.bonusDeduction, 6000);
  check("A1 MACRS = $800", r.macrsDeduction, 800);
  check("A1 §179 = 0", r.section179Deduction, 0);
  check("A1 total = $6,800", r.totalDepreciation, 6800);
}

// ── A2: 7-yr asset, current year, MACRS only (no §179, no bonus) ──
// cost $14,000, 7-yr, 2024. year-1 (7-yr) = 14.29% × 14,000 = $2,000.60.
header("A2: 7-yr $14k MACRS-only → 14.29% × 14,000 = $2,000.60");
{
  const r = calc([{ cost: 14000, recoveryYears: 7, placedInServiceYear: 2024 }]);
  check("A2 MACRS = $2,000.60", r.macrsDeduction, 2000.6);
  check("A2 total = $2,000.60", r.totalDepreciation, 2000.6);
  check("A2 bonus = 0", r.bonusDeduction, 0);
}

// ── A3: §179 full expensing, income NOT limited ──
// cost $20,000, 5-yr, 2024, §179. business income $100k. §179 = min(20,000, 100,000)
// = $20,000; no MACRS (fully §179'd). total = $20,000.
header("A3: §179 $20k, income $100k → $20,000 §179, no carryforward");
{
  const r = calc([{ cost: 20000, recoveryYears: 5, placedInServiceYear: 2024, section179: true }],
    { businessIncomeForSection179: 100000 });
  check("A3 §179 = $20,000", r.section179Deduction, 20000);
  check("A3 MACRS = 0 (fully §179'd)", r.macrsDeduction, 0);
  check("A3 carryforward = 0", r.section179Carryforward, 0);
  check("A3 total = $20,000", r.totalDepreciation, 20000);
}

// ── A4: §179 INCOME-LIMITED (§179(b)(3)) → carryforward ──
// cost $60,000, 7-yr, 2024, §179. business income $50k. §179 = min(60,000, 50,000)
// = $50,000; carryforward = 60,000 − 50,000 = $10,000. total = $50,000.
header("A4: §179 $60k, income $50k → $50,000 allowed, $10,000 carryforward");
{
  const r = calc([{ cost: 60000, recoveryYears: 7, placedInServiceYear: 2024, section179: true }],
    { businessIncomeForSection179: 50000 });
  check("A4 §179 = $50,000", r.section179Deduction, 50000);
  check("A4 carryforward = $10,000", r.section179Carryforward, 10000);
  check("A4 total = $50,000", r.totalDepreciation, 50000);
}

// ── A5: §179 carryforward-IN + current §179, income limit binds, re-carry ──
// current §179 asset $5,000 + carryIn $10,000; business income $8,000.
// available = 5,000 + 10,000 = 15,000; §179 = min(15,000, 8,000) = $8,000;
// carryforward = 15,000 − 8,000 = $7,000.
header("A5: carry-in $10k + $5k §179, income $8k → $8,000 allowed, $7,000 re-carry");
{
  const r = calc([{ cost: 5000, recoveryYears: 5, placedInServiceYear: 2024, section179: true }],
    { businessIncomeForSection179: 8000, section179CarryforwardIn: 10000 });
  check("A5 §179 = $8,000", r.section179Deduction, 8000);
  check("A5 carryforward = $7,000", r.section179Carryforward, 7000);
}

// ── A6: PRIOR-year asset, MACRS year-3 (multi-year) ──
// cost $10,000, 5-yr, placed 2022, taxYear 2024 → year 3 (index 2) = 19.20% ×
// 10,000 = $1,920. No bonus, no §179.
header("A6: 5-yr $10k placed 2022, TY2024 → year-3 19.20% = $1,920");
{
  const r = calc([{ cost: 10000, recoveryYears: 5, placedInServiceYear: 2022 }]);
  check("A6 MACRS = $1,920", r.macrsDeduction, 1920);
  check("A6 total = $1,920", r.totalDepreciation, 1920);
}

// ── A7: PRIOR-year BONUS asset — basis reconstruction ──
// cost $10,000, 5-yr, placed 2023 (80% bonus that year), bonus=true, TY2024.
// Bonus was taken in 2023 (NOT now): MACRS basis = 10,000 − 80%×10,000 = $2,000.
// TY2024 = year 2 (index 1) = 32.00% × 2,000 = $640. Bonus now = 0.
header("A7: 5-yr $10k bonus placed 2023, TY2024 → MACRS on $2k basis, yr-2 32% = $640");
{
  const r = calc([{ cost: 10000, recoveryYears: 5, placedInServiceYear: 2023, bonus: true }]);
  check("A7 bonus now = 0 (taken in 2023)", r.bonusDeduction, 0);
  check("A7 MACRS = $640 (32% × $2,000 post-bonus basis)", r.macrsDeduction, 640);
  check("A7 total = $640", r.totalDepreciation, 640);
}

// ── A8: multiple assets; income limit subtracts bonus+MACRS from the §179 ceiling ──
// Asset A: $30,000 7-yr §179. Asset B: $10,000 5-yr bonus.
// B: bonus 60%×10,000 = $6,000; MACRS basis 4,000; yr-1 20% = $800.
// business income $32,000 → §179 ceiling = 32,000 − 6,000 − 800 = $25,200.
// §179 = min(30,000, 25,200) = $25,200; carryforward = 30,000 − 25,200 = $4,800.
// total = 25,200 + 6,000 + 800 = $32,000.
header("A8: $30k §179 + $10k bonus, income $32k → §179 $25,200 (ceiling nets bonus+MACRS)");
{
  const r = calc([
    { cost: 30000, recoveryYears: 7, placedInServiceYear: 2024, section179: true },
    { cost: 10000, recoveryYears: 5, placedInServiceYear: 2024, bonus: true },
  ], { businessIncomeForSection179: 32000 });
  check("A8 bonus = $6,000", r.bonusDeduction, 6000);
  check("A8 MACRS = $800", r.macrsDeduction, 800);
  check("A8 §179 = $25,200 (ceiling = 32,000 − 6,000 − 800)", r.section179Deduction, 25200);
  check("A8 carryforward = $4,800", r.section179Carryforward, 4800);
  check("A8 total = $32,000", r.totalDepreciation, 32000);
}

// ── A9: OBBBA 100% bonus (post-1/19/2025 property) vs the conservative default ──
// cost $50,000, 5-yr, placed 2025, bonus + bonusFullObbba, taxYear 2025.
// 100% bonus = $50,000; MACRS basis 0 → no MACRS. total = $50,000.
header("A9: 2025 $50k bonus + bonusFullObbba → 100% = $50,000 (no MACRS)");
{
  const r = calc([{ cost: 50000, recoveryYears: 5, placedInServiceYear: 2025, bonus: true, bonusFullObbba: true }],
    { taxYear: 2025 });
  check("A9 bonus = $50,000 (OBBBA 100%)", r.bonusDeduction, 50000);
  check("A9 MACRS = 0", r.macrsDeduction, 0);
  check("A9 total = $50,000", r.totalDepreciation, 50000);
}
// ── A9b: SAME asset WITHOUT the flag → conservative 40% TCJA default ──
// 40% bonus = $20,000; MACRS basis $30,000; yr-1 (5-yr) 20% = $6,000. total = $26,000.
header("A9b: 2025 $50k bonus, no OBBBA flag → 40% = $20k + $6k MACRS = $26,000");
{
  const r = calc([{ cost: 50000, recoveryYears: 5, placedInServiceYear: 2025, bonus: true }],
    { taxYear: 2025 });
  check("A9b bonus = $20,000 (40% TCJA default)", r.bonusDeduction, 20000);
  check("A9b MACRS = $6,000 (20% × $30k post-bonus basis)", r.macrsDeduction, 6000);
  check("A9b total = $26,000", r.totalDepreciation, 26000);
}

// ════════════════════════ §168(d)(3) mid-quarter detection ════════════════════════
// MACRS is computed half-year regardless; `midQuarterApplies` flags when > 40% of
// the year's NON-§179 depreciable basis is placed in Q4 (CPA must then override).

// ── MQ1: 60% of basis in Q4 → mid-quarter applies ──
// A $60k Q4 + B $40k Q1 (both MACRS). Q4 share 60/100 = 60% > 40% → TRUE.
header("MQ1: $60k Q4 + $40k Q1 (60% in Q4) → midQuarterApplies = true");
{
  const r = calc([
    { cost: 60000, recoveryYears: 5, placedInServiceYear: 2024, placedInServiceQuarter: 4 },
    { cost: 40000, recoveryYears: 5, placedInServiceYear: 2024, placedInServiceQuarter: 1 },
  ]);
  checkBool("MQ1 midQuarterApplies = true", r.midQuarterApplies, true);
}
// ── MQ2: 30% of basis in Q4 → does NOT apply ──
header("MQ2: $30k Q4 + $70k Q1 (30% in Q4) → midQuarterApplies = false");
{
  const r = calc([
    { cost: 30000, recoveryYears: 5, placedInServiceYear: 2024, placedInServiceQuarter: 4 },
    { cost: 70000, recoveryYears: 5, placedInServiceYear: 2024, placedInServiceQuarter: 1 },
  ]);
  checkBool("MQ2 midQuarterApplies = false (30% ≤ 40%)", r.midQuarterApplies, false);
}
// ── MQ3: §179 property is EXCLUDED from the 40% test (§168(d)(3)) ──
// A $80k Q4 §179 (excluded) + B $50k Q1 MACRS. Test basis = B only = $50k; Q4 = $0
// → false. (If §179 counted, 80/130 = 62% would wrongly trigger.)
header("MQ3: $80k Q4 §179 excluded + $50k Q1 MACRS → false (§179 not in the test)");
{
  const r = calc([
    { cost: 80000, recoveryYears: 5, placedInServiceYear: 2024, section179: true, placedInServiceQuarter: 4 },
    { cost: 50000, recoveryYears: 5, placedInServiceYear: 2024, bonus: true, placedInServiceQuarter: 1 },
  ], { businessIncomeForSection179: 200000 });
  checkBool("MQ3 midQuarterApplies = false (§179 Q4 asset excluded)", r.midQuarterApplies, false);
}
// ── MQ4: no quarter data → false (default to half-year) ──
header("MQ4: no placedInServiceQuarter → midQuarterApplies = false");
{
  const r = calc([
    { cost: 60000, recoveryYears: 5, placedInServiceYear: 2024 },
    { cost: 40000, recoveryYears: 5, placedInServiceYear: 2024 },
  ]);
  checkBool("MQ4 midQuarterApplies = false (no quarter data)", r.midQuarterApplies, false);
}

// ════════════════════════ End-to-end (SE base) ════════════════════════
function mkReturn(scheduleCAssets: ScheduleCAsset[], adj: AdjustmentFact[], w2 = 0): TaxReturnInputs {
  return {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: w2 > 0 ? [{ taxYear: 2024, wagesBox1: w2, stateCode: "FL" }] : [],
    form1099s: [],
    adjustments: adj,
    scheduleCAssets,
    taxYear: 2024,
  } as unknown as TaxReturnInputs;
}
const A = (t: string, amt: number): AdjustmentFact => ({ adjustmentType: t, amount: amt, isApplied: true });

// ── E1: asset §179 reduces the SE base by exactly the depreciation ──
// SE income $100k, one 5-yr $20k §179 asset (income not limited → $20k §179).
// SE base 100,000 → 80,000. SE-tax delta = 20,000 × 0.9235 × 0.153 = $2,825.91.
header("E1: $20k §179 asset reduces SE tax by $2,825.91 (= $20k × 0.9235 × 0.153)");
{
  const baseE = computeTaxReturnPure(mkReturn([], [A("self_employment_income", 100000)]));
  const withAsset = computeTaxReturnPure(mkReturn(
    [{ cost: 20000, recoveryYears: 5, placedInServiceYear: 2024, section179: true }],
    [A("self_employment_income", 100000)]));
  check("E1 scheduleCDepreciation = $20,000", withAsset.scheduleCDepreciation, 20000);
  check("E1 §179 deduction = $20,000", withAsset.scheduleCAssetDepreciation?.section179Deduction ?? -1, 20000);
  check("E1 SE tax drops $2,825.91", baseE.selfEmploymentTax - withAsset.selfEmploymentTax, 2825.91, 1);
}

// ── E2: §179 income limit binds end-to-end → carryforward + SE tax floored ──
// SE income $30k, one 7-yr $50k §179. §179 = min(50,000, 30,000) = $30,000;
// carryforward $20,000; SE net = 30,000 − 30,000 = 0 → SE tax 0.
header("E2: low-income §179 → $30k allowed, $20k carryforward, SE tax 0");
{
  const r = computeTaxReturnPure(mkReturn(
    [{ cost: 50000, recoveryYears: 7, placedInServiceYear: 2024, section179: true }],
    [A("self_employment_income", 30000)]));
  check("E2 §179 deduction = $30,000 (income-limited)", r.scheduleCAssetDepreciation?.section179Deduction ?? -1, 30000);
  check("E2 §179 carryforward = $20,000", r.scheduleCAssetDepreciation?.section179Carryforward ?? -1, 20000);
  check("E2 SE tax floored at 0", r.selfEmploymentTax, 0, 0.5);
}

// ── E3: gated — no scheduleCAssets → null, SE base unchanged ──
header("E3: no scheduleCAssets → scheduleCAssetDepreciation null (inert)");
{
  const r = computeTaxReturnPure(mkReturn([], [A("self_employment_income", 100000)]));
  checkBool("E3 scheduleCAssetDepreciation is null", r.scheduleCAssetDepreciation === null, true);
  check("E3 scheduleCDepreciation = 0", r.scheduleCDepreciation, 0);
}

// ── E4: W-2 wages lift the §179 business-income limit (Reg §1.179-2(c)(6)(iv)) ──
// SE income $20k + W-2 $80k, one 7-yr $50k §179. §179 ceiling = 20,000 + 80,000 =
// 100,000 → §179 = $50,000 (fully allowed; without wages it would cap at $20k).
// Sch C net = 20,000 − 50,000 = −30,000 loss → flows to AGI: 80,000 − 30,000 = $50,000.
header("E4: W-2 $80k lifts §179 limit → full $50k §179, AGI = $50,000");
{
  const r = computeTaxReturnPure(mkReturn(
    [{ cost: 50000, recoveryYears: 7, placedInServiceYear: 2024, section179: true }],
    [A("self_employment_income", 20000)], 80000));
  check("E4 §179 deduction = $50,000 (wage-lifted)", r.scheduleCAssetDepreciation?.section179Deduction ?? -1, 50000);
  check("E4 §179 carryforward = 0", r.scheduleCAssetDepreciation?.section179Carryforward ?? -1, 0);
  check("E4 AGI = $50,000 (Sch C loss offsets wages)", r.adjustedGrossIncome, 50000, 1);
}

// ════════════════════════ §179 carryforward roll-forward ════════════════════════
// The §179(b)(3)(B) income-limit carryforward persists
// (tax_returns.schedule_c_section179_carryforward_remaining) and re-seeds as a
// `schedule_c_section179_carryforward` adjustment that the engine adds to next
// year's §179 available BEFORE the income limit (mirrors §41/§51). Tested at the
// engine level by feeding year-N's carryforward as year-N+1's input.

// ── C1: carried §179 deducts with NO new assets (engine runs on carryforward alone) ──
// SE income $30k, prior §179 carryforward $10k, no assets. available = $10k;
// income limit $30k → §179 = $10,000 fully deducted; nothing re-carries.
header("C1: §179 carryforward $10k + no assets, SE $30k → $10,000 deducted");
{
  const r = computeTaxReturnPure(mkReturn([], [
    A("self_employment_income", 30000),
    A("schedule_c_section179_carryforward", 10000),
  ]));
  check("C1 §179 deduction = $10,000", r.scheduleCAssetDepreciation?.section179Deduction ?? -1, 10000);
  check("C1 nothing re-carried", r.scheduleCAssetDepreciation?.section179Carryforward ?? -1, 0);
  check("C1 scheduleCDepreciation = $10,000", r.scheduleCDepreciation, 10000);
}

// ── C2: carried §179 RE-LIMITED by a low-income year → re-carries ──
// SE income $6k, prior §179 carryforward $10k. §179 = min(10,000, 6,000) = $6,000;
// re-carry = $4,000.
header("C2: §179 carryforward $10k, SE $6k → $6,000 deducted, $4,000 re-carry");
{
  const r = computeTaxReturnPure(mkReturn([], [
    A("self_employment_income", 6000),
    A("schedule_c_section179_carryforward", 10000),
  ]));
  check("C2 §179 deduction = $6,000 (income-limited again)", r.scheduleCAssetDepreciation?.section179Deduction ?? -1, 6000);
  check("C2 §179 re-carry = $4,000", r.scheduleCAssetDepreciation?.section179Carryforward ?? -1, 4000);
}

// ── C3: full year-N → year-N+1 roll-forward ──
// Year N: SE $30k + a $50k 7-yr §179 asset → §179 $30k allowed, $20k carryforward.
// Year N+1: feed that $20k carryforward, SE $30k, no new assets → $20k deducted.
header("C3: year-N disallows $20k → persists → year-N+1 deducts the carryforward");
{
  const yearN = computeTaxReturnPure(mkReturn(
    [{ cost: 50000, recoveryYears: 7, placedInServiceYear: 2024, section179: true }],
    [A("self_employment_income", 30000)]));
  check("C3 year-N carryforward = $20,000", yearN.scheduleCAssetDepreciation?.section179Carryforward ?? -1, 20000);

  const rolled = yearN.scheduleCAssetDepreciation?.section179Carryforward ?? 0;
  const yearN1 = computeTaxReturnPure(mkReturn([], [
    A("self_employment_income", 30000),
    A("schedule_c_section179_carryforward", rolled),
  ]));
  check("C3 year-N+1 §179 deduction = $20,000 (rolled forward)", yearN1.scheduleCAssetDepreciation?.section179Deduction ?? -1, 20000);
  check("C3 year-N+1 nothing left to carry", yearN1.scheduleCAssetDepreciation?.section179Carryforward ?? -1, 0);
}

// ════════════════════════ SECTION_179_CAPS regression ════════════════════════
// 2026-06-06i — the TY2024 §179 cap/phase-out were stale (held the 2023 figures
// $1,160,000 / $2,890,000). Correct TY2024 values: $1,220,000 cap / $3,050,000
// phase-out (Rev. Proc. 2023-34 §3.27). 2025/2026 = OBBBA $2.5M/$4.0M + indexed.
header("CAP: SECTION_179_CAPS year values (TY2024 corrected to $1.22M / $3.05M)");
{
  check("CAP 2024 cap = $1,220,000 (not stale $1,160,000)", SECTION_179_CAPS[2024].cap, 1_220_000, 0);
  check("CAP 2024 phase-out = $3,050,000 (not stale $2,890,000)", SECTION_179_CAPS[2024].phaseStart, 3_050_000, 0);
  check("CAP 2025 cap = $2,500,000 (OBBBA)", SECTION_179_CAPS[2025].cap, 2_500_000, 0);
  check("CAP 2025 phase-out = $4,000,000 (OBBBA)", SECTION_179_CAPS[2025].phaseStart, 4_000_000, 0);
  check("CAP 2026 cap = $2,560,000 (OBBBA indexed)", SECTION_179_CAPS[2026].cap, 2_560_000, 0);
  check("CAP 2026 phase-out = $4,090,000 (OBBBA indexed)", SECTION_179_CAPS[2026].phaseStart, 4_090_000, 0);
}

// Behavioral: the above-the-line §179 caps at $1,220,000 (the income limit doesn't
// bind on $2M of SE income; the phase-out doesn't apply below $3.05M of property).
// Under the old stale cap this would have been $1,160,000.
header("CAP-e2e: §179 elected $1.3M on $2M SE → capped at $1,220,000");
{
  const r = computeTaxReturnPure(mkReturn([], [
    A("self_employment_income", 2_000_000),
    A("section_179_expense_election", 1_300_000),
  ]));
  check("CAP-e2e §179 applied = $1,220,000 (cap binds)", r.section179Applied, 1_220_000, 1);
}

// ── Summary ──
console.log(`\n== Schedule C asset depreciation ==  PASS: ${PASS.length}  FAIL: ${FAIL.length}`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log("ALL SCHEDULE-C ASSET-DEPRECIATION ASSERTIONS PASS");
