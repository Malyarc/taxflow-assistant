/**
 * Phase 2 unit tests — capital loss + state retirement exemption + Schedule B
 * + multi-state + Schedule E/MACRS + Schedule D detail.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-phase2-unit-tests.ts
 */

import {
  calculateStateTax,
  getStateRetirementExemption,
} from "../../artifacts/api-server/src/lib/taxCalculator";
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function near(a: number, b: number, tol = 0.01) { return Math.abs(a - b) <= tol; }
function check(label: string, actual: number, expected: number, tol = 0.01) {
  if (near(actual, expected, tol)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}
function checkExact<T>(label: string, actual: T, expected: T) {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

// ════════════════════════════════════════════════════════════════════════════
// CAPITAL LOSS NETTING + $3K CAP (IRC §1211, Schedule D Line 21)
// ════════════════════════════════════════════════════════════════════════════
header("Capital loss — net loss ≤ $3k (no carryforward)");
{
  // Single, $50k W-2, $2k LTCL → -$2k net loss → all $2k deducted, no carryforward.
  // Total income = $50k - $2k = $48k. Std ded $14,600. Taxable $33,400.
  // Tax = $1,160 + ($33,400 - $11,600) × 0.12 = $3,776.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: -2000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("Total income $48,000 (after $2k loss)", r.totalIncome, 48000, 1);
  check("Capital loss deducted = $2,000", r.capitalLossDeducted, 2000);
  checkExact("No short carryforward", r.capitalLossCarryforwardShort, 0);
  checkExact("No long carryforward", r.capitalLossCarryforwardLong, 0);
  check("Net cap loss = -$2,000", r.netCapitalGainLoss, -2000);
  check("Federal tax $3,776", r.federalTaxLiability, 3776, 2);
}

header("Capital loss — net loss > $3k cap, with short + long carryforward");
{
  // Single, $50k W-2, $5k LTCL + $2k STCL → -$7k net.
  // $3k cap consumed: short first ($2k), then long ($1k).
  // Carryforward: short $0, long $4,000. Net = -$7k.
  // Total income = $50k - $3k = $47k.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: -5000, shortTermGainLoss: -2000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("Total income = $47,000 ($50k - $3k cap)", r.totalIncome, 47000, 1);
  check("Capital loss deducted = $3,000 (cap)", r.capitalLossDeducted, 3000);
  checkExact("Short carryforward = $0 (short consumed first)", r.capitalLossCarryforwardShort, 0);
  check("Long carryforward = $4,000 ($5k - $1k applied)", r.capitalLossCarryforwardLong, 4000);
  check("Net cap loss = -$7,000", r.netCapitalGainLoss, -7000);
}

header("Capital loss — MFS $1,500 cap");
{
  // MFS gets half the cap. Same -$7k loss → $1,500 deducted, $5,500 carryforward.
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_separately", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: -5000, shortTermGainLoss: -2000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("MFS cap loss deducted = $1,500", r.capitalLossDeducted, 1500);
  checkExact("MFS short carryforward = $500 ($2k - $1.5k applied)", r.capitalLossCarryforwardShort, 500);
  check("MFS long carryforward = $5,000 (no LT consumed)", r.capitalLossCarryforwardLong, 5000);
}

header("Capital loss — cross-netting STCG vs LTCL");
{
  // STCG $3,000 + LTCL -$1,000. Cross-net: long loss offsets short gain → STCG $2,000 net.
  // No cap loss deduction (net positive).
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", shortTermGainLoss: 3000, longTermGainLoss: -1000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("Cross-net STCG -$1k LT loss = $2,000 STCG", r.netCapitalGainLoss, 2000);
  checkExact("No cap loss deduction (net gain)", r.capitalLossDeducted, 0);
  check("Total income $52,000 ($50k + $2k STCG)", r.totalIncome, 52000, 1);
}

header("Capital loss — cross-netting LTCG vs STCL");
{
  // LTCG $4,000 + STCL -$3,000. Cross-net: short loss offsets long gain.
  // Net: $1,000 LTCG (preserves long character).
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", shortTermGainLoss: -3000, longTermGainLoss: 4000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("Net cap gain = $1,000 LTCG after cross-net", r.netCapitalGainLoss, 1000);
  check("Preferential income includes $1k LTCG", r.preferentialIncome, 1000);
}

header("Capital loss — prior year carryforward via adjustment");
{
  // Prior year carryforward: $5k long + $2k short. This year: $1k LTCG.
  // After carryforward applied:
  //   netSTCG = 0 - $2,000 = -$2,000
  //   netLTCG = $1,000 - $5,000 = -$4,000
  // Cross-netting: both negative, no swap.
  // netTotal = -$6,000. $3k cap consumed: short first ($2k), then long ($1k).
  // Carryforward: short $0, long $3,000 ($4k LT loss - $1k consumed).
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 10000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: 1000 }],
    adjustments: [
      { adjustmentType: "capital_loss_carryforward_long", amount: 5000, isApplied: true },
      { adjustmentType: "capital_loss_carryforward_short", amount: 2000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("Net after prior year carryforward = -$6,000", r.netCapitalGainLoss, -6000);
  check("Cap loss deducted = $3,000", r.capitalLossDeducted, 3000);
  checkExact("Short carryforward to next year = $0", r.capitalLossCarryforwardShort, 0);
  check("Long carryforward to next year = $3,000", r.capitalLossCarryforwardLong, 3000);
}

// ════════════════════════════════════════════════════════════════════════════
// STATE RETIREMENT-INCOME EXEMPTION (PA, IL, MS)
// ════════════════════════════════════════════════════════════════════════════
header("State retirement exemption — PA (age-gated)");
{
  // PA exempts qualified retirement at age 59½+ (we use 60).
  // Filer age 65, $30k 1099-R distribution. PA should exempt all $30k.
  // PA flat rate 3.07%. Without exemption: tax on AGI $30k = $921.
  // With exemption: tax on $0 = $0.
  const r1 = getStateRetirementExemption({ stateCode: "PA", retirementIncome: 30000, taxpayerAge: 65 });
  check("PA age 65 → $30k exempt", r1.exemption, 30000);

  const r2 = getStateRetirementExemption({ stateCode: "PA", retirementIncome: 30000, taxpayerAge: 55 });
  checkExact("PA age 55 (below 60) → $0 exempt", r2.exemption, 0);

  // Verify it flows through calculateStateTax
  const taxWithExemption = calculateStateTax(30000, "PA", "single", 2024, {
    retirementIncomeForExemption: 30000,
    taxpayerAge: 65,
  });
  checkExact("PA state tax with exemption = $0", taxWithExemption, 0);

  const taxWithoutExemption = calculateStateTax(30000, "PA", "single", 2024, {
    retirementIncomeForExemption: 30000,
    taxpayerAge: 55,
  });
  check("PA state tax without exemption (age 55)", taxWithoutExemption, 30000 * 0.0307, 0.01);
}

header("State retirement exemption — IL (no age requirement)");
{
  // IL exempts qualified retirement at any age. IL flat rate 4.95%.
  // $30k retirement income at any age → full exempt.
  const r1 = getStateRetirementExemption({ stateCode: "IL", retirementIncome: 30000, taxpayerAge: 35 });
  check("IL age 35 → $30k exempt (no age req)", r1.exemption, 30000);

  // IL has no std deduction by default in our data; need to verify
  // The state tax calc applies retirement exemption → AGI - exempt = $0 → tax $0
  const taxWithExemption = calculateStateTax(30000, "IL", "single", 2024, {
    retirementIncomeForExemption: 30000,
    taxpayerAge: 35,
  });
  checkExact("IL state tax with full retirement exemption = $0", taxWithExemption, 0);
}

header("State retirement exemption — MS age-gated");
{
  // MS exempts qualified retirement at age 59½+ (we use 60). MS flat 4.7% in 2024.
  const r1 = getStateRetirementExemption({ stateCode: "MS", retirementIncome: 20000, taxpayerAge: 62 });
  check("MS age 62 → $20k exempt", r1.exemption, 20000);

  const r2 = getStateRetirementExemption({ stateCode: "MS", retirementIncome: 20000, taxpayerAge: 50 });
  checkExact("MS age 50 (below 60) → $0 exempt", r2.exemption, 0);
}

header("State retirement exemption — other state (no rule) → $0");
{
  const r = getStateRetirementExemption({ stateCode: "CA", retirementIncome: 30000, taxpayerAge: 65 });
  checkExact("CA → $0 exempt (no state rule)", r.exemption, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// END-TO-END: PA retiree with 1099-R should pay $0 PA tax
// ════════════════════════════════════════════════════════════════════════════
header("End-to-end: PA retiree with 1099-R retirement income");
{
  // PA filer age 70, no wages, $40k 1099-R distribution.
  // Federal: AGI = $40k. Std ded single 2024 = $14,600 (extra std ded for 65+ = $1,950)
  // For now, we don't model extra std ded for 65+, so use base $14,600.
  // Taxable = $25,400. Tax = $1,160 + ($25,400 - $11,600) × 0.12 = $2,816.
  // State (PA): retirement income exempt → $0 PA tax.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "PA", taxYear: 2024, taxpayerAge: 70 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "r", taxableAmount: 40000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("AGI $40,000", r.adjustedGrossIncome, 40000, 1);
  check("Federal tax ~$2,816", r.federalTaxLiability, 2816, 2);
  check("PA state tax = $0 (retirement exempt)", r.stateTaxLiability, 0, 0.01);
  check("State retirement exemption = $40,000", r.stateRetirementExemption, 40000, 1);
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log("\n══════════════════════ Phase 2 Test Summary ══════════════════════");
console.log(`PASS: ${PASS.length}`);
console.log(`FAIL: ${FAIL.length}`);
if (FAIL.length > 0) {
  console.log("\nFailures:");
  for (const f of FAIL) console.log("  " + f);
  process.exit(1);
} else {
  console.log("\n✓ All Phase 2 unit tests pass");
}
