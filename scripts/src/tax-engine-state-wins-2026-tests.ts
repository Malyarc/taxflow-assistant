/**
 * State quick-wins suite (no API) — hand-calc'd against published state rules.
 *
 *  - Vermont dependent personal exemption ($4,850/dependent, Form IN-111 Line 5b).
 *  - Yonkers resident income-tax surcharge (16.75% of net NY State tax, IT-201).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-state-wins-2026-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.5): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}
function checkExact<T>(label: string, actual: T, expected: T): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function checkTruthy(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}
function header(t: string): void { console.log(`\n-- ${t} --`); }

// ════════════════════════════════════════════════════════════════════════════
// VERMONT — dependent personal exemption $4,850/dependent (Form IN-111 Line 5b)
//
// VT single 2024: std deduction $7,400, personal exemption $4,850, first bracket
// 3.35% to $45,400. With $40k W-2:
//   0 deps → VT taxable = 40,000 − 7,400 − 4,850            = 27,750   (3.35% bracket)
//   2 deps → exemption +$9,700 → VT taxable                = 18,050   (3.35% bracket)
// Both incomes sit in the 3.35% bracket, so the state-tax DIFFERENCE isolates the
// dependent exemption exactly: 9,700 × 0.0335 = $324.95 (engine-specific VT quirks
// cancel between the two identical runs).
// ════════════════════════════════════════════════════════════════════════════
header("VT — dependent personal exemption ($4,850/dep)");
{
  const vt = (deps: number) =>
    computeTaxReturnPure({
      client: { filingStatus: "single", state: "VT", taxYear: 2024, dependentsUnder17: deps } as TaxReturnInputs["client"],
      w2s: [{ taxYear: 2024, wagesBox1: 40000, federalTaxWithheldBox2: 0, stateCode: "VT" } as unknown as TaxReturnInputs["w2s"][number]],
      form1099s: [],
      adjustments: [],
      taxYear: 2024,
    });
  const noDeps = vt(0);
  const twoDeps = vt(2);
  checkTruthy("2-dependent VT return owes LESS state tax than 0-dependent", twoDeps.stateTaxLiability < noDeps.stateTaxLiability);
  check("VT 2-dep exemption saves 9,700 × 3.35% = $324.95",
    noDeps.stateTaxLiability - twoDeps.stateTaxLiability, 324.95, 1);
  // one-dependent = half the two-dependent delta (linear per-dependent application)
  const oneDep = vt(1);
  check("VT 1-dep exemption saves 4,850 × 3.35% = $162.48",
    noDeps.stateTaxLiability - oneDep.stateTaxLiability, 162.48, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// YONKERS — resident income-tax surcharge = 16.75% of NET NY State tax (IT-201).
//
// The surcharge is a flat 16.75% of the NY State resident tax liability (NOT a tax
// on income). A NY resident flagged localityCode "YONKERS" must therefore show
// localTaxLiability == NY-state-tax × 0.1675, with the NY state tax itself
// unchanged. We read the engine's own NY tax (verified by the NY/50-state suites)
// and assert the surcharge math directly.
// ════════════════════════════════════════════════════════════════════════════
header("Yonkers — 16.75% surcharge on NY State tax");
{
  const w2 = [{ taxYear: 2024, wagesBox1: 90000, federalTaxWithheldBox2: 0, stateCode: "NY" } as unknown as TaxReturnInputs["w2s"][number]];
  const base = computeTaxReturnPure({
    client: { filingStatus: "single", state: "NY", taxYear: 2024 } as TaxReturnInputs["client"],
    w2s: w2, form1099s: [], adjustments: [], taxYear: 2024,
  });
  const yonkers = computeTaxReturnPure({
    client: { filingStatus: "single", state: "NY", localityCode: "YONKERS", taxYear: 2024 } as TaxReturnInputs["client"],
    w2s: w2, form1099s: [], adjustments: [], taxYear: 2024,
  });
  const nyTax = base.stateTaxLiability;
  checkTruthy("base NY resident (no locality) has $0 local tax", base.localTaxLiability === 0);
  checkTruthy("Yonkers surcharge is positive", yonkers.localTaxLiability > 0);
  check("Yonkers surcharge = 16.75% × NY State tax", yonkers.localTaxLiability, nyTax * 0.1675, 0.5);
  check("NY State tax itself is unchanged by the surcharge", yonkers.stateTaxLiability, nyTax, 0.5);
  checkExact("Yonkers jurisdiction reported", yonkers.localTaxJurisdiction, "YONKERS");
}

console.log(`\n========================================`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed  (state quick-wins)`);
if (FAIL.length) {
  console.log(`\nFAILURES:`);
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log(`ALL STATE QUICK-WIN ASSERTIONS PASS`);
