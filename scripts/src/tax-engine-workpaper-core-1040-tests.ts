/**
 * T2.1 — Workpaper packet: Form 1040 builder (group "core-1040").
 *
 * Verifies build1040 (artifacts/api-server/src/lib/forms/form1040Spec.ts)
 * against computeTaxReturnPure output across 5 scenarios:
 *   S1 — W-2-only single TY2024 (hand-calc'd 2024 single brackets)
 *   S2 — MFJ + SE income + 2 kids (SE tax, half-SE, §199A QBI, CTC ordering)
 *   S3 — investor with LTCG + QDIV (QDCGT worksheet preferential method)
 *   S4 — retiree: 1099-R + Social Security (Pub 915) + §63(f) age-65 add-on
 *   S5 — empty return (1040 is ALWAYS applicable — never null)
 *
 * Every headline dollar expectation is HAND-CALC'D from the IRS published
 * rule (Rev. Proc. 2023-34 brackets/std-ded, Sch SE, §199A, Sch 8812,
 * QDCGT worksheet, Pub 915) — see the "Hand-calc:" blocks. Identity ties
 * (line 24 + credits == engine liability, settlement) compare to engine
 * fields — that is the workpaper's job.
 *
 * No API required.
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-workpaper-core-1040-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { build1040 } from "../../artifacts/api-server/src/lib/forms/form1040Spec";
import type {
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
function checkStr(label: string, actual: string | null | undefined, includes: string): void {
  if ((actual ?? "").includes(includes)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected to include "${includes}", got "${actual}"`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const findLine = (
  inst: FormInstance,
  lineNo: string,
  frag?: string,
): FormLine | undefined =>
  inst.parts
    .flatMap((p) => p.lines)
    .find((l) => l.line === lineNo && (!frag || l.label.includes(frag)));

/** Numeric value of a form line (NaN when absent / non-money — fails checks loudly). */
const moneyOf = (inst: FormInstance, lineNo: string, frag?: string): number => {
  const l = findLine(inst, lineNo, frag);
  return l && typeof l.value === "number" ? l.value : NaN;
};

/** Every checkLine row must read "ties" — a ⚠ row means an identity broke. */
function assertAllTie(scenario: string, inst: FormInstance): void {
  const broken = inst.parts
    .flatMap((p) => p.lines)
    .filter((l) => typeof l.value === "string" && l.value.startsWith("off by"));
  checkTrue(
    `${scenario}: every ✓ tie-out row ties (${broken.length === 0 ? "ok" : broken.map((b) => b.label).join("; ")})`,
    broken.length === 0,
  );
}

function client(
  overrides: Partial<TaxReturnInputs["client"]> = {},
): TaxReturnInputs["client"] {
  return {
    filingStatus: "single",
    state: "FL", // no state income tax — keeps the federal lines isolated
    taxYear: 2024,
    dependentsUnder17: 0,
    otherDependents: 0,
    taxpayerAge: 45,
    ...overrides,
  };
}

function taxpayerOf(inputs: TaxReturnInputs): WorkpaperTaxpayer {
  const c = inputs.client;
  return {
    firstName: "Test",
    lastName: "Taxpayer",
    filingStatus: c.filingStatus,
    state: c.state ?? "FL",
    dependentsUnder17: c.dependentsUnder17,
    otherDependents: c.otherDependents,
    taxpayerAge: c.taxpayerAge,
    spouseAge: c.spouseAge,
  };
}

function buildFor(inputs: TaxReturnInputs) {
  const ret = computeTaxReturnPure(inputs);
  const inst = build1040({ taxpayer: taxpayerOf(inputs), ret, inputs });
  return { ret, inst };
}

// ─────────────────────────────────────────────────────────────────────────────
// S1 — W-2-only single, TY2024. $85,000 wages, $10,000 withheld.
//
// Hand-calc (Rev. Proc. 2023-34):
//   Std deduction (single)         = $14,600
//   Taxable = 85,000 − 14,600      = $70,400
//   Tax (2024 single brackets):
//     11,600 × 10%                 = 1,160.00
//     (47,150 − 11,600) × 12%      = 4,266.00
//     (70,400 − 47,150) × 22%      = 5,115.00
//     line 16                      = $10,541.00
//   No credits / other taxes → line 22 = 24 = 10,541.
//   Withheld 10,000 → line 37 owed = 10,541 − 10,000 = $541.00.
// ─────────────────────────────────────────────────────────────────────────────
{
  const inputs: TaxReturnInputs = {
    client: client(),
    w2s: [
      {
        taxYear: 2024,
        wagesBox1: 85000,
        federalTaxWithheldBox2: 10000,
        socialSecurityWagesBox3: 85000,
        medicareWagesBox5: 85000,
        stateCode: "FL",
      },
    ],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const { inst } = buildFor(inputs);

  checkTrue("S1: builder returns a FormInstance (1040 always applicable)", inst != null);
  checkStr("S1: formId", inst.formId, "1040");
  checkStr("S1: formNumber", inst.formNumber, "Form 1040");
  check("S1: taxYear", inst.taxYear, 2024, 0);

  check("S1 line 1a wages", moneyOf(inst, "1a"), 85000);
  check("S1 line 9 total income", moneyOf(inst, "9"), 85000);
  check("S1 line 10 adjustments", moneyOf(inst, "10"), 0);
  check("S1 line 11 AGI", moneyOf(inst, "11"), 85000);
  check("S1 line 12 standard deduction", moneyOf(inst, "12"), 14600);
  checkStr("S1 line 12 label says standard", findLine(inst, "12")?.label ?? "", "Standard deduction");
  check("S1 line 14 = line 12 (no QBI/OBBBA)", moneyOf(inst, "14"), 14600);
  check("S1 line 15 taxable income (hand-calc)", moneyOf(inst, "15"), 70400);
  check("S1 line 16 tax (hand-calc 2024 single brackets)", moneyOf(inst, "16"), 10541);
  check("S1 line 17 Schedule 2 line 3", moneyOf(inst, "17"), 0);
  check("S1 line 18 = 16 + 17 (additive)", moneyOf(inst, "18"), 10541);
  check("S1 line 19 CTC", moneyOf(inst, "19"), 0);
  check("S1 line 20 Schedule 3 line 8", moneyOf(inst, "20"), 0);
  check("S1 line 22 after credits", moneyOf(inst, "22"), 10541);
  check("S1 line 23 other taxes", moneyOf(inst, "23"), 0);
  check("S1 line 24 total tax", moneyOf(inst, "24"), 10541);
  check("S1 line 25a W-2 withholding", moneyOf(inst, "25a"), 10000);
  check("S1 line 25d total withholding", moneyOf(inst, "25d"), 10000);
  check("S1 line 32 refundable credits", moneyOf(inst, "32"), 0);
  check("S1 line 33 total payments", moneyOf(inst, "33"), 10000);
  check("S1 line 37 amount owed (hand-calc $541)", moneyOf(inst, "37"), 541);
  checkTrue("S1: refund line 34 absent on an owed return", findLine(inst, "34") === undefined);
  checkTrue("S1: zero line 2b omitted", findLine(inst, "2b") === undefined);
  checkTrue("S1: zero line 8 omitted", findLine(inst, "8") === undefined);
  checkTrue("S1: zero line 27 EITC omitted", findLine(inst, "27") === undefined);
  assertAllTie("S1", inst);
}

// ─────────────────────────────────────────────────────────────────────────────
// S2 — MFJ, 2 kids under 17. W-2 $60,000 ($9,000 withheld) + 1099-NEC $40,000.
//
// Hand-calc:
//   Schedule SE: net SE = 40,000 × 0.9235 = 36,940
//     SS 36,940 × 12.4% = 4,580.56; Medicare 36,940 × 2.9% = 1,071.26
//     SE tax = $5,651.82; deductible half = $2,825.91
//   AGI = 60,000 + 40,000 − 2,825.91 = $97,174.09
//   §199A QBI = (Sch C 40,000 − half-SE 2,825.91) × 20% = 37,174.09 × 0.20
//             = $7,434.818  (cap 20% × 67,974.09 = 13,594.82 not binding)
//   Taxable = 97,174.09 − 29,200 − 7,434.818 = $60,539.272
//   Tax (2024 MFJ): 23,200 × 10% + (60,539.272 − 23,200) × 12%
//                 = 2,320 + 4,480.7126 = $6,800.7126
//   CTC (Sch 8812, TY2024 $2,000/child): 2 × 2,000 = 4,000; AGI < $400k
//     no phase-out; nonrefundable = min(4,000, 6,800.71) = $4,000; ACTC $0
//   line 22 = 6,800.7126 − 4,000 = $2,800.7126;  line 23 = SE $5,651.82
//   line 24 = $8,452.5326;  engine pre-credit liability = $12,452.5326
//   Withheld 9,000 → line 34 refund = 9,000 − 8,452.5326 = $547.4674
// ─────────────────────────────────────────────────────────────────────────────
{
  const inputs: TaxReturnInputs = {
    client: client({
      filingStatus: "married_filing_jointly",
      dependentsUnder17: 2,
      spouseAge: 44,
    }),
    w2s: [
      {
        taxYear: 2024,
        wagesBox1: 60000,
        federalTaxWithheldBox2: 9000,
        socialSecurityWagesBox3: 60000,
        medicareWagesBox5: 60000,
        stateCode: "FL",
      },
    ],
    form1099s: [
      { taxYear: 2024, formType: "nec", payerName: "Acme LLC", nonemployeeCompensation: 40000 },
    ],
    adjustments: [],
    taxYear: 2024,
  };
  const { ret, inst } = buildFor(inputs);

  check("S2 line 1a wages", moneyOf(inst, "1a"), 60000);
  check("S2 line 8 Schedule 1 residual = SE income", moneyOf(inst, "8"), 40000);
  check("S2 line 9 total income", moneyOf(inst, "9"), 100000);
  check("S2 line 10 adjustments = half-SE (hand-calc)", moneyOf(inst, "10"), 2825.91);
  check("S2 line 11 AGI (hand-calc)", moneyOf(inst, "11"), 97174.09);
  check("S2 line 12 MFJ standard deduction", moneyOf(inst, "12"), 29200);
  check("S2 line 13a QBI deduction (hand-calc §199A)", moneyOf(inst, "13a"), 7434.82);
  check("S2 line 14 = 12 + 13a (additive)", moneyOf(inst, "14"), 36634.82);
  check("S2 line 15 taxable income (hand-calc)", moneyOf(inst, "15"), 60539.27);
  check("S2 line 16 tax (hand-calc 2024 MFJ brackets)", moneyOf(inst, "16"), 6800.71);
  check("S2 line 19 CTC nonrefundable (Sch 8812)", moneyOf(inst, "19"), 4000);
  check("S2 line 21 = 19 + 20 (additive)", moneyOf(inst, "21"), 4000);
  check("S2 line 22 tax after credits (hand-calc)", moneyOf(inst, "22"), 2800.71);
  check("S2 line 23 other taxes = SE tax (hand-calc)", moneyOf(inst, "23"), 5651.82);
  check("S2 line 24 total tax (hand-calc)", moneyOf(inst, "24"), 8452.53);
  check("S2 engine pre-credit liability ties line 24 + line 21", ret.federalTaxLiability, 12452.53);
  check("S2 line 25d withholding", moneyOf(inst, "25d"), 9000);
  check("S2 line 32 refundable credits (ACTC $0 — CTC fully nonrefundable)", moneyOf(inst, "32"), 0);
  check("S2 line 33 total payments", moneyOf(inst, "33"), 9000);
  check("S2 line 34 refund (hand-calc $547.47)", moneyOf(inst, "34"), 547.47);
  checkTrue("S2: owed line 37 absent on a refund return", findLine(inst, "37") === undefined);
  checkTrue("S2: zero line 28 ACTC omitted", findLine(inst, "28") === undefined);
  assertAllTie("S2", inst);
}

// ─────────────────────────────────────────────────────────────────────────────
// S3 — Single investor: W-2 $100,000 ($15,000 withheld), 1099-DIV box 1a
//      $10,000 ALL qualified (box 1b $10,000), 1099-B long-term gain $30,000.
//
// Hand-calc (Qualified Dividends & Capital Gain Tax Worksheet, TY2024):
//   AGI = 100,000 + 10,000 + 30,000 = $140,000; taxable = 140,000 − 14,600
//       = $125,400
//   Preferential amount = LTCG 30,000 + QDIV 10,000 = $40,000
//   Ordinary portion = 125,400 − 40,000 = $85,400
//     Tax: 1,160 + 4,266 + (85,400 − 47,150) × 22% = 1,160 + 4,266 + 8,415
//        = $13,841.00
//   LTCG stacking: 0% bracket tops at $47,025 (single 2024) — fully consumed
//     by the $85,400 ordinary base → all $40,000 at 15% = $6,000.00
//   line 16 = 13,841 + 6,000 = $19,841.00  (vs all-ordinary $23,138.50 —
//     worksheet takes the smaller)
//   line 24 = $19,841 (no NIIT: MAGI 140k < 200k);  owed = 19,841 − 15,000
//           = $4,841.00
// ─────────────────────────────────────────────────────────────────────────────
{
  const inputs: TaxReturnInputs = {
    client: client(),
    w2s: [
      {
        taxYear: 2024,
        wagesBox1: 100000,
        federalTaxWithheldBox2: 15000,
        socialSecurityWagesBox3: 100000,
        medicareWagesBox5: 100000,
        stateCode: "FL",
      },
    ],
    form1099s: [
      {
        taxYear: 2024,
        formType: "div",
        payerName: "Vanguard",
        ordinaryDividends: 10000, // box 1a (includes qualified)
        qualifiedDividends: 10000, // box 1b
      },
      { taxYear: 2024, formType: "b", payerName: "Schwab", longTermGainLoss: 30000 },
    ],
    adjustments: [],
    taxYear: 2024,
  };
  const { ret, inst } = buildFor(inputs);

  check("S3 line 1a wages", moneyOf(inst, "1a"), 100000);
  check("S3 line 3a qualified dividends (info)", moneyOf(inst, "3a"), 10000);
  check("S3 line 3b ordinary dividends = box 1a total", moneyOf(inst, "3b"), 10000);
  check("S3 line 7 capital gain (Sch D line 16)", moneyOf(inst, "7"), 30000);
  check("S3 line 9 total income", moneyOf(inst, "9"), 140000);
  checkTrue("S3: zero line 8 omitted (QDIV fully on 3b, not residual)", findLine(inst, "8") === undefined);
  check("S3 line 11 AGI", moneyOf(inst, "11"), 140000);
  check("S3 line 15 taxable income", moneyOf(inst, "15"), 125400);
  check("S3 line 16 QDCGT worksheet tax (hand-calc $19,841)", moneyOf(inst, "16"), 19841);
  check("S3 engine preferential-rate tax (hand-calc $6,000 at 15%)", ret.capitalGainsTax, 6000);
  checkStr(
    "S3 line 16 note discloses the preferential tax inside the line",
    findLine(inst, "16")?.note ?? "",
    "$6,000.00",
  );
  check("S3 line 22", moneyOf(inst, "22"), 19841);
  check("S3 line 23 other taxes (no NIIT below $200k MAGI)", moneyOf(inst, "23"), 0);
  check("S3 line 24 total tax", moneyOf(inst, "24"), 19841);
  check("S3 line 33 total payments", moneyOf(inst, "33"), 15000);
  check("S3 line 37 amount owed (hand-calc $4,841)", moneyOf(inst, "37"), 4841);
  assertAllTie("S3", inst);
}

// ─────────────────────────────────────────────────────────────────────────────
// S4 — Retiree, single, age 70: Social Security $20,000 + 1099-R $30,000
//      (code 7 normal distribution, $3,000 withheld).
//
// Hand-calc (Pub 915 Worksheet 1 + §63(f)):
//   Provisional income = 30,000 + ½ × 20,000 = $40,000 > $34,000 (85% tier)
//   50%-zone piece = min(½ × 20,000, ½ × (34,000 − 25,000)) = min(10,000, 4,500)
//                  = 4,500
//   Taxable SS = min(0.85 × 20,000 = 17,000,
//                    0.85 × (40,000 − 34,000) + 4,500 = 5,100 + 4,500 = 9,600)
//              = $9,600  (line 6b)
//   Total income = 30,000 + 9,600 = $39,600
//   Std deduction = 14,600 + $1,950 age-65 add-on (single, Rev. Proc. 2023-34)
//                 = $16,550
//   Taxable = 39,600 − 16,550 = $23,050
//   Tax = 1,160 + (23,050 − 11,600) × 12% = 1,160 + 1,374 = $2,534.00
//   Withheld 3,000 → refund = 3,000 − 2,534 = $466.00
// ─────────────────────────────────────────────────────────────────────────────
{
  const inputs: TaxReturnInputs = {
    client: client({ taxpayerAge: 70, socialSecurityBenefits: 20000 }),
    w2s: [],
    form1099s: [
      {
        taxYear: 2024,
        formType: "r",
        payerName: "Fidelity IRA",
        grossDistribution: 30000,
        taxableAmount: 30000,
        distributionCode: "7",
        federalTaxWithheld: 3000,
      },
    ],
    adjustments: [],
    taxYear: 2024,
  };
  const { inst } = buildFor(inputs);

  check("S4 line 4b/5b retirement distributions", moneyOf(inst, "4b/5b"), 30000);
  check("S4 line 6a gross SS (info)", moneyOf(inst, "6a"), 20000);
  check("S4 line 6b taxable SS (hand-calc Pub 915 $9,600)", moneyOf(inst, "6b"), 9600);
  check("S4 line 9 total income", moneyOf(inst, "9"), 39600);
  check("S4 line 12 std deduction incl. $1,950 age-65 add-on", moneyOf(inst, "12"), 16550);
  check("S4 line 15 taxable income (hand-calc)", moneyOf(inst, "15"), 23050);
  check("S4 line 16 tax (hand-calc $2,534)", moneyOf(inst, "16"), 2534);
  check("S4 line 23 (code-7 distribution — no §72(t) penalty)", moneyOf(inst, "23"), 0);
  check("S4 line 24 total tax", moneyOf(inst, "24"), 2534);
  check("S4 line 25b 1099 withholding", moneyOf(inst, "25b"), 3000);
  check("S4 line 25d total withholding", moneyOf(inst, "25d"), 3000);
  check("S4 line 34 refund (hand-calc $466)", moneyOf(inst, "34"), 466);
  checkTrue("S4: line 1a omitted (no W-2s)", findLine(inst, "1a") === undefined);
  assertAllTie("S4", inst);
}

// ─────────────────────────────────────────────────────────────────────────────
// S5 — Empty return: the 1040 is the one form that is ALWAYS applicable.
//      Structural totals must still render (at zero); every identity ties.
// ─────────────────────────────────────────────────────────────────────────────
{
  const inputs: TaxReturnInputs = {
    client: client(),
    w2s: [],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const { inst } = buildFor(inputs);

  checkTrue("S5: builder returns non-null on an EMPTY return (never null)", inst != null);
  check("S5 line 9 total income renders at 0", moneyOf(inst, "9"), 0);
  check("S5 line 15 taxable income renders at 0", moneyOf(inst, "15"), 0);
  check("S5 line 24 total tax renders at 0", moneyOf(inst, "24"), 0);
  check("S5 line 33 total payments renders at 0", moneyOf(inst, "33"), 0);
  check("S5 line 34 refund renders at 0", moneyOf(inst, "34"), 0);
  checkTrue("S5: zero line 1a omitted", findLine(inst, "1a") === undefined);
  assertAllTie("S5", inst);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\nT2.1 workpaper — Form 1040 builder (core-1040):`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) FAIL.forEach((f) => console.log(`  ${f}`));
process.exit(FAIL.length > 0 ? 1 : 0);
