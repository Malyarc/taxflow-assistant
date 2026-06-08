/**
 * PREP-B1 — full-year NON-RESIDENT per-type source PLUMBING (e2e through
 * computeTaxReturnPure). The `nonresident_source_allocation` marker sources a
 * full-year resident's OUT-OF-STATE K-1 business (Box 1) + rental real estate
 * (K-1 Box 2/3 + rentalProperties net) to each fact's `sourceState`, populating
 * the calculateMultiStateTax `perStateNonResidentOtherSourced` option so a
 * non-resident state with NO wages there is still taxed (method-(a) states via the
 * as-if-resident ratio; direct brackets otherwise).
 *
 * 4 U.S.C. §114 is enforced by construction: intangibles (K-1 interest/dividends/
 * royalties/STCG/LTCG) and retirement are NEVER sourced. Resident-state source is
 * skipped (covered by the resident calc).
 *
 * Worked example anchor — NY-as-resident($100,000 single 2024): taxable 100,000 −
 * 8,000 std ded = 92,000; NY brackets 4%×8,500 + 4.5%×3,200 + 5.25%×2,200 +
 * 5.5%×66,750 + 6%×11,350 = 340 + 144 + 115.50 + 3,671.25 + 681 = $4,951.75.
 * NR ratio 40,000/100,000 = 0.40 → NY NR tax = $1,980.70. (TX resident → no
 * resident tax, so totalStateTax == the NY NR tax.)
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-nr-source-plumbing-tests.ts
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
function checkTruthy(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}
function header(t: string): void { console.log(`\n-- ${t} --`); }

const W2 = (w: number, st: string) =>
  ({ taxYear: 2024, wagesBox1: w, federalTaxWithheldBox2: 0, stateCode: st } as unknown as TaxReturnInputs["w2s"][number]);
const MARKER = [{ adjustmentType: "nonresident_source_allocation", amount: 1, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number]];
// TX resident (no income tax) → totalStateTax isolates the non-resident tax.
const run = (k1: unknown[], rentals: unknown[], adjustments: unknown[]) =>
  computeTaxReturnPure({
    client: { filingStatus: "single", state: "TX", taxYear: 2024 } as TaxReturnInputs["client"],
    w2s: [W2(60000, "TX")],
    form1099s: [],
    scheduleK1: k1 as TaxReturnInputs["scheduleK1"],
    rentalProperties: rentals as TaxReturnInputs["rentalProperties"],
    adjustments: adjustments as TaxReturnInputs["adjustments"],
    taxYear: 2024,
  });

// ════════════════════════════════════════════════════════════════════════════
// 1 — K-1 rental real estate (Box 2) sourced to NY (a method-(a) state). With the
// marker → NY taxes it via the IT-203 as-if-resident ratio; without → not at all.
// TX resident, W-2 $60k + K-1 Box 2 $40k (NY) → AGI $100,000.
// ════════════════════════════════════════════════════════════════════════════
header("1 — K-1 Box 2 (rental RE) sourced to NY; marker on/off");
{
  const k1 = [{ taxYear: 2024, box2RentalRealEstate: 40000, sourceState: "NY" }];
  const on = run(k1, [], MARKER);
  const off = run(k1, [], []);
  check("AGI = $100,000 (W-2 60k + K-1 rental 40k)", on.adjustedGrossIncome, 100000, 1);
  check("marker ON → NY NR tax = $1,980.70 (NY-as-resident × 40%)", on.stateTaxLiability, 1980.7, 1);
  check("marker ON → matches NY-as-resident(AGI) × (40k/AGI) relationally",
    on.stateTaxLiability, calculateStateTax(on.adjustedGrossIncome, "NY", "single", 2024) * (40000 / on.adjustedGrossIncome), 1);
  check("marker OFF → NY is NOT sourced (no NY wages) → $0 state tax", off.stateTaxLiability, 0, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// 2 — §114(a): a K-1 with ONLY intangibles (interest + dividends) sourced to NY is
// NEVER NR-sourced, even with the marker on. TX resident, W-2 $60k + K-1 $20k
// interest + $20k dividends (NY) → AGI $100,000 but $0 NY-source.
// ════════════════════════════════════════════════════════════════════════════
header("2 — §114(a): intangible K-1 income is NOT NR-sourced");
{
  const k1 = [{ taxYear: 2024, interestIncome: 20000, ordinaryDividends: 20000, sourceState: "NY" }];
  const on = run(k1, [], MARKER);
  check("AGI = $100,000 (W-2 60k + 40k intangibles)", on.adjustedGrossIncome, 100000, 1);
  check("marker ON → NY tax STILL $0 (interest/dividends are §114(a) intangibles)", on.stateTaxLiability, 0, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// 3 — rentalProperties net rental (real-property situs) sourced to NY. TX resident,
// W-2 $60k + rental $50k income − $10k expenses = $40k net (NY) → AGI $100,000.
// ════════════════════════════════════════════════════════════════════════════
header("3 — rentalProperty net rental sourced to NY (real-property situs)");
{
  const rentals = [{ taxYear: 2024, rentalIncome: 50000, totalExpenses: 10000, sourceState: "NY" }];
  const on = run([], rentals, MARKER);
  check("AGI = $100,000 (W-2 60k + rental net 40k)", on.adjustedGrossIncome, 100000, 1);
  check("marker ON → NY NR tax = $1,980.70 on the rental", on.stateTaxLiability, 1980.7, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// 4 — resident-state source is skipped (covered by the resident calc, not double-
// counted as non-resident). TX resident, K-1 Box 2 $40k sourced TX → marker ON ==
// OFF (both $0; TX has no income tax and the income is resident-sourced).
// ════════════════════════════════════════════════════════════════════════════
header("4 — resident-state source is NOT treated as non-resident");
{
  const k1 = [{ taxYear: 2024, box2RentalRealEstate: 40000, sourceState: "TX" }];
  checkTruthy("marker ON with resident-sourced K-1 → $0 (== marker OFF)",
    Math.abs(run(k1, [], MARKER).stateTaxLiability - run(k1, [], []).stateTaxLiability) < 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// 5 — the marker is OPT-IN: a K-1 with a sourceState but NO marker leaves behavior
// unchanged (no surprise NR tax for clients who set sourceState informationally).
// ════════════════════════════════════════════════════════════════════════════
header("5 — opt-in: sourceState without the marker changes nothing");
{
  const k1 = [{ taxYear: 2024, box2RentalRealEstate: 40000, sourceState: "NY" }];
  check("no marker → NY NR tax $0 even though sourceState=NY is set", run(k1, [], []).stateTaxLiability, 0, 0.5);
}

console.log(`\n========================================`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed  (NR per-type source plumbing)`);
if (FAIL.length) {
  console.log(`\nFAILURES:`);
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log(`ALL NR-SOURCE-PLUMBING ASSERTIONS PASS`);
