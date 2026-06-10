/**
 * T2.1 — Workpaper builder tests: Schedules 1 / 1-A / 2 / 3 (group
 * "schedules-123"). Pure — no API, no DB. Builds TaxReturnInputs by hand, runs
 * computeTaxReturnPure, then asserts on FormInstance line values.
 *
 * Headline dollars are HAND-CALC'D against the IRS published rule (2024
 * brackets, Form 8959 0.9% threshold, OBBBA §224 tip cap); identity-tie rows
 * compare to engine fields by design (the workpaper's job).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-workpaper-schedules-123-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { buildSchedule1 } from "../../artifacts/api-server/src/lib/forms/schedule1Spec";
import { buildSchedule1A } from "../../artifacts/api-server/src/lib/forms/schedule1ASpec";
import { buildSchedule2 } from "../../artifacts/api-server/src/lib/forms/schedule2Spec";
import { buildSchedule3 } from "../../artifacts/api-server/src/lib/forms/schedule3Spec";
import type {
  FormBuildContext,
  FormInstance,
  FormLine,
  WorkpaperTaxpayer,
} from "../../artifacts/api-server/src/lib/forms/formSpec";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.02): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

const allLines = (inst: FormInstance): FormLine[] => inst.parts.flatMap((p) => p.lines);
const findLine = (inst: FormInstance, lineNo: string, frag?: string): FormLine | undefined =>
  allLines(inst).find((l) => l.line === lineNo && (!frag || l.label.includes(frag)));
const findByLabel = (inst: FormInstance, frag: string): FormLine | undefined =>
  allLines(inst).find((l) => l.label.includes(frag));
const num = (l: FormLine | undefined): number =>
  l != null && typeof l.value === "number" ? l.value : NaN;

/** All checkLine tie-out rows must say "ties" (none "off by …"). */
function assertTies(label: string, inst: FormInstance): void {
  const checks = allLines(inst).filter(
    (l) => typeof l.value === "string" && (l.value === "ties" || l.value.startsWith("off by")),
  );
  const offs = checks.filter((l) => l.value !== "ties");
  if (checks.length === 0) FAIL.push(`✗ ${label}: expected at least one tie-out row, found none`);
  else if (offs.length === 0) PASS.push(`✓ ${label}: all ${checks.length} tie-out rows tie`);
  else FAIL.push(`✗ ${label}: ${offs.length} tie-out row(s) off — ${offs.map((l) => l.label).join("; ")}`);
}

/** Every money line is a finite number or null (no NaN leaks). */
function assertNoNaN(label: string, inst: FormInstance): void {
  const bad = allLines(inst).filter(
    (l) => l.kind === "money" && l.value != null && (typeof l.value !== "number" || !Number.isFinite(l.value)),
  );
  if (bad.length === 0) PASS.push(`✓ ${label}: no NaN/Infinity money lines`);
  else FAIL.push(`✗ ${label}: ${bad.length} bad money line(s) — ${bad.map((l) => l.label).join("; ")}`);
}

function ctxFor(inputs: TaxReturnInputs, taxpayerOverride: Partial<WorkpaperTaxpayer> = {}): {
  ctx: FormBuildContext;
  ret: ReturnType<typeof computeTaxReturnPure>;
} {
  const ret = computeTaxReturnPure(inputs);
  const taxpayer: WorkpaperTaxpayer = {
    firstName: "Test",
    lastName: "Client",
    filingStatus: inputs.client.filingStatus,
    state: inputs.client.state ?? "FL",
    ...taxpayerOverride,
  };
  return { ctx: { taxpayer, ret, inputs }, ret };
}

// ════════════════════════════════════════════════════════════════════════════
// S1 — Schedule 1: W-2 + SE filer with above-the-line deductions (TY2024).
//   $55k W-2 + $15k 1099-NEC (no expenses); eligible educator ($300 cap),
//   IRA $4,000, student loan $1,500. Part I (Sch C net) + Part II (adjustments).
//   Income $70k → all deductions full (MAGI well under every phase-out):
//     Sch C net      = 15,000
//     half-SE        = 15,000 × 0.9235 × 15.3% ÷ 2 = $1,059.72
//     educator       = 300 (eligibleEducatorCount = 1)
//     IRA            = 4,000 (non-covered single, under $7,000 cap)
//     student loan   = 1,500 (MAGI $68,640 < $80,000 single phase-out start)
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024, eligibleEducatorCount: 1 },
    w2s: [{ taxYear: 2024, wagesBox1: 55000, federalTaxWithheldBox2: 6000 }],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 15000 }],
    adjustments: [
      { adjustmentType: "educator_expenses", amount: 300, isApplied: true },
      { adjustmentType: "ira_contribution_traditional", amount: 4000, isApplied: true },
      { adjustmentType: "student_loan_interest", amount: 1500, isApplied: true },
    ],
    taxYear: 2024,
  };
  const { ctx, ret } = ctxFor(inputs);
  const s1 = buildSchedule1(ctx);
  checkTrue("S1 Schedule 1 applicable", s1 !== null);
  if (s1) {
    assertTies("S1 Schedule 1", s1);
    assertNoNaN("S1 Schedule 1", s1);
    // Part I line 3 — Schedule C net = $15,000 (no expenses).
    check("S1 line 3 Sch C net $15,000", num(findLine(s1, "3", "Business income")), 15000);
    // Part II — educator $300, IRA $4,000, student loan $1,500 (all full).
    check("S1 line 11 educator $300", num(findLine(s1, "11", "Educator")), 300);
    check("S1 line 15 half-SE $1,059.72", num(findLine(s1, "15")), 1059.72);
    check("S1 line 20 IRA $4,000", num(findLine(s1, "20", "IRA")), 4000);
    check("S1 line 21 student loan $1,500 (full — MAGI < $80k)", num(findLine(s1, "21", "Student loan")), 1500);
    // Line 25 (total adjustments) == totalIncome − AGI.
    check("S1 line 25 = totalIncome − AGI", num(findLine(s1, "25")), ret.totalIncome - ret.adjustedGrossIncome);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S2 — Schedule 2: high earner hitting Additional Medicare + NIIT (TY2024).
//   Single, $300k W-2 Medicare wages + $60k investment income (interest+LTCG),
//   MAGI well over thresholds.
//   Hand-calc 8959: (300,000 − 200,000) × 0.9%            = $900.00
//   Hand-calc 8960: 3.8% × min(NII, MAGI − 200,000) — NII $60k < excess → $2,280.00
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 300000, medicareWagesBox5: 300000, federalTaxWithheldBox2: 60000 }],
    form1099s: [
      { taxYear: 2024, formType: "int", interestIncome: 20000 },
      { taxYear: 2024, formType: "div", ordinaryDividends: 0, qualifiedDividends: 0 },
    ],
    adjustments: [{ adjustmentType: "long_term_capital_gain", amount: 40000, isApplied: true }],
    taxYear: 2024,
  };
  const { ctx, ret } = ctxFor(inputs);
  check("S2 engine 8959 Additional Medicare $900", ret.additionalMedicareTax, 900);
  checkTrue("S2 engine NIIT > 0", ret.niitTax > 0);
  const s2 = buildSchedule2(ctx);
  checkTrue("S2 Schedule 2 applicable", s2 !== null);
  if (s2) {
    assertTies("S2 Schedule 2", s2);
    assertNoNaN("S2 Schedule 2", s2);
    check("S2 line 11 Additional Medicare $900", num(findLine(s2, "11")), 900);
    check("S2 line 12 NIIT == engine niitTax", num(findLine(s2, "12")), ret.niitTax);
    // Part II total == sum of the modeled other taxes.
    const part2 =
      ret.selfEmploymentTax + ret.earlyWithdrawalPenalty + ret.hsaExcessExcise +
      ret.scheduleH.total + ret.additionalMedicareTax + ret.niitTax;
    check("S2 line 21 Part II total", num(findLine(s2, "21")), part2);
    // Regular tax residual + parts == federalTaxLiability (exact identity).
    const regular = num(findByLabel(s2, "Regular income tax"));
    check("S2 regular + Part I + Part II = federalTaxLiability", regular + part2 + ret.amtTax, ret.federalTaxLiability, 0.05);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S3 — Schedule 1-A: OBBBA qualified tips (TY2025).
//   Single, $60k W-2 + $8,000 qualified tips. MAGI ($60k) < $150k → no phase-out.
//   §224 deduction = min(8,000, $25,000 cap) = $8,000 → Form 1040 line 13b.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2025 },
    w2s: [{ taxYear: 2025, wagesBox1: 60000, federalTaxWithheldBox2: 6000 }],
    form1099s: [],
    adjustments: [{ adjustmentType: "qualified_tips", amount: 8000, isApplied: true }],
    taxYear: 2025,
  };
  const { ctx, ret } = ctxFor(inputs);
  check("S3 engine OBBBA tips $8,000 (no phase-out below $150k MAGI)", ret.obbbaSchedule1A.tips, 8000);
  check("S3 engine OBBBA total $8,000", ret.obbbaSchedule1A.total, 8000);
  const s1a = buildSchedule1A(ctx);
  checkTrue("S3 Schedule 1-A applicable (TY2025 with tips)", s1a !== null);
  if (s1a) {
    assertTies("S3 Schedule 1-A", s1a);
    assertNoNaN("S3 Schedule 1-A", s1a);
    check("S3 line 1 tips $8,000", num(findLine(s1a, "1", "tips")), 8000);
    check("S3 line 5 total $8,000 → 1040 line 13b", num(findLine(s1a, "5")), 8000);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S4 — Schedule 3: nonrefundable credits (TY2024).
//   MFJ two-earner ($70k + $50k W-2), 2 kids, $6k dependent-care (2 qualifying),
//   $4k AOC expenses, $1,500 FTC.
//   Hand-calc dependent care (Form 2441): AGI $120k → 20% rate; 2 kids → $6,000
//     expense limit; lower earner $50k > expenses → 6,000 × 20% = $1,200.
//   Schedule 3 Part I (line 8) ties to nonrefundable applied − CTC nonref.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024,
      dependentsUnder17: 2,
      dependentsForCareCredit: 2,
      spouseEarnedIncome: 50000,
    },
    w2s: [
      { taxYear: 2024, wagesBox1: 70000, federalTaxWithheldBox2: 7000, spouse: "taxpayer" },
      { taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, spouse: "spouse" },
    ],
    form1099s: [],
    adjustments: [
      { adjustmentType: "dependent_care_expenses", amount: 6000, isApplied: true },
      { adjustmentType: "qualified_education_expenses_aoc", amount: 4000, isApplied: true },
      { adjustmentType: "foreign_tax_paid", amount: 1500, isApplied: true },
    ],
    taxYear: 2024,
  };
  const { ctx, ret } = ctxFor(inputs);
  const s3 = buildSchedule3(ctx);
  checkTrue("S4 Schedule 3 applicable", s3 !== null);
  if (s3) {
    assertTies("S4 Schedule 3", s3);
    assertNoNaN("S4 Schedule 3", s3);
    check("S4 line 1 FTC $1,500", num(findLine(s3, "1", "Foreign")), 1500);
    check("S4 line 2 dependent care $1,200 (6,000 × 20%)", num(findLine(s3, "2", "child & dependent")), 1200);
    check("S4 line 2 == engine applied", num(findLine(s3, "2", "child & dependent")), ret.dependentCareCredit.appliedCredit);
    // Line 8 (total Part I) == totalNonRefundableApplied − CTC nonrefundable.
    check(
      "S4 line 8 Part I total = nonrefundable − CTC nonref",
      num(findLine(s3, "8")),
      ret.totalNonRefundableApplied - ret.childTaxCredit.nonRefundablePortion,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S5 — Null gates: bare W-2 single, no SE/credits/adjustments/AMT.
//   Schedule 1 (no add'l income/adjustments), Schedule 2 (no other taxes),
//   Schedule 3 (no credits), Schedule 1-A (TY2024, no OBBBA) → all null.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000 }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const { ctx } = ctxFor(inputs);
  checkTrue("S5 Schedule 1 null (no add'l income/adjustments)", buildSchedule1(ctx) === null);
  checkTrue("S5 Schedule 2 null (no other taxes)", buildSchedule2(ctx) === null);
  checkTrue("S5 Schedule 3 null (no credits)", buildSchedule3(ctx) === null);
  checkTrue("S5 Schedule 1-A null (TY2024, no OBBBA)", buildSchedule1A(ctx) === null);
}

console.log(`\nT2.1 workpaper — Schedules 1/1-A/2/3 builders (schedules-123):`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.error(`  ${f}`); process.exit(1); }
for (const p of PASS) console.log(`  ${p}`);
process.exit(0);
