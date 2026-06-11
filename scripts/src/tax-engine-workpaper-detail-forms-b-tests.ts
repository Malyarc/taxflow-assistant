/**
 * T2.1 — Workpaper builders, group "detail-forms-b":
 *   Form 2555 (FEIE §911) / Form 7206 (SEHI §162(l)) /
 *   Form 8283 (noncash charitable) / Form 4797 (§1231/§1245/§1250).
 *
 * Every headline dollar value is HAND-CALC'D against the IRS published rule
 * (citations inline); engine-identity tie rows are the only assertions that
 * compare back to engine output (that is the workpaper's job). Pure engine —
 * no API required.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-workpaper-detail-forms-b-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { buildForm2555 } from "../../artifacts/api-server/src/lib/forms/form2555Spec";
import { buildForm7206 } from "../../artifacts/api-server/src/lib/forms/form7206Spec";
import { buildForm8283 } from "../../artifacts/api-server/src/lib/forms/form8283Spec";
import { buildForm4797Form } from "../../artifacts/api-server/src/lib/forms/form4797Spec";
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
function checkStr(label: string, actual: string | null | undefined, expected: string): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected "${expected}", got "${actual}"`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

// ── form-instance probes ─────────────────────────────────────────────────────
const allLines = (inst: FormInstance): FormLine[] => inst.parts.flatMap((p) => p.lines);
/** First line matching the official line number (+ optional label fragment). */
const findLine = (inst: FormInstance, lineNo: string, frag?: string): FormLine | undefined =>
  allLines(inst).find((l) => l.line === lineNo && (!frag || l.label.includes(frag)));
/** Numeric value of a line; NaN when missing/non-numeric (fails check loudly). */
const lineVal = (inst: FormInstance, lineNo: string, frag?: string): number => {
  const l = findLine(inst, lineNo, frag);
  return l && typeof l.value === "number" ? l.value : NaN;
};
const findByLabel = (inst: FormInstance, frag: string): FormLine | undefined =>
  allLines(inst).find((l) => l.label.includes(frag));
const labelVal = (inst: FormInstance, frag: string): number => {
  const l = findByLabel(inst, frag);
  return l && typeof l.value === "number" ? l.value : NaN;
};
/** True when the ✓/⚠ check row containing `frag` reports "ties". */
const tieOk = (inst: FormInstance, frag: string): boolean => {
  const l = findByLabel(inst, frag);
  return !!l && l.value === "ties" && l.label.startsWith("✓");
};

// ── input construction (minimal Fact-shaped literals; engine is structural) ──
function mkInputs(opts: {
  filingStatus?: string;
  state?: string;
  taxYear?: number;
  wages?: number;
  adjustments?: Array<{ adjustmentType: string; amount: number }>;
  form4797?: TaxReturnInputs["form4797"];
}): TaxReturnInputs {
  const taxYear = opts.taxYear ?? 2024;
  const wages = opts.wages ?? 0;
  const state = opts.state ?? "FL";
  return {
    client: {
      filingStatus: opts.filingStatus ?? "single",
      state,
      taxYear,
      taxpayerAge: 45,
      dependentsUnder17: 0,
      otherDependents: 0,
    },
    w2s:
      wages > 0
        ? [{ taxYear, wagesBox1: wages, socialSecurityWagesBox3: wages, medicareWagesBox5: wages, stateCode: state }]
        : [],
    form1099s: [],
    adjustments: (opts.adjustments ?? []).map((a) => ({ ...a, isApplied: true })),
    ...(opts.form4797 ? { form4797: opts.form4797 } : {}),
    taxYear,
  };
}
const taxpayer = (filingStatus = "single", state = "FL"): WorkpaperTaxpayer => ({
  firstName: "Test",
  lastName: "Client",
  filingStatus,
  state,
});
function ctxOf(inputs: TaxReturnInputs) {
  const ret = computeTaxReturnPure(inputs);
  const ctx: FormBuildContext = { taxpayer: taxpayer(inputs.client.filingStatus, inputs.client.state ?? "FL"), ret, inputs };
  return { ret, ctx };
}

// ═════════════════════════════════════════════════════════════════════════════
// FORM 2555 — Foreign Earned Income Exclusion (§911)
// ═════════════════════════════════════════════════════════════════════════════

// Scenario A — single expat, TY2024, $150,000 foreign earned income, FL, no W-2.
// Hand-calc (IRC §911(b)(2)(D); Rev. Proc. 2023-34 TY2024 cap $126,500):
//   exclusion       = min(150,000, 126,500) = 126,500
//   over-cap in AGI = 150,000 − 126,500     =  23,500
//   AGI             = 23,500 (no other income / above-the-line)
//   taxable         = 23,500 − 14,600 std ded (single, Rev. Proc. 2023-34) = 8,900
//   STACKING RULE (Foreign Earned Income Tax Worksheet, 1040 instructions):
//     tax = tax(8,900 + 126,500) − tax(126,500)   [2024 single brackets:
//       10% ≤ 11,600; 12% ≤ 47,150; 22% ≤ 100,525; 24% ≤ 191,950]
//     tax(135,400) = 1,160 + 35,550·.12 + 53,375·.22 + 34,875·.24
//                  = 1,160 + 4,266 + 11,742.50 + 8,370   = 25,538.50
//     tax(126,500) = 1,160 + 4,266 + 11,742.50 + 25,975·.24 = 23,402.50
//     stacked tax  = 25,538.50 − 23,402.50 = 2,136.00
//   (No SE / NIIT / AMT [AMTI 23,500 < 85,700 exemption] / credits → the
//    pre-credit federalTaxLiability is exactly the stacked income tax.)
{
  const { ret, ctx } = ctxOf(
    mkInputs({ adjustments: [{ adjustmentType: "foreign_earned_income", amount: 150000 }] }),
  );
  check("2555-A engine total exclusion = $126,500 (TY2024 cap)", ret.feie.totalExclusion, 126500);
  check("2555-A AGI = $23,500 (only the over-cap remainder)", ret.adjustedGrossIncome, 23500);
  check("2555-A total income = $23,500 (gross in, exclusion out)", ret.totalIncome, 23500);
  check("2555-A stacked federal tax = $2,136.00 (worksheet hand-calc)", ret.federalTaxLiability, 2136.0);

  const inst = buildForm2555(ctx);
  checkTrue("2555-A builder applicable (non-null)", inst != null);
  if (inst) {
    checkStr("2555-A formNumber", inst.formNumber, "Form 2555");
    check("2555-A taxYear", inst.taxYear, 2024);
    check("2555-A line 26 foreign earned income = $150,000", lineVal(inst, "26"), 150000);
    check("2555-A line 42 exclusion = $126,500", lineVal(inst, "42"), 126500);
    check("2555-A over-cap row = $23,500", labelVal(inst, "above the cap"), 23500);
    check("2555-A line 45 to Schedule 1 = $126,500", lineVal(inst, "45"), 126500);
    check("2555-A combined line 8d = $126,500", lineVal(inst, "8d"), 126500);
    checkTrue("2555-A exclusion tie row ties", tieOk(inst, "Total exclusion"));
    checkTrue("2555-A no spouse part (2 parts: taxpayer + combined)", inst.parts.length === 2);
    checkTrue(
      "2555-A stacking-rule footnote present",
      (inst.footnotes ?? []).some((f) => f.includes("STACKING RULE")),
    );
  }
}

// Scenario B — MFJ TY2025: taxpayer $140,000 + spouse $100,000 foreign earned.
// Hand-calc (Rev. Proc. 2024-40 TY2025 cap $130,000 PER SPOUSE):
//   taxpayer exclusion = min(140,000, 130,000) = 130,000
//   spouse exclusion   = min(100,000, 130,000) = 100,000 (under cap → full)
//   total              = 230,000
//   AGI = (140,000 + 100,000) − 230,000 = 10,000
{
  const { ret, ctx } = ctxOf(
    mkInputs({
      filingStatus: "married_filing_jointly",
      taxYear: 2025,
      adjustments: [
        { adjustmentType: "foreign_earned_income", amount: 140000 },
        { adjustmentType: "foreign_earned_income_spouse", amount: 100000 },
      ],
    }),
  );
  check("2555-B engine taxpayer exclusion = $130,000 (TY2025 cap)", ret.feie.taxpayerExclusion, 130000);
  check("2555-B engine spouse exclusion = $100,000 (under cap)", ret.feie.spouseExclusion, 100000);
  check("2555-B AGI = $10,000", ret.adjustedGrossIncome, 10000);

  const inst = buildForm2555(ctx);
  checkTrue("2555-B builder applicable", inst != null);
  if (inst) {
    checkTrue("2555-B 3 parts (taxpayer + spouse + combined)", inst.parts.length === 3);
    check("2555-B taxpayer line 42 = $130,000", lineVal(inst, "42", "smaller of"), 130000);
    const spousePart = inst.parts.find((p) => (p.title ?? "").includes("Spouse"));
    checkTrue("2555-B spouse part present", spousePart != null);
    const spouse42 = spousePart?.lines.find((l) => l.line === "42");
    check("2555-B spouse line 42 = $100,000", typeof spouse42?.value === "number" ? spouse42.value : NaN, 100000);
    checkTrue(
      "2555-B spouse over-cap row absent (income fully excluded)",
      !(spousePart?.lines ?? []).some((l) => l.label.includes("above the cap")),
    );
    check("2555-B combined gross foreign income = $240,000", labelVal(inst, "Gross foreign earned income"), 240000);
    check("2555-B combined line 8d total = $230,000", lineVal(inst, "8d"), 230000);
    checkTrue("2555-B exclusion tie row ties", tieOk(inst, "Total exclusion"));
  }
}

// Scenario A-null — no foreign income → form not applicable.
{
  const { ctx } = ctxOf(mkInputs({ wages: 60000 }));
  checkTrue("2555-null gate: no FEIE → builder returns null", buildForm2555(ctx) === null);
}

// ═════════════════════════════════════════════════════════════════════════════
// FORM 7206 — Self-Employed Health Insurance Deduction (§162(l))
// ═════════════════════════════════════════════════════════════════════════════

// Scenario C — SE $60,000 + $15,000 premiums, single FL TY2024 (no W-2).
// Hand-calc (Schedule SE + Form 7206 instructions):
//   net SE earnings = 60,000 × 0.9235             = 55,410.00
//   SE tax          = 55,410 × 15.3%              =  8,477.73
//   half-SE         = 8,477.73 / 2                =  4,238.865
//   line 4 cap      = 55,410 − 4,238.865          = 51,171.135  (§162(l)(2)(A))
//   line 14         = min(15,000, 51,171.135)     = 15,000 (premiums fully allowed)
//   AGI             = 60,000 − 4,238.865 − 15,000 = 40,761.135
{
  const { ret, ctx } = ctxOf(
    mkInputs({
      adjustments: [
        { adjustmentType: "self_employment_income", amount: 60000 },
        { adjustmentType: "self_employed_health_insurance_premiums", amount: 15000 },
      ],
    }),
  );
  check("7206-C engine deduction = $15,000", ret.sehi.deduction, 15000);
  check("7206-C engine cap = $51,171.14 (55,410 − 4,238.87)", ret.sehi.earnedIncomeCap, 51171.14);
  check("7206-C AGI = $40,761.14", ret.adjustedGrossIncome, 40761.14);

  const inst = buildForm7206(ctx);
  checkTrue("7206-C builder applicable", inst != null);
  if (inst) {
    checkStr("7206-C formNumber", inst.formNumber, "Form 7206");
    check("7206-C line 1 premiums = $15,000", lineVal(inst, "1"), 15000);
    check("7206-C line 4 earned-income limit = $51,171.14", lineVal(inst, "4"), 51171.14);
    check("7206-C line 14 deduction = $15,000", lineVal(inst, "14"), 15000);
    check("7206-C line 14 == ret.sehi.deduction (identity)", lineVal(inst, "14"), ret.sehi.deduction);
    checkTrue("7206-C min(line 1, line 4) tie row ties", tieOk(inst, "min(line 1, line 4)"));
    checkTrue("7206-C excess-premium row absent (under cap)", findByLabel(inst, "above the earned-income limit") == null);
  }
}

// Scenario D — cap binds: SE $10,000 + $60,000 premiums.
// Hand-calc:
//   net SE  = 10,000 × 0.9235 = 9,235;  SE tax = 9,235 × 15.3% = 1,412.955
//   half-SE = 706.4775;  cap = 9,235 − 706.4775 = 8,528.5225
//   line 14 = min(60,000, 8,528.5225)  = 8,528.52
//   excess  = 60,000 − 8,528.5225      = 51,471.48 (NOT deductible as SEHI;
//             no carryforward — same-year Schedule A medical per §213)
//   AGI     = 10,000 − 706.4775 − 8,528.5225 = 765.00
{
  const { ret, ctx } = ctxOf(
    mkInputs({
      adjustments: [
        { adjustmentType: "self_employment_income", amount: 10000 },
        { adjustmentType: "self_employed_health_insurance_premiums", amount: 60000 },
      ],
    }),
  );
  check("7206-D engine deduction capped = $8,528.52", ret.sehi.deduction, 8528.52);
  check("7206-D AGI = $765.00", ret.adjustedGrossIncome, 765.0);

  const inst = buildForm7206(ctx);
  checkTrue("7206-D builder applicable", inst != null);
  if (inst) {
    check("7206-D line 4 cap = $8,528.52", lineVal(inst, "4"), 8528.52);
    check("7206-D line 14 = $8,528.52 (cap binds)", lineVal(inst, "14"), 8528.52);
    check("7206-D excess premiums row = $51,471.48", labelVal(inst, "above the earned-income limit"), 51471.48);
    checkTrue("7206-D min tie row ties", tieOk(inst, "min(line 1, line 4)"));
  }
}

// Scenario E — null gates.
{
  // Premiums with NO SE income → cap 0 → deduction 0 → not applicable.
  const { ctx: ctx1 } = ctxOf(
    mkInputs({
      wages: 50000,
      adjustments: [{ adjustmentType: "self_employed_health_insurance_premiums", amount: 15000 }],
    }),
  );
  checkTrue("7206-null gate: premiums but no SE earnings → null", buildForm7206(ctx1) === null);
  // No premiums at all.
  const { ctx: ctx2 } = ctxOf(mkInputs({ wages: 50000 }));
  checkTrue("7206-null gate: no premiums → null", buildForm7206(ctx2) === null);
}

// ═════════════════════════════════════════════════════════════════════════════
// FORM 8283 — Noncash Charitable Contributions
// ═════════════════════════════════════════════════════════════════════════════

// Scenario F — $5,000 appreciated-stock donation, wages $100,000, single FL.
// Hand-calc (§170(b)(1)(C) + Form 8283 instructions):
//   noncash = 5,000 (> $500 → Form 8283 required)
//   AGI = 100,000;  30% ceiling = 30,000;  50% ceiling = 50,000
//   Schedule A charitable = min(5,000, 30,000, 50,000 − 0 cash) = 5,000
//   itemized total 5,000 < 14,600 std ded → return uses STANDARD deduction
{
  const { ret, ctx } = ctxOf(
    mkInputs({ wages: 100000, adjustments: [{ adjustmentType: "charitable_property", amount: 5000 }] }),
  );
  check("8283-F engine Schedule A charitable = $5,000", ret.scheduleA.charitableDeductible, 5000);
  checkTrue("8283-F return uses standard deduction", ret.itemizedDeductions == null);

  const inst = buildForm8283(ctx);
  checkTrue("8283-F builder applicable (noncash $5,000 > $500)", inst != null);
  if (inst) {
    checkStr("8283-F formNumber", inst.formNumber, "Form 8283");
    check("8283-F line 1(h) total noncash = $5,000", lineVal(inst, "1(h)"), 5000);
    check("8283-F 30%-of-AGI ceiling = $30,000", labelVal(inst, "30%-of-AGI ceiling"), 30000);
    check("8283-F overall 50% ceiling = $50,000", labelVal(inst, "Overall 50%-of-AGI"), 50000);
    check("8283-F Schedule A charitable tie = $5,000", labelVal(inst, "Schedule A charitable deduction"), 5000);
    checkTrue("8283-F standard-deduction disclosure present", findByLabel(inst, "Deduction status") != null);
    checkTrue("8283-F Section B trigger absent ($5,000 not > $5,000)", findByLabel(inst, "Section B appraisal trigger") == null);
  }
}

// Scenario G — itemizer: cash $12,000 + property $5,000 + mortgage interest
// $9,000 on wages $100,000.
// Hand-calc (§170(b)(1) ordering inside calculateScheduleA):
//   cash deductible    = min(12,000, 60% × 100,000) = 12,000
//   property deductible= min(5,000, 30,000, 50,000 − 12,000) = 5,000
//   charitable total   = 17,000;  itemized = 12,000 + 5,000 + 9,000 = 26,000 > 14,600
{
  const { ret, ctx } = ctxOf(
    mkInputs({
      wages: 100000,
      adjustments: [
        { adjustmentType: "charitable_cash", amount: 12000 },
        { adjustmentType: "charitable_property", amount: 5000 },
        { adjustmentType: "mortgage_interest", amount: 9000 },
      ],
    }),
  );
  check("8283-G engine itemized total = $26,000", ret.itemizedDeductions ?? NaN, 26000);
  check("8283-G engine charitable (cash+noncash) = $17,000", ret.scheduleA.charitableDeductible, 17000);

  const inst = buildForm8283(ctx);
  checkTrue("8283-G builder applicable", inst != null);
  if (inst) {
    check("8283-G line 1(h) noncash only = $5,000 (cash excluded)", lineVal(inst, "1(h)"), 5000);
    check("8283-G Schedule A charitable tie = $17,000", labelVal(inst, "Schedule A charitable deduction"), 17000);
    checkTrue("8283-G standard-deduction disclosure ABSENT (itemizing)", findByLabel(inst, "Deduction status") == null);
  }
}

// Scenario I — Section B advisory: $25,000 property on wages $200,000.
// Hand-calc: noncash 25,000 > 5,000 → appraisal advisory; 30% ceiling = 60,000.
{
  const { ctx } = ctxOf(
    mkInputs({ wages: 200000, adjustments: [{ adjustmentType: "charitable_property", amount: 25000 }] }),
  );
  const inst = buildForm8283(ctx);
  checkTrue("8283-I builder applicable", inst != null);
  if (inst) {
    checkTrue("8283-I Section B appraisal advisory present (> $5,000)", findByLabel(inst, "Section B appraisal trigger") != null);
    check("8283-I 30% ceiling = $60,000", labelVal(inst, "30%-of-AGI ceiling"), 60000);
    check("8283-I line 1(h) = $25,000", lineVal(inst, "1(h)"), 25000);
  }
}

// Scenario H — null gates.
{
  // $400 donation: ≤ $500 → Form 8283 not required.
  const { ctx: ctx1 } = ctxOf(
    mkInputs({ wages: 100000, adjustments: [{ adjustmentType: "charitable_property", amount: 400 }] }),
  );
  checkTrue("8283-null gate: $400 noncash (≤ $500) → null", buildForm8283(ctx1) === null);
  // Cash-only giving → no Form 8283.
  const { ctx: ctx2 } = ctxOf(
    mkInputs({ wages: 100000, adjustments: [{ adjustmentType: "charitable_cash", amount: 10000 }] }),
  );
  checkTrue("8283-null gate: cash-only → null", buildForm8283(ctx2) === null);
  // No inputs supplied (aggregate-only context) → degrade to null.
  const { ret } = ctxOf(
    mkInputs({ wages: 100000, adjustments: [{ adjustmentType: "charitable_property", amount: 5000 }] }),
  );
  checkTrue(
    "8283-null gate: ctx without inputs → null (graceful degrade)",
    buildForm8283({ taxpayer: taxpayer(), ret }) === null,
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// FORM 4797 — Sales of Business Property (§1231 / §1245 / §1250)
// ═════════════════════════════════════════════════════════════════════════════

// Scenario J — equipment sale with §1245 recapture, wages $80,000.
// Hand-calc (Form 4797 Part III, IRC §1245(a)):
//   line 20 sales price 45,000; line 21 cost 50,000; line 22 depreciation 30,000
//   line 23 adjusted basis = 50,000 − 30,000 = 20,000
//   line 24 total gain     = 45,000 − 20,000 = 25,000
//   line 25b recapture     = min(25,000, 30,000) = 25,000 (ALL ordinary)
//   §1231 gain surviving   = 25,000 − 25,000 = 0  → line 7 = 0, line 9 = 0
//   Part II line 13 = 25,000; line 17 ordinary total = 25,000
//   AGI = 80,000 + 25,000 = 105,000; Schedule D untouched (netCapGain = 0)
{
  const { ret, ctx } = ctxOf(
    mkInputs({
      wages: 80000,
      form4797: [
        {
          taxYear: 2024,
          description: "CNC machine",
          grossSalePrice: 45000,
          costOrBasis: 50000,
          depreciationAllowed: 30000,
          assetClass: "section1245",
        },
      ],
    }),
  );
  check("4797-J engine ordinary component = $25,000", ret.form4797?.ordinaryComponent ?? NaN, 25000);
  check("4797-J engine §1245 recapture = $25,000", ret.form4797?.section1245OrdinaryRecapture ?? NaN, 25000);
  check("4797-J engine surviving §1231 LTCG = $0", ret.form4797?.netSection1231LtcgGain ?? NaN, 0);
  check("4797-J AGI = $105,000 (wages + recapture)", ret.adjustedGrossIncome, 105000);
  check("4797-J Schedule D net = $0 (no capital character)", ret.netCapitalGainLoss, 0);

  const inst = buildForm4797Form(ctx);
  checkTrue("4797-J builder applicable", inst != null);
  if (inst) {
    checkStr("4797-J formNumber", inst.formNumber, "Form 4797");
    check("4797-J line 20 sales price = $45,000", lineVal(inst, "20"), 45000);
    check("4797-J line 21 cost = $50,000", lineVal(inst, "21"), 50000);
    check("4797-J line 22 depreciation = $30,000", lineVal(inst, "22"), 30000);
    check("4797-J line 23 adjusted basis = $20,000", lineVal(inst, "23"), 20000);
    check("4797-J line 24 total gain = $25,000", lineVal(inst, "24"), 25000);
    check("4797-J line 25b §1245 recapture = $25,000", lineVal(inst, "25b"), 25000);
    check("4797-J line 30 = $25,000", lineVal(inst, "30"), 25000);
    check("4797-J line 31 = $25,000", lineVal(inst, "31"), 25000);
    check("4797-J line 32 = $0 (nothing survives to Part I)", lineVal(inst, "32"), 0);
    check("4797-J Part I line 7 = $0", lineVal(inst, "7"), 0);
    check("4797-J Part II line 13 = $25,000", lineVal(inst, "13"), 25000);
    check("4797-J Part II line 17 = $25,000", lineVal(inst, "17"), 25000);
    checkTrue("4797-J line 17 tie row ties", tieOk(inst, "Line 17 = line 10"));
    checkTrue("4797-J line 31 tie row ties", tieOk(inst, "Line 31 ties to engine recapture"));
    checkTrue("4797-J line 7 tie row ties", tieOk(inst, "Line 7 ties"));
  }
}

// Scenario K — rental building with unrecaptured §1250 (straight-line MACRS),
// wages $50,000.
// Hand-calc (Form 4797 Part III + Schedule D Unrecaptured §1250 Worksheet):
//   sale 450,000; cost 400,000; SL depreciation 100,000 (additional = 0 →
//   post-1986 MACRS realty has NO accelerated excess → line 26g = 0)
//   adjusted basis = 300,000;  total gain = 150,000
//   unrecaptured §1250 = min(gain 150,000, SL depreciation 100,000) = 100,000
//   §1231 gain = 150,000 → line 7 = 150,000 → line 9 = 150,000 → Schedule D
//   AGI = 50,000 + 150,000 = 200,000;  ordinary component = 0
{
  const { ret, ctx } = ctxOf(
    mkInputs({
      wages: 50000,
      form4797: [
        {
          taxYear: 2024,
          description: "Rental building — 12 Oak St",
          grossSalePrice: 450000,
          costOrBasis: 400000,
          depreciationAllowed: 100000,
          additionalDepreciation: 0,
          assetClass: "section1250",
        },
      ],
    }),
  );
  check("4797-K engine ordinary component = $0 (SL → no §1250 recapture)", ret.form4797?.ordinaryComponent ?? NaN, 0);
  check("4797-K engine §1231 LTCG = $150,000", ret.form4797?.netSection1231LtcgGain ?? NaN, 150000);
  check("4797-K engine form-level unrecaptured §1250 = $100,000", ret.form4797?.unrecaptured1250Gain ?? NaN, 100000);
  check("4797-K return-level §1250 bucket ties = $100,000 (sole source)", ret.unrecapturedSection1250Gain, 100000);
  check("4797-K Schedule D net = $150,000", ret.netCapitalGainLoss, 150000);
  check("4797-K AGI = $200,000", ret.adjustedGrossIncome, 200000);

  const inst = buildForm4797Form(ctx);
  checkTrue("4797-K builder applicable", inst != null);
  if (inst) {
    check("4797-K line 24 gain = $150,000", lineVal(inst, "24"), 150000);
    check("4797-K line 26g recapture = $0 (straight-line)", lineVal(inst, "26g"), 0);
    check("4797-K per-property unrecaptured memo = $100,000", labelVal(inst, "Unrecaptured §1250 gain memo"), 100000);
    check("4797-K Part I line 6 = $150,000", lineVal(inst, "6"), 150000);
    check("4797-K Part I line 7 = $150,000", lineVal(inst, "7"), 150000);
    check("4797-K Part I line 9 = $150,000 (→ Schedule D)", lineVal(inst, "9"), 150000);
    check("4797-K cross-ref form pool = $100,000", labelVal(inst, "Unrecaptured §1250 gain from this form"), 100000);
    check("4797-K cross-ref return-level bucket = $100,000", labelVal(inst, "reported on the return"), 100000);
    check("4797-K Part II line 17 = $0", lineVal(inst, "17"), 0);
    checkTrue("4797-K line 17 tie row ties", tieOk(inst, "Line 17 = line 10"));
    checkTrue(
      "4797-K NIIT conservative-inclusion note present (not flagged nonPassive)",
      findByLabel(inst, "NIIT treatment of the §1231 gain") != null,
    );
  }
}

// Scenario L — combined: equipment (§1245) + building (§1250) + land LOSS +
// short-term equipment + §1231(c) lookback $40,000, wages $100,000.
// Hand-calc:
//   equipment: gain 25,000 → recapture 25,000, §1231 0          (as in J)
//   building : gain 150,000 → recapture 0, §1231 150,000,
//              unrecaptured pool min(150,000, 100,000) = 100,000 (as in K)
//   land     : 80,000 − 100,000 = (20,000) §1231 loss → Part I line 2
//   short-term equip: 30,000 − 25,000 = 5,000 ordinary → Part II line 10
//   line 7 net §1231 = 150,000 − 20,000 = 130,000
//   line 8 lookback applied = min(130,000, 40,000) = 40,000 → ordinary
//   line 9 §1231 LTCG = 90,000 → Schedule D
//   unrecaptured §1250 (RE-DERIVED 2026-06-11, T1.0c #6 — Notice 97-59 +
//     Reg. §1.453-12 Ex. 3: the §1231(c)-recharacterized ordinary amount comes
//     FIRST from 28%-rate gain [none here], THEN from the unrecaptured-§1250
//     25% pool, and only then from 0/15/20 gain — so the $40,000 recapture
//     ABSORBS the 25% pool before the regular gain):
//     = min(max(0, pool 100,000 − recapture 40,000), surviving LTCG 90,000)
//     = min(60,000, 90,000) = 60,000
//     (surviving 90,000 = 60,000 @25% + 30,000 @0/15/20; prior expectation
//     kept the full 90,000 in the 25% pool — over-tax by 25%−15% on $30k)
//   Part II line 17 = 5,000 + 40,000 + 25,000 = 70,000
//   AGI = 100,000 + 70,000 + 90,000 = 260,000
{
  const inputs = mkInputs({
    wages: 100000,
    adjustments: [{ adjustmentType: "section_1231_lookback_loss", amount: 40000 }],
    form4797: [
      { taxYear: 2024, description: "CNC machine", grossSalePrice: 45000, costOrBasis: 50000, depreciationAllowed: 30000, assetClass: "section1245" },
      { taxYear: 2024, description: "Rental building — 12 Oak St", grossSalePrice: 450000, costOrBasis: 400000, depreciationAllowed: 100000, additionalDepreciation: 0, assetClass: "section1250" },
      { taxYear: 2024, description: "Adjacent lot", grossSalePrice: 80000, costOrBasis: 100000, depreciationAllowed: 0, assetClass: "land" },
      { taxYear: 2024, description: "Forklift (held 8 months)", grossSalePrice: 30000, costOrBasis: 25000, depreciationAllowed: 0, assetClass: "section1245", heldMoreThanOneYear: false },
    ],
  });
  const { ret, ctx } = ctxOf(inputs);
  check("4797-L engine net §1231 = $130,000", ret.form4797?.netSection1231 ?? NaN, 130000);
  check("4797-L engine lookback recapture = $40,000", ret.form4797?.section1231LookbackRecapture ?? NaN, 40000);
  check("4797-L engine §1231 LTCG = $90,000", ret.form4797?.netSection1231LtcgGain ?? NaN, 90000);
  check("4797-L engine ordinary component = $70,000", ret.form4797?.ordinaryComponent ?? NaN, 70000);
  check("4797-L engine unrecaptured §1250 = $60,000 (pool − §1231(c) recapture, Notice 97-59)", ret.form4797?.unrecaptured1250Gain ?? NaN, 60000);
  check("4797-L return-level §1250 bucket = $60,000", ret.unrecapturedSection1250Gain, 60000);
  check("4797-L Part II short-term = $5,000", ret.form4797?.partIIOrdinary ?? NaN, 5000);
  check("4797-L Schedule D net = $90,000", ret.netCapitalGainLoss, 90000);
  check("4797-L AGI = $260,000", ret.adjustedGrossIncome, 260000);

  const inst = buildForm4797Form(ctx);
  checkTrue("4797-L builder applicable", inst != null);
  if (inst) {
    check("4797-L land loss row on line 2 = −$20,000", lineVal(inst, "2", "Adjacent lot"), -20000);
    check("4797-L Part I line 6 = $150,000", lineVal(inst, "6"), 150000);
    check("4797-L Part I line 7 = $130,000", lineVal(inst, "7"), 130000);
    check("4797-L Part I line 8 lookback = $40,000", lineVal(inst, "8"), 40000);
    check("4797-L Part I line 9 = $90,000", lineVal(inst, "9"), 90000);
    check("4797-L Part II line 10 short-term = $5,000", lineVal(inst, "10"), 5000);
    check("4797-L Part II line 12 lookback ordinary = $40,000", lineVal(inst, "12"), 40000);
    check("4797-L Part II line 13 recapture = $25,000", lineVal(inst, "13"), 25000);
    check("4797-L Part II line 17 = $70,000", lineVal(inst, "17"), 70000);
    check("4797-L Part III line 30 = $175,000 (25k + 150k gains)", lineVal(inst, "30"), 175000);
    check("4797-L Part III line 31 = $25,000", lineVal(inst, "31"), 25000);
    check("4797-L Part III line 32 = $150,000", lineVal(inst, "32"), 150000);
    check("4797-L cross-ref form pool (post-lookback) = $60,000", labelVal(inst, "Unrecaptured §1250 gain from this form"), 60000);
    checkTrue("4797-L line 7 tie row ties", tieOk(inst, "Line 7 ties"));
    checkTrue("4797-L line 17 tie row ties", tieOk(inst, "Line 17 = line 10"));
    checkTrue("4797-L line 31 tie row ties", tieOk(inst, "Line 31 ties to engine recapture"));
  }

  // Degrade gracefully: same return, ctx WITHOUT inputs → aggregate-only form.
  const instAgg = buildForm4797Form({ taxpayer: taxpayer(), ret });
  checkTrue("4797-L aggregate mode (no inputs) still builds", instAgg != null);
  if (instAgg) {
    check("4797-L agg combined §1231 gains row = $150,000", lineVal(instAgg, "2/6"), 150000);
    check("4797-L agg §1231 losses row = −$20,000", lineVal(instAgg, "2", "losses"), -20000);
    check("4797-L agg line 7 = $130,000", lineVal(instAgg, "7"), 130000);
    check("4797-L agg line 17 = $70,000", lineVal(instAgg, "17"), 70000);
    check("4797-L agg §1245 recapture aggregate = $25,000", lineVal(instAgg, "25b"), 25000);
    checkTrue("4797-L agg line 17 tie row still ties", tieOk(instAgg, "Line 17 = line 10"));
    checkTrue("4797-L agg has no per-property line 20 rows", findLine(instAgg, "20") == null);
  }
}

// Scenario M — §1250 unrecaptured CAPPED AT GAIN: sold below cost but above
// depreciated basis. Wages $60,000.
// Hand-calc: cost 300,000, depreciation 120,000 → basis 180,000; sale 200,000
//   gain = 20,000;  unrecaptured §1250 = min(20,000, 120,000) = 20,000
//   (the ENTIRE gain is 25%-bucket; nothing at 0/15/20)
//   AGI = 60,000 + 20,000 = 80,000
{
  const { ret, ctx } = ctxOf(
    mkInputs({
      wages: 60000,
      form4797: [
        {
          taxYear: 2024,
          description: "Duplex — 9 Elm Ave",
          grossSalePrice: 200000,
          costOrBasis: 300000,
          depreciationAllowed: 120000,
          additionalDepreciation: 0,
          assetClass: "section1250",
        },
      ],
    }),
  );
  check("4797-M engine §1231 LTCG = $20,000", ret.form4797?.netSection1231LtcgGain ?? NaN, 20000);
  check("4797-M unrecaptured §1250 capped at gain = $20,000", ret.form4797?.unrecaptured1250Gain ?? NaN, 20000);
  check("4797-M return-level §1250 bucket = $20,000", ret.unrecapturedSection1250Gain, 20000);
  check("4797-M AGI = $80,000", ret.adjustedGrossIncome, 80000);
  const inst = buildForm4797Form(ctx);
  if (inst) {
    check("4797-M per-property memo capped at gain = $20,000", labelVal(inst, "Unrecaptured §1250 gain memo"), 20000);
    check("4797-M line 24 = $20,000", lineVal(inst, "24"), 20000);
  } else {
    FAIL.push("✗ 4797-M builder unexpectedly null");
  }
}

// Scenario N — nonPassive flag: NIIT-exclusion info row.
{
  const { ret, ctx } = ctxOf(
    mkInputs({
      wages: 50000,
      form4797: [
        {
          taxYear: 2024,
          description: "Owner-operated warehouse",
          grossSalePrice: 450000,
          costOrBasis: 400000,
          depreciationAllowed: 100000,
          additionalDepreciation: 0,
          assetClass: "section1250",
          nonPassive: true,
        },
      ],
    }),
  );
  check("4797-N engine non-passive §1231 gain = $150,000", ret.form4797?.nonPassiveSection1231Gain ?? NaN, 150000);
  const inst = buildForm4797Form(ctx);
  if (inst) {
    check("4797-N NIIT-exclusion row = $150,000", labelVal(inst, "EXCLUDED from the §1411 NIIT base"), 150000);
    checkTrue(
      "4797-N conservative-inclusion note absent (flagged nonPassive)",
      findByLabel(inst, "NIIT treatment of the §1231 gain") == null,
    );
  } else {
    FAIL.push("✗ 4797-N builder unexpectedly null");
  }
}

// Scenario Q — pure net §1231 LOSS (land sold at a loss): fully ORDINARY,
// no $3,000 capital-loss cap. Wages $60,000.
// Hand-calc: 80,000 − 100,000 = (20,000) → line 7 = (20,000) → Part II line 11
//   ordinary component = −20,000;  AGI = 60,000 − 20,000 = 40,000
{
  const { ret, ctx } = ctxOf(
    mkInputs({
      wages: 60000,
      form4797: [
        { taxYear: 2024, description: "Vacant parcel", grossSalePrice: 80000, costOrBasis: 100000, depreciationAllowed: 0, assetClass: "land" },
      ],
    }),
  );
  check("4797-Q engine ordinary component = −$20,000 (full, no $3k cap)", ret.form4797?.ordinaryComponent ?? NaN, -20000);
  check("4797-Q AGI = $40,000", ret.adjustedGrossIncome, 40000);
  check("4797-Q Schedule D net untouched = $0", ret.netCapitalGainLoss, 0);
  const inst = buildForm4797Form(ctx);
  if (inst) {
    check("4797-Q Part I line 7 = −$20,000", lineVal(inst, "7"), -20000);
    check("4797-Q Part I line 9 = $0 (loss → ordinary, not Schedule D)", lineVal(inst, "9"), 0);
    check("4797-Q Part II line 11 = −$20,000", lineVal(inst, "11"), -20000);
    check("4797-Q Part II line 17 = −$20,000", lineVal(inst, "17"), -20000);
    checkTrue("4797-Q line 17 tie row ties", tieOk(inst, "Line 17 = line 10"));
    checkTrue(
      "4797-Q no-$3k-cap note present on line 11",
      (findLine(inst, "11")?.note ?? "").includes("$3,000"),
    );
  } else {
    FAIL.push("✗ 4797-Q builder unexpectedly null");
  }
}

// Scenario O — null gate: no business-property dispositions.
{
  const { ret, ctx } = ctxOf(mkInputs({ wages: 60000 }));
  checkTrue("4797-null gate: engine form4797 is null", ret.form4797 === null);
  checkTrue("4797-null gate: builder returns null", buildForm4797Form(ctx) === null);
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log("\nT2.1 workpaper builders — detail-forms-b (2555 / 7206 / 8283 / 4797):");
for (const f of FAIL) console.log(`  ${f}`);
console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length > 0 ? 1 : 0);
