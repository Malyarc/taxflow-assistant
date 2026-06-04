/**
 * Real-world end-to-end CPA scenarios — invoke computeTaxReturnPure directly
 * with hand-built inputs (NO DB / NO API). Each scenario carries a `Hand-calc:`
 * block computed line-by-line against published IRS rules BEFORE asserting,
 * per the project's hard rule (hand-calc, then verify).
 *
 * These were authored during the 2026-05-28 deep audit to (a) lock the
 * H-1/H-2/M-1/M-3 correctness fixes as regressions, and (b) stress the engine
 * with stacked-feature returns that a CPA would hand-prepare.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-realworld-scenarios-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 1) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)} (Δ ${(actual - expected).toFixed(2)})`);
}
function checkExact<T>(label: string, actual: T, expected: T) {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

// ════════════════════════════════════════════════════════════════════════════
// S1 — QBI taxable-income cap reduced by net capital gain (catches H-1)
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, $20k Schedule C consulting + $300k LTCG (1099-B). TY2024.
//
// Hand-calc:
//   SE tax: $20,000 × 0.9235 = $18,470 net SE → × 15.3% = $2,825.91; half = $1,412.96
//   QBI income = Sch C net − half-SE = $20,000 − $1,412.96 = $18,587.04
//     preliminary QBI = 20% × $18,587.04 = $3,717.41
//   Total income = $20,000 + $300,000 = $320,000
//   AGI = $320,000 − $1,412.96 (half-SE) = $318,587.04
//   Taxable before QBI = $318,587.04 − $14,600 std = $303,987.04
//   §199A(e)(3) net capital gain = LTCG $300,000 + QDIV $0 = $300,000
//   QBI cap = 20% × ($303,987.04 − $300,000) = 20% × $3,987.04 = $797.41  ← THE FIX
//     (buggy engine capped at 20% × $303,987 = $60,797 → wrongly allowed $3,717.41)
//   Final QBI deduction = min($3,717.41, $797.41) = $797.41
//   NIIT: MAGI $318,587 > $200k single threshold; NII = $300,000 LTCG
//     NIIT = 3.8% × min($300,000, $318,587.04 − $200,000) = 3.8% × $118,587.04 = $4,506.31
{
  header("S1 — QBI cap reduced by net capital gain (H-1)");
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [
      { taxYear: 2024, formType: "b", longTermGainLoss: 300000 },
    ],
    adjustments: [
      { adjustmentType: "self_employment_income", amount: 20000, isApplied: true },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("S1 AGI = $318,587.04", r.adjustedGrossIncome, 318587.04, 2);
  check("S1 QBI deduction = $797.41 (capped by net cap gain)", r.qbiDeduction, 797.41, 1);
  check("S1 NIIT = $4,506.31", r.niitTax, 4506.31, 2);
}

// ── Summary ──────────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════
// S2 — NIIT on passive rental net income (catches H-2)
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, $300k W-2 + $100k passive Schedule-E rental net income. TY2024.
// Hand-calc:
//   AGI = $300,000 wages + $100,000 rental net = $400,000
//   §1411 NII = passive rental net $100,000 (rents are passive → NII)
//   NIIT (single $200k threshold), MAGI $400,000
//     = 3.8% × min($100,000, $400,000 − $200,000) = 3.8% × $100,000 = $3,800
//   (Pre-fix: rental excluded from NII → NIIT $0.)
{
  header("S2 — NIIT on passive rental (H-2)");
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 300000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "schedule_e_rental_income", amount: 100000, isApplied: true },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("S2 AGI = $400,000 (rental flows to AGI)", r.adjustedGrossIncome, 400000, 1);
  check("S2 NIIT = $3,800 (passive rental now in NII)", r.niitTax, 3800, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// S3 — NIIT on K-1 portfolio income (catches H-2)
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, $250k W-2 + brokerage K-1 (Box 5 interest $20k, Box 9a LTCG $100k). TY2024.
// Hand-calc:
//   AGI = $250,000 wages + $20,000 K-1 interest + $100,000 K-1 LTCG = $370,000
//   §1411 NII = K-1 interest $20,000 + post-netting LTCG $100,000 = $120,000
//   NIIT (single $200k threshold) = 3.8% × min($120,000, $370,000 − $200,000)
//     = 3.8% × $120,000 = $4,560
//   (Pre-fix: K-1 portfolio income excluded from NII → NIIT $0.)
{
  header("S3 — NIIT on K-1 portfolio income (H-2)");
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 250000, stateCode: "FL" }],
    form1099s: [],
    scheduleK1: [
      { taxYear: 2024, entityType: "partnership", activityType: "passive",
        interestIncome: 20000, netLongTermCapitalGain: 100000 },
    ],
    adjustments: [],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("S3 AGI = $370,000", r.adjustedGrossIncome, 370000, 1);
  check("S3 NIIT = $4,560 (K-1 interest + LTCG in NII)", r.niitTax, 4560, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// S4 — NIIT on §121 home-sale taxable remainder (catches M-1)
// ════════════════════════════════════════════════════════════════════════════
// Profile: MFJ, FL, $250k W-2 + $900k gain on primary residence. TY2024.
// Hand-calc:
//   §121 exclusion (MFJ) = $500,000; taxable LTCG remainder = $900,000 − $500,000 = $400,000
//   AGI = $250,000 wages + $400,000 LTCG = $650,000
//   §1411 NII = $400,000 home-sale LTCG (now flows into NII via post-netting gain)
//   NIIT (MFJ $250k threshold) = 3.8% × min($400,000, $650,000 − $250,000)
//     = 3.8% × $400,000 = $15,200
//   (Pre-fix: §121 remainder excluded from NII → NIIT $0 on the home sale.)
{
  header("S4 — NIIT on §121 home-sale remainder (M-1)");
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 250000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "home_sale_gross_gain_primary_residence", amount: 900000, isApplied: true },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("S4 §121 taxable remainder in AGI → AGI $650,000", r.adjustedGrossIncome, 650000, 1);
  check("S4 NIIT = $15,200 (home-sale LTCG now in NII)", r.niitTax, 15200, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// S5 — Charitable overall AGI ceiling (catches M-2)
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, $100k W-2, $70k cash + $40k capital-gain property to a
// public charity. TY2024.
// Hand-calc (IRC §170(b)(1) + Pub 526):
//   Cash limit 60% × $100,000 = $60,000 → cash deductible = min($70k, $60k) = $60,000
//   Property: min(30% × $100k = $30,000, 50% × $100k − $60k cash = max(0, −$10k) = $0) = $0
//   Charitable deductible = $60,000  (NOT $90,000 — the old independent-cap bug)
//   Excess ($10k cash over the 60% cap + $40k property) carries forward (cash modeled).
{
  header("S5 — Charitable overall AGI ceiling (M-2)");
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "charitable_cash", amount: 70000, isApplied: true },
      { adjustmentType: "charitable_property", amount: 40000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("S5 charitable deductible = $60,000 (overall ceiling, not $90k)", r.scheduleA.charitableDeductible, 60000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// S6 — Dependent-care credit disallowed for MFS (catches M-3)
// ════════════════════════════════════════════════════════════════════════════
// Profile: MFS, $50k W-2, 1 qualifying child, $3,000 dependent-care expenses. TY2024.
// Hand-calc (§21(e)(2)): a standard MFS filer (not lived-apart) → credit = $0.
//   (Without the guard: AGI $50k > $43k → 20% rate × min($3,000 expenses) = $600.)
// Control: an identical SINGLE filer DOES get the $600 credit.
{
  header("S6 — Dependent-care credit MFS disallowance (M-3)");
  const mfs = computeTaxReturnPure({
    client: { filingStatus: "married_filing_separately", state: "FL", taxYear: 2024,
      dependentsUnder17: 1, dependentsForCareCredit: 1 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [{ adjustmentType: "dependent_care_expenses", amount: 3000, isApplied: true }],
    taxYear: 2024,
  });
  checkExact("S6 MFS dependent-care credit = $0 (§21(e)(2))", mfs.dependentCareCredit.appliedCredit, 0);
  const single = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024,
      dependentsUnder17: 1, dependentsForCareCredit: 1 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [{ adjustmentType: "dependent_care_expenses", amount: 3000, isApplied: true }],
    taxYear: 2024,
  });
  check("S6 control: SINGLE dependent-care credit = $600 (20% × $3,000)", single.dependentCareCredit.appliedCredit, 600, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// S7 — Real-estate professional: rental EXCLUDED from NII (mirror of S2)
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, $300k W-2 + $100k rental net, client IS a real-estate
// professional (rental is non-passive → NOT net investment income). TY2024.
// Hand-calc: AGI = $400,000 (rental still flows to AGI). NII = $0 (rental
// excluded for RE pros, wages are never NII) → NIIT = $0.
{
  header("S7 — RE-professional rental excluded from NII");
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, rentalRealEstateProfessional: true },
    w2s: [{ taxYear: 2024, wagesBox1: 300000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [{ adjustmentType: "schedule_e_rental_income", amount: 100000, isApplied: true }],
    taxYear: 2024,
  });
  check("S7 AGI = $400,000", r.adjustedGrossIncome, 400000, 1);
  check("S7 NIIT = $0 (RE-professional rental is non-passive)", r.niitTax, 0, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// S8 — Royalty earner: NIIT on 1099-MISC royalties
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, $220k W-2 + $60k 1099-MISC Box 2 royalties. TY2024.
// Hand-calc: AGI = $220,000 + $60,000 = $280,000. NII = royalties $60,000.
//   NIIT = 3.8% × min($60,000, $280,000 − $200,000) = 3.8% × $60,000 = $2,280.
{
  header("S8 — NIIT on 1099-MISC royalties");
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 220000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "misc", royalties: 60000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("S8 AGI = $280,000", r.adjustedGrossIncome, 280000, 1);
  check("S8 NIIT = $2,280 (royalties are NII)", r.niitTax, 2280, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// S9 — Net capital loss: $3k ordinary offset + NII floored at $0
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, $250k W-2 + 1099-B $20k LTCG and −$50k STCG. TY2024.
// Hand-calc: cross-net → net $30k LT/ST loss. $3,000 offsets ordinary income;
//   $27k carries forward. AGI = $250,000 − $3,000 = $247,000.
//   No positive investment gain → NII floored at $0 → NIIT = $0.
{
  header("S9 — Net capital loss: $3k offset + NII floor");
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 250000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: 20000, shortTermGainLoss: -50000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("S9 AGI = $247,000 ($3k capital-loss offset)", r.adjustedGrossIncome, 247000, 1);
  check("S9 NIIT = $0 (no positive NII)", r.niitTax, 0, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// S10 — Qualifying surviving spouse: §121 $500k cap + $250k NIIT threshold
// ════════════════════════════════════════════════════════════════════════════
// Profile: QSS, FL, $180k W-2 + $900k primary-residence gain + 2 kids. TY2024.
// Hand-calc: §121 cap (QSS = MFJ) = $500,000 → taxable home LTCG = $400,000.
//   AGI = $180,000 + $400,000 = $580,000.
//   NIIT (QSS $250k threshold) = 3.8% × min($400,000, $580,000 − $250,000)
//     = 3.8% × $330,000 = $12,540.
{
  header("S10 — QSS §121 $500k cap + NIIT");
  const r = computeTaxReturnPure({
    client: { filingStatus: "qualifying_widow", state: "FL", taxYear: 2024, dependentsUnder17: 2 },
    w2s: [{ taxYear: 2024, wagesBox1: 180000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [{ adjustmentType: "home_sale_gross_gain_primary_residence", amount: 900000, isApplied: true }],
    taxYear: 2024,
  });
  check("S10 §121 taxable remainder = $400,000", r.homeSaleTaxableGain, 400000, 1);
  check("S10 AGI = $580,000", r.adjustedGrossIncome, 580000, 1);
  check("S10 NIIT = $12,540 (QSS $250k threshold)", r.niitTax, 12540, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// S11 — Social Security taxability (Pub 915 85%) + IRA + LTCG
// ════════════════════════════════════════════════════════════════════════════
// Profile: MFJ, MN, age 70, $60k SS benefits + $120k IRA distribution + $50k LTCG. TY2024.
// Hand-calc (Pub 915): provisional income = $120k + $50k + ½×$60k = $200k ≫
//   $44k MFJ top threshold → 85% of SS taxable = 0.85 × $60,000 = $51,000.
//   AGI = $120,000 IRA + $50,000 LTCG + $51,000 taxable SS = $221,000.
//   NIIT: NII = $50,000 LTCG; MAGI $221,000 < $250k MFJ threshold → NIIT = $0.
{
  header("S11 — SS taxability (Pub 915 85%) + IRA + LTCG");
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "MN", taxYear: 2024, taxpayerAge: 70, socialSecurityBenefits: 60000 },
    w2s: [],
    form1099s: [
      { taxYear: 2024, formType: "r", grossDistribution: 120000, taxableAmount: 120000, distributionCode: "7" },
      { taxYear: 2024, formType: "b", longTermGainLoss: 50000 },
    ],
    adjustments: [],
    taxYear: 2024,
  });
  check("S11 AGI = $221,000 (85% of SS taxable)", r.adjustedGrossIncome, 221000, 1);
  check("S11 NIIT = $0 (MAGI under $250k MFJ threshold)", r.niitTax, 0, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// S12 — HNW stacked (CA): NIIT including passive K-1, at scale
// ════════════════════════════════════════════════════════════════════════════
// Profile: MFJ, CA, $600k W-2 + $300k LTCG (1099-B) + $150k passive K-1 ordinary
//   + 3 kids. TY2024.
// Hand-calc: AGI = $600k + $300k + $150k = $1,050,000.
//   NII = $300k LTCG + $150k passive K-1 = $450,000.
//   NIIT = 3.8% × min($450,000, $1,050,000 − $250,000) = 3.8% × $450,000 = $17,100.
//   CTC: fully phased out at $1.05M MFJ → $0 (not asserted here).
{
  header("S12 — HNW stacked: NIIT incl. passive K-1 (CA)");
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "CA", taxYear: 2024, dependentsUnder17: 3 },
    w2s: [{ taxYear: 2024, wagesBox1: 600000, stateCode: "CA" }],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: 300000 }],
    scheduleK1: [{ taxYear: 2024, entityType: "partnership", activityType: "passive", box1OrdinaryIncome: 150000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("S12 AGI = $1,050,000", r.adjustedGrossIncome, 1050000, 1);
  check("S12 NIIT = $17,100 (LTCG + passive K-1 in NII)", r.niitTax, 17100, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// S13 — Simple single filer (easy-end sanity anchor)
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, $60k W-2, $6k federal withheld. TY2024.
// Hand-calc: AGI $60,000 − $14,600 std = $45,400 taxable.
//   Tax = $1,160 (10% to $11,600) + ($45,400 − $11,600) × 12% = $1,160 + $4,056 = $5,216.
//   Refund = $6,000 − $5,216 = $784.
{
  header("S13 — Simple single $60k (sanity anchor)");
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 6000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("S13 taxable income = $45,400", r.taxableIncome, 45400, 1);
  check("S13 federal tax = $5,216", r.federalTaxLiability, 5216, 2);
  check("S13 refund = $784", r.federalRefundOrOwed, 784, 2);
}

// ════════════════════════════════════════════════════════════════════════════
// S14 — Cap-gains preferential base capped at taxable income (QDCGT wksht L10)
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, FL, $5,000,000 LTCG only (no ordinary income). TY2024.
// Hand-calc (IRS Qualified Dividends & Cap Gain Tax Worksheet):
//   AGI $5,000,000; std ded $14,600 → taxable $4,985,400 (ALL preferential).
//   QDCGT L10 caps the preferential amount taxed at MIN(net cap gain, taxable)
//     = min($5,000,000, $4,985,400) = $4,985,400 (the std ded reduces the gain
//     subject to tax because there is no ordinary income to absorb it).
//   0% to $47,025 → $0
//   15% on ($518,900 − $47,025 = $471,875) → $70,781.25
//   20% on ($4,985,400 − $518,900 = $4,466,500) → $893,300.00
//   capGainsTax = $964,081.25.  (Pre-fix bug taxed the FULL $5,000,000 →
//   $967,001.25, over by $14,600 × 20% = $2,920 — the "lost" std deduction.)
{
  header("S14 — cap-gains preferential base capped at taxable income (single)");
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: 5000000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("S14 taxable income = $4,985,400", r.taxableIncome, 4985400, 1);
  check("S14 capital-gains tax = $964,081.25 (pref base capped, not $967,001.25)", r.capitalGainsTax, 964081.25, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// S15 — Same cap, MFJ (larger std deduction → larger correction)
// ════════════════════════════════════════════════════════════════════════════
// Profile: MFJ, FL, $5,000,000 LTCG only. TY2024.
// Hand-calc: std ded $29,200 → taxable $4,970,800 (preferential cap).
//   0% to $94,050 → $0 ; 15% on ($583,750 − $94,050 = $489,700) → $73,455
//   20% on ($4,970,800 − $583,750 = $4,387,050) → $877,410 ; total $950,865.
//   (Pre-fix taxed full $5M → $956,705, over by $29,200 × 20% = $5,840.)
{
  header("S15 — cap-gains preferential base capped at taxable income (MFJ)");
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: 5000000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("S15 capital-gains tax = $950,865 (MFJ pref base capped)", r.capitalGainsTax, 950865, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// S16 — Realistic retiree living off qualified dividends (cap binds at 15%)
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single retiree, FL, $120,000 qualified dividends only. TY2024.
// Hand-calc: AGI $120,000; std ded $14,600 → taxable $105,400 (all QDIV).
//   QDCGT L10 cap = min($120,000, $105,400) = $105,400.
//   0% to $47,025 → $0 ; 15% on ($105,400 − $47,025 = $58,375) → $8,756.25.
//   No 20% (taxable < $518,900). No NIIT (AGI < $200k). capGainsTax $8,756.25.
//   (Pre-fix taxed full $120,000 → 15% on $72,975 = $10,946.25, over by $2,190.)
{
  header("S16 — retiree on $120k QDIV (cap binds in the 15% bracket)");
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "div", ordinaryDividends: 120000, qualifiedDividends: 120000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("S16 taxable income = $105,400", r.taxableIncome, 105400, 1);
  check("S16 capital-gains tax = $8,756.25 (QDIV pref base capped at taxable)", r.capitalGainsTax, 8756.25, 1);
  check("S16 federal tax = $8,756.25 (no ordinary tax, no NIIT)", r.federalTaxLiability, 8756.25, 2);
}

// ════════════════════════════════════════════════════════════════════════════
// S17 — Part-year mover: former-state income taxed ONCE, not double-counted
// ════════════════════════════════════════════════════════════════════════════
// Profile: Single, NY→FL on 2024-07-01, $200k W-2 (NY-sourced) + $8k QDIV +
//   $12k LTCG distribution. AGI $220,000.
// Hand-calc (engine day-proration model, E12):
//   NY resident days = Jan 1–Jul 1 = 182 of 366. NY pro-rated AGI =
//     220,000 × 182/366 = $109,398.91. NY tax on (that − pro-rated NY std ded)
//     ≈ $5,757 (formerStateTax).
//   Total state tax = NY former-state $5,757 + TX resident $0. The NY W-2 must
//   NOT ALSO be taxed as NON-RESIDENT NY income (the pre-fix bug summed both →
//   $16,709, MORE than a full-year NY resident — impossible).
//   INVARIANT: a part-year resident pays ≤ a full-year former-state resident.
{
  header("S17 — part-year former-state income taxed once (no double-count)");
  const partYear = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, residencyChangedInYear: true, formerState: "NY", residencyChangeDate: "2024-07-01" },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 38000, stateCode: "NY" }],
    form1099s: [{ taxYear: 2024, formType: "div", ordinaryDividends: 8000, qualifiedDividends: 8000, totalCapitalGainDistribution: 12000 }],
    adjustments: [],
    taxYear: 2024,
  });
  const fullYearNy = computeTaxReturnPure({
    client: { filingStatus: "single", state: "NY", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 38000, stateCode: "NY" }],
    form1099s: [{ taxYear: 2024, formType: "div", ordinaryDividends: 8000, qualifiedDividends: 8000, totalCapitalGainDistribution: 12000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("S17 part-year state tax = $5,757 (NY former-state only, no NR double-count)", partYear.stateTaxLiability, 5757, 1);
  checkExact("S17 INVARIANT: part-year ≤ full-year former-state resident", partYear.stateTaxLiability <= fullYearNy.stateTaxLiability, true);
}

const total = PASS.length + FAIL.length;
console.log(`\n${"═".repeat(66)}`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed (${total} total)`);
if (FAIL.length) {
  console.log("\nFAILURES:");
  for (const f of FAIL) console.log("  " + f);
  process.exit(1);
}
console.log("ALL REAL-WORLD SCENARIO ASSERTIONS PASS");
