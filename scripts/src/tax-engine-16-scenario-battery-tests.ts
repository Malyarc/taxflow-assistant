/**
 * 16-scenario real-world battery — end-to-end CPA returns through
 * computeTaxReturnPure (NO DB / NO API). Authored 2026-06-01 to give PIPELINE
 * coverage for the 2026-05-29 audit fixes that were previously locked only by
 * direct unit hand-calc (FED-03 NIIT FEIE add-back, FED-04 QBI/NOL ordering,
 * FED-06 EITC §32(i) tax-exempt interest) plus a battery of stacked-feature
 * pass-through / NIIT / self-employment returns.
 *
 * Every scenario carries a `Hand-calc:` block derived line-by-line from the
 * published IRS rule BEFORE the assertion, per the project's hard rule. Where
 * the engine has a documented sub-gap that diverges from the literal rule
 * (e.g. K-1 QBI not reduced by SE-tax / SEHI / SEP), the affected output is
 * NOT asserted and the gap is noted in-comment.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-16-scenario-battery-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

let pass = 0;
const failures: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1) {
  if (Math.abs(actual - expected) <= tol) pass++;
  else failures.push(`  ✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)} (Δ ${(actual - expected).toFixed(2)})`);
}
function checkExact<T>(label: string, actual: T, expected: T) {
  if (actual === expected) pass++;
  else failures.push(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function section(t: string) { console.log(`\n== ${t} ==`); }

// ════════════════════════════════════════════════════════════════════════════
// N1 — FED-03: NIIT MAGI adds back the §911 FEIE exclusion (§1411(d))
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, lives abroad, FL domicile (no state). $150,000 foreign
// earned income (FEIE) + $80,000 LTCG (1099-B). TY2024.
// Hand-calc:
//   FEIE exclusion = min($150,000, $126,500 cap) = $126,500.
//   Foreign income left in AGI = $150,000 − $126,500 = $23,500.
//   AGI = $23,500 + $80,000 LTCG = $103,500.
//   §1411(d) NIIT MAGI = AGI + FEIE exclusion = $103,500 + $126,500 = $230,000.
//   NII = $80,000 LTCG (foreign EARNED income is not investment income).
//   NIIT = 3.8% × min($80,000, $230,000 − $200,000) = 3.8% × $30,000 = $1,140.
//   ← Without the add-back, MAGI $103,500 < $200k → NIIT $0 (the bug).
section("N1 — FED-03 NIIT MAGI FEIE add-back");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: 80000 }],
    adjustments: [{ adjustmentType: "foreign_earned_income", amount: 150000, isApplied: true }],
    taxYear: 2024,
  });
  check("N1 AGI = $103,500 (FEIE excludes $126,500)", r.adjustedGrossIncome, 103500, 1);
  check("N1 NIIT = $1,140 (FEIE added back to MAGI)", r.niitTax, 1140, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// N2 — FED-04: QBI §199A cap computed on POST-NOL taxable income
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, Schedule C net $200,000 + $300,000 NOL carryforward. TY2024.
// Hand-calc (RE-DERIVED 2026-06-11, T1.0c #3 — the §172 NOL is a Schedule 1
// line 8a deduction, i.e. ABOVE THE LINE → it now reduces AGI; the 80% cap
// stays measured on taxable income computed WITHOUT the NOL/QBI per
// §172(a)(2)(B)(ii), so the deduction/remaining amounts are unchanged):
//   SE: net SE = 200,000 × 0.9235 = 184,700.
//     OASDI = min(184,700, 168,600) × 12.4% = 168,600 × .124 = 20,906.40
//     Medicare = 184,700 × 2.9% = 5,356.30 → SE tax = 26,262.70; half = 13,131.35.
//   80%-cap base (taxable w/o NOL or QBI): AGI-w/o-NOL 186,868.65 − 14,600 std
//     = 172,268.65.
//   NOL deduction = min(300,000, 80% × 172,268.65 = 137,814.92) = 137,814.92.
//     Remaining NOL = 162,185.08.
//   AGI = 200,000 − 13,131.35 (½ SE) − 137,814.92 (NOL, Sch 1 line 8a)
//       = 49,053.73   ← NOL is an AGI deduction now.
//   Taxable pre-QBI = 49,053.73 − 14,600 std = 34,453.73 (post-NOL inherently).
//   Prelim QBI = 20% × (200,000 − 13,131.35) = 20% × 186,868.65 = 37,373.73.
//   QBI cap = 20% × POST-NOL taxable 34,453.73 = 6,890.75   ← THE FED-04 FIX.
//   Final QBI = min(37,373.73, 6,890.75) = 6,890.75.
//   Final taxable = 34,453.73 − 6,890.75 = 27,562.98.
section("N2 — FED-04 QBI cap on post-NOL taxable income");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [
      { adjustmentType: "self_employment_income", amount: 200000, isApplied: true },
      { adjustmentType: "nol_carryforward", amount: 300000, isApplied: true },
    ],
    taxYear: 2024,
  });
  // NOL is a Sch 1 line 8a AGI deduction (T1.0c #3) — AGI now $49,053.73.
  check("N2 AGI = $49,053.73 (200,000 − 13,131.35 − NOL 137,814.92)", r.adjustedGrossIncome, 49053.73, 1);
  check("N2 NOL deduction = $137,814.92 (80% of pre-NOL taxable)", r.nolDeduction, 137814.92, 1);
  check("N2 NOL remaining = $162,185.08", r.nolCarryforwardRemaining, 162185.08, 1);
  check("N2 QBI deduction = $6,890.75 (capped by POST-NOL taxable)", r.qbiDeduction, 6890.75, 1);
  check("N2 taxable income = $27,562.98", r.taxableIncome, 27562.98, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// N3 — FED-06: EITC §32(i) disqualified by tax-exempt interest
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, 2 qualifying children, $20,000 W-2 + tax-exempt muni
// interest. TY2024. §32(i)(2)(B) COUNTS tax-exempt interest as disqualifying
// investment income; the 2024 limit is $11,600.
// Hand-calc (a): $12,000 muni → investment income $12,000 > $11,600 → EITC $0.
//   AGI = $20,000 (tax-exempt interest is NOT in AGI).
// Hand-calc (b, control): $11,000 muni → $11,000 < $11,600 → EITC allowed.
//   Single, 2 kids, earned $20,000 (≥ $16,810 plateau, < $22,720 phase-out
//   start) → EITC = max-credit $6,960 (Rev. Proc. 2023-34).
section("N3 — FED-06 EITC disqualified by tax-exempt interest");
{
  const disq = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, dependentsUnder17: 2 },
    w2s: [{ taxYear: 2024, wagesBox1: 20000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "int", interestIncome: 12000, taxExemptInterest: 12000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("N3a AGI = $20,000 (muni interest excluded)", disq.adjustedGrossIncome, 20000, 1);
  checkExact("N3a EITC = $0 ($12,000 > $11,600 §32(i) limit)", disq.eitc.appliedCredit, 0);

  const ok = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, dependentsUnder17: 2 },
    w2s: [{ taxYear: 2024, wagesBox1: 20000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "int", interestIncome: 11000, taxExemptInterest: 11000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("N3b control EITC = $6,960 ($11,000 < limit; 2-kid plateau)", ok.eitc.appliedCredit, 6960, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// N4 — Pass-through: S-corp shareholder, W-2 reasonable comp + K-1 Box 1 + QBI
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, W-2 $80,000 (own-S-corp reasonable comp) + S-corp K-1
// Box 1 ordinary $120,000 (active). TY2024.
// Hand-calc:
//   S-corp K-1 Box 1 is NOT self-employment income → no SE tax.
//   AGI = 80,000 + 120,000 = 200,000.
//   Pre-QBI taxable = 200,000 − 14,600 = 185,400 (< $191,950 §199A threshold
//     → simplified 20%, no wage/UBIA limit even under the literal rule).
//   QBI = min(20% × 120,000 = 24,000, 20% × 185,400 = 37,080) = 24,000.
//   Taxable = 185,400 − 24,000 = 161,400.
//   Federal ordinary tax (single 2024): 1,160 + 4,266 + 11,742.50
//     + 24% × (161,400 − 100,525 = 60,875 = 14,610) = 31,778.50.
//   No NIIT (no investment income; MAGI 200k not over 200k threshold),
//   no Additional Medicare (wages 80k < 200k).
section("N4 — S-corp K-1 + W-2 reasonable comp + QBI");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, stateCode: "FL" }],
    form1099s: [],
    scheduleK1: [
      { taxYear: 2024, entityType: "s_corp", activityType: "active", box1OrdinaryIncome: 120000 },
    ],
    adjustments: [],
    taxYear: 2024,
  });
  check("N4 AGI = $200,000", r.adjustedGrossIncome, 200000, 1);
  check("N4 QBI deduction = $24,000 (20% of K-1 Box 1)", r.qbiDeduction, 24000, 1);
  check("N4 taxable income = $161,400", r.taxableIncome, 161400, 1);
  check("N4 federal income tax = $31,778.50", r.federalTaxLiability, 31778.50, 1);
  checkExact("N4 SE tax = $0 (S-corp K-1 not SE)", r.selfEmploymentTax, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// N5 — MFS NIIT ($125k threshold) + Additional Medicare (Form 8959)
// ════════════════════════════════════════════════════════════════════════════
// Profile: Married filing separately, FL, W-2 $250,000 + $50,000 LTCG. TY2024.
// Hand-calc:
//   AGI = 250,000 + 50,000 = 300,000.
//   NIIT (MFS threshold $125,000), NII = 50,000 LTCG:
//     3.8% × min(50,000, 300,000 − 125,000 = 175,000) = 3.8% × 50,000 = 1,900.
//   Additional Medicare 0.9% (MFS threshold $125,000) on Medicare wages 250,000:
//     0.9% × (250,000 − 125,000) = 0.9% × 125,000 = 1,125.
section("N5 — MFS NIIT $125k threshold + Additional Medicare");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_separately", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 250000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: 50000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("N5 AGI = $300,000", r.adjustedGrossIncome, 300000, 1);
  check("N5 NIIT = $1,900 (MFS $125k threshold)", r.niitTax, 1900, 1);
  check("N5 Additional Medicare = $1,125 (MFS $125k threshold)", r.additionalMedicareTax, 1125, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// N6 — Capital-loss carryforward absorbs current gain + $3k ordinary offset
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, W-2 $100,000 + $10,000 LTCG (1099-B) + $20,000 prior-year
// LONG-term capital-loss carryforward. TY2024.
// Hand-calc (Sch D / §1211 / §1212):
//   Net long = current LTCG 10,000 − carryforward 20,000 = (10,000) net LT loss.
//   $3,000 offsets ordinary income; 7,000 carries forward (long character).
//   AGI = 100,000 − 3,000 = 97,000.
section("N6 — Capital-loss carryforward + $3k offset");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: 10000 }],
    adjustments: [{ adjustmentType: "capital_loss_carryforward_long", amount: 20000, isApplied: true }],
    taxYear: 2024,
  });
  check("N6 AGI = $97,000 ($3k loss offsets ordinary)", r.adjustedGrossIncome, 97000, 1);
  check("N6 LT carryforward remaining = $7,000", r.capitalLossCarryforwardLong, 7000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// N7 — §1031 boot recognized gain flows into the §1411 NIIT base
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, W-2 $250,000 + §1031 exchange: realized gain $200,000,
// boot received $60,000. TY2024.
// Hand-calc:
//   §1031 recognized = min(realized 200,000, boot 60,000) = 60,000 (LTCG);
//     deferred 140,000.
//   AGI = 250,000 + 60,000 = 310,000.
//   NII includes the recognized §1031 boot gain (corrected 2026-05-28; the old
//     Form 8824 footnote that told CPAs to add it manually was wrong → FORM-01).
//   NIIT = 3.8% × min(60,000, 310,000 − 200,000 = 110,000) = 3.8% × 60,000 = 2,280.
section("N7 — §1031 boot recognized gain in NIIT base");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 250000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "section_1031_realized_gain", amount: 200000, isApplied: true },
      { adjustmentType: "section_1031_boot_received", amount: 60000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("N7 AGI = $310,000 (recognized boot gain)", r.adjustedGrossIncome, 310000, 1);
  check("N7 NIIT = $2,280 (recognized §1031 gain in NII)", r.niitTax, 2280, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// N8 — Self-employed above-the-line stacking → AGI (half-SE + SEP + SEHI + HSA)
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, Schedule C net $200,000 + $30,000 SEP (above-the-line
// "deduction") + $10,000 self-employed health insurance + $4,150 HSA (self-only
// 2024). TY2024.
// Hand-calc:
//   SE: net SE = 200,000 × 0.9235 = 184,700 → SE tax 26,262.70; half = 13,131.35.
//   SEHI cap = net SE − half-SE = 184,700 − 13,131.35 = 171,568.65 ≥ 10,000 → full.
//   Above-the-line = 13,131.35 + 30,000 + 10,000 + 4,150 = 57,281.35.
//   AGI = 200,000 − 57,281.35 = 142,718.65.
//   (QBI NOT asserted: engine sub-gap — §199A QBI not reduced by SEP/SEHI.)
section("N8 — SE above-the-line stacking → AGI");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [
      { adjustmentType: "self_employment_income", amount: 200000, isApplied: true },
      { adjustmentType: "deduction", amount: 30000, isApplied: true },
      { adjustmentType: "self_employed_health_insurance_premiums", amount: 10000, isApplied: true },
      { adjustmentType: "hsa_contribution", amount: 4150, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("N8 AGI = $142,718.65 (half-SE + SEP + SEHI + HSA)", r.adjustedGrossIncome, 142718.65, 1);
  check("N8 SE tax = $26,262.70", r.selfEmploymentTax, 26262.70, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// N9 — Partnership K-1 Box 14A self-employment earnings → SE tax + AGI
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, partnership K-1 Box 1 ordinary $150,000 (active) with
// Box 14A self-employment earnings $150,000 (general partner). TY2024.
// Hand-calc:
//   net SE = 150,000 × 0.9235 = 138,525 (< $168,600 wage base).
//   OASDI = 138,525 × 12.4% = 17,177.10; Medicare = 138,525 × 2.9% = 4,017.23.
//   SE tax = 21,194.33; half = 10,597.16.
//   AGI = 150,000 (Box 1 ordinary) − 10,597.16 half-SE = 139,402.84.
//   (QBI not asserted: engine K-1 QBI sub-gap does not net the SE-tax deduction.)
section("N9 — Partnership K-1 Box 14A SE earnings");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    scheduleK1: [
      { taxYear: 2024, entityType: "partnership", activityType: "active",
        box1OrdinaryIncome: 150000, selfEmploymentEarnings: 150000 },
    ],
    adjustments: [],
    taxYear: 2024,
  });
  check("N9 AGI = $139,402.84 (Box 1 − half-SE)", r.adjustedGrossIncome, 139402.84, 1);
  check("N9 SE tax = $21,194.33 (on Box 14A)", r.selfEmploymentTax, 21194.33, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// N10 — HoH working family: CTC nonrefundable + ACTC + EITC interaction
// ════════════════════════════════════════════════════════════════════════════
// Profile: Head of household, FL, W-2 $40,000, 2 children under 17. TY2024.
// Hand-calc:
//   Taxable = 40,000 − 21,900 std (HoH) = 18,100.
//   Ordinary tax = 1,655 (10% to 16,550) + 12% × (18,100 − 16,550 = 1,550 = 186)
//     = 1,841.
//   federalTaxLiability is PRE-(nonrefundable-credit) → = the $1,841 income tax
//     (credits flow into federalRefundOrOwed, not this field).
//   CTC nonrefundable portion = min(2 × 2,000 = 4,000, 1,841 tax) = 1,841.
//   ACTC refundable = min(remaining 4,000 − 1,841 = 2,159, 2 × 1,700 = 3,400,
//     15% × (40,000 − 2,500) = 5,625) = 2,159.
//   EITC (HoH 2 kids): 6,960 − 21.06% × (40,000 − 22,720 = 17,280) = 3,320.83.
section("N10 — HoH CTC + ACTC + EITC");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "head_of_household", state: "FL", taxYear: 2024, dependentsUnder17: 2 },
    w2s: [{ taxYear: 2024, wagesBox1: 40000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("N10 federal income tax (pre-credit) = $1,841", r.federalTaxLiability, 1841, 1);
  check("N10 CTC nonrefundable portion = $1,841 (offsets the tax)", r.childTaxCredit.nonRefundablePortion, 1841, 1);
  check("N10 ACTC refundable = $2,159", r.additionalChildTaxCredit, 2159, 1);
  check("N10 EITC = $3,320.83", r.eitc.appliedCredit, 3320.83, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// N11 — MA 4% millionaire's surtax (state pipeline)
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, MA, W-2 $1,200,000. TY2024.
// Hand-calc (MA 5% flat + 4% surtax > $1,053,750; MA std ded 0):
//   State tax = 5% × 1,200,000 + 4% × (1,200,000 − 1,053,750 = 146,250)
//     = 60,000 + 5,850 = 65,850.
section("N11 — MA millionaire's surtax");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "MA", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 1200000, stateCode: "MA" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("N11 MA state tax = $65,850 (5% + 4% surtax)", r.stateTaxLiability, 65850, 2);
}

// ════════════════════════════════════════════════════════════════════════════
// N12 — STL-02: Philadelphia local EIT base includes SE net profit
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, PA, Philadelphia resident, W-2 $80,000 + Schedule C net
// $20,000. TY2024.
// Hand-calc:
//   Philly resident EIT base = wages 80,000 + SE net profit 20,000 = 100,000.
//   Local EIT = 100,000 × 3.75% = 3,750. (Pre-STL-02: wages-only → $3,000.)
//   net SE = 20,000 × 0.9235 = 18,470; SE tax 2,825.91; half 1,412.96.
//   AGI = 100,000 − 1,412.96 = 98,587.04.
section("N12 — STL-02 Philadelphia EIT includes SE profit");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "PA", taxYear: 2024, localityCode: "PA-PHILADELPHIA" },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, stateCode: "PA" }],
    form1099s: [],
    adjustments: [{ adjustmentType: "self_employment_income", amount: 20000, isApplied: true }],
    taxYear: 2024,
  });
  check("N12 AGI = $98,587.04", r.adjustedGrossIncome, 98587.04, 1);
  check("N12 Philly local EIT = $3,750 (wages + SE base)", r.localTaxLiability, 3750, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// N13 — Social Security taxability worksheet (Pub 915) — retiree
// ════════════════════════════════════════════════════════════════════════════
// Profile: MFJ, FL, both 68, SS benefits $40,000 + IRA distribution $30,000
// (1099-R) + $20,000 LTCG. TY2024.
// Hand-calc (Pub 915 MFJ thresholds $32,000 / $44,000):
//   Other income = 30,000 IRA + 20,000 LTCG = 50,000.
//   Provisional = 50,000 + 50% × 40,000 = 70,000 (> $44,000).
//   Taxable SS = min(0.85 × 40,000 = 34,000,
//                    0.85 × (70,000 − 44,000) + min(0.5 × 40,000, 6,000)
//                    = 22,100 + 6,000 = 28,100) = 28,100.
//   AGI = 50,000 + 28,100 = 78,100.
section("N13 — Social Security taxability (Pub 915)");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024,
      taxpayerAge: 68, spouseAge: 68, socialSecurityBenefits: 40000 },
    w2s: [],
    form1099s: [
      { taxYear: 2024, formType: "r", grossDistribution: 30000, taxableAmount: 30000, distributionCode: "7" },
      { taxYear: 2024, formType: "b", longTermGainLoss: 20000 },
    ],
    adjustments: [],
    taxYear: 2024,
  });
  check("N13 AGI = $78,100 (28,100 taxable SS)", r.adjustedGrossIncome, 78100, 1);
  check("N13 taxable SS = $28,100", r.socialSecurityTaxabilityDetail.taxableAmount, 28100, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// N14 — FED-03 MFJ: per-spouse FEIE cap + NIIT MAGI add-back
// ════════════════════════════════════════════════════════════════════════════
// Profile: MFJ, FL, taxpayer foreign earned $130,000 + spouse foreign earned
// $130,000 + $100,000 LTCG. TY2024.
// Hand-calc:
//   FEIE cap $126,500 PER SPOUSE → exclusion 126,500 + 126,500 = 253,000.
//   Foreign left in AGI = (130,000 − 126,500) × 2 = 7,000.
//   AGI = 7,000 + 100,000 LTCG = 107,000.
//   NIIT MAGI = 107,000 + 253,000 FEIE add-back = 360,000.
//   NII = 100,000 LTCG; MFJ threshold $250,000.
//   NIIT = 3.8% × min(100,000, 360,000 − 250,000 = 110,000) = 3,800.
section("N14 — FED-03 MFJ per-spouse FEIE + NIIT");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: 100000 }],
    adjustments: [
      { adjustmentType: "foreign_earned_income", amount: 130000, isApplied: true },
      { adjustmentType: "foreign_earned_income_spouse", amount: 130000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("N14 AGI = $107,000 (per-spouse $126,500 cap)", r.adjustedGrossIncome, 107000, 1);
  check("N14 NIIT = $3,800 (both FEIEs added back)", r.niitTax, 3800, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// N15 — §1202 QSBS exclusion cap (10×basis vs $10M) + remainder in NIIT
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, W-2 $150,000 + QSBS sale gross gain $12,000,000,
// adjusted basis $200,000. TY2024 (100% post-2010-09-27 acquisition).
// Hand-calc:
//   Exclusion = min(12,000,000, max($10,000,000, 10 × 200,000 = 2,000,000))
//     = min(12,000,000, 10,000,000) = 10,000,000.
//   Taxable QSBS LTCG remainder = 12,000,000 − 10,000,000 = 2,000,000.
//   AGI = 150,000 + 2,000,000 = 2,150,000.
//   NII includes the taxable QSBS remainder; MAGI 2,150,000, single $200k.
//   NIIT = 3.8% × min(2,000,000, 2,150,000 − 200,000 = 1,950,000) = 74,100.
section("N15 — §1202 QSBS exclusion cap + NIIT");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 150000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "qsbs_gross_gain", amount: 12000000, isApplied: true },
      { adjustmentType: "qsbs_adjusted_basis", amount: 200000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("N15 AGI = $2,150,000 ($10M excluded)", r.adjustedGrossIncome, 2150000, 1);
  check("N15 NIIT = $74,100 (QSBS remainder in NII)", r.niitTax, 74100, 2);
}

// ════════════════════════════════════════════════════════════════════════════
// N16 — Schedule A: SALT $10k cap binds; itemized beats standard
// ════════════════════════════════════════════════════════════════════════════
// Profile: MFJ, FL, W-2 $300,000, property tax $12,000, mortgage interest
// $20,000, charitable cash $10,000. TY2024. (FL: no state income tax, so SALT
// = property tax alone, which still exceeds the $10k cap.)
// Hand-calc (Schedule A):
//   SALT = min(12,000 property + 0 state income, 10,000 cap) = 10,000.
//   Mortgage interest = 20,000; charitable cash = 10,000 (< 60% AGI).
//   Total itemized = 10,000 + 20,000 + 10,000 = 40,000 (> 29,200 MFJ std).
section("N16 — Schedule A SALT cap + itemize");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 300000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "state_property_tax", amount: 12000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 20000, isApplied: true },
      { adjustmentType: "charitable_cash", amount: 10000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("N16 SALT deductible = $10,000 (cap binds)", r.scheduleA.saltDeductible, 10000, 1);
  check("N16 total itemized = $40,000", r.scheduleA.totalItemized, 40000, 1);
  check("N16 taxable income = $260,000 (itemized used)", r.taxableIncome, 260000, 1);
}

// ── Results ──────────────────────────────────────────────────────────────────
console.log(`\nRESULTS: ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.join("\n")); process.exit(1); }
