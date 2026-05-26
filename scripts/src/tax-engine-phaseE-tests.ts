/**
 * Phase E — Engine completeness tests.
 *
 * One file covering hand-calc'd assertions for every Phase E item we ship.
 * Each item gets its own section with:
 *   - Hand-calc trace as a comment block (against the published IRC/Pub or
 *     state statute / form instructions)
 *   - Positive cases (rule fires correctly)
 *   - Negative cases (rule doesn't fire when it shouldn't)
 *   - Boundary / edge case (cliff threshold, etc.)
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-phaseE-tests.ts
 */

import {
  calculateStateTax,
  calculateAmt,
  calculateScheduleA,
  calculateRetirementDeductions,
  calculateStateEitc,
} from "../../artifacts/api-server/src/lib/taxCalculator";
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: Array<{ rule: string; label: string; expected: number | string; actual: number | string; delta?: number; cite?: string }> = [];

function check(rule: string, label: string, actual: number, expected: number, tol = 1, cite = ""): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK [${rule}] ${label}`);
  else FAIL.push({ rule, label, expected, actual, delta: Math.round((actual - expected) * 100) / 100, cite });
}

function checkTruthy(rule: string, label: string, actual: boolean, expected: boolean, cite = ""): void {
  if (actual === expected) PASS.push(`OK [${rule}] ${label}`);
  else FAIL.push({ rule, label, expected: String(expected), actual: String(actual), cite });
}

function header(t: string): void { console.log(`\n-- ${t} --`); }
function section(t: string): void { console.log(`\n========== ${t} ==========`); }

// ============================================================================
// E1 — IL personal exemption cliff (IL-1040 2024 Line 10b)
// Cliff (not gradual phase-out): exemption is $0 when AGI > $250k single /
// $500k MFJ. Below threshold: full $2,775 single / $5,550 MFJ at IL 4.95%.
// ============================================================================
section("E1 — IL personal exemption AGI cliff");

// --- E1+1: IL single AGI $100k — below cliff, full $2,775 exemption ---
// Hand-calc:
//   AGI = $100,000, IL std ded = $0, exemption = $2,775
//   IL taxable = $100,000 - $2,775 = $97,225
//   IL tax = $97,225 × 4.95% = $4,812.64
header("E1+1 — Single IL $100k AGI, exemption applies, tax $4,812.64");
{
  const tax = calculateStateTax(100000, "IL", "single", 2024);
  check("E1+1", "IL single $100k", tax, 4812.64, 1, "IL-1040 2024 4.95% flat × ($100k - $2,775)");
}

// --- E1+2: IL MFJ AGI $400k — below cliff ($500k), full $5,550 exemption ---
// Hand-calc:
//   AGI = $400,000, IL std ded = $0, exemption = $5,550
//   IL taxable = $400,000 - $5,550 = $394,450
//   IL tax = $394,450 × 4.95% = $19,525.28
header("E1+2 — MFJ IL $400k AGI, below cliff, tax $19,525.28");
{
  const tax = calculateStateTax(400000, "IL", "married_filing_jointly", 2024);
  check("E1+2", "IL MFJ $400k", tax, 19525.28, 1, "IL-1040 below $500k MFJ cliff");
}

// --- E1+3: IL single AGI $300k — ABOVE $250k cliff, exemption = $0 ---
// Hand-calc:
//   AGI = $300,000, cliff binds, exemption = $0
//   IL taxable = $300,000 - $0 = $300,000
//   IL tax = $300,000 × 4.95% = $14,850.00
header("E1+3 — Single IL $300k AGI, ABOVE $250k cliff, exemption $0, tax $14,850");
{
  const tax = calculateStateTax(300000, "IL", "single", 2024);
  check("E1+3", "IL single $300k (cliff binds)", tax, 14850.00, 1, "IL-1040 Line 10b cliff");
}

// --- E1+4: IL MFJ AGI $600k — ABOVE $500k cliff, exemption = $0 ---
// Hand-calc:
//   AGI = $600,000, cliff binds, exemption = $0
//   IL tax = $600,000 × 4.95% = $29,700.00
header("E1+4 — MFJ IL $600k AGI, ABOVE $500k cliff, exemption $0, tax $29,700");
{
  const tax = calculateStateTax(600000, "IL", "married_filing_jointly", 2024);
  check("E1+4", "IL MFJ $600k (cliff binds)", tax, 29700.00, 1, "IL-1040 Line 10b cliff");
}

// --- E1 boundary: IL single AGI exactly $250k (boundary — at threshold, NOT above) ---
// Hand-calc:
//   AGI = $250,000 — equal to cliff. Per "> threshold" semantics, exemption applies.
//   IL taxable = $250,000 - $2,775 = $247,225
//   IL tax = $247,225 × 4.95% = $12,237.64
header("E1 boundary — Single IL exactly $250k, exemption STILL applies (not >)");
{
  const tax = calculateStateTax(250000, "IL", "single", 2024);
  check("E1±", "IL single exactly $250k", tax, 12237.64, 1, "Boundary AT cliff (not above) — exemption applies");
}

// --- E1 boundary 2: IL single AGI $250,001 — just over cliff, exemption $0 ---
// Hand-calc:
//   $250,001 × 4.95% = $12,375.05
header("E1 boundary — Single IL $250,001 just over cliff, exemption $0");
{
  const tax = calculateStateTax(250001, "IL", "single", 2024);
  check("E1±2", "IL single $250,001 (just over cliff)", tax, 12375.05, 1, "$1 over cliff, exemption gone");
}

// --- E1-1: Non-IL state (CA) — no IL cliff, unrelated ---
header("E1-1 — CA $300k (sanity check IL cliff doesn't bleed into CA)");
{
  const tax = calculateStateTax(300000, "CA", "single", 2024);
  // CA tax at $300k single is ~$22-24k (don't pin precise; just confirm reasonable)
  checkTruthy("E1-1", "CA tax > $15k at $300k", tax > 15000, true);
  checkTruthy("E1-1", "CA tax < $35k at $300k", tax < 35000, true);
}

// ============================================================================
// E2 — AMT credit carryforward (Form 8801 / IRC §53)
// Year A: AMT generated; credit carries forward.
// Year B: AMT doesn't bind → carryforward applies against spread between
//         regular tax and tentative minimum tax (TMT = regularTax + amtTax).
// ============================================================================
section("E2 — AMT credit carryforward (Form 8801, IRC §53)");

// --- E2+1: Year A — single TY2024 W-2 $300k + ISO bargain $200k → AMT generated ---
// Hand-calc: Engine computes the AMT in this scenario; we verify
//   (a) amtTax > 0 (the AMT actually fires)
//   (b) amtCreditGenerated equals amtTax (simplified §53(b) model)
//   (c) amtCreditApplied = 0 (no carryforward in; nothing to apply)
//   (d) amtCreditCarryforwardRemaining = amtTax (rolls to next year)
header("E2+1 — Year A: AMT fires, no prior carryforward, generates credit");
{
  const computed = computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 300000, federalTaxWithheldBox2: 50000, stateCode: "TX" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "amt_iso_bargain_element", amount: 200000, isApplied: true },
    ],
    taxYear: 2024,
  });
  checkTruthy("E2+1", "AMT fires", computed.amtTax > 0, true, "ISO bargain $200k drives AMT");
  check("E2+1", "amtCreditGenerated = amtTax", computed.amtCreditGenerated, computed.amtTax, 1);
  check("E2+1", "amtCreditApplied = 0 (no carryforward)", computed.amtCreditApplied, 0, 1);
  check("E2+1", "amtCreditCarryforwardRemaining = amtTax", computed.amtCreditCarryforwardRemaining, computed.amtTax, 1);
}

// --- E2+2: Year B — same client TY2024 but with $30k carryforward from prior year ---
// Hand-calc: Same ISO scenario. AMT binds again this year. The §53(c)
// limit (regularTax - TMT) is 0 when AMT binds, so amtCreditApplied = 0.
// The new amtTax adds to the carryforward.
header("E2+2 — Year B: AMT still binds + $30k carryforward in, no credit applied (TMT > regular)");
{
  const computed = computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 300000, federalTaxWithheldBox2: 50000, stateCode: "TX" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "amt_iso_bargain_element", amount: 200000, isApplied: true },
      { adjustmentType: "amt_credit_carryforward", amount: 30000, isApplied: true },
    ],
    taxYear: 2024,
  });
  checkTruthy("E2+2", "AMT fires", computed.amtTax > 0, true);
  check("E2+2", "amtCreditApplied = 0 (AMT binds)", computed.amtCreditApplied, 0, 1,
    "§53(c): credit applies only down to TMT; when AMT binds, regular tax < TMT");
  // Carryforward out = 30000 (in) + new amtTax - 0 (applied)
  check("E2+2", "carryforward out = $30k + new amtTax",
    computed.amtCreditCarryforwardRemaining,
    30000 + computed.amtTax, 1);
}

// --- E2+3: Year B alt — same client but no ISO this year + $30k carryforward applies ---
// Hand-calc: Without the ISO bargain, AMT doesn't bind. The spread
// (regularTax - TMT) is positive, so the carryforward can apply.
// W-2 $300k single TY2024:
//   AGI = $300,000
//   Taxable = $300,000 - $14,600 = $285,400
//   Regular tax (Single 2024 brackets):
//     10% × $11,600 = $1,160
//     12% × ($47,150 - $11,600) = $4,266
//     22% × ($100,525 - $47,150) = $11,742.50
//     24% × ($191,950 - $100,525) = $21,942.00
//     32% × ($243,725 - $191,950) = $16,568.00
//     35% × ($285,400 - $243,725) = $14,586.25
//   Sum = $70,264.75
//   AMTI (no preferences) = taxable = $285,400 (per current engine model)
//   AMT exemption 2024 single = $85,700, phase-out begins $609,350 → no phase
//   AMT base = $285,400 - $85,700 = $199,700
//   AMT @ 26% = $51,922.00 (under $232,600 breakpoint)
//   TMT = $51,922 < regular $70,264.75 → AMT doesn't bind, amtTax = 0
//   Spread (regularTax - TMT) = $70,264.75 - $51,922.00 = $18,342.75
//   amtCreditApplied = min($30,000, $18,342.75, availableForNonRefundable)
//     ≈ $18,342.75 (assuming sufficient non-refundable headroom)
//   Carryforward out = $30,000 + 0 (generated) - $18,342.75 ≈ $11,657.25
header("E2+3 — Year B alt: No ISO this year, $30k cf applies up to TMT spread");
{
  const computed = computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 300000, federalTaxWithheldBox2: 50000, stateCode: "TX" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "amt_credit_carryforward", amount: 30000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("E2+3", "amtTax = 0 (AMT doesn't bind)", computed.amtTax, 0, 1);
  check("E2+3", "amtCreditApplied ≈ $18,343",
    computed.amtCreditApplied, 18342.75, 5,
    "min(cf, regularTax - TMT) = min(30000, 70264.75 - 51922.00)");
  // Carryforward out = $30,000 - $18,342.75 = $11,657.25 (no new AMT generated)
  check("E2+3", "carryforward out ≈ $11,657",
    computed.amtCreditCarryforwardRemaining, 11657.25, 5);
  check("E2+3", "amtCreditGenerated = 0", computed.amtCreditGenerated, 0, 1);
}

// --- E2-1: No carryforward + no AMT → all values zero ---
header("E2-1 — Normal W-2 client, no carryforward, no AMT");
{
  const computed = computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 7000, stateCode: "TX" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("E2-1", "amtTax = 0", computed.amtTax, 0, 1);
  check("E2-1", "amtCreditApplied = 0", computed.amtCreditApplied, 0, 1);
  check("E2-1", "amtCreditGenerated = 0", computed.amtCreditGenerated, 0, 1);
  check("E2-1", "amtCreditCarryforwardRemaining = 0", computed.amtCreditCarryforwardRemaining, 0, 1);
}

// --- E2 boundary: Carryforward larger than applicable spread ---
// Hand-calc: Same as E2+3 but cf = $100,000 (way more than spread).
// Applied = $18,342.75 (capped by spread); carryforward out = $100k - $18,343 ≈ $81,657
header("E2 boundary — Large carryforward $100k, only $18,343 applied (spread cap binds)");
{
  const computed = computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 300000, federalTaxWithheldBox2: 50000, stateCode: "TX" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "amt_credit_carryforward", amount: 100000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("E2±", "amtCreditApplied capped by spread", computed.amtCreditApplied, 18342.75, 5);
  check("E2±", "remaining carryforward = $100k - $18,343",
    computed.amtCreditCarryforwardRemaining, 81657.25, 5);
}

// ============================================================================
// E3 — Cash charitable carryforward (IRC §170(d)(1), 5-year)
// Excess cash gifts above 60% AGI cap carry forward up to 5 years.
// Ordering per §170(d)(1): current-year contributions deducted first,
// then prior carryforward (lumped as one number in our simplified model).
// ============================================================================
section("E3 — Cash charitable carryforward (IRC §170(d)(1))");

// --- E3+1: Single TY2024, $100k AGI, $80k cash charity (over 60% cap) ---
// Hand-calc:
//   60% AGI cap = $60,000
//   Current cash applied = min($80k, $60k) = $60,000
//   Cash carryforward going out = max(0, $80k - $60k) = $20,000
header("E3+1 — Single $100k AGI, $80k cash, $60k applied, $20k carries to next year");
{
  const result = calculateScheduleA({
    agi: 100000,
    filingStatus: "single",
    taxYear: 2024,
    inputs: { charitableCash: 80000 },
  });
  check("E3+1", "charitableDeductible = $60k", result.charitableDeductible, 60000, 1, "60% × $100k AGI cap");
  check("E3+1", "carryforward out = $20k", result.charitableCarryforwardCashRemaining, 20000, 1);
}

// --- E3+2: Carryforward applies in subsequent year ---
// Hand-calc:
//   Year B: AGI $100k, no current cash, $20k carryforward in (from prior).
//   Current applied = min($0, $60k) = $0
//   Headroom = $60k - $0 = $60k
//   Carryforward applied = min($20k, $60k) = $20,000
//   charitableDeductible = $20,000
//   New carryforward out = (current excess $0) + ($20k - $20k unused) = $0
header("E3+2 — Year B: $0 current, $20k carryforward in, $20k applied, $0 out");
{
  const result = calculateScheduleA({
    agi: 100000,
    filingStatus: "single",
    taxYear: 2024,
    inputs: { charitableCash: 0, charitableCarryforwardCash: 20000 },
  });
  check("E3+2", "charitableDeductible = $20k", result.charitableDeductible, 20000, 1);
  check("E3+2", "carryforward out = $0", result.charitableCarryforwardCashRemaining, 0, 1);
}

// --- E3+3: Current + carryforward exceeding cap → both partially deducted ---
// Hand-calc:
//   AGI $100k, current $50k, carryforward in $30k
//   Cap = $60k
//   Current applied = min($50k, $60k) = $50,000
//   Headroom = $60k - $50k = $10k
//   Carryforward applied = min($30k, $10k) = $10,000
//   charitableDeductible = $60,000 (exactly the cap)
//   Current excess = $50k - $50k = $0
//   Carryforward unused = $30k - $10k = $20,000
//   Carryforward out = $0 + $20k = $20,000
header("E3+3 — Mix: $50k current + $30k cf, cap binds, $20k cf rolls forward");
{
  const result = calculateScheduleA({
    agi: 100000,
    filingStatus: "single",
    taxYear: 2024,
    inputs: { charitableCash: 50000, charitableCarryforwardCash: 30000 },
  });
  check("E3+3", "charitableDeductible = $60k", result.charitableDeductible, 60000, 1);
  check("E3+3", "carryforward out = $20k", result.charitableCarryforwardCashRemaining, 20000, 1);
}

// --- E3+4: Current overflow + carryforward — both stack to next year ---
// Hand-calc:
//   AGI $100k, current $80k (over cap), carryforward in $10k
//   Cap = $60k
//   Current applied = min($80k, $60k) = $60,000
//   Headroom = $0 (cap fully used by current)
//   Carryforward applied = min($10k, $0) = $0
//   charitableDeductible = $60,000
//   Current excess = $80k - $60k = $20,000
//   Carryforward unused = $10k - $0 = $10,000
//   Carryforward out = $20k + $10k = $30,000
header("E3+4 — $80k current + $10k cf, current overflows first, $30k rolls forward");
{
  const result = calculateScheduleA({
    agi: 100000,
    filingStatus: "single",
    taxYear: 2024,
    inputs: { charitableCash: 80000, charitableCarryforwardCash: 10000 },
  });
  check("E3+4", "charitableDeductible = $60k", result.charitableDeductible, 60000, 1);
  check("E3+4", "carryforward out = $30k", result.charitableCarryforwardCashRemaining, 30000, 1);
}

// --- E3-1: Under cap, no carryforward — no rollover ---
// Hand-calc:
//   AGI $200k, current $10k cash. Cap = $120k. $10k < $120k.
//   charitableDeductible = $10k, carryforward out = $0
header("E3-1 — Well under cap, no carryforward");
{
  const result = calculateScheduleA({
    agi: 200000,
    filingStatus: "single",
    taxYear: 2024,
    inputs: { charitableCash: 10000 },
  });
  check("E3-1", "charitableDeductible = $10k", result.charitableDeductible, 10000, 1);
  check("E3-1", "carryforward out = $0", result.charitableCarryforwardCashRemaining, 0, 1);
}

// --- E3-2: Zero cash everywhere — zero everything ---
header("E3-2 — Zero cash, zero carryforward");
{
  const result = calculateScheduleA({
    agi: 100000,
    filingStatus: "single",
    taxYear: 2024,
    inputs: {},
  });
  check("E3-2", "charitableDeductible = $0", result.charitableDeductible, 0, 1);
  check("E3-2", "carryforward out = $0", result.charitableCarryforwardCashRemaining, 0, 1);
}

// --- E3 boundary: cash exactly at cap — no excess ---
// Hand-calc: AGI $100k, current $60k. Cap = $60k. Applied = $60k. Excess = $0.
header("E3 boundary — cash exactly at 60% cap, no carryforward");
{
  const result = calculateScheduleA({
    agi: 100000,
    filingStatus: "single",
    taxYear: 2024,
    inputs: { charitableCash: 60000 },
  });
  check("E3±", "charitableDeductible = $60k", result.charitableDeductible, 60000, 1);
  check("E3±", "carryforward out = $0", result.charitableCarryforwardCashRemaining, 0, 1);
}

// --- E3 engine integration: end-to-end via computeTaxReturnPure ---
// Verify the engine actually persists carryforward through to ComputedTaxReturn
header("E3 integration — engine end-to-end propagates carryforward to result");
{
  const computed = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 15000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "charitable_cash", amount: 75000, isApplied: true },
    ],
    taxYear: 2024,
  });
  // AGI = $100k, 60% cap = $60k. Excess = $75k - $60k = $15k carries forward.
  check("E3-engine", "carryforward = $15k", computed.charitableCarryforwardCashRemaining, 15000, 1);
}

// ============================================================================
// E5 — IRC §72(t) Early-Withdrawal 10% Penalty (1099-R Box 7 code)
// 10% on code "1" (early, no known exception); 25% on code "S"
// (SIMPLE IRA in first 2 years). No penalty on codes 2/3/4/7/G/T/Q etc.
// ============================================================================
section("E5 — 1099-R early-withdrawal penalty (IRC §72(t))");

// --- E5+1: Code "1" early distribution → 10% penalty ---
// Hand-calc: $25,000 distribution × 10% = $2,500 penalty.
// Single TX no state tax, W-2 $0, taxable income from retirement only.
header("E5+1 — Code 1 early $25k distribution, 10% = $2,500 penalty");
{
  const computed = computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "TX" }],
    form1099s: [{
      taxYear: 2024, formType: "r", payerName: "401k Plan",
      taxableAmount: 25000, grossDistribution: 25000,
      distributionCode: "1",
    }],
    adjustments: [],
    taxYear: 2024,
  });
  check("E5+1", "earlyWithdrawalPenalty = $2,500", computed.earlyWithdrawalPenalty, 2500, 1,
    "IRC §72(t) 10% × $25k taxable distribution code 1");
}

// --- E5+2: Code "S" SIMPLE IRA in first 2 years → 25% penalty ---
// Hand-calc: $10,000 × 25% = $2,500 penalty.
header("E5+2 — Code S SIMPLE IRA $10k early, 25% = $2,500 penalty");
{
  const computed = computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "TX" }],
    form1099s: [{
      taxYear: 2024, formType: "r", payerName: "SIMPLE IRA",
      taxableAmount: 10000, grossDistribution: 10000,
      distributionCode: "S",
    }],
    adjustments: [],
    taxYear: 2024,
  });
  check("E5+2", "earlyWithdrawalPenalty = $2,500", computed.earlyWithdrawalPenalty, 2500, 1,
    "IRC §72(t)(6) 25% × $10k SIMPLE early");
}

// --- E5+3: Mixed codes — sums correctly ---
// Hand-calc: $20k code 1 (10% = $2k) + $5k code S (25% = $1.25k) + $50k code 7 ($0)
//           = $3,250 total penalty
header("E5+3 — Multiple 1099-Rs (code 1 + S + 7) sums to $3,250 penalty");
{
  const computed = computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "TX" }],
    form1099s: [
      { taxYear: 2024, formType: "r", payerName: "401k", taxableAmount: 20000, grossDistribution: 20000, distributionCode: "1" },
      { taxYear: 2024, formType: "r", payerName: "SIMPLE", taxableAmount: 5000, grossDistribution: 5000, distributionCode: "S" },
      { taxYear: 2024, formType: "r", payerName: "Normal", taxableAmount: 50000, grossDistribution: 50000, distributionCode: "7" },
    ],
    adjustments: [],
    taxYear: 2024,
  });
  check("E5+3", "penalty = $3,250", computed.earlyWithdrawalPenalty, 3250, 1,
    "$20k × 10% + $5k × 25% + $50k × 0% = $2,000 + $1,250 + $0");
}

// --- E5-1: Code "7" normal distribution → no penalty ---
header("E5-1 — Code 7 normal distribution, no penalty");
{
  const computed = computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024 },
    w2s: [],
    form1099s: [{
      taxYear: 2024, formType: "r", payerName: "401k",
      taxableAmount: 100000, grossDistribution: 100000,
      distributionCode: "7",
    }],
    adjustments: [],
    taxYear: 2024,
  });
  check("E5-1", "penalty = $0", computed.earlyWithdrawalPenalty, 0, 1);
}

// --- E5-2: Code "2" early but with exception → no penalty ---
header("E5-2 — Code 2 early w/ exception, no penalty");
{
  const computed = computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024 },
    w2s: [],
    form1099s: [{
      taxYear: 2024, formType: "r", payerName: "401k",
      taxableAmount: 30000, grossDistribution: 30000,
      distributionCode: "2",
    }],
    adjustments: [],
    taxYear: 2024,
  });
  check("E5-2", "penalty = $0", computed.earlyWithdrawalPenalty, 0, 1);
}

// --- E5-3: No 1099-R at all → no penalty ---
header("E5-3 — No 1099-R records, no penalty");
{
  const computed = computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "TX" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("E5-3", "penalty = $0", computed.earlyWithdrawalPenalty, 0, 1);
}

// ============================================================================
// E6 — 1099-G state-refund tax-benefit rule (IRC §111 / Pub 525)
// Unemployment (IRC §85) fully federal-taxable. State refund only taxable
// if prior year itemized (had tax benefit).
// ============================================================================
section("E6 — 1099-G unemployment + state-refund tax-benefit rule");

// --- E6+1: Prior-year std ded → state refund EXCLUDED from AGI ---
// Hand-calc:
//   W-2 $50k + 1099-G ($3k unemployment + $1k state refund)
//   Pub 525: prior year used std ded → state refund $1k NOT taxable
//   Unemployment $3k always taxable (IRC §85)
//   AGI = $50k + $3k = $53k (state refund excluded)
header("E6+1 — Prior year std ded, state refund excluded, AGI = $53k");
{
  const computed = computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024, priorYearItemized: false },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "TX" }],
    form1099s: [{
      taxYear: 2024, formType: "g", payerName: "State",
      unemploymentCompensation: 3000, stateLocalRefund: 1000,
    }],
    adjustments: [],
    taxYear: 2024,
  });
  check("E6+1", "AGI = $53k (refund excluded)", computed.adjustedGrossIncome, 53000, 1,
    "Pub 525: prior std ded → state refund not federal-taxable");
}

// --- E6+2: Prior-year itemized → state refund IS taxable ---
// Hand-calc:
//   Same as above but priorYearItemized = true
//   AGI = $50k + $3k + $1k = $54k
header("E6+2 — Prior year itemized, state refund taxable, AGI = $54k");
{
  const computed = computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024, priorYearItemized: true },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "TX" }],
    form1099s: [{
      taxYear: 2024, formType: "g", payerName: "State",
      unemploymentCompensation: 3000, stateLocalRefund: 1000,
    }],
    adjustments: [],
    taxYear: 2024,
  });
  check("E6+2", "AGI = $54k (refund taxable)", computed.adjustedGrossIncome, 54000, 1,
    "Pub 525: prior itemized → state refund federal-taxable");
}

// --- E6+3: Unemployment only (no state refund) — same result either way ---
// Hand-calc: $50k W-2 + $5k unemployment, no refund.
//   AGI = $55k regardless of prior-year itemization
header("E6+3 — Unemployment only $5k, priorYearItemized doesn't affect");
{
  const computedA = computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024, priorYearItemized: true },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "TX" }],
    form1099s: [{ taxYear: 2024, formType: "g", payerName: "State",
      unemploymentCompensation: 5000, stateLocalRefund: 0 }],
    adjustments: [],
    taxYear: 2024,
  });
  const computedB = computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024, priorYearItemized: false },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "TX" }],
    form1099s: [{ taxYear: 2024, formType: "g", payerName: "State",
      unemploymentCompensation: 5000, stateLocalRefund: 0 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("E6+3", "AGI same (priorItemized=true) = $55k", computedA.adjustedGrossIncome, 55000, 1);
  check("E6+3", "AGI same (priorItemized=false) = $55k", computedB.adjustedGrossIncome, 55000, 1);
}

// --- E6-1: priorYearItemized=null (default) treats as not itemized ---
// Engine default: null treated as false. AGI = $50k + $3k = $53k.
header("E6-1 — priorYearItemized=null defaults to NOT taxable (tax-friendly)");
{
  const computed = computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "TX" }],
    form1099s: [{
      taxYear: 2024, formType: "g", payerName: "State",
      unemploymentCompensation: 3000, stateLocalRefund: 1000,
    }],
    adjustments: [],
    taxYear: 2024,
  });
  check("E6-1", "Default: AGI = $53k (refund excluded)", computed.adjustedGrossIncome, 53000, 1);
}

// ============================================================================
// E10 — State EITC piggybacks (20+ new states)
// Each state's published % of federal EITC. Test with a fixed federal
// EITC ($1,000 stand-in) so the math is trivial and every state is
// verified separately.
// ============================================================================
section("E10 — State EITC piggyback rates");

function stateEitc(state: string, fedEitc: number, qualifyingChildren = 2): number {
  return calculateStateEitc({
    state,
    federalEitcApplied: fedEitc,
    federalEitcEligible: fedEitc > 0,
    agi: 25000,
    earnedIncome: 25000,
    investmentIncome: 0,
    qualifyingChildren,
    taxYear: 2024,
    filingStatus: "single",
  }).credit;
}

// E10+1 through E10+19 — individual state piggyback verifications.
// Federal EITC base of $1,000 makes hand-calc trivial: credit = $1,000 × rate.
header("E10+ — Each state's piggyback rate at $1,000 federal EITC");

check("E10+CT", "CT 40% piggyback = $400", stateEitc("CT", 1000), 400, 1, "Conn. Gen. Stat. §12-704e");
check("E10+DE", "DE 4.5% refundable piggyback = $45", stateEitc("DE", 1000), 45, 1, "DE Sched 1 refundable choice");
check("E10+IN", "IN 10% piggyback = $100", stateEitc("IN", 1000), 100, 1, "IN Sched IN-EIC");
check("E10+IA", "IA 15% piggyback = $150", stateEitc("IA", 1000), 150, 1, "IA-1040 Sched 1A");
check("E10+KS", "KS 17% piggyback = $170", stateEitc("KS", 1000), 170, 1, "K-40 Line 19");
check("E10+LA", "LA 5% piggyback = $50", stateEitc("LA", 1000), 50, 1, "IT-540 Sched E");
check("E10+MT", "MT 10% piggyback = $100", stateEitc("MT", 1000), 100, 1, "Montana EIC");
check("E10+NE", "NE 10% piggyback = $100", stateEitc("NE", 1000), 100, 1, "NE 1040N Sched I");
check("E10+NM", "NM 25% piggyback = $250", stateEitc("NM", 1000), 250, 1, "NM Working Families TC");
check("E10+OH", "OH 30% piggyback = $300", stateEitc("OH", 1000), 300, 1, "Ohio IT-1040");
check("E10+OK", "OK 5% piggyback = $50", stateEitc("OK", 1000), 50, 1, "OK 511");
check("E10+OR", "OR 9% piggyback = $90", stateEitc("OR", 1000), 90, 1, "OR-EIC");
check("E10+RI", "RI 16% piggyback = $160", stateEitc("RI", 1000), 160, 1, "RI Sched EIC");
check("E10+VT", "VT 38% piggyback = $380", stateEitc("VT", 1000), 380, 1, "VT EIC (raised TY2024)");
check("E10+VA", "VA 15% refundable piggyback = $150", stateEitc("VA", 1000), 150, 1, "VA Sched ADJ refundable choice");
check("E10+DC", "DC 70% piggyback (simplified) = $700", stateEitc("DC", 1000), 700, 1, "DC EITC");
check("E10+ME", "ME 25% piggyback (with kids) = $250", stateEitc("ME", 1000), 250, 1, "ME Earned Income Credit");
check("E10+MD", "MD 45% piggyback = $450", stateEitc("MD", 1000), 450, 1, "MD Form 502");
check("E10+MI", "MI 30% piggyback = $300", stateEitc("MI", 1000), 300, 1, "MI Sched 1 PA 4 of 2023");

// WI — tiered by # qualifying children
check("E10+WI-1", "WI 1 kid: 4% = $40", stateEitc("WI", 1000, 1), 40, 1, "Wisc. Stat. §71.07(9e)");
check("E10+WI-2", "WI 2 kids: 11% = $110", stateEitc("WI", 1000, 2), 110, 1);
check("E10+WI-3+", "WI 3+ kids: 34% = $340", stateEitc("WI", 1000, 3), 340, 1);
check("E10+WI-0", "WI 0 kids: 0 (no childless EITC)", stateEitc("WI", 1000, 0), 0, 1);

// E10-1 — Federal-ineligible client gets $0 state EITC
header("E10-1 — Federal-ineligible client → state EITC = $0");
{
  const out = calculateStateEitc({
    state: "CT",
    federalEitcApplied: 0,
    federalEitcEligible: false,
    agi: 50000,
    earnedIncome: 50000,
    investmentIncome: 0,
    qualifyingChildren: 0,
    taxYear: 2024,
    filingStatus: "single",
  });
  check("E10-1", "CT $0 when not federal-eligible", out.credit, 0, 1);
}

// E10-2 — Non-piggyback state → $0
header("E10-2 — Non-piggyback state (FL = no income tax) returns $0");
{
  check("E10-2", "FL no state EITC", stateEitc("FL", 1000), 0, 1);
  check("E10-2", "TX no state EITC", stateEitc("TX", 1000), 0, 1);
  check("E10-2", "WA no piggyback (independent calc not modeled)", stateEitc("WA", 1000), 0, 1);
}

// ============================================================================
// Report
// ============================================================================
console.log("\n========== RESULTS ==========");
console.log(`PASSED: ${PASS.length}`);
if (FAIL.length > 0) {
  console.log(`\nFAILED: ${FAIL.length}`);
  for (const f of FAIL) {
    console.log(`  ✗ [${f.rule}] ${f.label}: expected ${f.expected}, got ${f.actual}` +
      (f.delta != null ? ` (delta ${f.delta})` : "") +
      (f.cite ? ` — ${f.cite}` : ""));
  }
  process.exit(1);
} else {
  console.log("\nALL PHASE E ASSERTIONS PASS");
}
