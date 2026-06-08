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
import { calculateStateTax } from "../../artifacts/api-server/src/lib/taxCalculator";

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

// ════════════════════════════════════════════════════════════════════════════
// WISCONSIN — sliding-scale standard deduction, SINGLE (Wis. Stat. §71.05(22)).
// 2024 single: max $13,230, reduced 12% of WAGI over $19,070, → $0 at ~$129,319.
// WI single brackets: 3.54% to $14,320 / 4.65% to $28,640 / 5.30% to $315,310.
//   AGI $50,000: stdDed = 13,230 − 0.12×(50,000−19,070) = 13,230 − 3,711.60 = 9,518.40
//                taxable = 40,481.60 → 0.0354×14,320 + 0.0465×14,320 + 0.0530×11,841.60
//                        = 506.93 + 665.88 + 627.60 = $1,800.41
//   AGI $19,070 (threshold): full $13,230 → taxable 5,840 → 0.0354×5,840 = $206.74
//   AGI $10,000 (below): full std ded > income → $0
// ════════════════════════════════════════════════════════════════════════════
header("WI — single sliding-scale standard deduction phase-out");
{
  check("WI single $50k: std-ded phased to $9,518.40 → tax $1,800.41",
    calculateStateTax(50000, "WI", "single", 2024), 1800.41, 0.5);
  check("WI single at $19,070 threshold: full $13,230 std ded → tax $206.74",
    calculateStateTax(19070, "WI", "single", 2024), 206.74, 0.5);
  checkTruthy("WI single $10k (below threshold): $0 tax (full std ded > income)",
    calculateStateTax(10000, "WI", "single", 2024) === 0);
  // Phase-out makes high-AGI single owe MORE than the full-std-ded baseline.
  checkTruthy("WI single phase-out increases tax vs full std ded at $50k",
    calculateStateTax(50000, "WI", "single", 2024) > 1603.70);
}

// ════════════════════════════════════════════════════════════════════════════
// WISCONSIN — MFJ / HoH / MFS sliding-scale std deduction (2026-06-06k). Each
// reverse-derived from + verified to reproduce the 2024 WI Form 1 Standard
// Deduction Table to the dollar. (HoH/MFS fall back to SINGLE brackets — a
// separate pre-existing WI-bracket sub-gap; this test fixes only the std ded.)
//   MFJ $80k: stdDed = 24,490 − 0.19778×(80,000−27,520) = 14,110.51 → taxable
//     65,889.49 → MFJ brackets 0.0354×19,090 + 0.0465×19,100 + 0.053×27,699.49
//     = 675.79 + 888.15 + 1,468.07 = $3,032.01 (was ~$2,481.90 at full std ded).
//   HoH $30k (below the ~$55,832 crossover): stdDed = max(single 11,918.40, the
//     HoH line 17,090 − 0.225×(30,000−19,070) = 14,630.75) = 14,630.75 → taxable
//     15,369.25 → single brackets 0.0354×14,320 + 0.0465×1,049.25 = $555.72.
//   HoH $60k (above crossover → follows single): stdDed = single 8,318.40 → $2,394.01.
//   MFS $40k: stdDed = 12,575 − 0.19778×(40,000−8,282) = 6,301.81 → $1,440.89.
// ════════════════════════════════════════════════════════════════════════════
header("WI — MFJ / HoH / MFS std-deduction phase-out");
{
  check("WI MFJ $80k: std-ded $14,110.51 → tax $3,032.01",
    calculateStateTax(80000, "WI", "married_filing_jointly", 2024), 3032.01, 0.5);
  checkTruthy("WI MFJ $80k owes MORE than the old full-std-ded baseline ($2,481.90)",
    calculateStateTax(80000, "WI", "married_filing_jointly", 2024) > 2481.90 + 1);
  check("WI HoH $30k (HoH 22.5% line): std-ded $14,630.75 → tax $555.72",
    calculateStateTax(30000, "WI", "head_of_household", 2024), 555.72, 0.5);
  check("WI HoH $60k (past crossover → = single): std-ded $8,318.40 → tax $2,394.01",
    calculateStateTax(60000, "WI", "head_of_household", 2024), 2394.01, 0.5);
  check("WI MFS $40k: std-ded $6,301.81 → tax $1,440.89",
    calculateStateTax(40000, "WI", "married_filing_separately", 2024), 1440.89, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// CONNECTICUT — Social Security exclusion (CT-1040 + DRS). 100% exempt below the
// federal-AGI threshold ($75k single/MFS, $100k MFJ/QW/HoH); above, CT taxes no
// more than ~25% of benefits (we exempt 75% of the federally-taxable SS). Tested
// relationally: tax(AGI, {SS}) must equal tax(AGI − exclusion) — i.e. the right
// amount of SS leaves the CT base. (Engine CT tax = brackets on taxable.)
// ════════════════════════════════════════════════════════════════════════════
header("CT — Social Security exclusion (100% below threshold; 75% above)");
{
  // Below threshold (single $50k < $75k): 100% of the $20k taxable SS exempt.
  check("CT single $50k AGI, $20k taxable SS → fully exempt (base $30k)",
    calculateStateTax(50000, "CT", "single", 2024, { taxableSocialSecurity: 20000 }),
    calculateStateTax(30000, "CT", "single", 2024), 0.5);
  // Above threshold (single $80k > $75k): exempt 75% of $20k = $15k → base $65k.
  check("CT single $80k AGI, $20k taxable SS → 75% exempt (base $65k)",
    calculateStateTax(80000, "CT", "single", 2024, { taxableSocialSecurity: 20000 }),
    calculateStateTax(65000, "CT", "single", 2024), 0.5);
  checkTruthy("CT above threshold is NOT 100% exempt (base ≠ $60k)",
    Math.abs(calculateStateTax(80000, "CT", "single", 2024, { taxableSocialSecurity: 20000 })
      - calculateStateTax(60000, "CT", "single", 2024)) > 1);
  // MFJ threshold is $100k: $90k AGI < $100k → 100% exempt → base $70k.
  check("CT MFJ $90k AGI, $20k taxable SS → fully exempt (base $70k)",
    calculateStateTax(90000, "CT", "married_filing_jointly", 2024, { taxableSocialSecurity: 20000 }),
    calculateStateTax(70000, "CT", "married_filing_jointly", 2024), 0.5);
}

console.log(`\n========================================`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed  (state quick-wins)`);
if (FAIL.length) {
  console.log(`\nFAILURES:`);
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log(`ALL STATE QUICK-WIN ASSERTIONS PASS`);
