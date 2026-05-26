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
