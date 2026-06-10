/**
 * T2.1 — Workpaper builders, group "other-tax-forms":
 *   Form 6251 (AMT) / Form 8959 (Additional Medicare) / Form 8960 (NIIT) /
 *   Form 8615 (kiddie tax, informational) / Form 5329 (early-distribution +
 *   HSA-excise additional taxes).
 *
 * Every headline dollar value is HAND-CALC'D against the IRS published rule
 * (see the `// Hand-calc:` blocks); identity tie rows may compare to engine
 * output (that is the workpaper's job). Pure engine — no API required.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-workpaper-other-tax-forms-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { buildForm6251 } from "../../artifacts/api-server/src/lib/forms/form6251Spec";
import { buildForm8959 } from "../../artifacts/api-server/src/lib/forms/form8959Spec";
import { buildForm8960 } from "../../artifacts/api-server/src/lib/forms/form8960Spec";
import { buildForm8615 } from "../../artifacts/api-server/src/lib/forms/form8615Spec";
import { buildForm5329 } from "../../artifacts/api-server/src/lib/forms/form5329Spec";
import type {
  FormBuildContext,
  FormInstance,
  FormLine,
  WorkpaperTaxpayer,
} from "../../artifacts/api-server/src/lib/forms/formSpec";
import { KIDDIE_TAX_THRESHOLD } from "../../artifacts/api-server/src/lib/taxCalculator";

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

// ── Fixture helpers (engine Fact types are structural — no casts needed) ────
function makeClient(over: Partial<TaxReturnInputs["client"]> = {}): TaxReturnInputs["client"] {
  return {
    filingStatus: "single",
    state: "FL",
    taxYear: 2024,
    dependentsUnder17: 0,
    otherDependents: 0,
    taxpayerAge: 45,
    ...over,
  };
}
function w2(wages: number): TaxReturnInputs["w2s"][number] {
  return {
    taxYear: 2024,
    wagesBox1: wages,
    federalTaxWithheldBox2: 0,
    socialSecurityWagesBox3: wages,
    medicareWagesBox5: wages,
    stateCode: "FL",
  };
}
function adj(adjustmentType: string, amount: number): TaxReturnInputs["adjustments"][number] {
  return { adjustmentType, amount, isApplied: true };
}
function makeTaxpayer(over: Partial<WorkpaperTaxpayer> = {}): WorkpaperTaxpayer {
  return { firstName: "Test", lastName: "Filer", filingStatus: "single", state: "FL", ...over };
}
function ctxFor(inputs: TaxReturnInputs, taxpayerOver: Partial<WorkpaperTaxpayer> = {}): FormBuildContext {
  return {
    taxpayer: makeTaxpayer({ filingStatus: inputs.client.filingStatus, ...taxpayerOver }),
    ret: computeTaxReturnPure(inputs),
    inputs,
  };
}

// Line finders. Numbered lines by line + optional label fragment; unnumbered
// rows by label fragment.
function findLine(inst: FormInstance, lineNo: string, frag?: string): FormLine | undefined {
  return inst.parts
    .flatMap((p) => p.lines)
    .find((l) => l.line === lineNo && (!frag || l.label.includes(frag)));
}
function findByLabel(inst: FormInstance, frag: string): FormLine | undefined {
  return inst.parts.flatMap((p) => p.lines).find((l) => l.label.includes(frag));
}
function lineVal(l: FormLine | undefined): number {
  return l && typeof l.value === "number" ? l.value : NaN;
}
/** Every ✓/⚠ tie row on the instance must read "ties" (the builder's own
 *  reconciliation device — a ⚠ means the workpaper caught a mismatch). */
function checkAllTies(name: string, inst: FormInstance): void {
  const tieRows = inst.parts
    .flatMap((p) => p.lines)
    .filter((l) => l.label.startsWith("✓") || l.label.startsWith("⚠"));
  checkTrue(`${name}: has tie rows`, tieRows.length > 0);
  for (const row of tieRows) {
    checkTrue(`${name}: tie "${row.label.slice(2)}"`, row.value === "ties");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S1 — ISO-exercise AMT filer (TY2024, single, FL).
//   W-2 wages $250,000; ISO bargain element (Form 6251 line 2i) $400,000.
//
// Hand-calc (IRS Form 6251 instructions TY2024 + Rev. Proc. 2023-34):
//   AGI 250,000; std ded 14,600 → taxable income 235,400.
//   Regular tax (2024 single brackets):
//     11,600×10% = 1,160;  35,550×12% = 4,266;  53,375×22% = 11,742.50;
//     91,425×24% = 21,942; 43,450×32% = 13,904  →  53,014.50.
//   AMT preferences = ISO 400,000 + std-ded addback (§56(b)(1)(E)) 14,600
//     = 414,600.  AMTI = 235,400 + 414,600 = 650,000.
//   Exemption: 85,700 − 25%×(650,000 − 609,350) = 85,700 − 10,162.50
//     = 75,537.50.  AMT base = 650,000 − 75,537.50 = 574,462.50.
//   TMT = 232,600×26% + (574,462.50 − 232,600)×28%
//       = 60,476 + 95,721.50 = 156,197.50.
//   AMT (line 11) = 156,197.50 − 53,014.50 = 103,183.00.
//   Form 8959: Medicare wages 250,000 − 200,000 = 50,000 × 0.9% = 450.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: makeClient(),
    w2s: [w2(250000)],
    form1099s: [],
    adjustments: [adj("amt_iso_bargain_element", 400000)],
    taxYear: 2024,
  };
  const ctx = ctxFor(inputs);
  const ret = ctx.ret;

  check("S1 engine AMT = 103,183 (hand-calc)", ret.amtTax, 103183.0);
  check("S1 engine Additional Medicare = 450 (hand-calc)", ret.additionalMedicareTax, 450);

  const f6251 = buildForm6251(ctx);
  checkTrue("S1 6251 builds (amtTax > 0)", f6251 != null);
  if (f6251) {
    checkTrue("S1 6251 formId", f6251.formId === "6251");
    checkTrue("S1 6251 taxYear 2024", f6251.taxYear === 2024);
    check("S1 6251 line 1 taxable income", lineVal(findLine(f6251, "1")), 235400);
    check("S1 6251 line 2a–3 aggregate adjustments", lineVal(findLine(f6251, "2a–3")), 414600);
    checkTrue("S1 6251 no ATNOLD row (line 2f) when none applied", findLine(f6251, "2f") == null);
    check("S1 6251 line 4 AMTI", lineVal(findLine(f6251, "4")), 650000);
    check("S1 6251 line 4 = line 1 + adjustments (additive)",
      lineVal(findLine(f6251, "1")) + lineVal(findLine(f6251, "2a–3")), lineVal(findLine(f6251, "4")));
    check("S1 6251 line 5 exemption (phase-out)", lineVal(findLine(f6251, "5")), 75537.5);
    check("S1 6251 line 6 base", lineVal(findLine(f6251, "6")), 574462.5);
    check("S1 6251 Path A (26/28% full base)", lineVal(findByLabel(f6251, "Path A")), 156197.5);
    check("S1 6251 Path B (Part III preferential)", lineVal(findByLabel(f6251, "Path B")), 156197.5);
    check("S1 6251 line 7 TMT = min(paths)", lineVal(findLine(f6251, "7")), 156197.5);
    check("S1 6251 line 9 tentative minimum tax", lineVal(findLine(f6251, "9")), 156197.5);
    check("S1 6251 line 10 regular tax", lineVal(findLine(f6251, "10")), 53014.5);
    check("S1 6251 line 11 AMT", lineVal(findLine(f6251, "11")), 103183.0);
    check("S1 6251 8801 credit generated = line 11",
      lineVal(findByLabel(f6251, "credit generated")), 103183.0);
    check("S1 6251 8801 carryforward = engine field",
      lineVal(findByLabel(f6251, "carryforward to next year")), ret.amtCreditCarryforwardRemaining);
    check("S1 6251 8801 carryforward = 103,183 (no prior credit)",
      lineVal(findByLabel(f6251, "carryforward to next year")), 103183.0);
    checkAllTies("S1 6251", f6251);
  }

  const f8959 = buildForm8959(ctx);
  checkTrue("S1 8959 builds", f8959 != null);
  if (f8959) {
    check("S1 8959 line 6 wages over threshold", lineVal(findLine(f8959, "6")), 50000);
    check("S1 8959 line 7 = 50,000 × 0.9%", lineVal(findLine(f8959, "7")), 450);
    check("S1 8959 line 18 total", lineVal(findLine(f8959, "18")), 450);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S2a — $300k W-2 wages, single (Form 8959 wages-only path).
//
// Hand-calc (Form 8959 Part I, IRC §3101(b)(2)):
//   Line 1/4 Medicare wages 300,000; line 5 threshold 200,000 (single);
//   line 6 = 100,000; line 7 = 100,000 × 0.9% = $900. No SE → Part II blank.
//   NIIT: no investment income → Form 8960 not applicable.
//   AMT: AMTI = 285,400 + 14,600 = 300,000; exemption 85,700 (no phase-out);
//   TMT = 214,300×26% = 55,718 < regular 70,264.75 → no AMT → 6251 null.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: makeClient(),
    w2s: [w2(300000)],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const ctx = ctxFor(inputs);

  check("S2a engine Additional Medicare = 900 (hand-calc)", ctx.ret.additionalMedicareTax, 900);
  checkTrue("S2a 8960 null gate (no investment income)", buildForm8960(ctx) == null);
  checkTrue("S2a 6251 null gate (no AMT)", buildForm6251(ctx) == null);

  const f8959 = buildForm8959(ctx);
  checkTrue("S2a 8959 builds", f8959 != null);
  if (f8959) {
    check("S2a 8959 line 1 Medicare wages", lineVal(findLine(f8959, "1")), 300000);
    check("S2a 8959 line 4 = line 1", lineVal(findLine(f8959, "4")), 300000);
    check("S2a 8959 line 5 threshold (single)", lineVal(findLine(f8959, "5")), 200000);
    check("S2a 8959 line 6 excess", lineVal(findLine(f8959, "6")), 100000);
    check("S2a 8959 line 7 tax on wages", lineVal(findLine(f8959, "7")), 900);
    check("S2a 8959 line 18 total", lineVal(findLine(f8959, "18")), 900);
    checkTrue("S2a 8959 omits Part II when no SE earnings", f8959.parts.length === 2);
    checkAllTies("S2a 8959", f8959);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S2b — Investor NIIT (TY2024, single, FL):
//   W-2 wages $210,000 + 1099-INT $25,000 + 1099-B long-term gain $35,000.
//
// Hand-calc (Form 8960, IRC §1411):
//   MAGI = AGI = 210,000 + 25,000 + 35,000 = 270,000 (no FEIE).
//   NII (line 8/12) = 25,000 interest + 35,000 net LTCG = 60,000.
//   Line 14 threshold 200,000 (single); line 15 = 70,000.
//   Line 16 = min(60,000, 70,000) = 60,000; line 17 = 60,000 × 3.8% = $2,280.
//   Form 8959: (210,000 − 200,000) × 0.9% = $90.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: makeClient(),
    w2s: [w2(210000)],
    form1099s: [
      { taxYear: 2024, formType: "int", payerName: "Bank", interestIncome: 25000 },
      { taxYear: 2024, formType: "b", payerName: "Broker", longTermGainLoss: 35000 },
    ],
    adjustments: [],
    taxYear: 2024,
  };
  const ctx = ctxFor(inputs);

  check("S2b engine NIIT = 2,280 (hand-calc)", ctx.ret.niitTax, 2280);
  check("S2b engine Additional Medicare = 90 (hand-calc)", ctx.ret.additionalMedicareTax, 90);

  const f8960 = buildForm8960(ctx);
  checkTrue("S2b 8960 builds", f8960 != null);
  if (f8960) {
    check("S2b 8960 line 1 taxable interest", lineVal(findLine(f8960, "1")), 25000);
    checkTrue("S2b 8960 omits line 2 (no dividends)", findLine(f8960, "2") == null);
    check("S2b 8960 residual = LTCG 35,000", lineVal(findLine(f8960, "4a–7")), 35000);
    check("S2b 8960 line 8 total investment income", lineVal(findLine(f8960, "8")), 60000);
    check("S2b 8960 line 12 net investment income", lineVal(findLine(f8960, "12")), 60000);
    check("S2b 8960 line 13 MAGI (derived)", lineVal(findLine(f8960, "13")), 270000);
    check("S2b 8960 line 14 threshold", lineVal(findLine(f8960, "14")), 200000);
    check("S2b 8960 line 15 excess", lineVal(findLine(f8960, "15")), 70000);
    check("S2b 8960 line 16 smaller-of", lineVal(findLine(f8960, "16")), 60000);
    check("S2b 8960 line 17 NIIT", lineVal(findLine(f8960, "17")), 2280);
    check("S2b 8960 line 11 Part II deductions = 0 (not modeled, disclosed)", lineVal(findLine(f8960, "11")), 0);
    checkAllTies("S2b 8960", f8960);
  }

  const f8959 = buildForm8959(ctx);
  checkTrue("S2b 8959 builds", f8959 != null);
  if (f8959) {
    check("S2b 8959 line 18 = 90", lineVal(findLine(f8959, "18")), 90);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S3 — Kiddie-tax filer (TY2024 + TY2025, informational Form 8615).
//   Child, single, FL, age 16; isKiddieTaxFiler; parent top rate 37%;
//   1099-INT interest $5,000, no earned income.
//
// Hand-calc (Form 8615 / §1(g); Rev. Proc. 2023-34):
//   Dependent std ded (§63(c)(5)) = max(1,300, 0 + 450) = 1,300.
//   Taxable income = 5,000 − 1,300 = 3,700.
//   Net unearned income = 5,000 − 2,600 = 2,400 (all at parent rate; ≤ taxable).
//   Kiddie method = tax(3,700 − 2,400) + 2,400 × 37% = 130 + 888 = 1,018.
//   Regular method = tax(3,700) = 370.  Line 18 = max → $1,018.
//   No SE/NIIT/AMT → federalTaxLiability = 1,018.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: makeClient({ taxpayerAge: 16, isKiddieTaxFiler: true, parentsTopMarginalRate: 0.37 }),
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "int", payerName: "Bank", interestIncome: 5000 }],
    adjustments: [],
    taxYear: 2024,
  };
  const ctx = ctxFor(inputs, { isKiddieTaxFiler: true, parentsTopMarginalRate: 0.37, taxpayerAge: 16 });

  check("S3 engine kiddie-overlaid federal tax = 1,018 (hand-calc)", ctx.ret.federalTaxLiability, 1018);

  const f8615 = buildForm8615(ctx);
  checkTrue("S3 8615 builds for kiddie filer", f8615 != null);
  if (f8615) {
    check("S3 8615 threshold row = 2,600 (TY2024)", lineVal(findLine(f8615, "2")), 2600);
    check("S3 8615 threshold matches engine KIDDIE_TAX_THRESHOLD[2024]",
      lineVal(findLine(f8615, "2")), KIDDIE_TAX_THRESHOLD[2024]);
    const pct = findByLabel(f8615, "Parent's top marginal rate");
    checkTrue("S3 8615 parent rate is a percent line", pct?.kind === "percent");
    check("S3 8615 parent rate = 0.37", lineVal(pct), 0.37);
    const method = findLine(f8615, "18");
    checkTrue("S3 8615 method row states MAX(regular, kiddie)",
      typeof method?.value === "string" && method.value.includes("MAX(regular"));
    checkTrue("S3 8615 method row is emphasized", method?.emphasis === true);
    check("S3 8615 limited dependent std ded context row = 1,300",
      lineVal(findByLabel(f8615, "Limited dependent standard deduction")), 1300);
    check("S3 8615 interest context row = 5,000", lineVal(findByLabel(f8615, "Taxable interest")), 5000);
    checkTrue("S3 8615 omits dividends context row (none)", findByLabel(f8615, "Dividends, ordinary") == null);
    checkTrue("S3 8615 footnote discloses the flat-parent-rate approximation",
      (f8615.footnotes ?? []).some((fn) => fn.includes("flat parent top marginal rate")));
  }

  // TY2025 threshold row drift-guard ($2,700 per Rev. Proc. 2024-40).
  const inputs25: TaxReturnInputs = {
    ...inputs,
    client: makeClient({ taxYear: 2025, taxpayerAge: 16, isKiddieTaxFiler: true, parentsTopMarginalRate: 0.37 }),
    form1099s: [{ taxYear: 2025, formType: "int", payerName: "Bank", interestIncome: 5000 }],
    taxYear: 2025,
  };
  const ctx25 = ctxFor(inputs25, { isKiddieTaxFiler: true, parentsTopMarginalRate: 0.37 });
  const f8615y25 = buildForm8615(ctx25);
  checkTrue("S3 8615 builds for TY2025", f8615y25 != null);
  if (f8615y25) {
    check("S3 8615 TY2025 threshold row = 2,700", lineVal(findLine(f8615y25, "2")), 2700);
    check("S3 8615 TY2025 threshold matches engine KIDDIE_TAX_THRESHOLD[2025]",
      lineVal(findLine(f8615y25, "2")), KIDDIE_TAX_THRESHOLD[2025]);
    // Hand-calc: §63(c)(5) floor TY2025 = $1,350 (Rev. Proc. 2024-40), no earned income.
    check("S3 8615 TY2025 limited dependent std ded = 1,350",
      lineVal(findByLabel(f8615y25, "Limited dependent standard deduction")), 1350);
  }

  // TY2026 threshold drift-guard ($2,700, flat vs 2025 per Rev. Proc. 2025-32).
  const inputs26: TaxReturnInputs = {
    ...inputs,
    client: makeClient({ taxYear: 2026, taxpayerAge: 16, isKiddieTaxFiler: true, parentsTopMarginalRate: 0.37 }),
    form1099s: [{ taxYear: 2026, formType: "int", payerName: "Bank", interestIncome: 5000 }],
    taxYear: 2026,
  };
  const ctx26 = ctxFor(inputs26, { isKiddieTaxFiler: true, parentsTopMarginalRate: 0.37 });
  const f8615y26 = buildForm8615(ctx26);
  checkTrue("S3 8615 builds for TY2026", f8615y26 != null);
  if (f8615y26) {
    check("S3 8615 TY2026 threshold matches engine KIDDIE_TAX_THRESHOLD[2026]",
      lineVal(findLine(f8615y26, "2")), KIDDIE_TAX_THRESHOLD[2026]);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S4 — Form 5329: early distribution + HSA excess (TY2024, single, FL, age 40).
//   W-2 $60,000; 1099-R code 1, taxable $20,000; employee HSA contribution
//   $5,150 on self-only coverage.
//
// Hand-calc:
//   Part I (§72(t)): 20,000 × 10% = $2,000 (code 1, no exception).
//   Part VII (§4973(g)): §223 limit (2024 self-only, age < 55) = $4,150;
//   excess = 5,150 − 4,150 = 1,000; excise = 1,000 × 6% = $60.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: makeClient({ taxpayerAge: 40, hsaIsFamilyCoverage: false }),
    w2s: [w2(60000)],
    form1099s: [
      { taxYear: 2024, formType: "r", payerName: "Custodian", grossDistribution: 20000, taxableAmount: 20000, distributionCode: "1" },
    ],
    adjustments: [adj("hsa_contribution", 5150)],
    taxYear: 2024,
  };
  const ctx = ctxFor(inputs);

  check("S4 engine §72(t) penalty = 2,000 (hand-calc)", ctx.ret.earlyWithdrawalPenalty, 2000);
  check("S4 engine HSA excise = 60 (hand-calc)", ctx.ret.hsaExcessExcise, 60);

  const f5329 = buildForm5329(ctx);
  checkTrue("S4 5329 builds", f5329 != null);
  if (f5329) {
    checkTrue("S4 5329 renders both Part I and Part VII", f5329.parts.length === 2);
    check("S4 5329 Part I line 1 early distributions", lineVal(findLine(f5329, "1")), 20000);
    check("S4 5329 code-1 subtotal", lineVal(findByLabel(f5329, "Code 1")), 20000);
    check("S4 5329 Part I line 3", lineVal(findLine(f5329, "3")), 20000);
    check("S4 5329 Part I line 4 additional tax", lineVal(findLine(f5329, "4")), 2000);
    check("S4 5329 Part VII line 47 excess", lineVal(findLine(f5329, "47")), 1000);
    check("S4 5329 Part VII line 48 total excess", lineVal(findLine(f5329, "48")), 1000);
    check("S4 5329 Part VII line 49 excise", lineVal(findLine(f5329, "49")), 60);
    check("S4 5329 HSA limit context row = 4,150", lineVal(findByLabel(f5329, "§223 annual limit")), 4150);
    check("S4 5329 HSA total contribution context row = 5,150",
      lineVal(findByLabel(f5329, "Total HSA contributions")), 5150);
    checkAllTies("S4 5329", f5329);
  }

  // S4c — degraded context (no inputs): line 4 still reports; line 1 blank.
  const f5329NoInputs = buildForm5329({ taxpayer: ctx.taxpayer, ret: ctx.ret });
  checkTrue("S4c 5329 builds without inputs", f5329NoInputs != null);
  if (f5329NoInputs) {
    const l1 = findLine(f5329NoInputs, "1");
    checkTrue("S4c 5329 line 1 blank without input detail", l1 != null && l1.value === null);
    check("S4c 5329 line 4 still = 2,000", lineVal(findLine(f5329NoInputs, "4")), 2000);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S4b — Form 5329 mixed Box 7 codes: code 1 ($20,000 @ 10%) + code S
//   (SIMPLE IRA first-2-years, $8,000 @ 25%, §72(t)(6)).
//
// Hand-calc: 20,000 × 10% + 8,000 × 25% = 2,000 + 2,000 = $4,000;
//   line 1 = 28,000.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: makeClient({ taxpayerAge: 40 }),
    w2s: [w2(60000)],
    form1099s: [
      { taxYear: 2024, formType: "r", payerName: "Custodian A", grossDistribution: 20000, taxableAmount: 20000, distributionCode: "1" },
      { taxYear: 2024, formType: "r", payerName: "Custodian B", grossDistribution: 8000, taxableAmount: 8000, distributionCode: "S" },
    ],
    adjustments: [],
    taxYear: 2024,
  };
  const ctx = ctxFor(inputs);

  check("S4b engine blended penalty = 4,000 (hand-calc)", ctx.ret.earlyWithdrawalPenalty, 4000);
  const f5329 = buildForm5329(ctx);
  checkTrue("S4b 5329 builds", f5329 != null);
  if (f5329) {
    check("S4b 5329 line 1 = 28,000", lineVal(findLine(f5329, "1")), 28000);
    check("S4b 5329 code-S subtotal = 8,000", lineVal(findByLabel(f5329, "Code S")), 8000);
    check("S4b 5329 line 4 blended = 4,000", lineVal(findLine(f5329, "4")), 4000);
    checkTrue("S4b 5329 only Part I renders (no HSA excess)", f5329.parts.length === 1);
    checkAllTies("S4b 5329", f5329);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S5 — Null applicability gates: a plain $50k W-2 single filer triggers NONE
//   of the five forms (no AMT, no Additional Medicare, no NIIT, not a kiddie
//   filer, no §72(t)/HSA additional taxes).
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: makeClient(),
    w2s: [w2(50000)],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const ctx = ctxFor(inputs);
  checkTrue("S5 6251 null", buildForm6251(ctx) == null);
  checkTrue("S5 8959 null", buildForm8959(ctx) == null);
  checkTrue("S5 8960 null", buildForm8960(ctx) == null);
  checkTrue("S5 8615 null", buildForm8615(ctx) == null);
  checkTrue("S5 5329 null", buildForm5329(ctx) == null);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\nT2.1 workpapers — other-tax-forms (6251 / 8959 / 8960 / 8615 / 5329):`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) FAIL.forEach((f) => console.log(`    ${f}`));
process.exit(FAIL.length > 0 ? 1 : 0);
