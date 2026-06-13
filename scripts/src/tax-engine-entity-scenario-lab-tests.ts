/**
 * G-5 — Entity Scenario Lab tests (sole-prop vs S-corp vs partnership vs C-corp).
 *
 * Pure (no API). HAND-CALC'D against the 2024 single brackets, the 2024 LTCG
 * preferential schedule (0% ≤ $47,025; 15% to $518,900; 20% above), the 2024 SS
 * wage base $168,600, FUTA net 0.6% × $7,000, the §11(b) 21% flat C-corp rate,
 * and the engine's §199A pipeline. Every C-corp number is independently
 * re-derived in a comment and verified against `computeTaxReturnPure` (the sole-
 * prop + S-corp legs are the engine-verified entity-choice calculator's output).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-entity-scenario-lab-tests.ts
 */

import type { TaxReturnInputs } from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { computeTaxReturnPure } from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { netTaxAfterCredits } from "../../artifacts/api-server/src/lib/filingStatusOptimizer";
import {
  analyzeEntityScenarioLab,
  type EntityForm,
  type EntityScenario,
} from "../../artifacts/api-server/src/lib/entityScenarioLab";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1.0): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean): void {
  cond ? PASS.push(`✓ ${label}`) : FAIL.push(`✗ ${label}`);
}

function lab(inputs: TaxReturnInputs, reasonableComp?: number, cCorpDistributes?: boolean) {
  const ret = computeTaxReturnPure(inputs);
  return analyzeEntityScenarioLab({
    baselineInputs: inputs,
    baselineReturn: ret,
    reasonableComp,
    cCorpDistributes,
  });
}
function leg(scenarios: EntityScenario[], form: EntityForm): EntityScenario {
  const s = scenarios.find((x) => x.form === form);
  if (!s) throw new Error(`missing leg ${form}`);
  return s;
}

// ════════════════════════════════════════════════════════════════════════════
// E1 — Single, FL, TY2024, $200,000 1099-NEC, EXPLICIT comp $80,000. FULL HAND-CALC.
//
//  Shared payroll on $80k W-2: employer FICA = 6.2%×80,000 + 1.45%×80,000 =
//   4,960 + 1,160 = 6,120; FUTA net = 0.6%×7,000 = 42; employee FICA = 6,120.
//
//  SOLE PROP (= the baseline, from entityChoice): net SE 200,000×.9235=184,700;
//   SE tax 26,262.70; AGI 186,868.65; std 14,600; QBI 34,453.73; taxable
//   137,814.92 → income tax 26,118.08 → net tax 52,380.78. payroll = SE tax.
//
//  S-CORP @ $80k (from entityChoice bestOption): K-1 Box 1 = 200,000−80,000−
//   6,120−42 = 113,838; individual net tax 30,595.40; payroll 6,120+6,120+42 =
//   12,282 → totalCost 42,877.40. entityLevelTax 0.
//
//  PARTNERSHIP = sole prop (single owner, SE-equivalent) → 52,380.78.
//
//  C-CORP @ $80k salary (the manual double-tax leg):
//   Corporate taxable income = profit − salary − employer payroll taxes
//     = 200,000 − 80,000 − 6,120 − 42 = 113,838.
//   Corporate tax = 21% × 113,838 = 23,905.98.
//   After-corp earnings = 113,838 − 23,905.98 = 89,932.02 → distributed as a
//     QUALIFIED dividend.
//   Individual (salary-only baseline): W-2 $80k, std 14,600 → taxable 65,400;
//     ordinary tax = 1,160 + 4,266 + (65,400−47,150)×22% = 1,160+4,266+4,015 =
//     9,441 → net 9,441.
//   Individual (with $89,932.02 QDIV): AGI 169,932.02; taxable 155,332.02;
//     ordinary portion still 65,400 (tax 9,441); QDIV stacks ABOVE 65,400, all
//     in the 15% bracket (65,400 + 89,932 < 518,900) → 89,932.02×15% =
//     13,489.80; MAGI 169,932 < $200k single → NO NIIT. Total fed = 9,441 +
//     13,489.80 = 22,930.80 → individualNetTax 22,930.80; dividendTax 13,489.80.
//   C-corp totalCost = 22,930.80 + 23,905.98 + 6,120 + 6,120 + 42 = 59,118.78.
//
//  RANKING: S-corp (42,877.40) < sole_prop = partnership (52,380.78) <
//   C-corp distribute (59,118.78). best = s_corp.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 200_000 }],
    adjustments: [],
    taxYear: 2024,
  } as TaxReturnInputs;
  const r = lab(inputs, 80_000);

  checkTrue("E1 applicable", r.applicable);
  check("E1 business profit $200,000", r.businessProfit, 200_000, 0.005);
  check("E1 four scenarios", r.scenarios.length, 4, 0);
  checkTrue("E1 scenario forms are the four entities", [
    "sole_prop", "s_corp", "partnership", "c_corp",
  ].every((f) => r.scenarios.some((s) => s.form === f)));

  // sole_prop
  const sp = leg(r.scenarios, "sole_prop");
  check("E1 sole_prop totalAnnualCost $52,380.78", sp.totalAnnualCost, 52380.78, 0.01);
  check("E1 sole_prop individualNetTax $52,380.78", sp.breakdown.individualNetTax, 52380.78, 0.01);
  check("E1 sole_prop payroll = SE tax $26,262.70", sp.breakdown.payrollTaxes, 26262.7, 0.02);
  check("E1 sole_prop entityLevelTax $0", sp.breakdown.entityLevelTax, 0, 0.005);
  checkTrue("E1 sole_prop reasonableComp null", sp.reasonableComp === null);
  checkTrue("E1 sole_prop has no dividendTax", sp.breakdown.dividendTax === undefined);

  // s_corp
  const sc = leg(r.scenarios, "s_corp");
  check("E1 s_corp reasonableComp $80,000", sc.reasonableComp ?? -1, 80_000, 0.005);
  check("E1 s_corp totalAnnualCost $42,877.40", sc.totalAnnualCost, 42877.4, 0.02);
  check("E1 s_corp individualNetTax $30,595.40", sc.breakdown.individualNetTax, 30595.4, 0.02);
  check("E1 s_corp payroll $12,282 (ER+EE+FUTA)", sc.breakdown.payrollTaxes, 12282, 0.02);
  check("E1 s_corp entityLevelTax $0", sc.breakdown.entityLevelTax, 0, 0.005);

  // partnership = sole prop
  const pt = leg(r.scenarios, "partnership");
  check("E1 partnership totalAnnualCost == sole_prop", pt.totalAnnualCost, sp.totalAnnualCost, 0.005);
  check("E1 partnership individualNetTax == sole_prop", pt.breakdown.individualNetTax, sp.breakdown.individualNetTax, 0.005);
  check("E1 partnership payroll == sole_prop SE tax", pt.breakdown.payrollTaxes, sp.breakdown.payrollTaxes, 0.005);
  checkTrue("E1 partnership reasonableComp null", pt.reasonableComp === null);
  checkTrue("E1 partnership note explains ≥2-partner equivalence",
    pt.notes.some((n) => /requires ≥2 partners/i.test(n) && /sole prop/i.test(n)));

  // c_corp — the double-tax leg
  const cc = leg(r.scenarios, "c_corp");
  check("E1 c_corp reasonableComp $80,000", cc.reasonableComp ?? -1, 80_000, 0.005);
  check("E1 c_corp corporate (entityLevel) tax $23,905.98", cc.breakdown.entityLevelTax, 23905.98, 0.02);
  check("E1 c_corp individualNetTax $22,930.80", cc.breakdown.individualNetTax, 22930.8, 0.05);
  check("E1 c_corp dividendTax $13,489.80", cc.breakdown.dividendTax ?? -1, 13489.8, 0.05);
  check("E1 c_corp payroll $12,282 (ER+EE+FUTA)", cc.breakdown.payrollTaxes, 12282, 0.02);
  check("E1 c_corp totalAnnualCost $59,118.78", cc.totalAnnualCost, 59118.78, 0.1);
  // Cost identity: the four disclosed parts sum to totalAnnualCost.
  check("E1 c_corp cost = indiv + entity + payroll",
    cc.totalAnnualCost,
    cc.breakdown.individualNetTax + cc.breakdown.entityLevelTax + cc.breakdown.payrollTaxes,
    0.05);

  // ranking + best
  check("E1 best totalAnnualCost == s_corp cost", r.best!.totalAnnualCost, sc.totalAnnualCost, 0.005);
  checkTrue("E1 best is s_corp", r.best!.form === "s_corp");
  checkTrue("E1 ordering S-corp < sole_prop < C-corp",
    sc.totalAnnualCost < sp.totalAnnualCost && sp.totalAnnualCost < cc.totalAnnualCost);
  checkTrue("E1 C-corp is the most expensive leg",
    cc.totalAnnualCost === Math.max(...r.scenarios.map((s) => s.totalAnnualCost)));

  // §1202 note
  checkTrue("E1 §1202 note present + mentions QSBS + future sale", /§1202/.test(r.section1202Note) && /Qualified Small Business Stock/i.test(r.section1202Note) && /sale/i.test(r.section1202Note));
  checkTrue("E1 §1202 note flags it is NOT an annual cost", /not an annual cost/i.test(r.section1202Note));
  checkTrue("E1 lab-level assumptions populated", r.assumptions.length >= 4);
  checkTrue("E1 c_corp assumptions mention double taxation",
    cc.assumptions.some((a) => /double tax/i.test(a)));
}

// ════════════════════════════════════════════════════════════════════════════
// E2 — Same E1 profile but C-corp RETAINS earnings (cCorpDistributes:false).
//   Corporate tax unchanged (23,905.98). NO dividend → individual = salary-only
//   net 9,441; dividendTax 0. totalCost = 9,441 + 23,905.98 + 6,120 + 6,120 +
//   42 = 45,628.98 (only the first 21% layer this year — second layer deferred).
//   Retain is cheaper than distribute (59,118.78) but still > S-corp.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 200_000 }],
    adjustments: [],
    taxYear: 2024,
  } as TaxReturnInputs;
  const r = lab(inputs, 80_000, false);
  const cc = leg(r.scenarios, "c_corp");
  check("E2 retain c_corp entityLevelTax $23,905.98", cc.breakdown.entityLevelTax, 23905.98, 0.02);
  check("E2 retain c_corp individualNetTax $9,441 (salary only)", cc.breakdown.individualNetTax, 9441, 0.05);
  check("E2 retain c_corp dividendTax $0", cc.breakdown.dividendTax ?? -1, 0, 0.005);
  check("E2 retain c_corp totalAnnualCost $45,628.98", cc.totalAnnualCost, 45628.98, 0.1);
  checkTrue("E2 retain assumption mentions RETAINED / deferred second layer",
    cc.assumptions.some((a) => /RETAINED/i.test(a) || /deferred/i.test(a)));
  // Retain (45,628.98) < distribute (59,118.78); both still > S-corp (42,877.40).
  checkTrue("E2 retain cheaper than distribute", cc.totalAnnualCost < 59118.78);
  checkTrue("E2 retain still costlier than S-corp", cc.totalAnnualCost > leg(r.scenarios, "s_corp").totalAnnualCost);
  // best still s_corp
  checkTrue("E2 best still s_corp", r.best!.form === "s_corp");
}

// ════════════════════════════════════════════════════════════════════════════
// E3 — DEFAULT SWEEP (no explicit comp). entityChoice sweeps 35/50/60% of
//   $200k = $70k/$100k/$120k and picks the lowest-cost level ($70k). The lab
//   uses that bestOption comp for BOTH the S-corp and C-corp legs.
//
//   S-corp @ $70k (entityChoice bestOption): totalCost 41,014.28.
//
//   C-corp @ $70k: ER FICA = 6.2%×70,000 + 1.45%×70,000 = 4,340+1,015 = 5,355;
//    FUTA 42; EE FICA 5,355. Corporate taxable = 200,000−70,000−5,355−42 =
//    124,603. Corp tax = 21%×124,603 = 26,166.63. After = 98,436.37 dividend.
//    Individual salary-only ($70k): std 14,600 → taxable 55,400; tax = 1,160 +
//     4,266 + (55,400−47,150)×22% = 1,160+4,266+1,815 = 7,241.
//    With $98,436.37 QDIV: ordinary portion 55,400 (tax 7,241); QDIV stacks
//     above 55,400, all 15% (55,400+98,436 < 518,900) → 98,436.37×15% =
//     14,765.46; MAGI 168,436 < $200k → no NIIT. indiv net = 7,241+14,765.46 =
//     22,006.46; dividendTax 14,765.46.
//    C-corp totalCost = 22,006.46 + 26,166.63 + 5,355 + 5,355 + 42 = 58,925.09.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 200_000 }],
    adjustments: [],
    taxYear: 2024,
  } as TaxReturnInputs;
  const r = lab(inputs); // no explicit comp → default sweep
  const sc = leg(r.scenarios, "s_corp");
  const cc = leg(r.scenarios, "c_corp");
  check("E3 sweep S-corp comp $70,000", sc.reasonableComp ?? -1, 70_000, 0.005);
  check("E3 sweep S-corp totalAnnualCost $41,014.28", sc.totalAnnualCost, 41014.28, 0.05);
  check("E3 sweep C-corp uses same comp $70,000", cc.reasonableComp ?? -1, 70_000, 0.005);
  check("E3 sweep C-corp entityLevelTax $26,166.63", cc.breakdown.entityLevelTax, 26166.63, 0.02);
  check("E3 sweep C-corp individualNetTax $22,006.46", cc.breakdown.individualNetTax, 22006.46, 0.05);
  check("E3 sweep C-corp dividendTax $14,765.46", cc.breakdown.dividendTax ?? -1, 14765.46, 0.05);
  check("E3 sweep C-corp payroll $10,752 (5,355×2 + 42)", cc.breakdown.payrollTaxes, 10752, 0.02);
  check("E3 sweep C-corp totalAnnualCost $58,925.09", cc.totalAnnualCost, 58925.09, 0.1);
  checkTrue("E3 sweep best is s_corp", r.best!.form === "s_corp");
}

// ════════════════════════════════════════════════════════════════════════════
// E4 — Partnership-equals-sole-prop holds with state tax + an MFJ profile.
//   $300k profit, MFJ, NY, TY2024, explicit comp $120k. Whatever the engine
//   computes for the (complex) sole-prop baseline, the partnership leg must
//   equal it to the cent (single-owner SE-equivalence) — and BOTH must equal
//   netTaxAfterCredits(baseline).
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "married_filing_jointly", state: "NY", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 300_000 }],
    adjustments: [],
    taxYear: 2024,
  } as TaxReturnInputs;
  const baseRet = computeTaxReturnPure(inputs);
  const baseNet = netTaxAfterCredits(baseRet);
  const r = lab(inputs, 120_000);
  const sp = leg(r.scenarios, "sole_prop");
  const pt = leg(r.scenarios, "partnership");
  checkTrue("E4 applicable (MFJ NY)", r.applicable);
  check("E4 sole_prop cost == baseline net tax", sp.totalAnnualCost, baseNet, 0.02);
  check("E4 partnership cost == sole_prop cost (SE-equivalent)", pt.totalAnnualCost, sp.totalAnnualCost, 0.005);
  check("E4 partnership individualNetTax == sole_prop", pt.breakdown.individualNetTax, sp.breakdown.individualNetTax, 0.005);
  // S-corp should beat sole-prop here too (residual escapes SE tax).
  checkTrue("E4 s_corp cheaper than sole_prop", leg(r.scenarios, "s_corp").totalAnnualCost < sp.totalAnnualCost);
  // C-corp entity tax = 21% × (300,000 − 120,000 − employer payroll).
  //   ER FICA = 6.2%×120,000 + 1.45%×120,000 = 7,440 + 1,740 = 9,180; FUTA 42.
  //   Corp taxable = 300,000 − 120,000 − 9,180 − 42 = 170,778; tax = 21% ×
  //   170,778 = 35,863.38.
  check("E4 c_corp entityLevelTax $35,863.38", leg(r.scenarios, "c_corp").breakdown.entityLevelTax, 35863.38, 0.1);
}

// ════════════════════════════════════════════════════════════════════════════
// E5 — DECLINE cases (lab leans on entityChoice's guards).
// ════════════════════════════════════════════════════════════════════════════
{
  // (a) Profit below the $10k S-corp-overhead floor.
  const low: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 5_000 }],
    adjustments: [],
    taxYear: 2024,
  } as TaxReturnInputs;
  const rl = lab(low);
  checkTrue("E5a low profit → not applicable", !rl.applicable);
  checkTrue("E5a low profit → empty scenarios", rl.scenarios.length === 0);
  checkTrue("E5a low profit → null best", rl.best === null);
  checkTrue("E5a low profit → reason mentions the floor", /below \$10,000/.test(rl.reason ?? ""));
  checkTrue("E5a §1202 note still present on decline", /§1202/.test(rl.section1202Note));

  // (b) Pure W-2 income, no SE → not applicable.
  const w2only: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 150_000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  } as TaxReturnInputs;
  checkTrue("E5b pure W-2 → not applicable", !lab(w2only).applicable);

  // (c) SE non-farm optional method elected → declines (can't preserve it).
  const opt: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 80_000 }],
    adjustments: [{ adjustmentType: "se_optional_method_nonfarm", amount: 6_560 }],
    taxYear: 2024,
  } as TaxReturnInputs;
  const ro = lab(opt);
  checkTrue("E5c SE optional method → not applicable", !ro.applicable);
  checkTrue("E5c SE optional method → reason mentions optional method", /optional method/i.test(ro.reason ?? ""));

  // (d) Self-employment split across BOTH spouses → declines.
  const split: TaxReturnInputs = {
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [
      { taxYear: 2024, formType: "nec", nonemployeeCompensation: 100_000, spouse: "taxpayer" },
      { taxYear: 2024, formType: "nec", nonemployeeCompensation: 100_000, spouse: "spouse" },
    ],
    adjustments: [],
    taxYear: 2024,
  } as TaxReturnInputs;
  const rsp = lab(split);
  checkTrue("E5d split-spouse business → not applicable", !rsp.applicable);
  checkTrue("E5d split-spouse → reason mentions both spouses", /BOTH spouses/i.test(rsp.reason ?? ""));
}

// ════════════════════════════════════════════════════════════════════════════
// E6 — Higher-profit case stresses the dividend stacking, and confirms the
//   C-corp double-tax dominates. Single FL, $500k profit, comp $150k.
//    ER FICA = 6.2%×min(150,000, SS base 168,600) + 1.45%×150,000
//            = 6.2%×150,000 + 1.45%×150,000 = 9,300 + 2,175 = 11,475. FUTA 42.
//    Corp taxable = 500,000 − 150,000 − 11,475 − 42 = 338,483.
//    Corp tax = 21% × 338,483 = 71,081.43.
//   Assert the entity tax + that C-corp is the most expensive leg + that the
//   dividend's second layer actually bites (dividendTax > 0) + best ≠ c_corp.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 500_000 }],
    adjustments: [],
    taxYear: 2024,
  } as TaxReturnInputs;
  const r = lab(inputs, 150_000);
  const cc = leg(r.scenarios, "c_corp");
  check("E6 c_corp entityLevelTax $71,081.43", cc.breakdown.entityLevelTax, 71081.43, 0.2);
  checkTrue("E6 c_corp dividendTax positive (second layer bites)", (cc.breakdown.dividendTax ?? 0) > 0);
  checkTrue("E6 c_corp most expensive leg",
    cc.totalAnnualCost === Math.max(...r.scenarios.map((s) => s.totalAnnualCost)));
  checkTrue("E6 best is a pass-through (not c_corp)", r.best!.form !== "c_corp");
}

console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.error(f);
  process.exit(1);
}
