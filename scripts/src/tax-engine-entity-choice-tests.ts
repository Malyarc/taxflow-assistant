/**
 * T2.2 D1 — Entity-choice / S-corp reasonable-comp calculator tests.
 *
 * Pure (no API). HAND-CALC'D against the 2024/2025 SS wage bases, FUTA net
 * 0.6% × $7,000, the 2024 single brackets, and the engine's §199A pipeline
 * (Sch C QBI = net SE − ½SE; K-1 QBI = supplied; income cap = 20% × taxable
 * before QBI; SSTB zero above the band).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-entity-choice-tests.ts
 */

import type { TaxReturnInputs } from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { computeTaxReturnPure } from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  analyzeEntityChoice,
  employerPayrollTaxes,
  employeeFicaOnWages,
} from "../../artifacts/api-server/src/lib/entityChoice";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1.0): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

function analyze(inputs: TaxReturnInputs, reasonableComp?: number) {
  const ret = computeTaxReturnPure(inputs);
  return analyzeEntityChoice({ baselineInputs: inputs, baselineReturn: ret, reasonableComp });
}

// ════════════════════════════════════════════════════════════════════════════
// P1 — Payroll formulas, exact (the statutory adders outside the engine).
//   TY2024 SS base $168,600; TY2025 $176,100. FUTA net = 0.6% × min(W, 7,000).
// ════════════════════════════════════════════════════════════════════════════
{
  // W=$80,000 (under the base): ER = 6.2%×80,000 + 1.45%×80,000 = 4,960+1,160.
  const p1 = employerPayrollTaxes(80_000, 2024);
  check("P1 employer FICA $80k/2024 = $6,120", p1.employerFica, 6120, 0.005);
  check("P1 FUTA $80k = $42", p1.futa, 42, 0.005);
  // W=$200,000 over the 2025 base: 6.2%×176,100 + 1.45%×200,000 = 10,918.20+2,900.
  const p2 = employerPayrollTaxes(200_000, 2025);
  check("P1 employer FICA $200k/2025 = $13,818.20", p2.employerFica, 13818.2, 0.005);
  check("P1 FUTA capped at $42", p2.futa, 42, 0.005);
  // W under the FUTA cap: 0.6% × 5,000 = $30.
  check("P1 FUTA $5k wages = $30", employerPayrollTaxes(5_000, 2024).futa, 30, 0.005);

  // Employee side — no other W-2: 6.2%+1.45% on $80k = $6,120.
  check("P1 employee FICA $80k, no other W-2 = $6,120", employeeFicaOnWages(80_000, 2024, 0), 6120, 0.005);
  // Other W-2 already at the 2024 base → SS room 0; Medicare-only = 1.45%×80k.
  check("P1 employee FICA, other W-2 at base = $1,160 (Medicare only)",
    employeeFicaOnWages(80_000, 2024, 168_600), 1160, 0.005);
  // Partial room (2025): other SS wages $100k → room $76,100 → 6.2%×76,100 +
  // 1.45%×200,000 = 4,718.20 + 2,900 = 7,618.20.
  check("P1 employee FICA $200k/2025, $100k other = $7,618.20",
    employeeFicaOnWages(200_000, 2025, 100_000), 7618.2, 0.005);
}

// ════════════════════════════════════════════════════════════════════════════
// E1 — Single, FL, TY2024, $200,000 1099-NEC, comp $80,000. FULL HAND-CALC.
//  SOLE PROP: net SE earnings 200,000×.9235=184,700; SS 168,600×12.4%=20,906.40;
//   Medicare 184,700×2.9%=5,356.30 → SE tax 26,262.70 (½ = 13,131.35).
//   AGI 186,868.65; std 14,600 → 172,268.65 pre-QBI. QBI base 186,868.65 → 20%
//   = 37,373.73 vs income cap 20%×172,268.65 = 34,453.73 → QBI 34,453.73.
//   Taxable 137,814.92 → tax 1,160+4,266+11,742.50+(37,289.92×24%)=26,118.08.
//   Net tax = 26,118.08 + 26,262.70 = 52,380.78.
//  S-CORP @ $80k: ER FICA 6,120, FUTA 42 → Box 1 = 200,000−80,000−6,120−42 =
//   113,838. Income 193,838 (no SE); std 14,600 → 179,238 pre-QBI; QBI 20%×
//   113,838 = 22,767.60 (under the 191,950 threshold → no wage limit; cap
//   35,847.60 not binding). Taxable 156,470.40 → tax 17,168.50 +
//   55,945.40×24% = 30,595.40. EE FICA 6,120.
//   Total S-corp cost = 30,595.40+6,120+42+6,120 = 42,877.40.
//   Savings = 52,380.78 − 42,877.40 = 9,503.38.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 200_000 }],
    adjustments: [],
    taxYear: 2024,
  };
  const r = analyze(inputs, 80_000);
  checkTrue("E1 applicable", r.applicable);
  check("E1 business profit $200,000", r.businessProfit, 200_000, 0.005);
  check("E1 sole-prop SE tax $26,262.70", r.soleProp.selfEmploymentTax, 26262.7, 0.01);
  check("E1 sole-prop QBI $34,453.73", r.soleProp.qbiDeduction, 34453.73, 0.01);
  check("E1 sole-prop net tax $52,380.78", r.soleProp.netTaxAfterCredits, 52380.78, 0.01);
  check("E1 one option (explicit comp)", r.options.length, 1, 0);
  const o = r.options[0];
  check("E1 employer FICA $6,120", o.employerFica, 6120, 0.005);
  check("E1 FUTA $42", o.futa, 42, 0.005);
  check("E1 employee FICA $6,120", o.employeeFica, 6120, 0.005);
  check("E1 S-corp Box 1 $113,838", o.sCorpOrdinaryIncome, 113_838, 0.005);
  check("E1 scenario AGI $193,838", o.scenario.adjustedGrossIncome, 193_838, 0.01);
  check("E1 scenario QBI $22,767.60", o.scenario.qbiDeduction, 22767.6, 0.01);
  check("E1 scenario taxable $156,470.40", o.scenario.taxableIncome, 156470.4, 0.01);
  check("E1 scenario SE tax $0 (no Sch C left)", o.scenario.selfEmploymentTax, 0, 0.005);
  check("E1 scenario engine net tax $30,595.40", o.engineNetTaxAfterCredits, 30595.4, 0.01);
  check("E1 total S-corp cost $42,877.40", o.totalCost, 42877.4, 0.01);
  check("E1 savings $9,503.38", o.savingsVsSoleProp, 9503.38, 0.02);
  // Cost identity — totalCost is exactly its four disclosed parts.
  check("E1 totalCost = engine + ER + FUTA + EE",
    o.totalCost, o.engineNetTaxAfterCredits + o.employerFica + o.futa + o.employeeFica, 0.011);
}

// ════════════════════════════════════════════════════════════════════════════
// E2 — Default sweep at $200k profit → comp levels 35/50/60% = $70k/$100k/$120k.
//   Box 1 per level: 70k → 200,000−70,000−(4,340+1,015)−42 = 124,603
//                    100k → 200,000−100,000−(6,200+1,450)−42 = 92,308
//                    120k → 200,000−120,000−(7,440+1,740)−42 = 70,778
//   Lower comp = less FICA + more QBI → the $70k level is the cheapest.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 200_000 }],
    adjustments: [],
    taxYear: 2024,
  };
  const r = analyze(inputs);
  check("E2 three sweep levels", r.options.length, 3, 0);
  check("E2 level 1 = $70,000", r.options[0].reasonableComp, 70_000, 0);
  check("E2 level 2 = $100,000", r.options[1].reasonableComp, 100_000, 0);
  check("E2 level 3 = $120,000", r.options[2].reasonableComp, 120_000, 0);
  check("E2 Box 1 @ $70k = $124,603", r.options[0].sCorpOrdinaryIncome, 124_603, 0.005);
  check("E2 Box 1 @ $100k = $92,308", r.options[1].sCorpOrdinaryIncome, 92_308, 0.005);
  check("E2 Box 1 @ $120k = $70,778", r.options[2].sCorpOrdinaryIncome, 70_778, 0.005);
  checkTrue("E2 best option exists", r.bestOption != null);
  check("E2 best = lowest comp ($70k)", r.bestOption!.reasonableComp, 70_000, 0);
  checkTrue("E2 cost increases with comp",
    r.options[0].totalCost < r.options[1].totalCost && r.options[1].totalCost < r.options[2].totalCost);
  checkTrue("E2 assumptions disclose Rev. Rul. 74-44",
    r.assumptions.some((a) => a.includes("Rev. Rul. 74-44")));
}

// ════════════════════════════════════════════════════════════════════════════
// E3 — Suppression cases.
// ════════════════════════════════════════════════════════════════════════════
{
  // No SE income at all.
  const noSe = analyze({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 90_000 }],
    form1099s: [], adjustments: [], taxYear: 2024,
  });
  checkTrue("E3 pure W-2 → not applicable", !noSe.applicable);

  // Profit below the $10k floor.
  const small = analyze({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 8_000 }],
    adjustments: [], taxYear: 2024,
  });
  checkTrue("E3 $8k profit → not applicable (floor)", !small.applicable);

  // Expenses eat the profit below the floor: 60k − 55k = 5k.
  const eaten = analyze({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 60_000 }],
    adjustments: [{ adjustmentType: "schedule_c_expenses", amount: 55_000, isApplied: true }],
    taxYear: 2024,
  });
  checkTrue("E3 expenses → $5k net → not applicable", !eaten.applicable);

  // MFJ with SE tagged to BOTH spouses → decline.
  const mixed = analyze({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [
      { taxYear: 2024, formType: "nec", nonemployeeCompensation: 80_000, spouse: "taxpayer" },
      { taxYear: 2024, formType: "nec", nonemployeeCompensation: 60_000, spouse: "spouse" },
    ],
    adjustments: [], taxYear: 2024,
  });
  checkTrue("E3 mixed-spouse SE → not applicable", !mixed.applicable);
  checkTrue("E3 mixed-spouse reason mentions spouses", (mixed.reason ?? "").includes("spouse"));

  // SE optional method elected → decline.
  const optional = analyze({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 50_000 }],
    adjustments: [{ adjustmentType: "se_optional_method_nonfarm", amount: 6_000, isApplied: true }],
    taxYear: 2024,
  });
  checkTrue("E3 optional method → not applicable", !optional.applicable);

  // Comp at/above profit → no modelable level.
  const overpaid = analyze({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 50_000 }],
    adjustments: [], taxYear: 2024,
  }, 50_000);
  checkTrue("E3 comp ≥ profit → not applicable", !overpaid.applicable);
}

// ════════════════════════════════════════════════════════════════════════════
// E4 — Profit composition: NEC + SE adjustment − expenses − manual depreciation.
//   P = 120,000 + 30,000 − 20,000 − 10,000 = 120,000.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = analyze({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 120_000 }],
    adjustments: [
      { adjustmentType: "self_employment_income", amount: 30_000, isApplied: true },
      { adjustmentType: "schedule_c_expenses", amount: 20_000, isApplied: true },
      { adjustmentType: "schedule_c_depreciation", amount: 10_000, isApplied: true },
    ],
    taxYear: 2024,
  }, 60_000);
  checkTrue("E4 applicable", r.applicable);
  check("E4 profit nets all four components = $120,000", r.businessProfit, 120_000, 0.005);
  // Box 1 = 120,000 − 60,000 − (3,720+870) − 42 = 55,368.
  check("E4 Box 1 $55,368", r.options[0].sCorpOrdinaryIncome, 55_368, 0.005);
}

// ════════════════════════════════════════════════════════════════════════════
// E5 — SEHI: baseline deducts §162(l); the S-corp scenario models it net-zero
//   (Notice 2008-1), so the scenario AGI matches the no-premium E1 scenario.
// ════════════════════════════════════════════════════════════════════════════
{
  const base: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 200_000 }],
    adjustments: [
      { adjustmentType: "self_employed_health_insurance_premiums", amount: 10_000, isApplied: true },
    ],
    taxYear: 2024,
  };
  const r = analyze(base, 80_000);
  checkTrue("E5 applicable with SEHI", r.applicable);
  // Sole-prop side keeps the SEHI deduction → cheaper than E1's $52,380.78.
  checkTrue("E5 sole-prop net < E1 (SEHI deducted)", r.soleProp.netTaxAfterCredits < 52380.78);
  // Scenario drops the premiums adjustment → AGI identical to E1's scenario.
  check("E5 scenario AGI = $193,838 (premiums net-zero)", r.options[0].scenario.adjustedGrossIncome, 193_838, 0.01);
  checkTrue("E5 assumptions disclose Notice 2008-1",
    r.assumptions.some((a) => a.includes("Notice 2008-1")));
}

// ════════════════════════════════════════════════════════════════════════════
// E6 — Day-job W-2 at the SS base: the employee 6.2% on the new S-corp wages
//   is fully credited back (per-person cap) → Medicare-only; the EMPLOYER 6.2%
//   is per-employer and NOT reduced.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = analyze({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 168_600, socialSecurityWagesBox3: 168_600, medicareWagesBox5: 168_600 }],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 100_000 }],
    adjustments: [], taxYear: 2024,
  }, 50_000);
  checkTrue("E6 applicable", r.applicable);
  check("E6 employee FICA Medicare-only $725", r.options[0].employeeFica, 725, 0.005);
  check("E6 employer FICA full $3,825", r.options[0].employerFica, 3825, 0.005);
}

// ════════════════════════════════════════════════════════════════════════════
// E7 — SSTB flag propagates to the modeled K-1. $400k SSTB profit, comp $160k,
//   single TY2024: taxable pre-QBI 373,118 > the $241,950 band top → QBI $0.
//   Non-SSTB control: wage limit = 50%×160,000 = 80,000 ≥ 20%×227,718 =
//   45,543.60 → QBI $45,543.60.
//   Box 1 = 400,000 − 160,000 − (6.2%×160,000=9,920 + 1.45%×160,000=2,320) −
//   42 = 227,718.  AGI 387,718; std 14,600 → 373,118 pre-QBI.
// ════════════════════════════════════════════════════════════════════════════
{
  const mk = (sstb: boolean): TaxReturnInputs => ({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 400_000 }],
    adjustments: sstb ? [{ adjustmentType: "qbi_sstb_flag", amount: 1, isApplied: true }] : [],
    taxYear: 2024,
  });
  const sstb = analyze(mk(true), 160_000);
  const nonSstb = analyze(mk(false), 160_000);
  check("E7 Box 1 $227,718", sstb.options[0].sCorpOrdinaryIncome, 227_718, 0.005);
  check("E7 SSTB above band → scenario QBI $0", sstb.options[0].scenario.qbiDeduction, 0, 0.005);
  check("E7 non-SSTB wage-limited QBI $45,543.60", nonSstb.options[0].scenario.qbiDeduction, 45543.6, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// E8 — MFJ, all SE spouse-tagged: the modeled W-2 carries the spouse tag and
//   the comparison still runs end-to-end.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = analyze({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 150_000, spouse: "taxpayer" }],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 120_000, spouse: "spouse" }],
    adjustments: [], taxYear: 2024,
  }, 55_000);
  checkTrue("E8 spouse-owned business applicable", r.applicable);
  check("E8 profit $120,000", r.businessProfit, 120_000, 0.005);
  // Spouse has no other W-2 → full employee FICA on $55k = 7.65% = $4,207.50.
  check("E8 employee FICA $4,207.50 (spouse's own cap)", r.options[0].employeeFica, 4207.5, 0.005);
  checkTrue("E8 finite savings", Number.isFinite(r.options[0].savingsVsSoleProp));
  check("E8 scenario SE tax $0", r.options[0].scenario.selfEmploymentTax, 0, 0.005);
}

// ════════════════════════════════════════════════════════════════════════════
// E9 — §179 income-limit carryforward (REGRESSION, /code-review 2026-06-10):
//   the pipeline-synthesized `schedule_c_section179_carryforward` must NOT
//   survive into the scenario — P is already net of the applied §179, so a
//   surviving adjustment deducted the same $20k AGAIN (scenario AGI came out
//   $56,898 instead of $76,898 pre-fix).
//   P = 100,000 − 20,000 = 80,000; comp $40k → ER 2,480+580=3,060, FUTA 42 →
//   Box 1 = 80,000 − 40,000 − 3,060 − 42 = 36,898 → scenario AGI 76,898.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 100_000 }],
    // The pipeline synthesizes this from the prior-year return row; the engine
    // deducts it via the asset calculator even with no new assets.
    adjustments: [{ adjustmentType: "schedule_c_section179_carryforward", amount: 20_000, isApplied: true }],
    taxYear: 2024,
  };
  const r = analyze(inputs, 40_000);
  checkTrue("E9 applicable", r.applicable);
  check("E9 profit nets the §179 carryforward = $80,000", r.businessProfit, 80_000, 0.005);
  check("E9 Box 1 $36,898", r.options[0].sCorpOrdinaryIncome, 36_898, 0.005);
  check("E9 scenario AGI $76,898 (no double deduction)", r.options[0].scenario.adjustedGrossIncome, 76_898, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// E10 — explicit Box 3 = 0 (SS-exempt W-2 wages, REGRESSION): a day job with
//   wagesBox1 $150k but socialSecurityWagesBox3 EXPLICITLY 0 must leave the
//   full per-person SS room — employee FICA on $50k comp = 7.65% = $3,825
//   (pre-fix the falsy-zero fallback consumed $150k of room → $1,852.20).
// ════════════════════════════════════════════════════════════════════════════
{
  const r = analyze({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 150_000, socialSecurityWagesBox3: 0, medicareWagesBox5: 150_000 }],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 100_000 }],
    adjustments: [], taxYear: 2024,
  }, 50_000);
  check("E10 employee FICA full $3,825 (explicit Box 3 = 0 respected)", r.options[0].employeeFica, 3825, 0.005);
}

// ════════════════════════════════════════════════════════════════════════════
// E11 — QBI-regime preservation (REGRESSION): client also holds an ACTIVE
//   partnership K-1 (no §199A fields → engine auto-default QBI). The modeled
//   S-corp K-1 must not flip the global auto-default off for it.
//   P = $120k NEC; comp $60k → ER 3,720+870=4,590, FUTA 42 → Box 1 = 55,368.
//   Scenario QBI = 20% × (50,000 partnership auto + 55,368 s-corp auto)
//   = 21,073.60 (income 165,368 − std 14,600 = 150,768 pre-QBI; cap
//   30,153.60 not binding; under the $191,950 threshold → no wage limit).
//   Pre-fix the explicit injected QBI killed the partnership's auto-default →
//   QBI was only $11,073.60.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = analyze({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 120_000 }],
    adjustments: [],
    scheduleK1: [{
      taxYear: 2024, entityName: "Side Partnership", entityType: "partnership",
      activityType: "active", box1OrdinaryIncome: 50_000,
    }],
    taxYear: 2024,
  }, 60_000);
  checkTrue("E11 applicable", r.applicable);
  check("E11 Box 1 $55,368", r.options[0].sCorpOrdinaryIncome, 55_368, 0.005);
  check("E11 scenario QBI keeps the partnership auto-default = $21,073.60",
    r.options[0].scenario.qbiDeduction, 21073.6, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// E12 — E7 aggregate §179 election moves WITH the business (sweep REGRESSION):
//   the engine caps `section_179_expense_election` at net SE earnings, which
//   collapses to 0 in the scenario — pre-fix the $30k deduction silently
//   VANISHED (scenario AGI 193,838; savings understated $5,760). Now the
//   ENTITY takes the baseline-applied amount: Box 1 = 200,000 − 80,000 −
//   6,120 − 42 − 30,000 = 83,838 → scenario AGI = 80,000 + 83,838 = 163,838
//   (= the no-§179 control 193,838 − 30,000, mirroring the baseline).
// ════════════════════════════════════════════════════════════════════════════
{
  const r = analyze({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 200_000 }],
    adjustments: [{ adjustmentType: "section_179_expense_election", amount: 30_000, isApplied: true }],
    taxYear: 2024,
  }, 80_000);
  checkTrue("E12 applicable", r.applicable);
  check("E12 profit $200,000 (§179 is above-the-line, not in Sch C net)", r.businessProfit, 200_000, 0.005);
  check("E12 Box 1 nets the applied §179 = $83,838", r.options[0].sCorpOrdinaryIncome, 83_838, 0.005);
  check("E12 scenario AGI $163,838 (deduction preserved)", r.options[0].scenario.adjustedGrossIncome, 163_838, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// E13 — explicit `qbi_income` Sch-C override must NOT survive into the
//   scenario (sweep REGRESSION): pre-fix the override stacked ON TOP of the
//   modeled K-1's auto-default QBI (scenario QBI $35,847.60 — savings
//   overstated ~$6,608, the dangerous direction). Post-fix the scenario is
//   byte-identical to the no-override E1 scenario: QBI $22,767.60, total
//   S-corp cost $42,877.40.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = analyze({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 200_000 }],
    adjustments: [{ adjustmentType: "qbi_income", amount: 100_000, isApplied: true }],
    taxYear: 2024,
  }, 80_000);
  checkTrue("E13 applicable", r.applicable);
  check("E13 scenario QBI $22,767.60 (no override stacking)", r.options[0].scenario.qbiDeduction, 22767.6, 0.01);
  check("E13 total S-corp cost $42,877.40 (= the E1 scenario)", r.options[0].totalCost, 42877.4, 0.01);
}

console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.error(f);
  process.exit(1);
}
