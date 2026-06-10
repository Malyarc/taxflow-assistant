/**
 * T2.1 workpaper packet — credit-forms-1 group tests:
 *   Schedule 8812 (buildForm8812), Form 8863 (buildForm8863),
 *   Form 8880 (buildForm8880), Form 2441 (buildForm2441).
 *
 * Pure engine + pure builders; no API required.
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-workpaper-credit-forms-1-tests.ts
 *
 * Every headline dollar value is HAND-CALC'D against the IRS published rule
 * (Schedule 8812 + §24, Form 8863 + §25A, Form 8880 + §25B, Form 2441 + §21,
 * TY2024 brackets/standard deductions) — never asserted back from engine
 * output. Identity rows (form total == engine field) are the workpaper's
 * tie-out job and DO compare to engine fields.
 */

import {
  computeTaxReturnPure,
  type ComputedTaxReturn,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { buildForm8812 } from "../../artifacts/api-server/src/lib/forms/form8812Spec";
import { buildForm8863 } from "../../artifacts/api-server/src/lib/forms/form8863Spec";
import { buildForm8880 } from "../../artifacts/api-server/src/lib/forms/form8880Spec";
import { buildForm2441 } from "../../artifacts/api-server/src/lib/forms/form2441Spec";
import type {
  FormBuildContext,
  FormInstance,
  FormLine,
} from "../../artifacts/api-server/src/lib/forms/formSpec";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.02): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected true`);
}
function checkStr(label: string, actual: unknown, expected: string): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected "${expected}", got "${String(actual)}"`);
}

// ── Fixture helpers ──────────────────────────────────────────────────────────

interface ScenarioOpts {
  filingStatus: string;
  wages: number;
  dependentsUnder17?: number;
  otherDependents?: number;
  dependentsForCareCredit?: number;
  spouseEarnedIncome?: number;
  adjustments?: Array<{ adjustmentType: string; amount: number }>;
}

function makeInputs(o: ScenarioOpts): TaxReturnInputs {
  return {
    client: {
      filingStatus: o.filingStatus,
      state: "FL", // no state income tax — keeps the federal credit math clean
      taxYear: 2024,
      dependentsUnder17: o.dependentsUnder17 ?? 0,
      otherDependents: o.otherDependents ?? 0,
      dependentsForCareCredit: o.dependentsForCareCredit ?? 0,
      taxpayerAge: 40,
      spouseEarnedIncome: o.spouseEarnedIncome ?? null,
      iraCoveredByWorkplacePlan: false,
    },
    w2s: [
      {
        taxYear: 2024,
        wagesBox1: String(o.wages),
        federalTaxWithheldBox2: "0",
        socialSecurityWagesBox3: String(o.wages),
        medicareWagesBox5: String(o.wages),
        stateTaxWithheldBox17: "0",
        stateCode: "FL",
      },
    ],
    form1099s: [],
    adjustments: (o.adjustments ?? []).map((a) => ({ ...a, isApplied: true })),
    taxYear: 2024,
  };
}

function ctxFor(inputs: TaxReturnInputs, ret: ComputedTaxReturn): FormBuildContext {
  return {
    taxpayer: {
      firstName: "Test",
      lastName: "Client",
      filingStatus: inputs.client.filingStatus,
      state: inputs.client.state ?? "FL",
      dependentsUnder17: inputs.client.dependentsUnder17,
      otherDependents: inputs.client.otherDependents,
      taxpayerAge: inputs.client.taxpayerAge,
    },
    ret,
    inputs,
  };
}

function allLines(inst: FormInstance | null): FormLine[] {
  return inst ? inst.parts.flatMap((p) => p.lines) : [];
}
function findLine(inst: FormInstance | null, lineNo: string, frag?: string): FormLine | undefined {
  return allLines(inst).find((l) => l.line === lineNo && (!frag || l.label.includes(frag)));
}
function lineNum(inst: FormInstance | null, lineNo: string, frag?: string): number {
  const l = findLine(inst, lineNo, frag);
  return typeof l?.value === "number" ? l.value : NaN;
}
function findByLabel(inst: FormInstance | null, frag: string): FormLine | undefined {
  return allLines(inst).find((l) => l.label.includes(frag));
}
function hasFootnote(inst: FormInstance | null, frag: string): boolean {
  return (inst?.footnotes ?? []).some((f) => f.includes(frag));
}

// ═════════════════════════════════════════════════════════════════════════════
// S1 — HoH, FL, wages $30,000, 2 qualifying children (TY2024).
//
// Hand-calc (IRS 2024 values):
//   Std ded HoH               = $21,900 (Rev. Proc. 2023-34)
//   Taxable                   = 30,000 − 21,900 = $8,100
//   Tax (HoH 10% ≤ $16,550)   = $810.00
//   Schedule 8812: line 4 = 2; line 5 = 2 × $2,000 = $4,000; line 8 = $4,000
//   No phase-out (AGI $30,000 < $200,000 threshold) → line 12 = $4,000
//   Line 13 (Credit Limit Wksht — no other credits) = $810
//   Line 14 = min(4,000, 810) = $810 (non-refundable CTC)
//   Line 16a = 4,000 − 810 = $3,190; line 16b = 2 × $1,700 = $3,400
//   Line 17 = min = $3,190; 15% × (30,000 − 2,500) = $4,125 (not binding)
//   Line 27 ACTC = $3,190  (unused-credit prong binds)
// ═════════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({ filingStatus: "head_of_household", wages: 30000, dependentsUnder17: 2 });
  const ret = computeTaxReturnPure(inputs);
  const ctx = ctxFor(inputs, ret);
  const f8812 = buildForm8812(ctx);

  checkTrue("S1 8812 renders", f8812 !== null);
  check("S1 8812 line 1 AGI", lineNum(f8812, "1"), 30000);
  check("S1 8812 line 4 qualifying children", lineNum(f8812, "4"), 2);
  check("S1 8812 line 5 = 2 × $2,000", lineNum(f8812, "5"), 4000);
  check("S1 8812 line 8 preliminary credit", lineNum(f8812, "8"), 4000);
  check("S1 8812 line 9 threshold", lineNum(f8812, "9"), 200000);
  checkTrue("S1 8812 line 10/11 omitted (no phase-out)", findLine(f8812, "11") === undefined);
  check("S1 8812 line 12 credit after phase-out", lineNum(f8812, "12"), 4000);
  check("S1 8812 line 13 credit limit (tax $810)", lineNum(f8812, "13"), 810);
  check("S1 8812 line 14 non-refundable CTC", lineNum(f8812, "14"), 810);
  checkStr("S1 8812 line-14 tie row ties", findByLabel(f8812, "Line 14 ties")?.value, "ties");
  check("S1 8812 line 16a unused credit", lineNum(f8812, "16a"), 3190);
  check("S1 8812 line 16b ACTC cap 2 × $1,700", lineNum(f8812, "16b"), 3400);
  check("S1 8812 line 17 smaller", lineNum(f8812, "17"), 3190);
  check("S1 8812 line 27 ACTC", lineNum(f8812, "27"), 3190);
  // Engine cross-checks (hand-calc'd expectations, not echoes):
  check("S1 engine additionalChildTaxCredit = $3,190", ret.additionalChildTaxCredit, 3190);
  check("S1 engine non-refundable CTC = $810", ret.childTaxCredit.nonRefundablePortion, 810);
  checkStr("S1 8812 line-27 tie row ties", findByLabel(f8812, "Line 27 ties")?.value, "ties");
  check("S1 8812 delivered total = $4,000", Number(findByLabel(f8812, "Total credit delivered")?.value), 4000);
  checkTrue("S1 8812 C1 ordering footnote present", hasFootnote(f8812, "AFTER the Schedule-3 personal credits"));
  // Applicability gates — no education / saver's / dependent-care activity:
  checkTrue("S1 8863 null (no education)", buildForm8863(ctx) === null);
  checkTrue("S1 8880 null (no saver's credit)", buildForm8880(ctx) === null);
  checkTrue("S1 2441 null (no dependent care)", buildForm2441(ctx) === null);
}

// ═════════════════════════════════════════════════════════════════════════════
// S1b — HoH, FL, wages $12,000, 2 kids: the 15% EARNED-INCOME prong binds.
//
// Hand-calc:
//   Taxable = 12,000 − 21,900 < 0 → $0 → tax $0 → line 14 = $0
//   Line 16a = $4,000; line 16b = $3,400; line 17 = $3,400
//   15% × (12,000 − 2,500) = $1,425  ← binds (Sch 8812 line 20)
//   Line 27 ACTC = min(3,400, 1,425) = $1,425
// ═════════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({ filingStatus: "head_of_household", wages: 12000, dependentsUnder17: 2 });
  const ret = computeTaxReturnPure(inputs);
  const f8812 = buildForm8812(ctxFor(inputs, ret));

  check("S1b 8812 line 14 = $0 (no tax)", lineNum(f8812, "14"), 0);
  check("S1b 8812 line 16a", lineNum(f8812, "16a"), 4000);
  check("S1b 8812 line 17 = $3,400 (per-child cap)", lineNum(f8812, "17"), 3400);
  check("S1b 8812 line 27 ACTC = $1,425 (15% earned-income limit)", lineNum(f8812, "27"), 1425);
  check("S1b engine additionalChildTaxCredit = $1,425", ret.additionalChildTaxCredit, 1425);
  checkStr("S1b 8812 line-27 tie row ties", findByLabel(f8812, "Line 27 ties")?.value, "ties");
}

// ═════════════════════════════════════════════════════════════════════════════
// S2 — MFJ, FL, wages $120,000 (spouse's share $40,000), 2 kids, dependent
// care $5,000 for 2 qualifying persons, AOC student $4,000, LLC $8,000.
//
// Hand-calc:
//   Std ded MFJ = $29,200 → taxable = $90,800
//   Tax (MFJ 2024): 10% × 23,200 = 2,320; 12% × (90,800 − 23,200) = 8,112
//     → income tax = $10,432.00
//   Form 2441: limit $6,000 (2+ persons); earned-income limit = min(80,000,
//     40,000) = $40,000; line 6 = min(5,000, 6,000, 40,000) = $5,000;
//     AGI $120,000 > $43,000 → 20% → line 9a = $1,000; line 10 = $10,432
//     → line 11 = $1,000
//   Form 8863: AOC prelim = 100%×2,000 + 25%×2,000 = $2,500; MAGI 120,000 <
//     160,000 → fraction 1.0 → line 7 = $2,500; line 8 = 40% = $1,000;
//     line 9 = $1,500; LLC: line 11 = $8,000, line 12 = 20% = $1,600,
//     line 18 = $1,600; line 19 = 1,500 + 1,600 = $3,100
//   Schedule 8812: line 12 = $4,000; line 13 = 10,432 − (1,000 + 1,500 +
//     1,600) = $6,332; line 14 = $4,000; ACTC = $0
//   totalNonRefundableApplied = 1,000 + 3,100 + 4,000 = $8,100
// ═════════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({
    filingStatus: "married_filing_jointly",
    wages: 120000,
    dependentsUnder17: 2,
    dependentsForCareCredit: 2,
    spouseEarnedIncome: 40000,
    adjustments: [
      { adjustmentType: "dependent_care_expenses", amount: 5000 },
      { adjustmentType: "qualified_education_expenses_aoc", amount: 4000 },
      { adjustmentType: "qualified_education_expenses_llc", amount: 8000 },
    ],
  });
  const ret = computeTaxReturnPure(inputs);
  const ctx = ctxFor(inputs, ret);
  const f2441 = buildForm2441(ctx);
  const f8863 = buildForm8863(ctx);
  const f8812 = buildForm8812(ctx);

  // Engine pre-flight (hand-calc'd):
  check("S2 engine income tax = $10,432", ret.federalTaxLiability, 10432);
  check("S2 engine totalNonRefundableApplied = $8,100", ret.totalNonRefundableApplied, 8100);

  // Form 2441
  checkTrue("S2 2441 renders", f2441 !== null);
  check("S2 2441 line 2 qualifying persons", lineNum(f2441, "2"), 2);
  check("S2 2441 line 2(d) expenses", lineNum(f2441, "2(d)"), 5000);
  check("S2 2441 line 3 capped expenses", lineNum(f2441, "3"), 5000);
  check("S2 2441 line 4/5 earned-income limit (lower earner $40k)", lineNum(f2441, "4/5"), 40000);
  check("S2 2441 line 6 eligible expenses", lineNum(f2441, "6"), 5000);
  checkStr("S2 2441 line-6 tie row ties", findByLabel(f2441, "Line 6 ties")?.value, "ties");
  check("S2 2441 line 8 rate = 20%", lineNum(f2441, "8"), 0.20);
  check("S2 2441 line 9a credit", lineNum(f2441, "9a"), 1000);
  check("S2 2441 line 10 tax limit", lineNum(f2441, "10"), 10432);
  check("S2 2441 line 11 final credit", lineNum(f2441, "11"), 1000);
  check("S2 engine dependent care credit = $1,000", ret.dependentCareCredit.appliedCredit, 1000);
  checkTrue("S2 2441 MFS-bar footnote present", hasFootnote(f2441, "§21(e)(2)"));

  // Form 8863
  checkTrue("S2 8863 renders", f8863 !== null);
  check("S2 8863 eligible students = 1", Number(findByLabel(f8863, "Eligible students")?.value), 1);
  check("S2 8863 line 1 tentative AOC", lineNum(f8863, "1"), 2500);
  check("S2 8863 line 3 MAGI", lineNum(f8863, "3"), 120000);
  check("S2 8863 line 6 fraction = 1.0", lineNum(f8863, "6"), 1.0);
  check("S2 8863 line 7 AOC after phase-out", lineNum(f8863, "7"), 2500);
  check("S2 8863 line 8 refundable AOC (40%)", lineNum(f8863, "8"), 1000);
  checkStr("S2 8863 line-8 tie row ties", findByLabel(f8863, "Line 8 ties")?.value, "ties");
  check("S2 8863 line 9 nonrefundable AOC", lineNum(f8863, "9"), 1500);
  check("S2 8863 line 10 raw LLC expenses (from inputs)", lineNum(f8863, "10"), 8000);
  check("S2 8863 line 11 capped LLC expenses", lineNum(f8863, "11"), 8000);
  check("S2 8863 line 12 tentative LLC (20%)", lineNum(f8863, "12"), 1600);
  check("S2 8863 line 18 LLC after phase-out", lineNum(f8863, "18"), 1600);
  check("S2 8863 line 19 nonrefundable education credits", lineNum(f8863, "19"), 3100);
  // Additive structure: line 19 = line 9 + line 18
  check("S2 8863 additive: line 9 + line 18 = line 19", lineNum(f8863, "9") + lineNum(f8863, "18"), lineNum(f8863, "19"));
  checkTrue("S2 8863 no tax-limit warning (credit fully usable)", findByLabel(f8863, "actually usable") === undefined);
  check("S2 engine aocRefundable = $1,000", ret.educationCredits.aocRefundable, 1000);

  // Schedule 8812
  check("S2 8812 line 12", lineNum(f8812, "12"), 4000);
  check("S2 8812 line 13 = tax less Sched-3 credits ($6,332)", lineNum(f8812, "13"), 6332);
  check("S2 8812 line 14 full CTC", lineNum(f8812, "14"), 4000);
  check("S2 8812 line 27 ACTC = $0", lineNum(f8812, "27"), 0);
  checkStr("S2 8812 line-14 tie row ties", findByLabel(f8812, "Line 14 ties")?.value, "ties");

  // Saver's: AGI $120,000 above every §25B tier → null gate.
  checkTrue("S2 8880 null (AGI above all tiers)", buildForm8880(ctx) === null);
}

// ═════════════════════════════════════════════════════════════════════════════
// S2b — MFJ, wages $100,000 (spouse $30,000), ONE qualifying person, $4,000
// expenses → the $3,000 one-person limit binds.
//
// Hand-calc:
//   Line 3 = min(4,000, 3,000) = $3,000; earned limit = min(70,000, 30,000)
//   = $30,000; line 6 = $3,000; AGI 100,000 → 20% → line 9a = $600
//   Tax: taxable = 100,000 − 29,200 = 70,800 → 2,320 + 12% × 47,600 =
//   $8,032 → not limiting → line 11 = $600
// ═════════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({
    filingStatus: "married_filing_jointly",
    wages: 100000,
    dependentsForCareCredit: 1,
    spouseEarnedIncome: 30000,
    adjustments: [{ adjustmentType: "dependent_care_expenses", amount: 4000 }],
  });
  const ret = computeTaxReturnPure(inputs);
  const f2441 = buildForm2441(ctxFor(inputs, ret));

  check("S2b 2441 line 3 = $3,000 (one-person limit)", lineNum(f2441, "3"), 3000);
  check("S2b 2441 line 4/5 earned limit $30,000", lineNum(f2441, "4/5"), 30000);
  check("S2b 2441 line 6", lineNum(f2441, "6"), 3000);
  check("S2b 2441 line 9a = $600", lineNum(f2441, "9a"), 600);
  check("S2b 2441 line 11 = $600", lineNum(f2441, "11"), 600);
  check("S2b engine dependent care credit = $600", ret.dependentCareCredit.appliedCredit, 600);
}

// ═════════════════════════════════════════════════════════════════════════════
// S2c — HoH, wages $14,000, 1 kid, $2,000 dependent care: 35% top rate AND
// the §21 credit is fully LOST to the zero tax liability; the ACTC per-child
// cap binds on Schedule 8812.
//
// Hand-calc:
//   Taxable = 14,000 − 21,900 < 0 → tax $0
//   2441: AGI ≤ $15,000 → 35%; line 6 = min(2,000, 3,000, 14,000) = $2,000
//     → line 9a = $700; line 10 = $0 → line 11 = $0 (nonrefundable, lost)
//   8812: line 12 = $2,000; line 14 = $0; 16a = $2,000; 16b = 1 × $1,700;
//     line 17 = $1,700; 15% × (14,000 − 2,500) = $1,725 (not binding)
//     → line 27 = $1,700  (per-child cap binds)
// ═════════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({
    filingStatus: "head_of_household",
    wages: 14000,
    dependentsUnder17: 1,
    dependentsForCareCredit: 1,
    adjustments: [{ adjustmentType: "dependent_care_expenses", amount: 2000 }],
  });
  const ret = computeTaxReturnPure(inputs);
  const ctx = ctxFor(inputs, ret);
  const f2441 = buildForm2441(ctx);
  const f8812 = buildForm8812(ctx);

  check("S2c 2441 line 8 rate = 35%", lineNum(f2441, "8"), 0.35);
  check("S2c 2441 line 9a = $700", lineNum(f2441, "9a"), 700);
  check("S2c 2441 line 10 tax limit = $0", lineNum(f2441, "10"), 0);
  check("S2c 2441 line 11 = $0 (credit lost to zero tax)", lineNum(f2441, "11"), 0);
  checkTrue("S2c 2441 line 11 carries the limit-binds note", (findLine(f2441, "11")?.note ?? "").includes("limit binds"));
  check("S2c engine totalNonRefundableApplied = $0", ret.totalNonRefundableApplied, 0);
  check("S2c 8812 line 16b = $1,700", lineNum(f8812, "16b"), 1700);
  check("S2c 8812 line 17 = $1,700", lineNum(f8812, "17"), 1700);
  check("S2c 8812 line 27 ACTC = $1,700 (per-child cap binds)", lineNum(f8812, "27"), 1700);
  check("S2c engine additionalChildTaxCredit = $1,700", ret.additionalChildTaxCredit, 1700);
}

// ═════════════════════════════════════════════════════════════════════════════
// S3 — Single, FL, wages $22,000, $2,000 traditional IRA → 50% Saver's tier,
// and the tax-liability limit BINDS.
//
// Hand-calc:
//   IRA fully deductible (not covered by a plan) → AGI = $20,000
//   Taxable = 20,000 − 14,600 = $5,400 → tax = 10% × 5,400 = $540.00
//   §25B single 2024: AGI ≤ $23,000 → 50%; eligible = min(2,000, 2,000)
//   Line 10 = 2,000 × 50% = $1,000; line 11 = $540 → line 12 = $540
//   totalNonRefundableApplied = $540 (saver's only)
// ═════════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({
    filingStatus: "single",
    wages: 22000,
    adjustments: [{ adjustmentType: "ira_contribution_traditional", amount: 2000 }],
  });
  const ret = computeTaxReturnPure(inputs);
  const ctx = ctxFor(inputs, ret);
  const f8880 = buildForm8880(ctx);

  checkTrue("S3 8880 renders", f8880 !== null);
  check("S3 8880 line 1 IRA piece (from inputs)", lineNum(f8880, "1"), 2000);
  checkTrue("S3 8880 line 2 absent (no elective deferrals)", findLine(f8880, "2") === undefined);
  check("S3 8880 line 3 total contributions", lineNum(f8880, "3"), 2000);
  checkTrue("S3 8880 line 4 is a not-modeled disclosure", findLine(f8880, "4")?.value === null);
  check("S3 8880 line 7 eligible contribution", lineNum(f8880, "7"), 2000);
  check("S3 8880 line 8 AGI = $20,000", lineNum(f8880, "8"), 20000);
  check("S3 8880 line 9 rate = 50%", lineNum(f8880, "9"), 0.50);
  check("S3 8880 line 10 tentative credit = $1,000", lineNum(f8880, "10"), 1000);
  checkStr("S3 8880 line-10 tie row ties", findByLabel(f8880, "Line 10 ties")?.value, "ties");
  check("S3 8880 line 11 tax limit = $540", lineNum(f8880, "11"), 540);
  check("S3 8880 line 12 = $540 (limit binds)", lineNum(f8880, "12"), 540);
  checkTrue("S3 8880 line 12 carries the limit-binds note", (findLine(f8880, "12")?.note ?? "").includes("limit binds"));
  check("S3 engine saversCredit (pre-limit) = $1,000", ret.saversCredit.appliedCredit, 1000);
  check("S3 engine totalNonRefundableApplied = $540", ret.totalNonRefundableApplied, 540);
  checkTrue("S3 8880 nonrefundable footnote present", hasFootnote(f8880, "NONREFUNDABLE"));
  // Gates: no kids, no education, no dependent care.
  checkTrue("S3 8812 null (no children, no CTC)", buildForm8812(ctx) === null);
  checkTrue("S3 8863 null", buildForm8863(ctx) === null);
  checkTrue("S3 2441 null", buildForm2441(ctx) === null);
}

// ═════════════════════════════════════════════════════════════════════════════
// S3b — MFJ, wages $48,000, $2,000 traditional IRA → AGI exactly $46,000 =
// the TOP of the MFJ 50% tier (boundary), credit fully usable.
//
// Hand-calc:
//   AGI = 48,000 − 2,000 = $46,000 (≤ $46,000 → 50%)
//   Taxable = 46,000 − 29,200 = $16,800 → tax = 10% × 16,800 = $1,680
//   Line 10 = min(2,000, $4,000 MFJ cap) × 50% = $1,000; line 11 = $1,680
//   → line 12 = $1,000 (not limited)
// ═════════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({
    filingStatus: "married_filing_jointly",
    wages: 48000,
    adjustments: [{ adjustmentType: "ira_contribution_traditional", amount: 2000 }],
  });
  const ret = computeTaxReturnPure(inputs);
  const f8880 = buildForm8880(ctxFor(inputs, ret));

  check("S3b 8880 line 8 AGI = $46,000", lineNum(f8880, "8"), 46000);
  check("S3b 8880 line 9 rate = 50% (boundary inclusive)", lineNum(f8880, "9"), 0.50);
  check("S3b 8880 line 10 = $1,000", lineNum(f8880, "10"), 1000);
  check("S3b 8880 line 11 = $1,680", lineNum(f8880, "11"), 1680);
  check("S3b 8880 line 12 = $1,000 (not limited)", lineNum(f8880, "12"), 1000);
  checkTrue("S3b 8880 line 12 has no limit note", findLine(f8880, "12")?.note === undefined);
}

// ═════════════════════════════════════════════════════════════════════════════
// S3c — Single, wages $26,000, $2,000 IRA → AGI $24,000 lands in the 20% tier
// ($23,001–$25,000 for 2024).
//
// Hand-calc: line 10 = 2,000 × 20% = $400; tax = 10% × (24,000 − 14,600) =
// $940 → not limiting → line 12 = $400.
// ═════════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({
    filingStatus: "single",
    wages: 26000,
    adjustments: [{ adjustmentType: "ira_contribution_traditional", amount: 2000 }],
  });
  const ret = computeTaxReturnPure(inputs);
  const f8880 = buildForm8880(ctxFor(inputs, ret));

  check("S3c 8880 line 9 rate = 20%", lineNum(f8880, "9"), 0.20);
  check("S3c 8880 line 10 = $400", lineNum(f8880, "10"), 400);
  check("S3c 8880 line 12 = $400", lineNum(f8880, "12"), 400);
}

// ═════════════════════════════════════════════════════════════════════════════
// S4 — Single, FL, wages $230,000, 1 kid + 1 other dependent, AOC $4,000,
// $2,000 elective deferrals: CTC PHASE-OUT + education fully phased out +
// Saver's/2441 null gates.
//
// Hand-calc:
//   Taxable = 230,000 − 14,600 = $215,400
//   Tax (single 2024): 1,160 + 4,266 + 11,742.50 + 21,942 + 32% × (215,400 −
//     191,950) = 7,504 → $46,614.50
//   Additional Medicare (Form 8959): 0.9% × (230,000 − 200,000) = $270
//     → federalTaxLiability = $46,884.50 (the line-13 reconstruction must
//     subtract the $270 — covered by the assertions below)
//   8812: line 8 = 2,000 + 500 = $2,500; line 10 = ceil(30,000/1,000) × 1,000
//     = $30,000; line 11 = 5% × 30,000 = $1,500; line 12 = $1,000;
//     line 13 = $46,614.50; line 14 = $1,000; ACTC $0
//   8863: MAGI $230,000 ≥ $90,000 → fraction 0 → line 7/8/19 = $0
//     (line 1 still shows the $2,500 tentative credit)
//   8880: AGI above every tier → rate 0 → credit $0 → null
// ═════════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({
    filingStatus: "single",
    wages: 230000,
    dependentsUnder17: 1,
    otherDependents: 1,
    adjustments: [
      { adjustmentType: "qualified_education_expenses_aoc", amount: 4000 },
      { adjustmentType: "retirement_contributions_savers", amount: 2000 },
    ],
  });
  const ret = computeTaxReturnPure(inputs);
  const ctx = ctxFor(inputs, ret);
  const f8812 = buildForm8812(ctx);
  const f8863 = buildForm8863(ctx);

  // Engine pre-flight (hand-calc'd):
  check("S4 engine federal liability = $46,884.50", ret.federalTaxLiability, 46884.50);
  check("S4 engine additional Medicare = $270", ret.additionalMedicareTax, 270);

  check("S4 8812 line 5 = $2,000", lineNum(f8812, "5"), 2000);
  check("S4 8812 line 6 other dependents", lineNum(f8812, "6"), 1);
  check("S4 8812 line 7 = $500", lineNum(f8812, "7"), 500);
  check("S4 8812 line 8 = $2,500", lineNum(f8812, "8"), 2500);
  check("S4 8812 additive: line 5 + line 7 = line 8", lineNum(f8812, "5") + lineNum(f8812, "7"), lineNum(f8812, "8"));
  check("S4 8812 line 10 rounded excess = $30,000", lineNum(f8812, "10"), 30000);
  check("S4 8812 line 11 phase-out reduction = $1,500", lineNum(f8812, "11"), 1500);
  check("S4 8812 line 12 = $1,000", lineNum(f8812, "12"), 1000);
  check("S4 8812 line 13 = $46,614.50 (nets out the $270 addl Medicare)", lineNum(f8812, "13"), 46614.50);
  check("S4 8812 line 14 = $1,000", lineNum(f8812, "14"), 1000);
  checkStr("S4 8812 line-14 tie row ties", findByLabel(f8812, "Line 14 ties")?.value, "ties");
  check("S4 8812 line 27 ACTC = $0", lineNum(f8812, "27"), 0);
  check("S4 engine phase-out reduction = $1,500", ret.childTaxCredit.phaseOutReduction, 1500);

  checkTrue("S4 8863 renders (shows the phase-out)", f8863 !== null);
  check("S4 8863 line 1 tentative = $2,500", lineNum(f8863, "1"), 2500);
  check("S4 8863 line 6 fraction = 0", lineNum(f8863, "6"), 0);
  check("S4 8863 line 7 = $0 (fully phased out)", lineNum(f8863, "7"), 0);
  check("S4 8863 line 8 refundable = $0", lineNum(f8863, "8"), 0);
  check("S4 8863 line 19 = $0", lineNum(f8863, "19"), 0);

  checkTrue("S4 8880 null (rate 0 above all tiers)", buildForm8880(ctx) === null);
  checkTrue("S4 2441 null (no expenses)", buildForm2441(ctx) === null);
}

// ═════════════════════════════════════════════════════════════════════════════
// S5 — Single, wages $85,000, AOC $4,000: PARTIAL education phase-out.
//
// Hand-calc:
//   Fraction = (90,000 − 85,000) / 10,000 = 0.5
//   Line 7 = 2,500 × 0.5 = $1,250; line 8 = 40% = $500; line 9 = $750
//   Line 19 = $750 (no LLC). Tax = 1,160 + 4,266 + 22% × (70,400 − 47,150)
//   = $10,541 → not limiting.
// ═════════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({
    filingStatus: "single",
    wages: 85000,
    adjustments: [{ adjustmentType: "qualified_education_expenses_aoc", amount: 4000 }],
  });
  const ret = computeTaxReturnPure(inputs);
  const f8863 = buildForm8863(ctxFor(inputs, ret));

  check("S5 8863 line 1 = $2,500", lineNum(f8863, "1"), 2500);
  check("S5 8863 line 6 fraction = 0.5", lineNum(f8863, "6"), 0.5);
  check("S5 8863 line 7 = $1,250", lineNum(f8863, "7"), 1250);
  check("S5 8863 line 8 refundable = $500", lineNum(f8863, "8"), 500);
  checkStr("S5 8863 line-8 tie row ties", findByLabel(f8863, "Line 8 ties")?.value, "ties");
  check("S5 8863 line 9 = $750", lineNum(f8863, "9"), 750);
  check("S5 8863 line 19 = $750", lineNum(f8863, "19"), 750);
  checkTrue("S5 8863 LLC lines omitted (no LLC)", findLine(f8863, "12") === undefined);
  checkTrue("S5 8863 no tax-limit warning", findByLabel(f8863, "actually usable") === undefined);
  check("S5 engine aocRefundable = $500", ret.educationCredits.aocRefundable, 500);
}

// ═════════════════════════════════════════════════════════════════════════════
// S6 — MFS, wages $50,000, AOC $4,000 entered + dependent care $3,000 for one
// person: the §25A(g)(6) and §21(e)(2) MFS bars.
//
// Hand-calc: both credits = $0 for MFS. Form 8863 still RENDERS (one eligible
// student entered — the workpaper shows the lost credit + the MFS footnote);
// Form 2441 returns null (appliedCredit = 0 gate).
// ═════════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({
    filingStatus: "married_filing_separately",
    wages: 50000,
    dependentsForCareCredit: 1,
    adjustments: [
      { adjustmentType: "qualified_education_expenses_aoc", amount: 4000 },
      { adjustmentType: "dependent_care_expenses", amount: 3000 },
    ],
  });
  const ret = computeTaxReturnPure(inputs);
  const ctx = ctxFor(inputs, ret);
  const f8863 = buildForm8863(ctx);

  checkTrue("S6 8863 renders for MFS (shows the bar)", f8863 !== null);
  check("S6 8863 eligible students = 1", Number(findByLabel(f8863, "Eligible students")?.value), 1);
  check("S6 8863 line 19 = $0 (MFS barred)", lineNum(f8863, "19"), 0);
  checkTrue("S6 8863 MFS footnote cites §25A(g)(6)", hasFootnote(f8863, "§25A(g)(6)"));
  check("S6 engine education credits all zero", ret.educationCredits.aocApplied + ret.educationCredits.llcApplied, 0);
  checkTrue("S6 2441 null (MFS bar → $0 credit)", buildForm2441(ctx) === null);
  check("S6 engine dependent care credit = $0", ret.dependentCareCredit.appliedCredit, 0);
}

// ═════════════════════════════════════════════════════════════════════════════
// S7 — Single, wages $60,000, no dependents, no credit activity: ALL FOUR
// builders must return null (applicability gates).
// ═════════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({ filingStatus: "single", wages: 60000 });
  const ret = computeTaxReturnPure(inputs);
  const ctx = ctxFor(inputs, ret);

  checkTrue("S7 8812 null", buildForm8812(ctx) === null);
  checkTrue("S7 8863 null", buildForm8863(ctx) === null);
  checkTrue("S7 8880 null", buildForm8880(ctx) === null);
  checkTrue("S7 2441 null", buildForm2441(ctx) === null);
}

// ── Summary ──────────────────────────────────────────────────────────────────
for (const p of PASS) console.log(p);
for (const f of FAIL) console.error(f);
console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length > 0 ? 1 : 0);
