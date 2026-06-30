/**
 * FULL-APP AUDIT 2026-06-30 — regression locks for the confirmed engine fixes.
 *
 * Pure engine + pure planning-lib (no API). Each value is hand-derived against the
 * cited IRS primary source. Covers:
 *   ENG-1  Sch SE non-farm OPTIONAL METHOD — Line 4b is NOT re-haircut by 92.35%.
 *   ENG-2  NIIT §163(d) investment interest = Form 8960 line 9c reduction to NII
 *          (only when itemized); §163(d)(4)(B) election lowers NIIT too.
 *   ENG-4/5/6  OBBBA Schedule 1-A phase-outs — per-$1,000 STEP (car-loan rounds UP
 *          "or fraction thereof"; tips/overtime round DOWN), senior stays smooth.
 *   ENG-7/8  Traditional-IRA deduction phase-out — Pub 590-A Worksheet 1-2 round-UP
 *          to next $10 + the §219(g)(2)(B) $200 minimum floor.
 *   CR-4/5  rothOptimizer + multiYearEngine growth-factor clamp (no negative/explosive
 *          projections from unbounded user-supplied growth).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-audit-2026-06-30-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { calculateObbbaSchedule1ADeductions, calculateRetirementDeductions } from "../../artifacts/api-server/src/lib/taxCalculator";
import { projectYearForward } from "../../artifacts/api-server/src/lib/multiYearEngine";
import { optimizeRothConversionLadder } from "../../artifacts/api-server/src/lib/rothOptimizer";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.5) {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(label);
  else FAIL.push(`${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean) {
  if (cond) PASS.push(label); else FAIL.push(`${label}: expected true`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

// ── ENG-1 — Sch SE non-farm optional method (Line 4b, no ×0.9235) ──
header("ENG-1 SE non-farm optional method");
{
  const seOpt = (gross: number, status = "single"): number =>
    computeTaxReturnPure({
      client: { filingStatus: status, state: "TX", taxYear: 2024 },
      w2s: [], form1099s: [], taxYear: 2024,
      adjustments: [{ adjustmentType: "se_optional_method_nonfarm", amount: gross } as never],
    } as TaxReturnInputs).selfEmploymentTax;
  // ⅔×gross (capped at the 2024 $6,920 max) × 15.3%, NO second 92.35% reduction.
  check("$10k gross → SE tax $1,020.00 (⅔×10k=6,666.67 × 15.3%)", seOpt(10000), 1020.0);
  check("$4k gross → SE tax $408.00", seOpt(4000), 408.0);
  check("$7k gross → SE tax $714.00", seOpt(7000), 714.0);
  check("$30k gross → capped at $6,920 → SE tax $1,058.76", seOpt(30000), 1058.76);
  // MFJ per-spouse path (optional defaults to the taxpayer; spouse $1 NEC triggers it).
  const mfj = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "Y", nonemployeeCompensation: 1, spouse: "spouse" } as never],
    adjustments: [
      { adjustmentType: "self_employment_income", amount: 10000 } as never,
      { adjustmentType: "schedule_c_expenses", amount: 7000 } as never,
      { adjustmentType: "se_optional_method_nonfarm", amount: 10000 } as never,
    ],
    taxYear: 2024,
  } as TaxReturnInputs).selfEmploymentTax;
  check("MFJ optional method → SE tax $1,020.00", mfj, 1020.0);
  // Regression: a normal SE return is byte-identical (no optional election).
  check("regression: pure $80k SE → $11,303.64 (unchanged)",
    computeTaxReturnPure({ client: { filingStatus: "single", state: "TX", taxYear: 2024 }, w2s: [], form1099s: [], adjustments: [{ adjustmentType: "self_employment_income", amount: 80000 } as never], taxYear: 2024 } as TaxReturnInputs).selfEmploymentTax,
    11303.64);
}

// ── ENG-2 — NIIT §163(d) investment interest (Form 8960 line 9c) ──
header("ENG-2 NIIT §163(d) line-9c reduction");
{
  const niit = (intInc: number, invInt: number, itemize: boolean): number =>
    (computeTaxReturnPure({
      client: { filingStatus: "single", state: "FL", taxYear: 2024, ...(itemize ? { useItemizedDeductions: true } : {}) } as never,
      w2s: [{ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 0, stateCode: "FL", medicareWagesBox5: 200000 } as never],
      form1099s: [{ taxYear: 2024, formType: "int", interestIncome: intInc } as never],
      adjustments: invInt ? [{ adjustmentType: "investment_interest_expense", amount: invInt } as never] : [],
      taxYear: 2024,
    } as TaxReturnInputs)).niitTax;
  // Itemizing: NII = $100k − $60k allowed interest = $40k → 3.8% = $1,520.
  check("itemize, $100k int − $60k inv int → NIIT $1,520", niit(100000, 60000, true), 1520);
  check("itemize, $50k int − $20k inv int → NIIT $1,140", niit(50000, 20000, true), 1140);
  // Standard deduction (small inv int can't beat the $14,600 std ded) → NOT deducted → no line-9c reduction.
  check("std ded, $1k inv int → NIIT $3,800 (unchanged, no line-9c)", niit(100000, 1000, false), 3800);
  // Regression: no investment interest → unchanged.
  check("regression: no inv int → NIIT $3,800", niit(100000, 0, true), 3800);
}

// ── ENG-4/5/6 — OBBBA Schedule 1-A per-$1,000 phase-out steps ──
header("ENG-4/5/6 OBBBA phase-out rounding");
{
  const f = calculateObbbaSchedule1ADeductions;
  // Car-loan §163(h)(4): "$200 per $1,000 OR FRACTION" → round UP.
  check("car-loan magi $120,600 → $5,800 (10k − ceil(20.6)×200)", f({ taxYear: 2025, filingStatus: "single", magi: 120600, qualifiedCarLoanInterest: 10000 }).carLoanInterest, 5800);
  check("car-loan magi $100,001 → $9,800 (one $1 fraction = a full step)", f({ taxYear: 2025, filingStatus: "single", magi: 100001, qualifiedCarLoanInterest: 10000 }).carLoanInterest, 9800);
  // Tips §224 / overtime §225: "$100 per $1,000" (no fraction clause) → round DOWN.
  check("tips magi $175,750 → $17,500 (20k − floor(25.75)×100)", f({ taxYear: 2025, filingStatus: "single", magi: 175750, qualifiedTips: 20000 }).tips, 17500);
  check("overtime magi $160,900 → $11,500 (12.5k − floor(10.9)×100)", f({ taxYear: 2025, filingStatus: "single", magi: 160900, qualifiedOvertime: 12500 }).overtime, 11500);
  check("overtime MFJ magi $305,500 → $24,500", f({ taxYear: 2025, filingStatus: "married_filing_jointly", magi: 305500, qualifiedOvertime: 25000 }).overtime, 24500);
  // Senior §151(d): straight 6% of excess (unchanged, no per-$1,000 step).
  check("senior magi $80,000 age 70 → $5,700 (6,000 − 6%×5,000, smooth)", f({ taxYear: 2025, filingStatus: "single", magi: 80000, taxpayerAge: 70 }).senior, 5700);
  // Below threshold → full.
  check("tips below threshold → full $20,000", f({ taxYear: 2025, filingStatus: "single", magi: 140000, qualifiedTips: 20000 }).tips, 20000);
}

// ── ENG-7/8 — IRA deduction phase-out (Pub 590-A Worksheet 1-2) ──
header("ENG-7/8 IRA deduction phase-out rounding + $200 floor");
{
  const ira = (agi: number, status = "single", covered = true): number =>
    calculateRetirementDeductions({ hsaContribution: 0, hsaIsFamilyCoverage: false, iraContribution: 7000, iraCoveredByWorkplacePlan: covered, age: 40, agi, filingStatus: status, taxYear: 2024 } as never).iraDeductible;
  check("single agi $86,950 → $200 (§219(g)(2)(B) floor; raw $35)", ira(86950), 200, 0.01);
  check("single agi $86,990 → $200 (floor; raw $7)", ira(86990), 200, 0.01);
  check("single agi $83,333 → $2,570 (round $2,566.9 up to next $10)", ira(83333), 2570, 0.01);
  check("MFJ agi $141,500 → $530 (round $525 up to next $10)", ira(141500, "married_filing_jointly"), 530, 0.01);
  check("regression: below band agi $70,000 → full $7,000", ira(70000), 7000, 0.01);
  check("regression: above band agi $90,000 → $0 (no floor)", ira(90000), 0, 0.01);
  check("regression: not covered agi $50,000 → full $7,000", ira(50000, "single", false), 7000, 0.01);
}

// ── CR-4/5 — growth-factor clamp (no negative/explosive projections) ──
header("CR-4/5 growth-factor clamps");
{
  const baseline: TaxReturnInputs = {
    client: { filingStatus: "single", state: "TX", taxYear: 2024, taxpayerAge: 62 } as never,
    w2s: [{ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 0, stateCode: "TX" } as never],
    form1099s: [], adjustments: [], taxYear: 2024,
  } as TaxReturnInputs;
  // A negative income-growth must NOT oscillate the projected wage sign.
  const proj = projectYearForward(baseline, 3, { incomeGrowth: -1.5 });
  const projWage = Number((proj.w2s?.[0] as { wagesBox1?: number } | undefined)?.wagesBox1 ?? 0);
  checkTrue("projectYearForward: negative growth clamped → projected wage stays positive", projWage > 0);
  // A negative iraGrowth must NOT produce a negative recommended conversion.
  const ladder = optimizeRothConversionLadder(baseline, { horizonYears: 5, traditionalIraBalance: 1_000_000, iraGrowth: -5, incomeGrowth: 1.0 });
  const anyNegConv = (ladder?.years ?? []).some((y: { conversion?: number }) => Number(y.conversion ?? 0) < 0);
  checkTrue("rothOptimizer: negative iraGrowth clamped → no negative conversion", !anyNegConv);
}

// ── summary ──
console.log(`\n========================================`);
console.log(`AUDIT-2026-06-30: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.log("  ✗ " + f); process.exit(1); }
else console.log("ALL AUDIT-2026-06-30 REGRESSION LOCKS GREEN");
