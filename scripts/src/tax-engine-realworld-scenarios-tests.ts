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

const total = PASS.length + FAIL.length;
console.log(`\n${"═".repeat(66)}`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed (${total} total)`);
if (FAIL.length) {
  console.log("\nFAILURES:");
  for (const f of FAIL) console.log("  " + f);
  process.exit(1);
}
console.log("ALL REAL-WORLD SCENARIO ASSERTIONS PASS");
