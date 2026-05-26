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
