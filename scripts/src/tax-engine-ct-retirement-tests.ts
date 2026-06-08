/**
 * CT pension/annuity + IRA income exclusion (lane B) — hand-calc'd against the
 * CT-1040 / CT-1040NR/PY "Pension and Annuity Worksheet" (Page 28) and the
 * Pension and Annuity Phase-Out Table (Conn. Gen. Stat. §12-701(a)(20)(B)).
 *
 *   subtraction = (100% × pension/annuity + IRA% × non-Roth IRA) × phase-out decimal
 *   IRA% (PA 23-204): 50% (2024) / 75% (2025) / 100% (2026+); pension/annuity 100%.
 *   Phase-out decimal: full (1.0) below the threshold, tiered to 0 at the cap.
 *     Single/MFS/HoH: $75,000 full → $100,000 zero.   MFJ/QSS: $100,000 → $150,000.
 *   (HoH is single-like here — DIFFERS from the CT Social Security exclusion.)
 *
 * The engine models CT as pure brackets (std ded 0; CT personal exemption / tax
 * credit / 3% recapture NOT modeled — a documented pre-existing gap), so for
 * AGI ≥ the exemption phase-out, CT taxable = AGI − exclusions, a clean hand-calc.
 * CT single 2024 brackets: 2% to $10k / 4.5% to $50k / 5.5% to $100k / 6% to $200k.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-ct-retirement-tests.ts
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
const ct = (agi: number, st: string, y: number, o: Record<string, number>) =>
  calculateStateTax(agi, "CT", st, y, o);

// ════════════════════════════════════════════════════════════════════════════
// A — pension/annuity, below threshold (full exclusion). CT single, AGI $60,000,
// $30,000 pension (no IRA marker → 100% base), no SS. AGI < $75k → decimal 1.0.
//   exclusion = 30,000 × 1.0 = 30,000 → CT taxable = 60,000 − 30,000 = 30,000.
//   tax = 2%×10,000 + 4.5%×20,000 = 200 + 900 = $1,100.
//   baseline (no exclusion) on $60,000 = 200 + 1,800 + 5.5%×10,000 = $2,550.
// ════════════════════════════════════════════════════════════════════════════
header("A — pension below threshold: full 100% exclusion (single $60k)");
{
  check("CT pension $30k @ $60k single 2024 = $1,100", ct(60000, "single", 2024, { retirementIncomeForExemption: 30000 }), 1100, 0.5);
  check("baseline (no retirement exclusion) @ $60k = $2,550", ct(60000, "single", 2024, {}), 2550, 0.5);
  checkTruthy("the exclusion strictly LOWERS CT tax (was over-taxing 100%)",
    ct(60000, "single", 2024, { retirementIncomeForExemption: 30000 }) < ct(60000, "single", 2024, {}));
}

// ════════════════════════════════════════════════════════════════════════════
// B/C — IRA portion, year-indexed %. CT single, AGI $60,000, $30,000 ALL IRA
// (ctIraDistribution = 30,000), below threshold (decimal 1.0).
//   2024 (50%): base 15,000 → taxable 45,000 → 2%×10k + 4.5%×35k = $1,775.
//   2025 (75%): base 22,500 → taxable 37,500 → 2%×10k + 4.5%×27,500 = $1,437.50.
//   2026 (100%): base 30,000 → taxable 30,000 → $1,100 (same as 100% pension).
// ════════════════════════════════════════════════════════════════════════════
header("B/C — IRA portion, year-indexed 50/75/100%");
{
  check("IRA $30k @ $60k single 2024 (50%) = $1,775", ct(60000, "single", 2024, { retirementIncomeForExemption: 30000, ctIraDistribution: 30000 }), 1775, 0.5);
  check("IRA $30k @ $60k single 2025 (75%) = $1,437.50", ct(60000, "single", 2025, { retirementIncomeForExemption: 30000, ctIraDistribution: 30000 }), 1437.5, 0.5);
  check("IRA $30k @ $60k single 2026 (100%) = $1,100", ct(60000, "single", 2026, { retirementIncomeForExemption: 30000, ctIraDistribution: 30000 }), 1100, 0.5);
  checkTruthy("IRA (50%) excludes LESS than pension (100%) in 2024 → higher tax",
    ct(60000, "single", 2024, { retirementIncomeForExemption: 30000, ctIraDistribution: 30000 }) >
    ct(60000, "single", 2024, { retirementIncomeForExemption: 30000 }));
}

// ════════════════════════════════════════════════════════════════════════════
// D/E — phase-out band + cap. CT single, $40,000 pension.
//   AGI $85,000 → single band $85,000–$87,499 → decimal 0.25. exclusion = 10,000
//     → taxable 75,000 → 2%×10k + 4.5%×40k + 5.5%×25k = 200+1,800+1,375 = $3,375.
//   AGI $100,000 → at/above cap → decimal 0 → no exclusion → taxable 100,000
//     → 200 + 1,800 + 5.5%×50,000 = $4,750.
// ════════════════════════════════════════════════════════════════════════════
header("D/E — single phase-out band (.25) + cap at $100k (0)");
{
  check("pension $40k @ $85k single → decimal .25 → tax $3,375", ct(85000, "single", 2024, { retirementIncomeForExemption: 40000 }), 3375, 0.5);
  check("pension $40k @ $100k single → decimal 0 (capped) → tax $4,750", ct(100000, "single", 2024, { retirementIncomeForExemption: 40000 }), 4750, 0.5);
  checkTruthy("at the $100k cap the exclusion is fully phased out (== no-exclusion tax)",
    Math.abs(ct(100000, "single", 2024, { retirementIncomeForExemption: 40000 }) - ct(100000, "single", 2024, {})) < 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// F — MFJ band. CT MFJ, AGI $120,000, $50,000 pension. MFJ band $120,000–$124,999
// → decimal 0.25. exclusion = 12,500 → taxable 107,500.
//   MFJ brackets: 2%×20,000 + 4.5%×80,000 + 5.5%×7,500 = 400 + 3,600 + 412.50 = $4,412.50.
// ════════════════════════════════════════════════════════════════════════════
header("F — MFJ phase-out band ($100k→$150k), decimal .25");
{
  check("pension $50k @ $120k MFJ → decimal .25 → tax $4,412.50", ct(120000, "married_filing_jointly", 2024, { retirementIncomeForExemption: 50000 }), 4412.5, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// G — HoH is SINGLE-like (the key threshold difference vs the CT SS exclusion).
// CT HoH, AGI $90,000, $30,000 pension. HoH uses the single $75k band → $90,000
// falls in $90,000–$94,999 → decimal 0.05 (NOT the MFJ band where $90k < $100k
// would give full 1.0). exclusion = 30,000 × 0.05 = 1,500 → taxable 88,500.
//   CT HoH uses single brackets (engine defines only single + MFJ): 2%×10k +
//   4.5%×40k + 5.5%×38,500 = 200 + 1,800 + 2,117.50 = $4,117.50.
//   (If HoH were wrongly grouped with MFJ → full exclusion → taxable 60,000 →
//    tax $2,550; no-exclusion tax on $90k = $4,200. The engine gives $4,117.50.)
// ════════════════════════════════════════════════════════════════════════════
header("G — HoH single-like band (decimal .05, NOT MFJ full exclusion)");
{
  const hoh = ct(90000, "head_of_household", 2024, { retirementIncomeForExemption: 30000 });
  check("pension $30k @ $90k HoH → single-band decimal .05 → tax $4,117.50", hoh, 4117.5, 0.5);
  checkTruthy("HoH is NOT in the MFJ band (would be full exclusion → $2,550)", Math.abs(hoh - 2550) > 1);
  checkTruthy("HoH exclusion is small but nonzero (< the no-exclusion $4,200)", hoh < ct(90000, "head_of_household", 2024, {}) - 1);
}

// ════════════════════════════════════════════════════════════════════════════
// H — SS + pension stack additively (no double-count). CT single, AGI $70,000
// incl $12,000 taxable SS + $25,000 pension. AGI < $75k → SS fully exempt
// (ssExclusion 12,000) + pension decimal 1.0 (exclusion 25,000).
//   CT taxable = 70,000 − 12,000 − 25,000 = 33,000 → 2%×10k + 4.5%×23k = $1,235.
// ════════════════════════════════════════════════════════════════════════════
header("H — SS exclusion + pension exclusion stack (no double-count)");
{
  check("SS $12k + pension $25k @ $70k single → tax $1,235",
    ct(70000, "single", 2024, { retirementIncomeForExemption: 25000, taxableSocialSecurity: 12000 }), 1235, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// E2E through computeTaxReturnPure — the ct_ira_distribution adjustment marker
// threads to the CT exclusion. CT single retiree, W-2 $30,000 + 1099-R $30,000 →
// federal AGI $60,000, retirement bucket $30,000.
//   No marker  → 100% pension → exclusion 30,000 → CT taxable 30,000 → tax $1,100.
//   Marker $30,000 (all IRA, 2024 50%) → exclusion 15,000 → taxable 45,000 → $1,775.
// ════════════════════════════════════════════════════════════════════════════
header("E2E — ct_ira_distribution marker threads through computeTaxReturnPure");
{
  const build = (iraMarker: number | null) =>
    computeTaxReturnPure({
      client: { filingStatus: "single", state: "CT", taxYear: 2024, taxpayerAge: 67 } as TaxReturnInputs["client"],
      w2s: [{ taxYear: 2024, wagesBox1: 30000, federalTaxWithheldBox2: 0, stateCode: "CT" } as unknown as TaxReturnInputs["w2s"][number]],
      form1099s: [{ taxYear: 2024, formType: "r", taxableAmount: 30000, grossDistribution: 30000, distributionCode: "7" } as unknown as TaxReturnInputs["form1099s"][number]],
      adjustments: iraMarker == null ? [] : [{ adjustmentType: "ct_ira_distribution", amount: iraMarker, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number]],
      taxYear: 2024,
    });
  const noMarker = build(null);
  const iraMarker = build(30000);
  check("E2E federal AGI = $60,000 (W-2 30k + 1099-R 30k)", noMarker.adjustedGrossIncome, 60000, 1);
  check("E2E no marker → pension 100% → CT state tax $1,100", noMarker.stateTaxLiability, 1100, 1);
  check("E2E IRA marker $30k → 50% → CT state tax $1,775", iraMarker.stateTaxLiability, 1775, 1);
  checkTruthy("E2E IRA marker raises CT tax vs the pension default", iraMarker.stateTaxLiability > noMarker.stateTaxLiability);
}

// ════════════════════════════════════════════════════════════════════════════
// Regression — a CT filer with NO retirement income is unchanged (the exclusion
// is inert when the retirement bucket is empty).
// ════════════════════════════════════════════════════════════════════════════
header("Regression — no retirement income → CT tax unchanged");
{
  check("CT single $80k wages, no retirement → unchanged",
    ct(80000, "single", 2024, { retirementIncomeForExemption: 0 }), ct(80000, "single", 2024, {}), 0.001);
}

console.log(`\n========================================`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed  (CT pension/IRA exclusion)`);
if (FAIL.length) {
  console.log(`\nFAILURES:`);
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log(`ALL CT RETIREMENT-EXCLUSION ASSERTIONS PASS`);
