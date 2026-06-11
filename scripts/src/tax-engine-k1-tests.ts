/**
 * BP1 — Schedule K-1 pure-engine tests.
 *
 * Invokes computeTaxReturnPure directly. No DB, no API.
 *
 * Hand-calc references:
 *   - 2024 single std ded: $14,600
 *   - 2024 single brackets (Rev. Proc. 2023-34):
 *       10% up to $11,600
 *       12% to $47,150 ($35,550 width)
 *       22% to $100,525 ($53,375 width)
 *       24% to $191,950 ($91,425 width)
 *       32% to $243,725 ($51,775 width)
 *       35% to $609,350 ($365,625 width)
 *       37% above
 *   - §199A §1.199A-1 / Form 8995: 20% × QBI, capped at 20% × (TI − net cap gain)
 *     Wage/UBIA limit only binds above the income threshold (skipped per known limit)
 *   - 1065 K-1: Box 1 ordinary biz income → Sch E Part II → Sch 1 Line 5 → 1040 Line 8
 *   - 1120-S K-1: same flow, but no SE on Box 1
 *   - §469 K-1 passive bucket: net loss fully suspended (no $25k allowance — that's
 *     rental-RE active-participation only). Suspended → carryforward.
 *   - Schedule SE: 2024 base = 92.35% × SE net; SS portion 12.4% to $168,600;
 *     Medicare 2.9% all of it; deductible half = total / 2.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-k1-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 0.5) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}
function checkExact<T>(label: string, actual: T, expected: T) {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

// ════════════════════════════════════════════════════════════════════════════
// Test A — S-corp K-1 active, $50k ordinary biz income, no QBI flow
// ════════════════════════════════════════════════════════════════════════════
// Filer: single 2024, $80k W-2, $50k S-corp K-1 (active, Box 1 only)
// Hand-calc:
//   Total income = wages 80,000 + K-1 active ordinary 50,000 = 130,000
//   AGI = 130,000 (no above-the-line items)
//   Std ded = 14,600
//   Taxable before QBI = 115,400
//   No QBI: deduction = 0
//   Taxable = 115,400
//   Federal tax (single 2024):
//     10% × 11,600                = 1,160.00
//     12% × (47,150 − 11,600)     = 12% × 35,550 = 4,266.00
//     22% × (100,525 − 47,150)    = 22% × 53,375 = 11,742.50
//     24% × (115,400 − 100,525)   = 24% × 14,875 =  3,570.00
//     ──────────────────────────────────────────────────────
//     Total                                       = 20,738.50
//   S-corp Box 1 → NO SE tax (shareholders aren't SE on distributive share)
header("Test A — S-corp K-1 active, $50k ordinary biz income");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [
      {
        taxYear: 2024,
        entityName: "Acme S Corp",
        entityType: "s_corp",
        activityType: "active",
        box1OrdinaryIncome: 50000,
      },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("Total income = $130,000", r.totalIncome, 130000, 1);
  check("AGI = $130,000", r.adjustedGrossIncome, 130000, 1);
  // C3 follow-up (2026-05-27 PM): §199A QBI now auto-defaults from K-1
  // Box 1 active S-corp ordinary income. QBI deduction = 20% × $50,000 = $10,000.
  // Taxable: $115,400 − $10,000 = $105,400.
  // Federal tax (single TY2024 brackets):
  //   10% × 11,600 = 1,160.00
  //   12% × 35,550 = 4,266.00
  //   22% × 53,375 = 11,742.50
  //   24% × (105,400 − 100,525) = 24% × 4,875 = 1,170.00
  //   Total                                  = 18,338.50
  check("Taxable income = $105,400 (post-QBI auto)", r.taxableIncome, 105400, 1);
  check("Federal tax = $18,338.50 (post-QBI auto)", r.federalTaxLiability, 18338.5, 1);
  checkExact("No SE tax on S-corp K-1", r.selfEmploymentTax ?? 0, 0);
  check("QBI deduction = $10,000 (auto from K-1 active Box 1)", r.qbiDeduction ?? 0, 10000, 0.01);
  checkExact("K-1 count = 1", r.scheduleK1.k1Count, 1);
  checkExact("S-corp count = 1", r.scheduleK1.sCorpCount, 1);
  checkExact("Partnership count = 0", r.scheduleK1.partnershipCount, 0);
  check("K-1 active ordinary = $50,000", r.scheduleK1.totalActiveOrdinaryIncome, 50000, 0.01);
  check("K-1 passive bucket applied = $0", r.scheduleK1.totalPassiveBucketNetApplied, 0, 0.01);
  check("K-1 passive suspended = $0", r.scheduleK1.k1PassiveLossSuspended, 0, 0.01);
  check("K-1 SE earnings = $0 (S-corp)", r.scheduleK1.totalSelfEmploymentEarnings, 0, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// Test B — Partnership K-1 passive, $30k loss, fully suspended
// ════════════════════════════════════════════════════════════════════════════
// Filer: single 2024, $80k W-2, partnership K-1 passive Box 1 = −$30k
// Hand-calc:
//   Total income = 80,000 (passive loss fully suspended — no $25k allowance)
//   AGI = 80,000
//   Std ded = 14,600
//   Taxable = 65,400
//   Federal tax:
//     10% × 11,600              = 1,160.00
//     12% × 35,550              = 4,266.00
//     22% × (65,400 − 47,150)   = 22% × 18,250 = 4,015.00
//     ──────────────────────────────────────────────
//     Total                                   = 9,441.00
//   K-1 passive loss suspended = 30,000 (carries to 2025 via k1_passive_loss_carryforward)
header("Test B — Partnership K-1 passive, $30k loss, fully suspended");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [
      {
        taxYear: 2024,
        entityName: "Sleepy Partners LP",
        entityType: "partnership",
        activityType: "passive",
        box1OrdinaryIncome: -30000,
      },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("Total income = $80,000 (loss suspended)", r.totalIncome, 80000, 1);
  check("AGI = $80,000", r.adjustedGrossIncome, 80000, 1);
  check("Taxable income = $65,400", r.taxableIncome, 65400, 1);
  check("Federal tax = $9,441.00", r.federalTaxLiability, 9441, 1);
  check("K-1 passive applied to AGI = $0", r.scheduleK1.totalPassiveBucketNetApplied, 0, 0.01);
  check("K-1 passive suspended = $30,000", r.scheduleK1.k1PassiveLossSuspended, 30000, 0.01);
  check("K-1 active ordinary = $0", r.scheduleK1.totalActiveOrdinaryIncome, 0, 0.01);
  checkExact("Partnership count = 1", r.scheduleK1.partnershipCount, 1);
  checkExact("S-corp count = 0", r.scheduleK1.sCorpCount, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// Test C — Partnership K-1 active with §199A QBI flow
// ════════════════════════════════════════════════════════════════════════════
// Filer: single 2024, $50k W-2, partnership K-1 active
//   Box 1 ordinary biz income = $80,000
//   Box 14A SE earnings = $0 (modeled to keep hand-calc clean — e.g. real
//     estate / investment LP without active services; §1402(a)(13) carve-out)
//   Box 20 Z: QBI = $80,000, W-2 wages = $0, UBIA = $0
// Hand-calc:
//   Total income = wages 50,000 + K-1 active 80,000 = 130,000
//   AGI = 130,000 (no SE deduction since SE = 0)
//   Std ded = 14,600
//   Taxable BEFORE QBI = 115,400
//   §199A QBI deduction:
//     preliminary = 20% × 80,000 = 16,000
//     cap          = 20% × 115,400 = 23,080
//     final        = min(16,000, 23,080) = 16,000
//   (TI is below the $191,950 single 2024 threshold so wage/UBIA limit does
//    not bind — engine's current simplified §199A is the correct answer.)
//   Taxable AFTER QBI = 99,400
//   Federal tax:
//     10% × 11,600              = 1,160.00
//     12% × 35,550              = 4,266.00
//     22% × (99,400 − 47,150)   = 22% × 52,250 = 11,495.00
//     ────────────────────────────────────────────────
//     Total                                   = 16,921.00
header("Test C — Partnership K-1 active with §199A QBI flow");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [
      {
        taxYear: 2024,
        entityName: "QBI LP",
        entityType: "partnership",
        activityType: "active",
        box1OrdinaryIncome: 80000,
        selfEmploymentEarnings: 0,
        section199aQbi: 80000,
        section199aW2Wages: 0,
        section199aUbia: 0,
      },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("Total income = $130,000", r.totalIncome, 130000, 1);
  check("AGI = $130,000", r.adjustedGrossIncome, 130000, 1);
  check("QBI deduction = $16,000", r.qbiDeduction ?? 0, 16000, 0.01);
  check("Taxable income (after QBI) = $99,400", r.taxableIncome, 99400, 1);
  check("Federal tax = $16,921.00", r.federalTaxLiability, 16921, 1);
  check("K-1 QBI contribution = $80,000", r.scheduleK1.totalQbiContribution, 80000, 0.01);
  check("K-1 SE earnings = $0", r.scheduleK1.totalSelfEmploymentEarnings, 0, 0.01);
  checkExact("No SE tax", r.selfEmploymentTax ?? 0, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// Test D — Multiple K-1s: one S-corp active income, one partnership passive
//           income (offsets passive losses) and §199A flow on the S-corp
// ════════════════════════════════════════════════════════════════════════════
// Filer: single 2024, no W-2.
// K-1 #1: S-corp active, Box 1 = $60,000, §199A QBI = $60,000
// K-1 #2: Partnership passive, Box 1 = +$10,000 (passive income, not loss)
// Hand-calc:
//   Total income = K-1 active 60,000 + K-1 passive applied 10,000 = 70,000
//   AGI = 70,000
//   Std ded = 14,600
//   Taxable BEFORE QBI = 55,400
//   §199A: prelim 20% × 60,000 = 12,000; cap 20% × 55,400 = 11,080
//     final = min(12,000, 11,080) = 11,080  (cap binds — passive K-1 income
//     does NOT count as QBI here since it's classified passive and we model
//     only the §199A QBI explicitly entered on K-1; cap reflects total TI)
//   Taxable AFTER QBI = 55,400 − 11,080 = 44,320
//   Federal tax:
//     10% × 11,600           = 1,160.00
//     12% × (44,320 − 11,600) = 12% × 32,720 = 3,926.40
//     ──────────────────────────────────────────────
//     Total                                  = 5,086.40
header("Test D — Mixed K-1s: active S-corp w/ QBI + passive partnership income");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [],
    scheduleK1: [
      {
        taxYear: 2024,
        entityName: "Active S Corp",
        entityType: "s_corp",
        activityType: "active",
        box1OrdinaryIncome: 60000,
        section199aQbi: 60000,
      },
      {
        taxYear: 2024,
        entityName: "Passive LP",
        entityType: "partnership",
        activityType: "passive",
        box1OrdinaryIncome: 10000,
      },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("Total income = $70,000", r.totalIncome, 70000, 1);
  check("AGI = $70,000", r.adjustedGrossIncome, 70000, 1);
  check("QBI deduction = $11,080 (cap binds)", r.qbiDeduction ?? 0, 11080, 0.5);
  check("Taxable income (after QBI) = $44,320", r.taxableIncome, 44320, 1);
  check("Federal tax = $5,086.40", r.federalTaxLiability, 5086.4, 1);
  checkExact("K-1 count = 2", r.scheduleK1.k1Count, 2);
  checkExact("Partnership count = 1", r.scheduleK1.partnershipCount, 1);
  checkExact("S-corp count = 1", r.scheduleK1.sCorpCount, 1);
  check("K-1 active ordinary = $60,000", r.scheduleK1.totalActiveOrdinaryIncome, 60000, 0.01);
  check("K-1 passive applied = $10,000", r.scheduleK1.totalPassiveBucketNetApplied, 10000, 0.01);
  check("K-1 passive suspended = $0", r.scheduleK1.k1PassiveLossSuspended, 0, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// Test E — Passive K-1 income offsetting passive K-1 loss within the bucket
// ════════════════════════════════════════════════════════════════════════════
// Filer: single 2024, $80k W-2.
// K-1 #1: Partnership passive Box 1 = +$20,000
// K-1 #2: Partnership passive Box 1 = −$15,000
// Bucket netting: 20,000 − 15,000 = +$5,000 (passive income to AGI; no loss to suspend)
// Hand-calc:
//   AGI = 80,000 + 5,000 = 85,000
//   Std ded = 14,600 → Taxable = 70,400
//   Federal tax:
//     10% × 11,600                  = 1,160.00
//     12% × 35,550                  = 4,266.00
//     22% × (70,400 − 47,150)       = 22% × 23,250 = 5,115.00
//     ────────────────────────────────────────────
//     Total                                       = 10,541.00
header("Test E — Passive K-1 income offsets passive K-1 loss");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [
      {
        taxYear: 2024,
        entityName: "Winning LP",
        entityType: "partnership",
        activityType: "passive",
        box1OrdinaryIncome: 20000,
      },
      {
        taxYear: 2024,
        entityName: "Losing LP",
        entityType: "partnership",
        activityType: "passive",
        box1OrdinaryIncome: -15000,
      },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("AGI = $85,000", r.adjustedGrossIncome, 85000, 1);
  check("Taxable income = $70,400", r.taxableIncome, 70400, 1);
  check("Federal tax = $10,541.00", r.federalTaxLiability, 10541, 1);
  check("K-1 passive applied = $5,000 net", r.scheduleK1.totalPassiveBucketNetApplied, 5000, 0.01);
  check("K-1 passive suspended = $0", r.scheduleK1.k1PassiveLossSuspended, 0, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// Test F — Prior-year K-1 passive loss carryforward absorbs current income
// ════════════════════════════════════════════════════════════════════════════
// Filer: single 2024, $80k W-2.
// K-1: Partnership passive Box 1 = +$25,000
// Prior-year suspended K-1 passive loss = $40,000 (entered as
// k1_passive_loss_carryforward adjustment)
// Bucket netting: 25,000 (current) − 40,000 (carry) = −15,000 → fully suspended.
//   K-1 passive applied to AGI = 0 (no current-year net income flows)
//   K-1 passive suspended = 15,000 (carries to 2025)
// Hand-calc:
//   AGI = 80,000 (no K-1 income applied; loss bucket absorbs)
//   Std ded = 14,600 → Taxable = 65,400 → Federal tax = $9,441
header("Test F — Prior-year K-1 PAL carryforward absorbs current passive income");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "k1_passive_loss_carryforward", amount: 40000, isApplied: true },
    ],
    scheduleK1: [
      {
        taxYear: 2024,
        entityName: "Recovery LP",
        entityType: "partnership",
        activityType: "passive",
        box1OrdinaryIncome: 25000,
      },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("AGI = $80,000 (K-1 income absorbed by prior-year carry)", r.adjustedGrossIncome, 80000, 1);
  check("Taxable income = $65,400", r.taxableIncome, 65400, 1);
  check("Federal tax = $9,441.00", r.federalTaxLiability, 9441, 1);
  check("K-1 passive applied = $0", r.scheduleK1.totalPassiveBucketNetApplied, 0, 0.01);
  check("K-1 passive suspended = $15,000 (carryforward net)", r.scheduleK1.k1PassiveLossSuspended, 15000, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// Test G — Partnership K-1 with Box 14A SE earnings flows to Schedule SE
// ════════════════════════════════════════════════════════════════════════════
// Filer: single 2024, no W-2.
// K-1: Partnership active, Box 1 = $60,000, Box 14A SE earnings = $60,000
// (General partner — Box 1 = Box 14A is the common case.)
// Hand-calc:
//   Gross SE = 60,000
//   Net SE = 92.35% × 60,000 = 55,410
//   SS portion (12.4% to $168,600): 12.4% × 55,410 = 6,870.84
//   Medicare (2.9%): 2.9% × 55,410 = 1,606.89
//   SE tax = 8,477.73 (round to nearest cent)
//   Deductible half = 4,238.865 → engine uses 4,238.87 (or unrounded)
//   AGI = 60,000 (K-1 active ordinary) − 4,238.87 (½ SE) = 55,761.13
//   Std ded = 14,600 → Taxable = 41,161.13
//   Federal tax (single 2024):
//     10% × 11,600         = 1,160.00
//     12% × (41,161.13 − 11,600) = 12% × 29,561.13 = 3,547.34
//     ───────────────────────────────────────────
//     Total                                       = 4,707.34
header("Test G — Partnership K-1 Box 14A SE earnings → Schedule SE");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [],
    scheduleK1: [
      {
        taxYear: 2024,
        entityName: "GP LP",
        entityType: "partnership",
        activityType: "active",
        box1OrdinaryIncome: 60000,
        selfEmploymentEarnings: 60000,
      },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("Net SE earnings = $55,410", r.detail.se.netSeEarnings, 55410, 1);
  check("SE tax ≈ $8,477.73", r.selfEmploymentTax ?? 0, 8477.73, 0.5);
  check("AGI = $55,761.13 (K-1 active − ½ SE)", r.adjustedGrossIncome, 55761.13, 1);
  // C3 follow-up (2026-05-27 PM): §199A QBI now auto-defaults from K-1
  // Box 1 active partnership Box 1 = $60,000. Per Treas. Reg. §1.199A-3(b)(1)(vi),
  // QBI = trade/business income (not reduced by ½-SE). Preliminary deduction
  // = 20% × $60,000 = $12,000. Cap = 20% × taxable-before-QBI $41,161.13 = $8,232.23.
  // QBI deduction = min($12,000, $8,232.23) = $8,232.23.
  // Post-QBI taxable: $41,161.13 − $8,232.23 = $32,928.90.
  // Federal regular tax:
  //   10% × 11,600 = 1,160.00
  //   12% × (32,928.90 − 11,600) = 12% × 21,328.90 = 2,559.47
  //   Total reg                                    = 3,719.47
  // Plus SE tax $8,477.73 = $12,197.20.
  check("Taxable income = $32,928.90 (post-QBI auto)", r.taxableIncome, 32928.90, 0.5);
  check("QBI deduction = $8,232.23 (cap-bound)", r.qbiDeduction ?? 0, 8232.23, 0.5);
  check("Federal tax (regular + SE) = $12,197.20 (post-QBI auto)", r.federalTaxLiability, 12197.20, 1);
  check("K-1 SE earnings = $60,000", r.scheduleK1.totalSelfEmploymentEarnings, 60000, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// Test H — K-1 capital gains, dividends, and interest flow to the right buckets
// ════════════════════════════════════════════════════════════════════════════
// Filer: single 2024, $50k W-2.
// K-1: S-corp active, no Box 1; Box 5 interest=$500, Box 5a ord div=$1,500,
//      Box 5b qual div=$1,000 (subset of ord div), Box 7 royalties=$2,000,
//      Box 7 STCG=$3,000, Box 8a LTCG=$4,000.
// Hand-calc (RE-DERIVED 2026-06-11, T1.0d #12 — K-1 Box 6a/6b mirror 1099-DIV
// 1a/1b: Box 6b QUALIFIED dividends are a SUBSET of Box 6a ordinary dividends
// per the 1065/1120-S K-1 instructions — exactly as this scenario's own setup
// line says ("subset of ord div"). The engine now nets max(0, 6a − 6b) =
// non-qualified ordinary, the same way summarize1099s nets 1a − 1b. The PRIOR
// expectation added both raw, double-counting the $1,000 qualified subset):
//   STCG to ordinary: 3,000
//   LTCG to preferential: 4,000
//   Dividend income TOTAL = Box 6a 1,500 (non-qualified 500 + qualified 1,000)
//   Ordinary additional income: interest 500 + non-qual div 500 + royalties 2,000 +
//                               STCG 3,000 + LTCG 4,000 + qual div 1,000 = 11,000
//   Total income = 50,000 + 11,000 = 61,000. AGI = 61,000.
//   Std ded = 14,600 → Taxable = 46,400
//   Preferential portion = LTCG 4,000 + qual div 1,000 = 5,000
//   Ordinary portion = 46,400 − 5,000 = 41,400
//   Ordinary tax:
//     10% × 11,600                 = 1,160.00
//     12% × (41,400 − 11,600)      = 12% × 29,800 = 3,576.00
//     ─────────────────────────────────────────────
//     Subtotal                                   = 4,736.00
//   LTCG/QDIV: 2024 single 0% bracket up to $47,025. Taxable income $46,400
//     ≤ $47,025 → ALL $5,000 of preferential stays at 0%. Preferential tax = 0.
//   Federal tax = 4,736.00
header("Test H — K-1 interest/div/royalties/cap gains flow to correct buckets");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [
      {
        taxYear: 2024,
        entityName: "Investment Holdings Inc",
        entityType: "s_corp",
        activityType: "active",
        interestIncome: 500,
        ordinaryDividends: 1500,
        qualifiedDividends: 1000,
        royalties: 2000,
        netShortTermCapitalGain: 3000,
        netLongTermCapitalGain: 4000,
      },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("Total income = $61,000 (6b is a subset of 6a — not double-counted)", r.totalIncome, 61000, 1);
  check("AGI = $61,000", r.adjustedGrossIncome, 61000, 1);
  check("Taxable income = $46,400", r.taxableIncome, 46400, 1);
  check("Federal tax = $4,736.00 (all preferential in the 0% bracket)", r.federalTaxLiability, 4736.00, 1);
  check("K-1 interest = $500", r.scheduleK1.totalInterestIncome, 500, 0.01);
  // totalOrdinaryDividends reports the NON-QUALIFIED net (6a − 6b), mirroring
  // form1099Summary.ordinaryDividends (1a − 1b) — T1.0d #12 convention.
  check("K-1 ord div (non-qualified net 6a−6b) = $500", r.scheduleK1.totalOrdinaryDividends, 500, 0.01);
  check("K-1 qual div = $1,000", r.scheduleK1.totalQualifiedDividends, 1000, 0.01);
  check("K-1 royalties = $2,000", r.scheduleK1.totalRoyalties, 2000, 0.01);
  check("K-1 STCG = $3,000", r.scheduleK1.totalShortTermCapitalGain, 3000, 0.01);
  check("K-1 LTCG = $4,000", r.scheduleK1.totalLongTermCapitalGain, 4000, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// Test I — Zero K-1s: engine returns clean empty summary
// ════════════════════════════════════════════════════════════════════════════
header("Test I — No K-1 rows → all summary fields zero");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  checkExact("K-1 count = 0", r.scheduleK1.k1Count, 0);
  check("All K-1 totals = 0", r.scheduleK1.totalActiveOrdinaryIncome + r.scheduleK1.totalPassiveBucketNetApplied + r.scheduleK1.k1PassiveLossSuspended, 0, 0.01);
  check("AGI unchanged $50,000", r.adjustedGrossIncome, 50000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// §199A WAGE/UBIA LIMIT (K-1 depth, fix 2026-06-01) — IRC §199A(b)(2)(B)
// ════════════════════════════════════════════════════════════════════════════
// Above the taxable-income threshold ($191,950 single TY2024), the QBI deduction
// is limited to the GREATER of 50% of W-2 wages OR 25% wages + 2.5% UBIA, phased
// in over the band. The engine now applies this when the K-1 supplies positive
// section199aW2Wages / section199aUbia. S-corp K-1 (no SE) for clean isolation.

// ── Test W1: wage limit binds, fully phased (high income, low wages) ──────
// S-corp Box 1 $1,000,000 QBI, W-2 wages $100,000, UBIA $0.
//   prelim = 20% × 1,000,000 = 200,000. taxable-before-QBI = 985,400 >> band top.
//   wageLimit = max(50%×100,000=50,000, 25%×100,000=25,000) = 50,000.
//   reduction = (200,000 − 50,000) × 1 = 150,000 → wage-limited = 50,000.
//   cap = 20% × 985,400 = 197,080. QBI = min(50,000, 197,080) = 50,000.
//   (Pre-fix: min(200,000, 197,080) = 197,080 — over-deducted by $147,080.)
header("Test W1 — §199A wage limit binds (50% of W-2 wages)");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [], adjustments: [],
    scheduleK1: [{ taxYear: 2024, entityType: "s_corp", activityType: "active",
      box1OrdinaryIncome: 1000000, section199aQbi: 1000000,
      section199aW2Wages: 100000, section199aUbia: 0 }],
    taxYear: 2024,
  });
  check("W1 QBI deduction = $50,000 (50% W-2 wage limit)", r.qbiDeduction ?? 0, 50000, 1);
}

// ── Test W2: UBIA path (25% wages + 2.5% UBIA) exceeds 50% wages ──────────
// W-2 wages $100,000, UBIA $4,000,000 → wageLimit = max(50,000, 25,000+100,000)
//   = 125,000. QBI = min(125,000, 197,080) = 125,000.
header("Test W2 — §199A UBIA path (25% wages + 2.5% UBIA)");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [], adjustments: [],
    scheduleK1: [{ taxYear: 2024, entityType: "s_corp", activityType: "active",
      box1OrdinaryIncome: 1000000, section199aQbi: 1000000,
      section199aW2Wages: 100000, section199aUbia: 4000000 }],
    taxYear: 2024,
  });
  check("W2 QBI deduction = $125,000 (UBIA path)", r.qbiDeduction ?? 0, 125000, 1);
}

// ── Test W3: phase-in (50% through the band) — partial limit ─────────────
// Box 1 $231,550 → taxable-before-QBI 216,950 → excessRatio 0.5. W-2 wages
//   $20,000 → wageLimit 10,000. prelim 46,310. reduction = (46,310−10,000)×0.5
//   = 18,155 → wage-limited 28,155. cap 43,390. QBI = 28,155.
header("Test W3 — §199A phase-in (50% through the band)");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [], adjustments: [],
    scheduleK1: [{ taxYear: 2024, entityType: "s_corp", activityType: "active",
      box1OrdinaryIncome: 231550, section199aQbi: 231550,
      section199aW2Wages: 20000, section199aUbia: 0 }],
    taxYear: 2024,
  });
  check("W3 QBI deduction = $28,155 (mid-band phase-in)", r.qbiDeduction ?? 0, 28155, 1);
}

// ── Test W4: below threshold — wage limit ignored (control) ──────────────
// Box 1 $150,000 → taxable-before-QBI 135,400 < threshold → simplified 20%.
//   QBI = min(30,000, 20%×135,400=27,080) = 27,080.
header("Test W4 — below threshold: wage limit ignored");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [], adjustments: [],
    scheduleK1: [{ taxYear: 2024, entityType: "s_corp", activityType: "active",
      box1OrdinaryIncome: 150000, section199aQbi: 150000,
      section199aW2Wages: 10000, section199aUbia: 0 }],
    taxYear: 2024,
  });
  check("W4 QBI deduction = $27,080 (cap binds, no wage limit)", r.qbiDeduction ?? 0, 27080, 1);
}

// ── Test W5: no wages supplied — backward-compat simplified 20% ───────────
// Box 1 $1,000,000, NO wage/UBIA → QBI = min(200,000, 197,080) = 197,080.
header("Test W5 — no wages supplied: simplified 20% (backward compat)");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [], adjustments: [],
    scheduleK1: [{ taxYear: 2024, entityType: "s_corp", activityType: "active",
      box1OrdinaryIncome: 1000000, section199aQbi: 1000000 }],
    taxYear: 2024,
  });
  check("W5 QBI deduction = $197,080 (no wage data → simplified)", r.qbiDeduction ?? 0, 197080, 1);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────────────");
console.log(`PASS: ${PASS.length}`);
for (const p of PASS) console.log("  " + p);
if (FAIL.length > 0) {
  console.log(`\nFAIL: ${FAIL.length}`);
  for (const f of FAIL) console.log("  " + f);
  process.exit(1);
}
console.log(`\nAll ${PASS.length} K-1 pure-engine assertions passed.`);
