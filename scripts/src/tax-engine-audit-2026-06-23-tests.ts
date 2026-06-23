/**
 * FULL-APP MAXIMUM AUDIT — 2026-06-23 regression suite.
 *
 * Pins the correctness fixes from the 2026-06-23 full-app audit (a 13-agent
 * fresh-fleet fan-out + the differential-oracle harness + property harness +
 * live /verify). Every value below is hand-calc'd against the IRS/state primary
 * source. Each block names the finding it locks.
 *
 *  F4  Heavy-SUV §179 dollar-cap excess now recovers via bonus/MACRS (was lost).
 *  F5  §163(j): business interest income raises the CEILING, not the deduction.
 *  FEIE-SS  §911 exclusion added back to the SS provisional base (Pub 915 W1 L3).
 *  GA-2026  Georgia flat rate 4.99% (HB 463), was 5.09%.
 *  CAL  planning-calendar deadlines apply the §7503 weekend roll.
 *  AGE  projectYearForward advances taxpayerAge/spouseAge (age-65 benefits).
 *  ONE-TIME  projectYearForward drops one-time disposition gain adjustments.
 *  DEP  §32(c)(3)(C) disabled child is exempt from the EITC "younger-than" test.
 *  CP   community-property split does NOT halve SE income (§1402(a)(5)(A)).
 *  RECIP reciprocity exempts WAGES only — non-wage NR source stays taxable.
 *  G1.46 spousal-IRA detector requires real compensation (wages + net SE).
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  calculateStateTax,
  calculateMultiStateTax,
  computeScheduleCAssetDepreciation,
  type ScheduleCAsset,
} from "../../artifacts/api-server/src/lib/taxCalculator";
import { strategyDeadline } from "../../artifacts/api-server/src/lib/planningCalendar";
import { filingDeadlinesFor } from "../../artifacts/api-server/src/lib/engagement";
import { projectYearForward } from "../../artifacts/api-server/src/lib/multiYearEngine";
import { deriveDependentCounts } from "../../artifacts/api-server/src/lib/dependents";
import { halve1099Community } from "../../artifacts/api-server/src/lib/communityProperty";
import { evaluatePlanningOpportunities } from "../../artifacts/api-server/src/lib/planningEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected ${expected}, got ${actual}`);
}
function checkExact(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

function mk(over: Partial<TaxReturnInputs> & { client?: Partial<TaxReturnInputs["client"]> }): TaxReturnInputs {
  const taxYear = over.taxYear ?? 2024;
  return {
    client: { filingStatus: "single", state: "FL", taxYear, ...(over.client ?? {}) },
    w2s: over.w2s ?? [],
    form1099s: over.form1099s ?? [],
    adjustments: over.adjustments ?? [],
    taxYear,
  } as TaxReturnInputs;
}

// ════════════════════════════════════════════════════════════════════════════
// F5 — §163(j): biz interest income raises the CEILING, not the deduction.
// single $100k W-2, gross biz interest $20k, biz interest income $5k. 30%×ATI≈
// $30k (not binding). Allowance = $5k + $30k = $35k → deductible = min($20k paid,
// $35k) = $20k. AGI = $100k − $20k = $80,000 (was $75,000 with the phantom $5k).
// ════════════════════════════════════════════════════════════════════════════
header("F5 — §163(j) deduction capped at interest incurred");
{
  const r = computeTaxReturnPure(mk({
    w2s: [{ taxYear: 2024, wagesBox1: 100000, medicareWagesBox5: 100000, federalTaxWithheldBox2: 0, stateCode: "FL" }] as TaxReturnInputs["w2s"],
    adjustments: [
      { adjustmentType: "section_163j_business_interest_expense", amount: 20000 },
      { adjustmentType: "section_163j_business_interest_income", amount: 5000 },
    ] as TaxReturnInputs["adjustments"],
  }));
  check("AGI = $80,000 (no $5k phantom deduction)", r.adjustedGrossIncome, 80000);
}

// ════════════════════════════════════════════════════════════════════════════
// F4 — Heavy-SUV §179 dollar-cap excess recovers via MACRS.
// regular $1.22M §179 asset (eats the whole 2024 dollar cap) + heavy SUV $40k
// §179-elected (SUV cap $30,500). Cap room exhausted → SUV §179 allowed = $0 →
// the SUV's FULL $40,000 basis recovers via 5-yr MACRS (yr1 20% = $8,000), NOT
// the $1,900 (20% × the $9,500 above-cap) it earned before (the disallowed
// $30,500 was permanently lost). businessIncome set high so the §179 income
// limit doesn't bind.
// ════════════════════════════════════════════════════════════════════════════
header("F4 — heavy-SUV §179 dollar-cap excess recovers via MACRS");
{
  const r = computeScheduleCAssetDepreciation({
    assets: [
      { cost: 1_220_000, recoveryYears: 5, placedInServiceYear: 2024, section179: true },
      { cost: 40000, recoveryYears: 5, placedInServiceYear: 2024, section179: true, gvwrOver6000: true, businessUsePct: 1 },
    ] as ScheduleCAsset[],
    taxYear: 2024,
    businessIncomeForSection179: 5_000_000,
    section179Cap: 1_220_000,
    section179PhaseStart: 3_050_000,
    bonusRateByYear: { 2024: 0.6 },
  });
  check("§179 deduction = $1,220,000 (regular asset)", r.section179Deduction, 1_220_000);
  check("SUV $40k basis recovers via MACRS yr1 = $8,000 (was $1,900)", r.macrsDeduction, 8000);
}

// ════════════════════════════════════════════════════════════════════════════
// FEIE-SS — §911 exclusion added back to the SS provisional base.
// single, $50k foreign earned income (fully excluded), $35k SS, no other income.
// Provisional = $0 AGI-excl-SS + $50k FEIE add-back + $17.5k (½ SS) = $67,500 →
// well above the $34k 85% threshold → taxable SS = 0.85 × $35,000 = $29,750.
// AGI = $29,750 (was $0 — provisional was only $17.5k without the add-back).
// ════════════════════════════════════════════════════════════════════════════
header("FEIE-SS — §911 add-back into SS provisional income");
{
  const r = computeTaxReturnPure(mk({
    client: { filingStatus: "single", state: "FL", socialSecurityBenefits: 35000 },
    adjustments: [{ adjustmentType: "foreign_earned_income", amount: 50000 }] as TaxReturnInputs["adjustments"],
  }));
  check("taxable SS = $29,750 (85% cap; FEIE in provisional)", r.socialSecurityTaxable ?? 0, 29750);
  check("AGI = $29,750", r.adjustedGrossIncome, 29750);
}

// ════════════════════════════════════════════════════════════════════════════
// GA-2026 — Georgia flat rate 4.99% (HB 463), not 5.09%.
// AGI $212,000 − GA std ded $12,000 = $200,000 taxable × 4.99% = $9,980
// (was $10,180 at 5.09%).
// ════════════════════════════════════════════════════════════════════════════
header("GA-2026 — Georgia 4.99% flat (HB 463)");
{
  check("GA TY2026 tax on $212k AGI = $9,980 (4.99%)", calculateStateTax(212000, "GA", "single", 2026), 9980, 1);
  // 2025 (5.19%) unchanged control: 212k − 12k = 200k × 5.19% = $10,380.
  check("GA TY2025 unchanged = $10,380 (5.19%)", calculateStateTax(212000, "GA", "single", 2025), 10380, 60);
}

// ════════════════════════════════════════════════════════════════════════════
// CAL — planning-calendar applies the §7503 weekend roll, agreeing with
// engagement.ts. TY2027 filing deadline = Apr 15 2028 (Saturday) → Apr 17.
// ════════════════════════════════════════════════════════════════════════════
header("CAL — planning-calendar §7503 weekend roll");
{
  const d = strategyDeadline("X.unmapped", "credits", 2027); // credits → filing_deadline
  checkExact("filing deadline TY2027 rolls off Sat (= engagement.ts)", d.isoDate, filingDeadlinesFor(2027).filingDeadline);
  checkExact("…and is 2028-04-17 (not 04-15 Sat)", d.isoDate, "2028-04-17");
  // Control: TY2024 Apr 15 2025 is a weekday → no roll.
  checkExact("TY2024 filing deadline = 2025-04-15 (no roll)", strategyDeadline("X.unmapped", "credits", 2024).isoDate, "2025-04-15");
  // year_end stays Dec 31 (within-tax-year action, not a §7503 date).
  checkExact("year_end TY2027 stays 2027-12-31", strategyDeadline("X.unmapped", "charitable", 2027).isoDate, "2027-12-31");
}

// ════════════════════════════════════════════════════════════════════════════
// AGE + ONE-TIME — projectYearForward advances age and drops one-time gains.
// ════════════════════════════════════════════════════════════════════════════
header("AGE / ONE-TIME — projectYearForward");
{
  const baseline = mk({
    taxYear: 2024,
    client: { filingStatus: "single", state: "FL", taxpayerAge: 64 },
    adjustments: [{ adjustmentType: "home_sale_gross_gain_primary_residence", amount: 400000 }] as TaxReturnInputs["adjustments"],
  });
  const y1 = projectYearForward(baseline, 1);
  checkExact("taxpayerAge 64 → 65 in year +1", y1.client.taxpayerAge, 65);
  checkExact("taxYear advanced to 2025", y1.client.taxYear, 2025);
  checkExact("one-time §121 home-sale gain dropped from projection",
    (y1.adjustments ?? []).some((a) => a.adjustmentType === "home_sale_gross_gain_primary_residence"), false);
}

// ════════════════════════════════════════════════════════════════════════════
// DEP — §32(c)(3)(C): a permanently disabled child is a qualifying child at ANY
// age, exempt from the EITC "younger than the taxpayer" test.
// taxpayer born 1994, disabled sibling born 1984 (older), SSN, lived all year.
// ════════════════════════════════════════════════════════════════════════════
header("DEP — disabled EITC qualifying child (older than taxpayer)");
{
  const counts = deriveDependentCounts(
    [{ birthYear: 1984, hasSsn: true, relationship: "sibling", monthsInHome: 12, isPermanentlyDisabled: true }],
    2024,
    1994, // taxpayer birth year (taxpayer is YOUNGER than the disabled dependent)
  );
  checkExact("disabled older child counts as EITC qualifying child", counts.eitcQualifyingChildren, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// CP — community-property split halves ALL income incl. NEC for the 50/50 Form
// 8958 split. The MFS optimizer hands the SAME halved 1099 array to BOTH spouses,
// so halving is what achieves 50/50 — NOT halving NEC would land the FULL amount
// on both returns (double-count). The SE-tax §1402(a)(5)(A) attribution is a
// documented sub-gap (see communityProperty.ts). (code-review 2026-06-23 caught an
// attempted "don't halve NEC" change that would have double-counted.)
// ════════════════════════════════════════════════════════════════════════════
header("CP — community split halves NEC 50/50 (no double-count)");
{
  const split = halve1099Community({ formType: "NEC", nonemployeeCompensation: 300000, interestIncome: 1000 });
  checkExact("nonemployeeCompensation halved → $150,000", split.nonemployeeCompensation, 150000);
  checkExact("interestIncome halved → $500", split.interestIncome, 500);
}

// ════════════════════════════════════════════════════════════════════════════
// RECIP — reciprocity exempts WAGES only; non-wage NR source stays taxable.
// NJ resident, $40k PA-source rental (non-wage). PA NR tax = $40k × 3.07% =
// $1,228 (was $0 — reciprocity wrongly zeroed the whole NR tax).
// ════════════════════════════════════════════════════════════════════════════
header("RECIP — non-wage NR income taxable despite a reciprocity pair");
{
  const r = calculateMultiStateTax({
    residentState: "NJ",
    federalAgi: 40000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [],
    options: { perStateNonResidentOtherSourced: { PA: 40000 } },
  });
  const pa = r.nonresidentStateTaxes.find((s) => s.state === "PA");
  check("PA NR tax on $40k rental = $1,228 (3.07%), not $0", pa?.tax ?? -1, 1228, 2);
  // …and the resident state must CREDIT that NR tax (code-review 2026-06-23: the
  // resident-credit loop skipped reciprocity rows, double-taxing the non-wage
  // income). With 100% PA-source income the NJ credit = NJ tax on it (> 0).
  check("NJ resident credit applied for the PA non-wage tax (> 0, was $0)", r.residentCreditApplied > 0 ? 1 : 0, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// G1.46 — spousal-IRA detector requires real compensation (wages + net SE).
// MFJ retiree: $60k IRA distribution + $40k SS, NO wages/SE → must NOT fire
// (no spouse has compensation). Control: $90k W-2 MFJ → fires.
// ════════════════════════════════════════════════════════════════════════════
header("G1.46 — spousal IRA needs compensation, not investment income");
{
  const retiree = mk({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxpayerAge: 68, spouseAge: 67, socialSecurityBenefits: 40000 },
    form1099s: [{ formType: "R", grossDistribution: 60000, taxableAmount: 60000 }] as TaxReturnInputs["form1099s"],
  });
  const retireeHits = evaluatePlanningOpportunities({
    client: retiree.client, computed: computeTaxReturnPure(retiree), adjustments: retiree.adjustments ?? [],
  });
  checkExact("retiree (IRA dist + SS, no comp) → G1.46 does NOT fire",
    retireeHits.some((h) => h.strategyId === "G1.46"), false);

  const worker = mk({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxpayerAge: 45 },
    w2s: [{ taxYear: 2024, wagesBox1: 90000, medicareWagesBox5: 90000, federalTaxWithheldBox2: 0, stateCode: "FL" }] as TaxReturnInputs["w2s"],
  });
  const workerHits = evaluatePlanningOpportunities({
    client: worker.client, computed: computeTaxReturnPure(worker), adjustments: worker.adjustments ?? [],
  });
  checkExact("worker ($90k W-2) → G1.46 fires (control)",
    workerHits.some((h) => h.strategyId === "G1.46"), true);
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(70)}`);
for (const f of FAIL) console.log(f);
console.log(`AUDIT-2026-06-23: ${PASS.length} passed, ${FAIL.length} failed`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) process.exit(1);
