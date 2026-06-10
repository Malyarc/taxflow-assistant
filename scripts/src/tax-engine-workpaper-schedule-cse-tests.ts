/**
 * T2.1 — Workpaper builder tests: Schedule C + Schedule SE substitute forms
 * (group "schedule-cse"). Pure — no API, no DB. Builds TaxReturnInputs by
 * hand, runs computeTaxReturnPure, then asserts on FormInstance line values.
 *
 * Every headline dollar is HAND-CALC'D against the IRS published rule
 * (Schedule SE Part I math + the 2024 SSA contribution & benefit base
 * $168,600) — never asserted back from engine output. Identity-tie rows
 * (line 12 == engine SE tax, line 13 == detail.se.deductibleHalf) compare to
 * engine fields by design — that is the workpaper's job.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-workpaper-schedule-cse-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { buildScheduleC } from "../../artifacts/api-server/src/lib/forms/scheduleCSpec";
import { buildScheduleSE } from "../../artifacts/api-server/src/lib/forms/scheduleSESpec";
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
function checkStr(label: string, actual: string | null | undefined, expectedFrag: string): void {
  if ((actual ?? "").includes(expectedFrag)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected to include "${expectedFrag}", got "${actual}"`);
}

const findLine = (inst: FormInstance, lineNo: string, frag?: string): FormLine | undefined =>
  inst.parts
    .flatMap((p) => p.lines)
    .find((l) => l.line === lineNo && (!frag || l.label.includes(frag)));
const findByLabel = (inst: FormInstance, frag: string): FormLine | undefined =>
  inst.parts.flatMap((p) => p.lines).find((l) => l.label.includes(frag));
const num = (l: FormLine | undefined): number =>
  l != null && typeof l.value === "number" ? l.value : NaN;

function ctxFor(inputs: TaxReturnInputs): {
  ctx: FormBuildContext;
  ret: ReturnType<typeof computeTaxReturnPure>;
} {
  const ret = computeTaxReturnPure(inputs);
  const taxpayer: WorkpaperTaxpayer = {
    firstName: "Test",
    lastName: "Client",
    filingStatus: inputs.client.filingStatus,
    state: inputs.client.state ?? "FL",
  };
  return { ctx: { taxpayer, ret, inputs }, ret };
}

// ════════════════════════════════════════════════════════════════════════════
// S1 — Sole prop, single FL, $100k 1099-NEC, $20k expenses, no W-2 (TY2024)
//
// Hand-calc (IRS Schedule SE 2024 Part I; SSA 2024 base $168,600):
//   Sch C line 31 = 100,000 − 20,000                       = $80,000.00
//   Sch SE 2/3    = 80,000
//   4a/4c         = 80,000 × 92.35%                        = $73,880.00
//   7             = $168,600 (no W-2 → line 9 = full base)
//   10            = min(73,880, 168,600) × 12.4%           = $9,161.12
//   11            = 73,880 × 2.9%                          = $2,142.52
//   12            = 9,161.12 + 2,142.52                    = $11,303.64
//   13            = 11,303.64 ÷ 2                          = $5,651.82
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 100000 }],
    adjustments: [{ adjustmentType: "schedule_c_expenses", amount: 20000, isApplied: true }],
    taxYear: 2024,
  };
  const { ctx, ret } = ctxFor(inputs);
  check("S1 engine SE tax $11,303.64 (hand-calc)", ret.selfEmploymentTax, 11303.64);

  const schC = buildScheduleC(ctx);
  checkTrue("S1 Schedule C applicable (non-null)", schC != null);
  if (schC) {
    checkTrue("S1 Sch C formId/taxYear", schC.formId === "schedule-c" && schC.taxYear === 2024);
    checkTrue("S1 Sch C has Part I + Part II", schC.parts.length === 2 && (schC.parts[0].title ?? "").includes("Part I"));
    check("S1 Sch C line 1 gross receipts $100,000", num(findLine(schC, "1")), 100000);
    check("S1 Sch C line 7 gross income $100,000", num(findLine(schC, "7")), 100000);
    check("S1 Sch C line 8–27a aggregate expenses $20,000", num(findLine(schC, "8–27a")), 20000);
    checkTrue("S1 Sch C line 13 omitted (no depreciation)", findLine(schC, "13") === undefined);
    check("S1 Sch C line 28 total expenses $20,000", num(findLine(schC, "28")), 20000);
    check("S1 Sch C line 29 tentative profit $80,000", num(findLine(schC, "29")), 80000);
    check("S1 Sch C line 31 net profit $80,000 (hand-calc)", num(findLine(schC, "31")), 80000);
    // Additive structure: line 28 = (8–27a) + (13, absent → 0).
    check("S1 Sch C additive: 28 = 8–27a + 13", num(findLine(schC, "28")), num(findLine(schC, "8–27a")) + 0);
    const tie = findByLabel(schC, "Schedule SE line 2 Schedule C portion");
    checkTrue("S1 Sch C SE tie-out row present and ties (✓)", tie != null && tie.label.startsWith("✓"));
  }

  const schSe = buildScheduleSE(ctx);
  checkTrue("S1 Schedule SE applicable (non-null)", schSe != null);
  if (schSe) {
    checkTrue("S1 Sch SE formId/formNumber", schSe.formId === "schedule-se" && schSe.formNumber === "Schedule SE (Form 1040)");
    check("S1 Sch SE line 2/3 net profit $80,000", num(findLine(schSe, "2/3")), 80000);
    check("S1 Sch SE line 4a/4c $73,880 (hand-calc ×0.9235)", num(findLine(schSe, "4a/4c")), 73880);
    check("S1 Sch SE line 7 SS base $168,600 (SSA 2024)", num(findLine(schSe, "7")), 168600);
    checkTrue("S1 Sch SE line 8a/8d omitted (no W-2 SS wages)", findLine(schSe, "8a/8d") === undefined);
    check("S1 Sch SE line 9 remaining base $168,600", num(findLine(schSe, "9")), 168600);
    check("S1 Sch SE line 10 SS portion $9,161.12 (hand-calc)", num(findLine(schSe, "10")), 9161.12);
    check("S1 Sch SE line 11 Medicare $2,142.52 (hand-calc)", num(findLine(schSe, "11")), 2142.52);
    check("S1 Sch SE line 12 SE tax $11,303.64 (hand-calc)", num(findLine(schSe, "12")), 11303.64);
    check("S1 Sch SE line 13 half-SE $5,651.82 (hand-calc)", num(findLine(schSe, "13")), 5651.82);
    // Identity ties (workpaper's job — compare to engine fields).
    check("S1 identity: line 12 == ret.selfEmploymentTax", num(findLine(schSe, "12")), ret.selfEmploymentTax, 0.005);
    check("S1 identity: line 13 == detail.se.deductibleHalf", num(findLine(schSe, "13")), ret.detail.se.deductibleHalf, 0.005);
    // Additive structure: 10 + 11 = 12.
    check("S1 Sch SE additive: 10 + 11 = 12", num(findLine(schSe, "10")) + num(findLine(schSe, "11")), num(findLine(schSe, "12")));
    const tie1 = findByLabel(schSe, "Line 10 + line 11 equals line 12");
    const tie2 = findByLabel(schSe, "equals the engine's self-employment tax");
    checkTrue("S1 Sch SE both check rows tie (✓)", tie1?.label.startsWith("✓") === true && tie2?.label.startsWith("✓") === true);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S2 — High earner: W-2 $150k (Box 3 $150k) + SE $80k ($50k NEC + $30k CPA
//      self-employment-income adjustment), single FL, TY2024.
//
// Hand-calc (Sch SE Part I line 8/9 SS-base sharing; SSA 2024 base $168,600):
//   Sch SE 2/3 = 50,000 + 30,000                            = $80,000.00
//   4a/4c      = 80,000 × 92.35%                            = $73,880.00
//   8a/8d      = W-2 SS wages (Box 3)                       = $150,000.00
//   9          = 168,600 − 150,000                          = $18,600.00
//   10         = min(73,880, 18,600) × 12.4%                = $2,306.40
//   11         = 73,880 × 2.9%                              = $2,142.52
//   12         = 2,306.40 + 2,142.52                        = $4,448.92
//   13         = 4,448.92 ÷ 2                               = $2,224.46
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [
      {
        taxYear: 2024,
        wagesBox1: 150000,
        socialSecurityWagesBox3: 150000,
        medicareWagesBox5: 150000,
        federalTaxWithheldBox2: 0,
      },
    ],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 50000 }],
    adjustments: [{ adjustmentType: "self_employment_income", amount: 30000, isApplied: true }],
    taxYear: 2024,
  };
  const { ctx, ret } = ctxFor(inputs);
  check("S2 engine SE tax $4,448.92 (hand-calc, shared SS base)", ret.selfEmploymentTax, 4448.92);

  const schSe = buildScheduleSE(ctx);
  checkTrue("S2 Schedule SE applicable (non-null)", schSe != null);
  if (schSe) {
    check("S2 Sch SE line 2/3 $80,000", num(findLine(schSe, "2/3")), 80000);
    check("S2 Sch SE line 4a/4c $73,880 (hand-calc)", num(findLine(schSe, "4a/4c")), 73880);
    check("S2 Sch SE line 7 $168,600", num(findLine(schSe, "7")), 168600);
    check("S2 Sch SE line 8a/8d W-2 SS wages credited $150,000 (hand-calc)", num(findLine(schSe, "8a/8d")), 150000);
    check("S2 Sch SE line 9 remaining base $18,600 (hand-calc)", num(findLine(schSe, "9")), 18600);
    check("S2 Sch SE line 10 SS portion $2,306.40 (hand-calc: base-limited)", num(findLine(schSe, "10")), 2306.40);
    check("S2 Sch SE line 11 Medicare $2,142.52 (hand-calc: uncapped)", num(findLine(schSe, "11")), 2142.52);
    check("S2 Sch SE line 12 $4,448.92 (hand-calc)", num(findLine(schSe, "12")), 4448.92);
    check("S2 Sch SE line 13 $2,224.46 (hand-calc)", num(findLine(schSe, "13")), 2224.46);
    check("S2 identity: line 12 == ret.selfEmploymentTax", num(findLine(schSe, "12")), ret.selfEmploymentTax, 0.005);
    // Structural identity: line 9 = line 7 − line 8d.
    check("S2 Sch SE line 9 = line 7 − line 8d", num(findLine(schSe, "7")) - num(findLine(schSe, "8a/8d")), num(findLine(schSe, "9")));
  }

  const schC = buildScheduleC(ctx);
  checkTrue("S2 Schedule C applicable (non-null)", schC != null);
  if (schC) {
    check("S2 Sch C line 1 receipts $80,000 (NEC + adjustment)", num(findLine(schC, "1")), 80000);
    check("S2 Sch C line 1 sub-row: 1099-NEC $50,000", num(findLine(schC, "", "1099-NEC")), 50000);
    check("S2 Sch C line 1 sub-row: CPA SE adjustments $30,000", num(findLine(schC, "", "CPA self-employment income")), 30000);
    check("S2 Sch C line 28 $0 (structural, renders at zero)", num(findLine(schC, "28")), 0);
    check("S2 Sch C line 31 $80,000", num(findLine(schC, "31")), 80000);
    const tie = findByLabel(schC, "Schedule SE line 2 Schedule C portion");
    checkTrue("S2 Sch C SE tie-out ties (✓)", tie != null && tie.label.startsWith("✓"));
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S3 — Schedule C LOSS: NEC $50k, expenses $20k, depreciation $40k
//      (`schedule_c_depreciation`), single FL, TY2024.
//
// Hand-calc:
//   Sch C line 13 = $40,000; line 28 = 20,000 + 40,000     = $60,000.00
//   line 29 = line 31 = 50,000 − 60,000                    = −$10,000.00
//   SE base floored at $0 (a Sch C loss does not reduce SE tax) → SE tax $0
//   → Schedule SE NOT applicable (null). The signed loss flows toward AGI,
//   but the ENGINE floors AGI at $0 (Math.max(0, totalIncome − adjustments)
//   in taxReturnEngine.ts ~2792) — official Form 1040 permits negative AGI;
//   the workpaper's line 31 preserves the −$10,000 detail regardless.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 50000 }],
    adjustments: [
      { adjustmentType: "schedule_c_expenses", amount: 20000, isApplied: true },
      { adjustmentType: "schedule_c_depreciation", amount: 40000, isApplied: true },
    ],
    taxYear: 2024,
  };
  const { ctx, ret } = ctxFor(inputs);
  check("S3 engine SE tax $0 (loss → floored base)", ret.selfEmploymentTax, 0);
  check("S3 engine AGI $0 (engine floors AGI at 0 on a pure-loss return)", ret.adjustedGrossIncome, 0);

  checkTrue("S3 Schedule SE returns null (no SE tax)", buildScheduleSE(ctx) === null);

  const schC = buildScheduleC(ctx);
  checkTrue("S3 Schedule C still renders on a loss", schC != null);
  if (schC) {
    check("S3 Sch C line 1 $50,000", num(findLine(schC, "1")), 50000);
    check("S3 Sch C line 8–27a $20,000", num(findLine(schC, "8–27a")), 20000);
    check("S3 Sch C line 13 depreciation $40,000", num(findLine(schC, "13")), 40000);
    check("S3 Sch C line 28 $60,000 (hand-calc)", num(findLine(schC, "28")), 60000);
    check("S3 Sch C additive: 28 = 8–27a + 13", num(findLine(schC, "8–27a")) + num(findLine(schC, "13")), num(findLine(schC, "28")));
    check("S3 Sch C line 29 −$10,000", num(findLine(schC, "29")), -10000);
    check("S3 Sch C line 31 NEGATIVE −$10,000 (hand-calc)", num(findLine(schC, "31")), -10000);
    checkStr("S3 Sch C line 31 loss note mentions the SE floor", findLine(schC, "31")?.note, "floored at $0");
    const tie = findByLabel(schC, "Schedule SE line 2 Schedule C portion");
    checkTrue("S3 Sch C tie-out ties on a loss (0 == max(0, −10k)) (✓)", tie != null && tie.label.startsWith("✓"));
    checkTrue(
      "S3 Sch C line 13 carries Form 4562 cross-ref",
      (findLine(schC, "13")?.label ?? "").includes("Form 4562"),
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S4 — MFJ per-spouse attribution (E2): taxpayer W-2 $150k (Box 3 $150k,
//      untagged → taxpayer); spouse 1099-NEC $50k tagged spouse="spouse".
//      FL, TY2024. The engine computes TWO Schedule SEs and sums them.
//
// Hand-calc (spouse's Schedule SE — no W-2 SS wages of her own):
//   spouse 4a = 50,000 × 92.35%                             = $46,175.00
//   spouse 10 = min(46,175, 168,600) × 12.4%                = $5,725.70
//   spouse 11 = 46,175 × 2.9%                               = $1,339.075 ≈ $1,339.08
//   spouse 12 = 5,725.70 + 1,339.075                        = $7,064.775 ≈ $7,064.78
//   taxpayer Schedule SE: SE base $0 → $0 tax; remaining base 168,600 − 150,000 = $18,600
// Aggregated workpaper rows (sum of the two forms):
//   2/3 = 50,000; 4a/4c = 46,175; 9 = 18,600 + 168,600      = $187,200.00
//   8a/8d derived = 2 × 168,600 − 187,200                   = $150,000.00
//   12 = $7,064.78; 13 = $3,532.39
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [
      {
        taxYear: 2024,
        wagesBox1: 150000,
        socialSecurityWagesBox3: 150000,
        medicareWagesBox5: 150000,
        federalTaxWithheldBox2: 0,
      },
    ],
    form1099s: [
      { taxYear: 2024, formType: "nec", nonemployeeCompensation: 50000, spouse: "spouse" },
    ],
    adjustments: [],
    taxYear: 2024,
  };
  const { ctx, ret } = ctxFor(inputs);
  check("S4 engine SE tax $7,064.78 (hand-calc, spouse's own full base)", ret.selfEmploymentTax, 7064.78);

  const schSe = buildScheduleSE(ctx);
  checkTrue("S4 Schedule SE applicable (non-null)", schSe != null);
  if (schSe) {
    check("S4 Sch SE line 2/3 $50,000", num(findLine(schSe, "2/3")), 50000);
    check("S4 Sch SE line 4a/4c $46,175 (hand-calc)", num(findLine(schSe, "4a/4c")), 46175);
    check("S4 Sch SE line 7 shows the per-form base $168,600", num(findLine(schSe, "7")), 168600);
    checkStr("S4 Sch SE line 7 notes the ×2 aggregation", findLine(schSe, "7")?.note, "Two per-spouse Schedule SEs");
    check("S4 Sch SE line 8a/8d derived $150,000 (hand-calc)", num(findLine(schSe, "8a/8d")), 150000);
    check("S4 Sch SE line 9 combined $187,200 (hand-calc)", num(findLine(schSe, "9")), 187200);
    check("S4 Sch SE line 10 $5,725.70 (hand-calc)", num(findLine(schSe, "10")), 5725.70);
    check("S4 Sch SE line 11 $1,339.08 (hand-calc)", num(findLine(schSe, "11")), 1339.08);
    check("S4 Sch SE line 12 $7,064.78 (hand-calc)", num(findLine(schSe, "12")), 7064.78);
    check("S4 Sch SE line 13 $3,532.39 (hand-calc)", num(findLine(schSe, "13")), 3532.39);
    check("S4 identity: line 12 == ret.selfEmploymentTax", num(findLine(schSe, "12")), ret.selfEmploymentTax, 0.005);
    checkTrue(
      "S4 Sch SE footnote discloses MFJ per-spouse attribution (E2)",
      (schSe.footnotes ?? []).some((f) => f.includes("per-spouse attribution")),
    );
  }

  const schC = buildScheduleC(ctx);
  checkTrue("S4 Schedule C applicable (non-null)", schC != null);
  if (schC) {
    check("S4 Sch C line 31 $50,000", num(findLine(schC, "31")), 50000);
    checkTrue(
      "S4 Sch C SE tie-out row OMITTED under per-spouse attribution",
      findByLabel(schC, "Schedule SE line 2 Schedule C portion") === undefined,
    );
    checkTrue(
      "S4 Sch C footnote discloses the per-spouse expense apportionment",
      (schC.footnotes ?? []).some((f) => f.includes("per-spouse SE attribution")),
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S5 — Clergy housing + statutory employee: minister W-2 $40k (Box 3 $40k),
//      `clergy_housing_allowance` $30k, `statutory_employee_income` $25k.
//      Single FL, TY2024.
//
// Hand-calc (IRC §107 / §1402(a)(8); statutory employee NOT SE-taxed):
//   SE base = clergy housing only                           = $30,000.00
//   4a/4c   = 30,000 × 92.35%                               = $27,705.00
//   8a/8d   = W-2 SS wages                                  = $40,000.00
//   9       = 168,600 − 40,000                              = $128,600.00
//   10      = min(27,705, 128,600) × 12.4%                  = $3,435.42
//   11      = 27,705 × 2.9%                                 = $803.445 ≈ $803.45
//   12      = 3,435.42 + 803.445                            = $4,238.865 ≈ $4,238.87
//   13      = $2,119.43
//   Sch C line 1 = $0 (clergy housing + statutory are NOT line-1 receipts);
//   both appear as disclosure rows.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [
      {
        taxYear: 2024,
        wagesBox1: 40000,
        socialSecurityWagesBox3: 40000,
        medicareWagesBox5: 40000,
        federalTaxWithheldBox2: 0,
      },
    ],
    form1099s: [],
    adjustments: [
      { adjustmentType: "clergy_housing_allowance", amount: 30000, isApplied: true },
      { adjustmentType: "statutory_employee_income", amount: 25000, isApplied: true },
    ],
    taxYear: 2024,
  };
  const { ctx, ret } = ctxFor(inputs);
  check("S5 engine SE tax $4,238.87 (hand-calc, clergy-only base)", ret.selfEmploymentTax, 4238.87);

  const schSe = buildScheduleSE(ctx);
  checkTrue("S5 Schedule SE applicable (clergy housing is SE-taxed)", schSe != null);
  if (schSe) {
    check("S5 Sch SE line 2/3 $30,000 (clergy only — statutory excluded)", num(findLine(schSe, "2/3")), 30000);
    check("S5 Sch SE clergy sub-row $30,000", num(findLine(schSe, "", "Clergy housing allowance")), 30000);
    checkTrue(
      "S5 Sch SE Schedule-C-portion sub-row omitted (portion = $0)",
      findLine(schSe, "", "Schedule C net profit") === undefined,
    );
    check("S5 Sch SE line 4a/4c $27,705 (hand-calc)", num(findLine(schSe, "4a/4c")), 27705);
    check("S5 Sch SE line 8a/8d $40,000 (hand-calc)", num(findLine(schSe, "8a/8d")), 40000);
    check("S5 Sch SE line 9 $128,600 (hand-calc)", num(findLine(schSe, "9")), 128600);
    check("S5 Sch SE line 10 $3,435.42 (hand-calc)", num(findLine(schSe, "10")), 3435.42);
    check("S5 Sch SE line 11 $803.45 (hand-calc)", num(findLine(schSe, "11")), 803.45);
    check("S5 Sch SE line 12 $4,238.87 (hand-calc)", num(findLine(schSe, "12")), 4238.87);
    check("S5 Sch SE line 13 $2,119.43 (hand-calc)", num(findLine(schSe, "13")), 2119.43);
    checkTrue(
      "S5 Sch SE footnote cites §107/§1402(a)(8)",
      (schSe.footnotes ?? []).some((f) => f.includes("§107")),
    );
  }

  const schC = buildScheduleC(ctx);
  checkTrue("S5 Schedule C applicable via the statutory-employee stream", schC != null);
  if (schC) {
    check("S5 Sch C line 1 $0 (no aggregate-Sch-C receipts)", num(findLine(schC, "1")), 0);
    check("S5 Sch C statutory disclosure row $25,000", num(findByLabel(schC, "Statutory-employee income")), 25000);
    checkStr(
      "S5 Sch C statutory note: ordinary income + QBI, NO SE tax",
      findByLabel(schC, "Statutory-employee income")?.note,
      "NO SE tax",
    );
    check("S5 Sch C clergy info row $30,000", num(findByLabel(schC, "Clergy housing allowance")), 30000);
    check("S5 Sch C line 31 $0", num(findLine(schC, "31")), 0);
    const tie = findByLabel(schC, "Schedule SE line 2 Schedule C portion");
    checkTrue("S5 Sch C tie-out ties (clergy carved out) (✓)", tie != null && tie.label.startsWith("✓"));
    checkTrue(
      "S5 Sch C footnotes disclose both streams",
      (schC.footnotes ?? []).some((f) => f.includes("§107")) &&
        (schC.footnotes ?? []).some((f) => f.includes("Statutory-employee")),
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S6 — Applicability gates: pure W-2 return → BOTH builders return null.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 5000 }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const { ctx, ret } = ctxFor(inputs);
  check("S6 engine SE tax $0", ret.selfEmploymentTax, 0);
  checkTrue("S6 Schedule C returns null (nothing to report)", buildScheduleC(ctx) === null);
  checkTrue("S6 Schedule SE returns null (no SE tax)", buildScheduleSE(ctx) === null);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\nT2.1 workpaper builders — Schedule C + Schedule SE (group schedule-cse):`);
for (const f of FAIL) console.log(`  ${f}`);
console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length > 0 ? 1 : 0);
