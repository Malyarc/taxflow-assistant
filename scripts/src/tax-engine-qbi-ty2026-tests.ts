/**
 * Regression — TY2026 §199A SSTB phase-out band (P0-7b).
 *
 * Bug (pre-fix): taxReturnEngine held a DUPLICATE QBI phase-in map covering only
 * TY2024/TY2025, selected by `taxYear === 2025 ? 2025 : 2024`. A TY2026 return
 * therefore silently used the TY2024 SSTB band — and MFS used a non-statutory
 * half-threshold. Fixed by routing BOTH §199A mechanics (the wage/UBIA limit in
 * calculateQbi AND the SSTB phase-out in taxReturnEngine) through the single
 * source of truth `taxCalculator.qbiPhaseInBand`, which is keyed through the
 * latest supported year and sets MFS = single per §199A(e)(2).
 *
 * Every expected value is hand-calc'd against OBBBA (P.L. 119-21) / Rev. Proc.
 * 2025-32 TY2026 §199A thresholds. Exit code is non-zero on any failure (CI).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-qbi-ty2026-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { qbiPhaseInBand } from "../../artifacts/api-server/src/lib/taxCalculator";

let passed = 0;
let failed = 0;
function check(label: string, actual: number, expected: number, tol = 0.01) {
  if (Math.abs(actual - expected) <= tol) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}: expected ${expected}, got ${actual}`); }
}
function assert(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); }
}

console.log("── qbiPhaseInBand: single source of truth (unit) ──");
// OBBBA TY2026 §199A thresholds (widened phase-in band: $75k single / $150k MFJ):
//   single 201,750 → 276,750 ; MFJ 403,500 → 553,500.
check("2026 single.start = 201,750", qbiPhaseInBand(2026, "single").start, 201_750, 0);
check("2026 single.end   = 276,750", qbiPhaseInBand(2026, "single").end, 276_750, 0);
check("2026 MFJ.start    = 403,500", qbiPhaseInBand(2026, "married_filing_jointly").start, 403_500, 0);
check("2026 MFJ.end      = 553,500", qbiPhaseInBand(2026, "married_filing_jointly").end, 553_500, 0);
// §199A(e)(2): only a JOINT return doubles the threshold amount → MFS = single
// (the old engine map wrongly halved it to 98,650/123,650).
check("2026 MFS.start = single (201,750)", qbiPhaseInBand(2026, "married_filing_separately").start, 201_750, 0);
check("2026 MFS.end   = single (276,750)", qbiPhaseInBand(2026, "married_filing_separately").end, 276_750, 0);
check("2026 HoH.start = single (201,750)", qbiPhaseInBand(2026, "head_of_household").start, 201_750, 0);
// TY2024 retained correctly, and 2026 must NOT equal 2024 (the fall-through bug).
check("2024 single.start = 191,950", qbiPhaseInBand(2024, "single").start, 191_950, 0);
assert("2026 band is distinct from the 2024 band (no fall-through)",
  qbiPhaseInBand(2026, "single").start !== qbiPhaseInBand(2024, "single").start);

console.log("\n── TY2026 SSTB return resolves the 2026 band end-to-end ──");
// Single, TY2026, S-corp K-1 Box 1 = $260,000, SSTB. S-corp Box 1 is NOT SE
// income, and there is no W-2, so AGI = $260,000 exactly.
//   Std ded (TY2026 single) = $16,100 → taxable before QBI = $243,900.
//   SSTB QBI = $260,000. 2026 band [201,750, 276,750]; AGI is inside the band.
//   phaseFraction = (276,750 − 260,000) / (276,750 − 201,750)
//                 = 16,750 / 75,000 = 0.223333…
//   Phased QBI income = 260,000 × 0.223333 = 58,066.67.
//   Deduction = min( 20% × 58,066.67 = 11,613.33 , 20% × 243,900 = 48,780 )
//             = $11,613.33.
//   PRE-FIX (TY2024 band, end 241,950): AGI 260,000 > 241,950 → fraction 0 →
//   the SSTB QBI zeroes out, leaving only the $400 OBBBA min deduction.
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2026 },
    w2s: [],
    form1099s: [],
    scheduleK1: [
      {
        taxYear: 2026,
        entityName: "Law Firm S Corp",
        entityType: "s_corp",
        activityType: "active",
        box1OrdinaryIncome: 260000,
        isSstb: true,
      },
    ],
    adjustments: [],
    taxYear: 2026,
  };
  const r = computeTaxReturnPure(inputs);
  check("AGI = $260,000", r.adjustedGrossIncome, 260000, 1);
  check("QBI deduction = $11,613.33 (2026 SSTB band)", r.qbiDeduction ?? 0, 11613.33, 1);
  // Discriminator: the pre-fix 2024-band bug would have collapsed this to the
  // $400 OBBBA floor. Anything well above $400 proves the 2026 band is in effect.
  assert("QBI deduction not collapsed to the $400 floor (bug fixed)", (r.qbiDeduction ?? 0) > 5000);
}

console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL TY2026 QBI REGRESSION CHECKS GREEN");
