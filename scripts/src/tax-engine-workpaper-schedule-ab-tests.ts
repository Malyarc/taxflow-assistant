/**
 * T2.1 workpaper packet — Schedule A (Itemized Deductions) + Schedule B
 * (Interest and Ordinary Dividends) builder tests.
 *
 * Pure engine + pure builders; NO API required. Every headline dollar value is
 * HAND-CALC'D against the official TY2024/TY2025 Schedule A/B instructions
 * (cited inline); identity ties compare workpaper totals to engine fields
 * (that is the workpaper's job); applicability gates and additive structure
 * are asserted per scenario.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-workpaper-schedule-ab-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { buildScheduleA } from "../../artifacts/api-server/src/lib/forms/scheduleASpec";
import { buildScheduleB } from "../../artifacts/api-server/src/lib/forms/scheduleBSpec";
import type {
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
  else FAIL.push(`✗ ${label}: expected true, got false`);
}
function checkStr(label: string, actual: string | null | undefined, frag: string): void {
  if ((actual ?? "").includes(frag)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected to include "${frag}", got "${actual}"`);
}

const findLine = (
  inst: FormInstance | null,
  lineNo: string,
  frag?: string,
): FormLine | undefined =>
  inst?.parts
    .flatMap((p) => p.lines)
    .find((l) => l.line === lineNo && (!frag || l.label.includes(frag)));
const lineVal = (inst: FormInstance | null, lineNo: string, frag?: string): number => {
  const l = findLine(inst, lineNo, frag);
  return typeof l?.value === "number" ? l.value : NaN;
};
/** Find a ✓/⚠ tie-out row whose label contains frag; returns its value string. */
const tieRow = (inst: FormInstance | null, frag: string): string =>
  String(
    inst?.parts.flatMap((p) => p.lines).find((l) => l.line === "" && l.label.includes(frag))?.value ?? "(missing)",
  );
const footnoteHas = (inst: FormInstance | null, frag: string): boolean =>
  (inst?.footnotes ?? []).some((f) => f.includes(frag));
const partTitled = (inst: FormInstance | null, frag: string) =>
  inst?.parts.find((p) => (p.title ?? "").includes(frag));

const taxpayer: WorkpaperTaxpayer = {
  firstName: "Test",
  lastName: "Filer",
  filingStatus: "single",
  state: "CA",
};

const adj = (adjustmentType: string, amount: number): TaxReturnInputs["adjustments"][number] => ({
  adjustmentType,
  amount,
  isApplied: true,
});

// ════════════════════════════════════════════════════════════════════════════
// S1 — TY2024 single itemizer: medical above the floor, SALT over the cap,
//      mortgage, uncapped cash charitable.
//
// Hand-calc (2024 Schedule A instructions):
//   W-2 wages $100,000, no other income, no above-the-line deductions
//     → AGI (1040 line 11) = $100,000.
//   Medical: line 1 = $12,000; line 3 = 100,000 × 7.5% = $7,500 (§213(a));
//     line 4 = 12,000 − 7,500 = $4,500.
//   SALT: 5a = $9,000 income tax (> $0 sales); 5b = $6,000 real estate;
//     5d = $15,000; 5e = min(15,000, $10,000 TCJA §164(b)(6) cap) = $10,000.
//   Interest: 8a = 8e = 10 = $8,000 mortgage.
//   Gifts: 11 = $5,000 cash (< 60% × AGI = $60,000 → uncapped); 14 = $5,000.
//   Line 17 = 4,500 + 10,000 + 8,000 + 5,000 = $27,500.
//   Std ded single 2024 = $14,600 < 27,500 → ITEMIZE; taxable = 100,000 −
//   27,500 = $72,500.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "CA", taxYear: 2024, taxpayerAge: 45 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "CA" }],
    form1099s: [],
    adjustments: [
      adj("medical_expenses", 12000),
      adj("state_income_tax", 9000),
      adj("state_property_tax", 6000),
      adj("mortgage_interest", 8000),
      adj("charitable_cash", 5000),
    ],
    taxYear: 2024,
  };
  const ret = computeTaxReturnPure(inputs);
  // Engine pre-flight (hand-calc'd, not engine echo)
  check("S1 engine AGI $100,000", ret.adjustedGrossIncome, 100000);
  check("S1 engine itemized used $27,500", ret.itemizedDeductions ?? NaN, 27500);
  check("S1 engine taxable $72,500", ret.taxableIncome, 72500);

  const a = buildScheduleA({ taxpayer, ret, inputs });
  checkTrue("S1 Schedule A builds", a != null);
  check("S1 line 1 medical paid $12,000", lineVal(a, "1"), 12000);
  check("S1 line 2 AGI $100,000", lineVal(a, "2"), 100000);
  check("S1 line 3 7.5% floor $7,500", lineVal(a, "3"), 7500);
  check("S1 line 4 deductible medical $4,500", lineVal(a, "4"), 4500);
  checkStr("S1 medical tie row ✓", tieRow(a, "Line 4 ties"), "ties");
  check("S1 line 5a state income taxes $9,000", lineVal(a, "5a"), 9000);
  check("S1 line 5b real estate taxes $6,000", lineVal(a, "5b"), 6000);
  check("S1 line 5d SALT before cap $15,000", lineVal(a, "5d"), 15000);
  checkStr("S1 SALT 5d tie row ✓", tieRow(a, "Line 5d ties"), "ties");
  check("S1 line 5e SALT capped $10,000 (TCJA)", lineVal(a, "5e"), 10000);
  checkStr("S1 5e cap note flags binding cap", findLine(a, "5e")?.note ?? "", "cap BINDS");
  check("S1 line 7 taxes paid $10,000", lineVal(a, "7"), 10000);
  check("S1 line 8a mortgage interest $8,000", lineVal(a, "8a"), 8000);
  check("S1 line 10 total interest $8,000", lineVal(a, "10"), 8000);
  check("S1 line 11 cash gifts $5,000", lineVal(a, "11"), 5000);
  check("S1 line 14 total gifts $5,000", lineVal(a, "14"), 5000);
  checkStr("S1 gifts additive tie row ✓", tieRow(a, "Line 14 ties"), "ties");
  check("S1 line 17 total itemized $27,500", lineVal(a, "17"), 27500);
  // Additive structure: 17 = 4 + 7 + 10 + 14
  check(
    "S1 additive: lines 4+7+10+14 == line 17",
    lineVal(a, "4") + lineVal(a, "7") + lineVal(a, "10") + lineVal(a, "14"),
    lineVal(a, "17"),
  );
  // Identity ties to engine fields
  check(
    "S1 line 17 == engine scheduleA.totalItemized + investment interest",
    lineVal(a, "17"),
    ret.scheduleA.totalItemized + ret.investmentInterestDeduction,
  );
  checkStr("S1 line 17 tie row ✓", tieRow(a, "Line 17 ties"), "ties");
  check("S1 election: Form 1040 line 12 row == engine itemizedDeductions", lineVal(a, "12", "ITEMIZED"), ret.itemizedDeductions ?? NaN);
  checkStr("S1 1040-line-12 tie row ✓", tieRow(a, "line 12 ties"), "ties");
  checkTrue("S1 no comparison-mode footnote (itemized was used)", !footnoteHas(a, "COMPARISON ONLY"));

  // S6 — degraded build of the SAME return without input facts: deductible
  // amounts stay engine-exact; gross-input rows are omitted.
  const d = buildScheduleA({ taxpayer, ret });
  checkTrue("S6 degraded build (no inputs) still builds", d != null);
  checkTrue("S6 degraded: no line 1 raw medical", findLine(d, "1") == null);
  check("S6 degraded line 4 medical $4,500", lineVal(d, "4"), 4500);
  checkTrue("S6 degraded: no line 5a (adjustment detail unavailable)", findLine(d, "5a") == null);
  check("S6 degraded line 5d $15,000", lineVal(d, "5d"), 15000);
  check("S6 degraded line 5e $10,000", lineVal(d, "5e"), 10000);
  check("S6 degraded line 14 gifts $5,000", lineVal(d, "14"), 5000);
  checkTrue("S6 degraded: no line 11 split", findLine(d, "11") == null);
  check("S6 degraded line 17 $27,500", lineVal(d, "17"), 27500);
  checkTrue("S6 degraded footnote discloses missing inputs", footnoteHas(d, "Adjustment-level inputs"));

  // Schedule B gate: no 1099s at all → null.
  checkTrue("S1 Schedule B returns null (no payers, not required)", buildScheduleB({ taxpayer, ret, inputs }) == null);
}

// ════════════════════════════════════════════════════════════════════════════
// S2 — TY2024 Schedule B: multi-payer interest + dividends crossing $1,500
//      via dividends only.
//
// Hand-calc (2024 Schedule B instructions):
//   1099-INT: First National Bank box 1 = $900 → taxable $900.
//             Credit Union West box 1 = $700, box 8 tax-exempt = $200 →
//             taxable = 700 − 200 = $500 (tax-exempt goes to 1040 line 2a).
//   Line 2 = line 4 = 900 + 500 = $1,400 (≤ $1,500 — interest alone does NOT
//   require Schedule B).
//   1099-DIV: Vanguard box 1a = $1,200 (of which box 1b qualified $800);
//             Fidelity box 1a = $500, box 2a cap-gain distribution $300.
//   Line 6 = 1,200 + 500 = $1,700 box-1a ordinary dividends > $1,500 →
//   Schedule B REQUIRED. Box 2a $300 is Schedule D line 13, NOT Schedule B.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 45 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
    form1099s: [
      { taxYear: 2024, formType: "int", payerName: "First National Bank", interestIncome: 900 },
      { taxYear: 2024, formType: "int", payerName: "Credit Union West", interestIncome: 700, taxExemptInterest: 200 },
      { taxYear: 2024, formType: "div", payerName: "Vanguard Brokerage", ordinaryDividends: 1200, qualifiedDividends: 800 },
      { taxYear: 2024, formType: "div", payerName: "Fidelity Investments", ordinaryDividends: 500, totalCapitalGainDistribution: 300 },
    ],
    adjustments: [],
    taxYear: 2024,
  };
  const ret = computeTaxReturnPure(inputs);
  check("S2 engine taxable interest $1,400", ret.form1099Summary.interestIncome, 1400);
  check(
    "S2 engine box-1a dividends $1,700",
    ret.form1099Summary.ordinaryDividends + ret.form1099Summary.qualifiedDividends,
    1700,
  );
  checkTrue("S2 engine scheduleBRequired (dividends > $1,500)", ret.form1099Summary.scheduleBRequired);

  const b = buildScheduleB({ taxpayer, ret, inputs });
  checkTrue("S2 Schedule B builds", b != null);
  const partI = partTitled(b, "Part I —");
  const partII = partTitled(b, "Part II —");
  const interestRows = (partI?.lines ?? []).filter((l) => l.line === "1");
  check("S2 Part I has 2 payer rows", interestRows.length, 2);
  checkStr("S2 Part I rows sorted: Credit Union West first", interestRows[0]?.label ?? "", "Credit Union West");
  check("S2 Credit Union West taxable interest $500 (700 − 200 exempt)", Number(interestRows[0]?.value), 500);
  checkStr("S2 Credit Union West note shows $200 tax-exempt", interestRows[0]?.note ?? "", "$200.00 tax-exempt");
  check("S2 First National Bank $900", Number(interestRows[1]?.value), 900);
  check("S2 line 2 total interest $1,400", lineVal(b, "2"), 1400);
  check("S2 line 4 → 1040 line 2b $1,400", lineVal(b, "4"), 1400);
  checkStr("S2 line 4 tie row ✓", tieRow(b, "Line 4 ties"), "ties");
  const divRows = (partII?.lines ?? []).filter((l) => l.line === "5");
  check("S2 Part II has 2 payer rows", divRows.length, 2);
  checkStr("S2 Part II rows sorted: Fidelity first", divRows[0]?.label ?? "", "Fidelity Investments");
  check("S2 Fidelity box 1a $500", Number(divRows[0]?.value), 500);
  check("S2 Vanguard box 1a $1,200 (incl. qualified)", Number(divRows[1]?.value), 1200);
  checkStr("S2 Vanguard note shows $800 qualified", divRows[1]?.note ?? "", "$800.00");
  check("S2 line 6 → 1040 line 3b $1,700", lineVal(b, "6"), 1700);
  checkStr("S2 line 6 tie row ✓", tieRow(b, "Line 6 ties"), "ties");
  check(
    "S2 line 6 == engine ordinary + qualified buckets",
    lineVal(b, "6"),
    ret.form1099Summary.ordinaryDividends + ret.form1099Summary.qualifiedDividends,
  );
  check("S2 qualified informational row $800", lineVal(b, "", "qualified dividends"), 800);
  check("S2 cap-gain distribution info row $300 → Schedule D line 13", lineVal(b, "", "Schedule D line 13"), 300);
  check("S2 tax-exempt informational row $200", lineVal(b, "", "Tax-exempt interest"), 200);
  // Part III structure
  const p3 = partTitled(b, "Part III —");
  check("S2 Part III has 4 question rows", p3?.lines.length ?? 0, 4);
  checkTrue("S2 Part III 7a unanswered (CPA to answer)", findLine(b, "7a")?.value === null);
  checkStr("S2 Part III 7a note", findLine(b, "7a")?.note ?? "", "CPA to answer");
  checkTrue("S2 Part III line 8 foreign trust row present", findLine(b, "8", "foreign trust") != null);
  checkTrue("S2 footnote: REQUIRED over $1,500", footnoteHas(b, "REQUIRED"));
  checkTrue("S2 footnote mentions $1,500 threshold", footnoteHas(b, "$1,500"));

  // Schedule A gate: no itemized data at all → null.
  checkTrue("S2 Schedule A returns null (totalItemized == 0)", buildScheduleA({ taxpayer, ret, inputs }) == null);
}

// ════════════════════════════════════════════════════════════════════════════
// S2b — Schedule B required via INTEREST only ($1,800 > $1,500); no dividends
//       → no Part II.
// Hand-calc: 1,000 + 800 = $1,800 interest.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 45 },
    w2s: [{ taxYear: 2024, wagesBox1: 30000, stateCode: "FL" }],
    form1099s: [
      { taxYear: 2024, formType: "int", payerName: "Bank A", interestIncome: 1000 },
      { taxYear: 2024, formType: "int", payerName: "Bank B", interestIncome: 800 },
    ],
    adjustments: [],
    taxYear: 2024,
  };
  const ret = computeTaxReturnPure(inputs);
  checkTrue("S2b engine scheduleBRequired (interest $1,800 > $1,500)", ret.form1099Summary.scheduleBRequired);
  const b = buildScheduleB({ taxpayer, ret, inputs });
  check("S2b line 2 = $1,800", lineVal(b, "2"), 1800);
  check("S2b line 4 = $1,800", lineVal(b, "4"), 1800);
  checkTrue("S2b no Part II (no dividends)", partTitled(b, "Part II —") == null);
  checkTrue("S2b Part III still present", partTitled(b, "Part III —") != null);
}

// ════════════════════════════════════════════════════════════════════════════
// S3a — Standard-deduction filer with small itemized data → Schedule A builds
//       in COMPARISON mode.
// Hand-calc: wages $60,000; charitable cash $2,000 → Schedule A total $2,000
//   < std ded $14,600 (2024 single) → standard chosen; itemizedDeductions null.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 45 },
    w2s: [{ taxYear: 2024, wagesBox1: 60000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [adj("charitable_cash", 2000)],
    taxYear: 2024,
  };
  const ret = computeTaxReturnPure(inputs);
  checkTrue("S3a engine chose the standard deduction", ret.itemizedDeductions == null);
  check("S3a engine std ded $14,600", ret.standardDeduction, 14600);

  const a = buildScheduleA({ taxpayer, ret, inputs });
  checkTrue("S3a Schedule A builds in comparison mode", a != null);
  checkStr("S3a PROMINENT comparison footnote (first)", a?.footnotes?.[0] ?? "", "STANDARD DEDUCTION WAS SELECTED");
  checkStr("S3a subtitle flags comparison", a?.subtitle ?? "", "Comparison only");
  check("S3a line 17 = $2,000", lineVal(a, "17"), 2000);
  check("S3a comparison row: standard deduction $14,600", lineVal(a, "", "Standard deduction available"), 14600);
  check("S3a election row: STANDARD used $14,600", lineVal(a, "12", "STANDARD"), 14600);
  checkTrue("S3a no ITEMIZED election row", findLine(a, "12", "ITEMIZED") == null);
  checkTrue("S3a Schedule B null (no payers)", buildScheduleB({ taxpayer, ret, inputs }) == null);
}

// ════════════════════════════════════════════════════════════════════════════
// S3b — No itemized data and no 1099s at all → BOTH builders return null.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 45 },
    w2s: [{ taxYear: 2024, wagesBox1: 60000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const ret = computeTaxReturnPure(inputs);
  checkTrue("S3b Schedule A null (nothing itemized)", buildScheduleA({ taxpayer, ret, inputs }) == null);
  checkTrue("S3b Schedule B null (no payers, not required)", buildScheduleB({ taxpayer, ret, inputs }) == null);
}

// ════════════════════════════════════════════════════════════════════════════
// S4 — TY2025 OBBBA SALT cap + §163(d) investment interest (Form 4952) +
//      single-payer Schedule B.
//
// Hand-calc:
//   W-2 $150,000 + 1099-INT $5,000 → AGI $155,000 (no above-the-line items).
//   SALT: 30,000 income + 15,000 real estate = 5d $45,000; MAGI 155,000 ≤
//     $500,000 → OBBBA §164(b)(7) cap $40,000 (TY2025) → 5e = $40,000.
//   Mortgage 8a = $10,000.
//   Investment interest: expense $6,000; net investment income = $5,000
//     taxable interest (§163(d)(4)) → line 9 allowed = $5,000; $1,000
//     disallowed carries forward (§163(d)(2)).
//   Line 10 = 10,000 + 5,000 = $15,000.
//   Line 17 = 0 + 40,000 + 15,000 + 0 = $55,000.
//   Std ded 2025 single = $15,750 (OBBBA) < 55,000 → ITEMIZE;
//   taxable = 155,000 − 55,000 = $100,000.
//   Schedule B: one payer $5,000 > $1,500 → REQUIRED.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2025, taxpayerAge: 45 },
    w2s: [{ taxYear: 2025, wagesBox1: 150000, stateCode: "FL" }],
    form1099s: [
      { taxYear: 2025, formType: "int", payerName: "Pacific Brokerage", interestIncome: 5000 },
    ],
    adjustments: [
      adj("state_income_tax", 30000),
      adj("state_property_tax", 15000),
      adj("mortgage_interest", 10000),
      adj("investment_interest_expense", 6000),
    ],
    taxYear: 2025,
  };
  const ret = computeTaxReturnPure(inputs);
  check("S4 engine AGI $155,000", ret.adjustedGrossIncome, 155000);
  check("S4 engine allowed investment interest $5,000", ret.investmentInterestDeduction, 5000);
  check("S4 engine disallowed investment interest $1,000", ret.investmentInterestDisallowed, 1000);
  check("S4 engine itemized used $55,000", ret.itemizedDeductions ?? NaN, 55000);
  check("S4 engine taxable $100,000", ret.taxableIncome, 100000);

  const a = buildScheduleA({ taxpayer, ret, inputs });
  check("S4 line 5d SALT before cap $45,000", lineVal(a, "5d"), 45000);
  check("S4 line 5e OBBBA cap $40,000", lineVal(a, "5e"), 40000);
  checkStr("S4 5e note cites OBBBA §164(b)(7)", findLine(a, "5e")?.note ?? "", "§164(b)(7)");
  check("S4 line 8a mortgage $10,000", lineVal(a, "8a"), 10000);
  check("S4 line 9 investment interest $5,000", lineVal(a, "9"), 5000);
  checkStr("S4 line 9 cross-references Form 4952", findLine(a, "9")?.label ?? "", "Form 4952");
  check("S4 line 10 total interest $15,000", lineVal(a, "10"), 15000);
  check("S4 line 17 total $55,000", lineVal(a, "17"), 55000);
  check(
    "S4 line 17 == engine totalItemized + investment interest",
    lineVal(a, "17"),
    ret.scheduleA.totalItemized + ret.investmentInterestDeduction,
  );
  checkStr("S4 line 17 tie row ✓", tieRow(a, "Line 17 ties"), "ties");
  check("S4 election row ties Form 1040 line 12 $55,000", lineVal(a, "12", "ITEMIZED"), 55000);
  checkTrue("S4 footnote discloses $1,000 §163(d)(2) carryforward", footnoteHas(a, "$1,000.00"));
  checkTrue("S4 footnote cites §163(d)(2)", footnoteHas(a, "§163(d)(2)"));

  const b = buildScheduleB({ taxpayer, ret, inputs });
  checkTrue("S4 Schedule B builds (interest $5,000 > $1,500)", b != null);
  const rows = (partTitled(b, "Part I —")?.lines ?? []).filter((l) => l.line === "1");
  check("S4 Part I single payer row", rows.length, 1);
  check("S4 Pacific Brokerage $5,000", Number(rows[0]?.value), 5000);
  check("S4 line 4 = $5,000", lineVal(b, "4"), 5000);
  checkTrue("S4 no Part II", partTitled(b, "Part II —") == null);
}

// ════════════════════════════════════════════════════════════════════════════
// S5 — TY2024 charitable AGI caps BIND: gifts section falls back to the
//      limited total + gross informational rows; cash carryforward footnote.
//
// Hand-calc (§170(b)(1), Pub 526):
//   Wages $50,000 → AGI $50,000.
//   Cash gifts $35,000 → 60% × 50,000 = $30,000 cap → $30,000 deducted,
//     $5,000 carries forward (§170(d)(1)).
//   Property gifts $20,000 → min(20,000, 30% × AGI = 15,000, overall 50% ×
//     AGI − cash deducted = 25,000 − 30,000 → 0) = $0 deducted (the engine
//     does NOT carry property excess — documented sub-gap).
//   Line 14 = $30,000; line 17 = $30,000 > std $14,600 → ITEMIZE;
//   taxable = 50,000 − 30,000 = $20,000.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 45 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [adj("charitable_cash", 35000), adj("charitable_property", 20000)],
    taxYear: 2024,
  };
  const ret = computeTaxReturnPure(inputs);
  check("S5 engine charitable deductible $30,000 (60% AGI cap)", ret.scheduleA.charitableDeductible, 30000);
  check("S5 engine cash carryforward remaining $5,000", ret.scheduleA.charitableCarryforwardCashRemaining, 5000);
  check("S5 engine taxable $20,000", ret.taxableIncome, 20000);

  const a = buildScheduleA({ taxpayer, ret, inputs });
  check("S5 line 14 limited gifts $30,000", lineVal(a, "14"), 30000);
  checkTrue("S5 no line 11 split (cap bound — split not exposed)", findLine(a, "11") == null);
  check("S5 gross cash informational row $35,000", lineVal(a, "", "Gross cash gifts"), 35000);
  check("S5 gross property informational row $20,000", lineVal(a, "", "Gross non-cash gifts"), 20000);
  check("S5 line 17 = $30,000", lineVal(a, "17"), 30000);
  checkTrue("S5 footnote: §170(d)(1) carryforward $5,000", footnoteHas(a, "$5,000.00") && footnoteHas(a, "§170(d)(1)"));
  checkTrue("S5 footnote: property excess NOT carried (engine sub-gap)", footnoteHas(a, "PROPERTY"));
  checkTrue("S5 footnote: AGI cap bound disclosure", footnoteHas(a, "AGI cap bound"));
}

// ════════════════════════════════════════════════════════════════════════════
// S7 — Schedule B BELOW the $1,500 threshold but payers exist → builds as
//      workpaper detail with a "not strictly required" footnote.
// Hand-calc: single 1099-INT $400 → line 2 = line 4 = $400; required = false.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 45 },
    w2s: [{ taxYear: 2024, wagesBox1: 40000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "int", payerName: "Small Town Bank", interestIncome: 400 }],
    adjustments: [],
    taxYear: 2024,
  };
  const ret = computeTaxReturnPure(inputs);
  checkTrue("S7 engine scheduleBRequired false", !ret.form1099Summary.scheduleBRequired);
  const b = buildScheduleB({ taxpayer, ret, inputs });
  checkTrue("S7 builds anyway (payer detail)", b != null);
  check("S7 line 2 = $400", lineVal(b, "2"), 400);
  check("S7 line 4 = $400", lineVal(b, "4"), 400);
  checkTrue("S7 footnote: not strictly required", footnoteHas(b, "not strictly required"));
}

// ── Summary ──────────────────────────────────────────────────────────────────
for (const p of PASS) console.log(p);
if (FAIL.length > 0) {
  console.log("\nFAILURES:");
  for (const f of FAIL) console.log(f);
}
console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length > 0 ? 1 : 0);
