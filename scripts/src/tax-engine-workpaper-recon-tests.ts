/**
 * T2.1 — Workpaper packet RECONCILIATION tests (group "recon-packet-tests").
 *
 * Covers the already-shipped packet core:
 *   - buildReconciliationWorksheet (artifacts/api-server/src/lib/forms/reconciliationWorksheet.ts)
 *   - buildWorkpaperPacketPdf (formRenderer.ts) — PDF smoke only
 *   - the NEW ComputedTaxReturn fields: obbbaSchedule1A,
 *     stateAdditionalCreditsNonRefundable/Refundable, stateChildTaxCredit,
 *     nycEitcRefundableExcess (+ stateIndividualMandatePenalty surfacing)
 *
 * Six scenarios, each: hand-built TaxReturnInputs → computeTaxReturnPure →
 * buildReconciliationWorksheet(ctx) → assert (a) HAND-CALC'D key dollar values
 * (arithmetic shown inline, citing the IRS/state published rule), (b) every
 * ✓/⚠ tie-out row reads "ties" (never "off by"), (c) structural invariants
 * (exactly 8 parts, 5 tie-out rows, valid line shapes, finite money values).
 *
 * Pure engine; no API required.
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-workpaper-recon-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
  type ComputedTaxReturn,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { buildReconciliationWorksheet } from "../../artifacts/api-server/src/lib/forms/reconciliationWorksheet";
import type {
  FormBuildContext,
  FormInstance,
  FormLine,
  WorkpaperTaxpayer,
} from "../../artifacts/api-server/src/lib/forms/formSpec";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 0.02): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}
function checkStr(label: string, actual: string | null | undefined, expected: string): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected "${expected}", got "${String(actual)}"`);
}

// ── Worksheet helpers ────────────────────────────────────────────────────────

const allLines = (inst: FormInstance): FormLine[] => inst.parts.flatMap((p) => p.lines);
const partLines = (inst: FormInstance, idx: number): FormLine[] => inst.parts[idx]?.lines ?? [];
const findLine = (lines: FormLine[], lineNo: string, frag?: string): FormLine | undefined =>
  lines.find((l) => l.line === lineNo && (!frag || l.label.includes(frag)));
const findByLabel = (lines: FormLine[], frag: string): FormLine | undefined =>
  lines.find((l) => l.label.includes(frag));

/** Collect the ✓/⚠ tie-out rows emitted by checkLine(): kind "text" with value
 *  "ties" or "off by $X". The worksheet emits exactly 5 (Parts 3/4/5/6/7). */
const tieRows = (inst: FormInstance): FormLine[] =>
  allLines(inst).filter(
    (l) =>
      l.kind === "text" &&
      typeof l.value === "string" &&
      (l.value === "ties" || l.value.startsWith("off by")),
  );

function assertAllTiesAndShape(name: string, inst: FormInstance, ret: ComputedTaxReturn): void {
  checkTrue(`${name}: worksheet has exactly 8 parts`, inst.parts.length === 8);
  checkStr(`${name}: formId`, inst.formId, "reconciliation");
  checkTrue(`${name}: taxYear matches engine`, inst.taxYear === ret.taxYear);

  const ties = tieRows(inst);
  checkTrue(`${name}: exactly 5 tie-out rows present`, ties.length === 5);
  const off = ties.filter((t) => String(t.value).startsWith("off by"));
  checkTrue(
    `${name}: ALL tie-out rows read "ties"${off.length > 0 ? ` — FAILING: ${off.map((o) => `[${o.label} → ${String(o.value)}]`).join("; ")}` : ""}`,
    off.length === 0,
  );

  // Line-shape invariants: kind/label/line defined, money values finite or null.
  const KINDS = new Set(["money", "text", "boolean", "percent", "count"]);
  const bad: string[] = [];
  for (const l of allLines(inst)) {
    if (!KINDS.has(l.kind)) bad.push(`bad kind "${String(l.kind)}" on "${l.label}"`);
    if (typeof l.label !== "string" || l.label.length === 0) bad.push(`empty label (line "${l.line}")`);
    if (typeof l.line !== "string") bad.push(`non-string line on "${l.label}"`);
    if (
      l.kind === "money" &&
      !(l.value === null || (typeof l.value === "number" && Number.isFinite(l.value)))
    ) {
      bad.push(`non-finite money on "${l.label}": ${String(l.value)}`);
    }
  }
  checkTrue(
    `${name}: every line has valid kind/label/line + finite-or-null money${bad.length > 0 ? ` — ${bad.join("; ")}` : ""}`,
    bad.length === 0,
  );
}

function makeTaxpayer(filingStatus: string, state: string): WorkpaperTaxpayer {
  return { firstName: "Test", lastName: "Payer", filingStatus, state };
}
function buildCtx(inputs: TaxReturnInputs, ret: ComputedTaxReturn): FormBuildContext {
  return {
    taxpayer: makeTaxpayer(inputs.client.filingStatus, inputs.client.state ?? ""),
    ret,
    inputs,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Scenario 1 — Simple W-2 single, TX, TY2024 ($85k wages, $9k withheld)
// ════════════════════════════════════════════════════════════════════════════
// Hand-calc (IRS Rev. Proc. 2023-34):
//   Total income = AGI = $85,000 (wages only; TX has no income tax).
//   Std deduction (single 2024) = $14,600 → taxable = $70,400.
//   Tax: 10% × 11,600 = 1,160; 12% × (47,150 − 11,600) = 4,266;
//        22% × (70,400 − 47,150) = 5,115.00 → total $10,541.00.
//   Refund = 9,000 withheld − 10,541 = −$1,541 (balance due $1,541).
let s1Worksheet: FormInstance | null = null;
let s1Taxpayer: WorkpaperTaxpayer | null = null;
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "TX", taxYear: 2024, taxpayerAge: 40 },
    w2s: [{ taxYear: 2024, wagesBox1: 85000, federalTaxWithheldBox2: 9000, stateCode: "TX", stateTaxWithheldBox17: 0 }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const ret = computeTaxReturnPure(inputs);
  const ws = buildReconciliationWorksheet(buildCtx(inputs, ret));
  s1Worksheet = ws;
  s1Taxpayer = makeTaxpayer("single", "TX");

  check("S1 engine: total income $85,000", ret.totalIncome, 85000);
  check("S1 engine: AGI $85,000", ret.adjustedGrossIncome, 85000);
  check("S1 engine: taxable income $70,400", ret.taxableIncome, 70400);
  check("S1 engine: federal tax $10,541.00", ret.federalTaxLiability, 10541.0);
  check("S1 engine: balance due $1,541.00", ret.federalRefundOrOwed, -1541.0);
  checkTrue("S1 engine: standard deduction used (itemized null)", ret.itemizedDeductions === null);
  check("S1 engine: TY2024 control — obbbaSchedule1A.total = 0", ret.obbbaSchedule1A.total, 0);
  check("S1 engine: stateAdditionalCredits both 0 (TX)", ret.stateAdditionalCreditsNonRefundable + ret.stateAdditionalCreditsRefundable, 0);
  check("S1 engine: stateChildTaxCredit 0", ret.stateChildTaxCredit, 0);
  check("S1 engine: nycEitcRefundableExcess 0", ret.nycEitcRefundableExcess, 0);

  assertAllTiesAndShape("S1", ws, ret);

  // Part 1 — wages row + total only; NO residual (listed = totalIncome).
  const p1 = partLines(ws, 0);
  checkTrue("S1 Part 1: NO residual row", findByLabel(p1, "residual") === undefined);
  check("S1 Part 1: line 1a wages = $85,000", Number(findLine(p1, "1a")?.value ?? NaN), 85000);
  check("S1 Part 1: line 9 total income = $85,000", Number(findLine(p1, "9")?.value ?? NaN), 85000);

  // Part 2 — no adjustments; structural total = 0; AGI row $85,000.
  const p2 = partLines(ws, 1);
  check("S1 Part 2: line 10 total adjustments = $0", Number(findLine(p2, "10")?.value ?? NaN), 0);
  check("S1 Part 2: line 11 AGI = $85,000", Number(findLine(p2, "11")?.value ?? NaN), 85000);

  // Part 3 — standard deduction label + values.
  const p3 = partLines(ws, 2);
  const dedRow = findLine(p3, "12");
  checkTrue("S1 Part 3: line 12 labeled \"Standard deduction\"", dedRow?.label === "Standard deduction");
  check("S1 Part 3: line 12 = $14,600", Number(dedRow?.value ?? NaN), 14600);
  check("S1 Part 3: line 15 taxable = $70,400", Number(findLine(p3, "15")?.value ?? NaN), 70400);
  checkTrue("S1 Part 3: NO OBBBA 13b row in TY2024", findLine(p3, "13b") === undefined);

  // Part 4 — single component (regular tax) = total.
  const p4 = partLines(ws, 3);
  check("S1 Part 4: line 16 regular tax = $10,541.00", Number(findLine(p4, "16")?.value ?? NaN), 10541.0);
  check("S1 Part 4: line 24 total federal tax = $10,541.00", Number(findLine(p4, "24")?.value ?? NaN), 10541.0);

  // Part 6 — settlement: withheld 9,000 − tax 10,541 → line 37 balance due 1,541 (abs).
  const p6 = partLines(ws, 5);
  check("S1 Part 6: line 25 withheld = $9,000", Number(findLine(p6, "25")?.value ?? NaN), 9000);
  const dueRow = findLine(p6, "37");
  checkTrue("S1 Part 6: balance-due row labeled as such", (dueRow?.label ?? "").includes("balance due"));
  check("S1 Part 6: line 37 balance due = $1,541.00 (absolute)", Number(dueRow?.value ?? NaN), 1541.0);

  // Part 7 — TX: state refund row 0.
  const p7 = partLines(ws, 6);
  check("S1 Part 7: state refund row = $0", Number(findByLabel(p7, "State refund (reported by engine)")?.value ?? NaN), 0);

  // Part 8 — no carryforwards placeholder.
  const p8 = partLines(ws, 7);
  checkTrue("S1 Part 8: \"No carryforwards generated this year\" placeholder", findByLabel(p8, "No carryforwards") !== undefined);
}

// ════════════════════════════════════════════════════════════════════════════
// Scenario 2 — Kitchen-sink federal, HoH, TX, TY2024
//   W-2 $40k ($11k withheld) + 1099-NEC $30k SE + 1099-DIV $5k all-qualified +
//   1099-B LTCG $20k + HSA $4,150 + dependent care $6,000 (1 qualifying) +
//   LLC tuition $8,000 + APTC $2,000 advance (MAGI > 400% FPL → full repayment)
//   + EITC-ineligible (investment income $25k > $11,600 limit).
// ════════════════════════════════════════════════════════════════════════════
// Hand-calc (Rev. Proc. 2023-34 + Sch SE + §223 + §21 + §25A + §36B):
//   SE tax (Sch SE): 30,000 × 0.9235 = 27,705 × 15.3% = $4,238.865  (W-2 SS
//     wages 40,000 leave 168,600 − 40,000 SS base — no cap binding).
//     Half-SE = $2,119.4325.
//   Total income = 40,000 + 30,000 + 5,000 QDIV + 20,000 LTCG = $95,000.
//   AGI = 95,000 − 2,119.4325 (half-SE) − 4,150 (HSA §223 self-only max) = $88,730.5675.
//   Std ded HoH = $21,900 → 66,830.5675.
//   QBI §199A: (30,000 − 2,119.4325) × 20% = $5,576.1135 (cap 20% × (66,830.57
//     − 25,000 net cap gain) = 8,366.11 not binding) → taxable = $61,254.454.
//   Ordinary portion = 61,254.454 − 25,000 pref = 36,254.454.
//     HoH tax: 10% × 16,550 = 1,655; 12% × (36,254.454 − 16,550) = 2,364.5345
//     → $4,019.5345. LTCG/QDIV stack 36,254 → 61,254, ALL below the HoH $63,000
//     0% breakpoint → preferential tax $0.
//   §36B: household 2 (HoH + 1 dep), 2023 FPL $19,720; MAGI/FPL = 4.50 > 4.0 →
//     PTC $0, full APTC repayment $2,000 (no cap at ≥400%).
//   federalTaxLiability = 4,019.5345 + 4,238.865 SE + 2,000 APTC = $10,258.40.
//   Credits: §21 dep care min(6,000, 3,000 cap-1-qualifying) × 20% (AGI>43k) = $600.
//     §25A LLC: 20% × 8,000 = 1,600 × phase-out (90,000 − 88,730.5675)/10,000
//     = 1,600 × 0.12694325 = $203.1092. ODC (other dependent) = $500.
//     totalNonRefundableApplied = 600 + 203.1092 + 500 = $1,303.1092.
//   Refund = 11,000 + 1,303.1092 − 10,258.3995 = $2,044.7097.
{
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "head_of_household",
      state: "TX",
      taxYear: 2024,
      taxpayerAge: 40,
      otherDependents: 1,
      dependentsForCareCredit: 1,
      hsaIsFamilyCoverage: false,
      acaAnnualPremium: 6000,
      acaAnnualSlcsp: 5500,
      acaAdvanceAptc: 2000,
    },
    w2s: [{ taxYear: 2024, wagesBox1: 40000, federalTaxWithheldBox2: 11000, stateCode: "TX" }],
    form1099s: [
      { taxYear: 2024, formType: "nec", nonemployeeCompensation: 30000 },
      { taxYear: 2024, formType: "div", ordinaryDividends: 5000, qualifiedDividends: 5000 },
      { taxYear: 2024, formType: "b", shortTermGainLoss: 0, longTermGainLoss: 20000 },
    ],
    adjustments: [
      { adjustmentType: "hsa_contribution", amount: 4150, isApplied: true },
      { adjustmentType: "dependent_care_expenses", amount: 6000, isApplied: true },
      { adjustmentType: "qualified_education_expenses_llc", amount: 8000, isApplied: true },
    ],
    taxYear: 2024,
  };
  const ret = computeTaxReturnPure(inputs);
  const ws = buildReconciliationWorksheet(buildCtx(inputs, ret));

  // Engine anchors (hand-calc'd above).
  check("S2 engine: total income $95,000", ret.totalIncome, 95000, 0.05);
  check("S2 engine: SE tax $4,238.87", ret.selfEmploymentTax, 4238.865, 0.05);
  check("S2 engine: AGI $88,730.57", ret.adjustedGrossIncome, 88730.5675, 0.05);
  check("S2 engine: HSA deductible $4,150", ret.retirementDeductions.hsaDeductible, 4150);
  check("S2 engine: QBI deduction $5,576.11", ret.qbiDeduction, 5576.1135, 0.05);
  check("S2 engine: taxable income $61,254.45", ret.taxableIncome, 61254.454, 0.05);
  check("S2 engine: preferential income $25,000", ret.preferentialIncome, 25000, 0.05);
  check("S2 engine: capital-gains tax $0 (all in HoH 0% bracket)", ret.capitalGainsTax, 0);
  check("S2 engine: APTC full repayment — netPtc −$2,000", ret.premiumTaxCredit.netPtc, -2000);
  check("S2 engine: federal tax (incl SE + APTC repayment) $10,258.40", ret.federalTaxLiability, 10258.3995, 0.05);
  check("S2 engine: dependent care credit $600", ret.dependentCareCredit.appliedCredit, 600, 0.05);
  check("S2 engine: LLC $203.11 (phase-out 0.126943)", ret.educationCredits.llcApplied, 203.1092, 0.05);
  check("S2 engine: ODC $500 nonrefundable", ret.childTaxCredit.nonRefundablePortion, 500);
  check("S2 engine: total nonrefundable applied $1,303.11", ret.totalNonRefundableApplied, 1303.1092, 0.05);
  checkTrue("S2 engine: EITC ineligible (investment income $25k > $11,600)", ret.eitc.eligible === false);
  check("S2 engine: EITC applied $0", ret.eitc.appliedCredit, 0);
  check("S2 engine: federal refund $2,044.71", ret.federalRefundOrOwed, 2044.7097, 0.05);

  assertAllTiesAndShape("S2", ws, ret);

  // Part 1 — components. T1.0i: the 3b row now carries TOTAL ordinary
  // dividends (incl. the qualified portion — matching official 1040 line 3b)
  // with a 3a informational subset row, so the $5,000 of qualified dividends
  // is ITEMIZED (no unexplained residual remains).
  const p1 = partLines(ws, 0);
  check("S2 Part 1: line 1a wages $40,000", Number(findLine(p1, "1a")?.value ?? NaN), 40000);
  check("S2 Part 1: line 3b total ordinary dividends $5,000 (incl. qualified)", Number(findLine(p1, "3b")?.value ?? NaN), 5000, 0.05);
  check("S2 Part 1: line 3a qualified-dividends info row $5,000", Number(findLine(p1, "3a")?.value ?? NaN), 5000, 0.05);
  check("S2 Part 1: line 7 capital gain $20,000", Number(findLine(p1, "7")?.value ?? NaN), 20000);
  check("S2 Part 1: line 8 Schedule C net $30,000", Number(findLine(p1, "8", "Schedule C")?.value ?? NaN), 30000);
  const resid = findByLabel(p1, "residual");
  checkTrue("S2 Part 1: residual row ABSENT (QDIV itemized in 3b)", resid === undefined || Number(resid?.value ?? 0) === 0);
  check("S2 Part 1: line 9 total income $95,000", Number(findLine(p1, "9")?.value ?? NaN), 95000, 0.05);

  // Part 2 — above-the-line rows.
  const p2 = partLines(ws, 1);
  check("S2 Part 2: line 13 HSA $4,150", Number(findLine(p2, "13")?.value ?? NaN), 4150);
  check("S2 Part 2: line 15 half-SE $2,119.43", Number(findLine(p2, "15")?.value ?? NaN), 2119.4325, 0.05);
  check("S2 Part 2: line 10 total adjustments $6,269.43", Number(findLine(p2, "10")?.value ?? NaN), 6269.4325, 0.05);
  checkTrue("S2 Part 2: no residual row", findByLabel(p2, "residual") === undefined);

  // Part 4 — component rows equal the engine fields.
  const p4 = partLines(ws, 3);
  check("S2 Part 4: line 16 regular tax $4,019.53", Number(findLine(p4, "16")?.value ?? NaN), 4019.5345, 0.05);
  const seRow = findLine(p4, "S2-4");
  checkTrue("S2 Part 4: SE-tax row present", seRow !== undefined);
  check("S2 Part 4: SE row == ret.selfEmploymentTax", Number(seRow?.value ?? NaN), ret.selfEmploymentTax, 0.005);
  const aptcRow = findLine(p4, "S2-2");
  check("S2 Part 4: excess-APTC repayment row $2,000", Number(aptcRow?.value ?? NaN), 2000);
  check("S2 Part 4: line 24 total == engine federalTaxLiability", Number(findLine(p4, "24")?.value ?? NaN), ret.federalTaxLiability, 0.005);

  // Part 5 — credit component rows.
  const p5 = partLines(ws, 4);
  check("S2 Part 5: dependent care row $600", Number(findLine(p5, "S3-2")?.value ?? NaN), 600, 0.05);
  check("S2 Part 5: education row $203.11", Number(findLine(p5, "S3-3")?.value ?? NaN), 203.1092, 0.05);
  check("S2 Part 5: CTC/ODC row $500", Number(findLine(p5, "19")?.value ?? NaN), 500);
  checkTrue("S2 Part 5: NO EITC row (line 27) — ineligible", findLine(p5, "27") === undefined);

  // Part 6 — settlement math by hand:
  //   11,000 withheld + 1,303.1092 nonrefundable + 0 refundable − 10,258.3995 tax
  //   = +$2,044.7097 refund.
  const p6 = partLines(ws, 5);
  check("S2 Part 6: line 25 withheld $11,000", Number(findLine(p6, "25")?.value ?? NaN), 11000);
  check("S2 Part 6: nonrefundable credits row $1,303.11", Number(findByLabel(p6, "Nonrefundable credits applied")?.value ?? NaN), 1303.1092, 0.05);
  check("S2 Part 6: refundable credits row $0", Number(findByLabel(p6, "Refundable credits")?.value ?? NaN), 0);
  check("S2 Part 6: less-total-tax row −$10,258.40", Number(findLine(p6, "24")?.value ?? NaN), -10258.3995, 0.05);
  const refundRow = findLine(p6, "34");
  checkTrue("S2 Part 6: refund row labeled as refund", (refundRow?.label ?? "").includes("Federal refund"));
  check("S2 Part 6: line 34 refund $2,044.71", Number(refundRow?.value ?? NaN), 2044.7097, 0.05);
}

// ════════════════════════════════════════════════════════════════════════════
// Scenario 3 — TY2025 OBBBA tips deduction, single, TX
//   W-2 $60k ($5k withheld) + qualified_tips $8,000 adjustment.
// ════════════════════════════════════════════════════════════════════════════
// Hand-calc (OBBBA P.L. 119-21 §224; Rev. Proc. 2024-40 TY2025 single):
//   §224 tips deduction: min(8,000, $25,000 cap) = $8,000; MAGI $60,000 <
//   $150,000 phase-out start → NO reduction → tips = total = $8,000.
//   The marker is deduction-only — total income stays $60,000 (tips are
//   already inside W-2 Box 1).
//   Taxable = max(0, 60,000 − 15,750 OBBBA std ded − 0 QBI) − 8,000 = $36,250.
//   Tax: 10% × 11,925 = 1,192.50; 12% × (36,250 − 11,925) = 2,919.00
//   → $4,111.50. Refund = 5,000 − 4,111.50 = $888.50.
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "TX", taxYear: 2025, taxpayerAge: 35 },
    w2s: [{ taxYear: 2025, wagesBox1: 60000, federalTaxWithheldBox2: 5000, stateCode: "TX" }],
    form1099s: [],
    adjustments: [{ adjustmentType: "qualified_tips", amount: 8000, isApplied: true }],
    taxYear: 2025,
  };
  const ret = computeTaxReturnPure(inputs);
  const ws = buildReconciliationWorksheet(buildCtx(inputs, ret));

  check("S3 engine: obbbaSchedule1A.tips = $8,000 (under $25k cap, no phase-out)", ret.obbbaSchedule1A.tips, 8000);
  check("S3 engine: obbbaSchedule1A.total = $8,000", ret.obbbaSchedule1A.total, 8000);
  check("S3 engine: obbba overtime/carLoan/senior all $0", ret.obbbaSchedule1A.overtime + ret.obbbaSchedule1A.carLoanInterest + ret.obbbaSchedule1A.senior, 0);
  check("S3 engine: total income $60,000 (marker is deduction-only)", ret.totalIncome, 60000);
  check("S3 engine: std ded TY2025 OBBBA $15,750", ret.standardDeduction, 15750);
  check("S3 engine: taxable income $36,250", ret.taxableIncome, 36250);
  check("S3 engine: federal tax $4,111.50", ret.federalTaxLiability, 4111.5);
  check("S3 engine: refund $888.50", ret.federalRefundOrOwed, 888.5);

  assertAllTiesAndShape("S3", ws, ret);

  // Part 3 — the 13b OBBBA row + the taxable-income tie.
  const p3 = partLines(ws, 2);
  const obbbaRow = findLine(p3, "13b");
  checkTrue("S3 Part 3: line 13b OBBBA row present", obbbaRow !== undefined);
  check("S3 Part 3: line 13b = $8,000", Number(obbbaRow?.value ?? NaN), 8000);
  check("S3 Part 3: line 15 taxable = $36,250", Number(findLine(p3, "15")?.value ?? NaN), 36250);
  const taxableTie = tieRows(ws).find((t) => t.label.includes("Taxable income ties"));
  checkStr("S3 Part 3: taxable-income checkLine ties", String(taxableTie?.value), "ties");

  // Part 6 — refund row.
  check("S3 Part 6: line 34 refund $888.50", Number(findLine(partLines(ws, 5), "34")?.value ?? NaN), 888.5);
}

// ════════════════════════════════════════════════════════════════════════════
// Scenario 4a — NJ renter + senior: state additional credits (both flavors)
//   Single, NJ, age 67, W-2 $60k ($5.5k fed + $2k NJ withheld),
//   annual_rent_paid $18,000.
// ════════════════════════════════════════════════════════════════════════════
// Hand-calc:
//   FEDERAL — age 65+ adds one $1,950 std-ded box (IRC §63(f), 2024 single
//   chart): std ded = 14,600 + 1,950 = $16,550 → taxable = $43,450.
//   Tax: 1,160 + 12% × (43,450 − 11,600) = 1,160 + 3,822 = $4,982.00.
//   Refund = 5,500 − 4,982 = $518.00.
//   NJ STATE (N.J.S.A. 54A) — no std deduction; $1,000 personal exemption →
//   NJ taxable = $59,000. Brackets (single):
//     1.4% × 20,000 = 280.00; 1.75% × 15,000 = 262.50; 3.5% × 5,000 = 175.00;
//     5.525% × 19,000 = 1,049.75 → NJ tax $1,767.25.
//   NJ additional credits (engine's 31-credit package):
//     - NJ Property Tax Credit $50 REFUNDABLE (N.J.S.A. 54A:3A-15/-18, renter
//       pathway via annual_rent_paid > 0).
//     - NJ Senior/Disabled Property Tax Deduction $250 NONREFUNDABLE
//       (N.J.S.A. 54:4-8.41 — age 65+, AGI ≤ $150k).
//   State refund = 2,000 withheld − max(0, 1,767.25 − 250) + 50 = $532.75.
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "NJ", taxYear: 2024, taxpayerAge: 67 },
    w2s: [{ taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 5500, stateCode: "NJ", stateTaxWithheldBox17: 2000 }],
    form1099s: [],
    adjustments: [{ adjustmentType: "annual_rent_paid", amount: 18000, isApplied: true }],
    taxYear: 2024,
  };
  const ret = computeTaxReturnPure(inputs);
  const ws = buildReconciliationWorksheet(buildCtx(inputs, ret));

  check("S4a engine: std ded $16,550 (age-65 box)", ret.standardDeduction, 16550);
  check("S4a engine: federal taxable $43,450", ret.taxableIncome, 43450);
  check("S4a engine: federal tax $4,982.00", ret.federalTaxLiability, 4982.0);
  check("S4a engine: federal refund $518.00", ret.federalRefundOrOwed, 518.0);
  check("S4a engine: NJ state tax $1,767.25", ret.stateTaxLiability, 1767.25, 0.05);
  check("S4a engine: stateAdditionalCreditsRefundable $50 (NJ PTC)", ret.stateAdditionalCreditsRefundable, 50);
  check("S4a engine: stateAdditionalCreditsNonRefundable $250 (NJ senior)", ret.stateAdditionalCreditsNonRefundable, 250);
  check("S4a engine: state refund $532.75", ret.stateRefundOrOwed, 532.75, 0.05);
  check("S4a engine: stateChildTaxCredit $0", ret.stateChildTaxCredit, 0);
  check("S4a engine: nycEitcRefundableExcess $0", ret.nycEitcRefundableExcess, 0);
  check("S4a engine: no mandate penalty (coverage not flagged)", ret.stateIndividualMandatePenalty, 0);
  check("S4a engine: TY2024 — OBBBA senior deduction NOT active", ret.obbbaSchedule1A.senior, 0);

  assertAllTiesAndShape("S4a", ws, ret);

  // Part 7 — the new state-credit rows surface with the right signs.
  const p7 = partLines(ws, 6);
  check("S4a Part 7: resident NJ tax row $1,767.25", Number(findByLabel(p7, "Resident-state (NJ) tax")?.value ?? NaN), 1767.25, 0.05);
  check("S4a Part 7: total state row == engine stateTaxLiability", Number(findByLabel(p7, "Total state + local tax")?.value ?? NaN), ret.stateTaxLiability, 0.005);
  const nonrefRow = findByLabel(p7, "State additional credits — nonrefundable");
  checkTrue("S4a Part 7: nonrefundable state-credit row present", nonrefRow !== undefined);
  check("S4a Part 7: nonrefundable row shown NEGATIVE −$250", Number(nonrefRow?.value ?? NaN), -250);
  const refRow = findByLabel(p7, "State additional credits — refundable");
  checkTrue("S4a Part 7: refundable state-credit row present", refRow !== undefined);
  check("S4a Part 7: refundable row +$50", Number(refRow?.value ?? NaN), 50);
  check("S4a Part 7: state withheld row $2,000", Number(findByLabel(p7, "State tax withheld")?.value ?? NaN), 2000);
  check("S4a Part 7: state refund row $532.75", Number(findByLabel(p7, "State refund (reported by engine)")?.value ?? NaN), 532.75, 0.05);
  checkTrue("S4a Part 7: NO mandate row", findByLabel(p7, "Individual mandate penalty") === undefined);
}

// ════════════════════════════════════════════════════════════════════════════
// Scenario 4b — CA individual-mandate penalty (the M4 anchor)
//   Single, CA, age 40, W-2 $180k ($30k fed + $12k CA withheld),
//   months_without_minimum_coverage = 12.
// ════════════════════════════════════════════════════════════════════════════
// Hand-calc (CA FTB Form 3853, TY2024):
//   Flat method: 1 adult × $900 = $900 (max 3× = $2,700 not reached).
//   Percentage method: 2.5% × (180,000 AGI − 17,818 CA filing threshold,
//     single 0-dep FTB 3853 table) = 2.5% × 162,182 = $4,054.55.
//   Bronze cap: $348/mo × 12 × 1 person = $4,176 — does NOT bind.
//   greater-of(900, 4,054.55) = $4,054.55 × 12/12 months = $4,054.55.
//   FEDERAL — taxable = 180,000 − 14,600 = $165,400.
//   Tax: 1,160 + 4,266 + 22% × (100,525 − 47,150) = 11,742.50 +
//        24% × (165,400 − 100,525) = 15,570.00 → $32,738.50.
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "CA", taxYear: 2024, taxpayerAge: 40 },
    w2s: [{ taxYear: 2024, wagesBox1: 180000, federalTaxWithheldBox2: 30000, stateCode: "CA", stateTaxWithheldBox17: 12000 }],
    form1099s: [],
    adjustments: [{ adjustmentType: "months_without_minimum_coverage", amount: 12, isApplied: true }],
    taxYear: 2024,
  };
  const ret = computeTaxReturnPure(inputs);
  const ws = buildReconciliationWorksheet(buildCtx(inputs, ret));

  check("S4b engine: federal taxable $165,400", ret.taxableIncome, 165400);
  check("S4b engine: federal tax $32,738.50", ret.federalTaxLiability, 32738.5);
  check("S4b engine: CA mandate penalty $4,054.55 = 2.5% × (180,000 − 17,818)", ret.stateIndividualMandatePenalty, 4054.55);
  checkStr("S4b engine: mandate method = percentage", ret.stateMandate.method, "percentage");
  check("S4b engine: mandate percentageAmount $4,054.55", ret.stateMandate.percentageAmount, 4054.55);
  check("S4b engine: mandate bronze cap $4,176 (348 × 12 × 1) not binding", ret.stateMandate.bronzeCapAmount, 4176);
  checkStr("S4b engine: mandate state CA", ret.stateMandate.state, "CA");
  // CA Personal Exemption Credit (Form 540 Line 32): $144/filer for single,
  // nonrefundable. At $180k AGI the filer is below the TY2024 PEC phase-out
  // threshold ($244,857 single — $6 reduction per $2,500 over), so the full
  // $144 applies. The CA Renter's Credit is correctly $0 (AGI > $52,421 cap).
  check("S4b engine: CA Personal Exemption Credit $144 (nonrefundable)", ret.stateAdditionalCreditsNonRefundable, 144);
  check("S4b engine: no refundable state additional credits", ret.stateAdditionalCreditsRefundable, 0);
  // Identity: refund = withheld − max(0, state tax − nonref additional credit)
  //   + refundable − mandate penalty = 12,000 − (12,767.142 − 144) + 0 − 4,054.55.
  check(
    "S4b engine: state refund identity (12,000 − (CA tax − $144 PEC) − 4,054.55)",
    ret.stateRefundOrOwed,
    12000 - (ret.stateTaxLiability - 144) - 4054.55,
    0.02,
  );

  assertAllTiesAndShape("S4b", ws, ret);

  // Part 7 — the mandate row appears, negative.
  const p7 = partLines(ws, 6);
  const mandateRow = findByLabel(p7, "Individual mandate penalty");
  checkTrue("S4b Part 7: mandate row present", mandateRow !== undefined);
  checkTrue("S4b Part 7: mandate row names CA", (mandateRow?.label ?? "").includes("CA"));
  check("S4b Part 7: mandate row −$4,054.55", Number(mandateRow?.value ?? NaN), -4054.55);
  check("S4b Part 7: state refund row == |engine stateRefundOrOwed|", Number(findByLabel(p7, ret.stateRefundOrOwed >= 0 ? "State refund (reported by engine)" : "State balance due (reported by engine)")?.value ?? NaN), Math.abs(ret.stateRefundOrOwed), 0.005);
}

// ════════════════════════════════════════════════════════════════════════════
// Scenario 5 — NYC EITC refundable excess + school tax credit
//   Single, NY resident, localityCode "NYC", age 30, W-2 $8,000, no withholding.
// ════════════════════════════════════════════════════════════════════════════
// Hand-calc:
//   FEDERAL EITC (Rev. Proc. 2023-34, single 0 kids): phase-in 7.65% to $8,260
//   → credit = 8,000 × 7.65% = $612.00 (AGI 8,000 < $10,330 phase-out start).
//   Federal taxable = max(0, 8,000 − 14,600) = 0 → tax $0 → refund = $612.
//   NY STATE: std ded $8,000 → NY taxable $0 → NY tax $0.
//     NY EITC (Tax Law §606(d)) = 30% × 612 = $183.60.
//   NYC: NYS taxable 0 → NYC PIT baseline $0 → localTaxLiability $0.
//     NYC EIC (IT-215 Worksheet C): rate at NYAGI $8,000 = 25% → 612 × 25% =
//     $153.00; NYC tax is $0 → ENTIRE $153 is the refundable excess.
//     NYC School Tax Credit (IT-201 line 69): single, NYAGI < $250k → $63.
//   State refund = 0 withheld − 0 tax + 183.60 + 153 + 63 = $399.60.
{
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "single",
      state: "NY",
      taxYear: 2024,
      taxpayerAge: 30,
      localityCode: "NYC",
    },
    w2s: [{ taxYear: 2024, wagesBox1: 8000, federalTaxWithheldBox2: 0, stateCode: "NY", stateTaxWithheldBox17: 0 }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const ret = computeTaxReturnPure(inputs);
  const ws = buildReconciliationWorksheet(buildCtx(inputs, ret));

  check("S5 engine: federal EITC $612.00 (7.65% × 8,000)", ret.eitc.appliedCredit, 612.0);
  check("S5 engine: federal taxable $0", ret.taxableIncome, 0);
  check("S5 engine: federal refund $612.00", ret.federalRefundOrOwed, 612.0);
  check("S5 engine: NY state tax $0 (AGI = std ded)", ret.stateTaxLiability, 0);
  check("S5 engine: NY state EITC $183.60 (30% piggyback)", ret.stateEitc.credit, 183.6);
  check("S5 engine: NYC local tax $0 after credits", ret.localTaxLiability, 0);
  check("S5 engine: nycEitcRefundableExcess $153.00 (25% × 612, NYC tax $0)", ret.nycEitcRefundableExcess, 153.0);
  check("S5 engine: NYC school tax credit $63", ret.multiState.localTax?.nycSchoolTaxCredit ?? NaN, 63);
  check("S5 engine: NYC EIC on local breakdown $153.00", ret.multiState.localTax?.nycEitc ?? NaN, 153.0);
  check("S5 engine: stateChildTaxCredit $0 (NY not a state-CTC state)", ret.stateChildTaxCredit, 0);
  check("S5 engine: state refund $399.60", ret.stateRefundOrOwed, 399.6);

  assertAllTiesAndShape("S5", ws, ret);

  // Part 5 — federal EITC refundable row.
  check("S5 Part 5: line 27 EITC row $612", Number(findLine(partLines(ws, 4), "27")?.value ?? NaN), 612.0);

  // Part 6 — refundable credits row carries the EITC.
  check("S5 Part 6: refundable credits row $612", Number(findByLabel(partLines(ws, 5), "Refundable credits")?.value ?? NaN), 612.0);

  // Part 7 — the NYC rows surface.
  const p7 = partLines(ws, 6);
  check("S5 Part 7: State EITC row $183.60", Number(findByLabel(p7, "State EITC")?.value ?? NaN), 183.6);
  const nycExcessRow = findByLabel(p7, "NYC EITC refundable excess");
  checkTrue("S5 Part 7: NYC EITC refundable-excess row present", nycExcessRow !== undefined);
  check("S5 Part 7: NYC EITC excess row $153.00", Number(nycExcessRow?.value ?? NaN), 153.0);
  const schoolRow = findByLabel(p7, "NYC school tax credit");
  checkTrue("S5 Part 7: NYC school-tax-credit row present", schoolRow !== undefined);
  check("S5 Part 7: NYC school credit row $63", Number(schoolRow?.value ?? NaN), 63);
  check("S5 Part 7: state refund row $399.60", Number(findByLabel(p7, "State refund (reported by engine)")?.value ?? NaN), 399.6);
  checkTrue("S5 Part 7: no local-tax row (NYC tax fully absorbed → $0)", findByLabel(p7, "Local tax (") === undefined);
}

// ════════════════════════════════════════════════════════════════════════════
// Scenario 6 — PDF smoke: buildWorkpaperPacketPdf renders the packet
// ════════════════════════════════════════════════════════════════════════════
// Dynamic import so a pdfkit RESOLUTION failure in the scripts workspace skips
// ONLY this block (per assignment); a render failure still FAILS the suite.
async function pdfSmoke(): Promise<void> {
  let renderer: typeof import("../../artifacts/api-server/src/lib/forms/formRenderer");
  try {
    renderer = await import("../../artifacts/api-server/src/lib/forms/formRenderer");
  } catch (err) {
    console.warn(
      `\n⚠ S6 PDF smoke SKIPPED — formRenderer/pdfkit failed to resolve from the scripts workspace: ${String(err)}`,
    );
    return;
  }
  if (!s1Worksheet || !s1Taxpayer) {
    FAIL.push("✗ S6 PDF smoke: scenario-1 worksheet unavailable");
    return;
  }
  const buf = await renderer.buildWorkpaperPacketPdf({
    taxpayer: s1Taxpayer,
    taxYear: 2024,
    instances: [s1Worksheet],
    generatedAt: new Date("2026-06-09T12:00:00Z"),
  });
  checkTrue(`S6 PDF: buffer length > 2000 (got ${buf.length})`, buf.length > 2000);
  checkStr("S6 PDF: starts with %PDF- magic", buf.slice(0, 5).toString("latin1"), "%PDF-");
}

// ── Summary ──────────────────────────────────────────────────────────────────
(async () => {
  await pdfSmoke();
  console.log("\nT2.1 recon-packet-tests — reconciliation worksheet + packet PDF:");
  console.log(`  ✓ Passed: ${PASS.length}`);
  console.log(`  ✗ Failed: ${FAIL.length}`);
  if (FAIL.length > 0) FAIL.forEach((f) => console.log(`    ${f}`));
  console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
  process.exit(FAIL.length > 0 ? 1 : 0);
})();
