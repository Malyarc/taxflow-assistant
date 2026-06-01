/**
 * BP3 — AMT preferences detail tests.
 *
 * Verifies:
 *   - SALT auto-addback (Form 6251 line 2g) when itemizing
 *   - SALT addback OFF when taking standard deduction (no SALT was deducted)
 *   - SALT addback override via `amt_state_tax_addback_override` adjustment
 *   - ISO bargain element via `amt_iso_bargain_element` adjustment (line 2k)
 *   - Combined preferences sum into AMTI
 *   - AMT binds when ISO bargain is large
 *
 * Hand-calc references:
 *   - 2024 single std ded: $14,600; MFJ std: $29,200
 *   - 2024 single AMT exemption: $85,700; phase-out starts $609,350
 *   - 2024 single AMT rate: 26% up to AMTI of $232,600, 28% above
 *   - Form 6251 instructions (2024): line 2g (state-tax addback),
 *     line 2k (ISO bargain element held past year-end)
 *   - SALT post-TCJA cap: $10,000 (single/MFJ); $5,000 MFS
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-amt-prefs-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { calculateAmt } from "../../artifacts/api-server/src/lib/taxCalculator";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 0.5) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

// ════════════════════════════════════════════════════════════════════════════
// Test A — SALT addback flows to AMTI when itemizing
// Single, $200k W-2, NY (so we get a state tax adjustment).
// Itemized: state income tax $25,000 + mortgage interest $20,000 = $45,000 raw.
// SALT cap: $10,000 (single 2024 post-TCJA). Itemized total = $10k + $20k = $30k.
// AGI = $200,000. Std ded = $14,600. Itemized $30k > std → itemize.
// Taxable = 200,000 − 30,000 = 170,000.
// AMTI = taxable 170,000 + SALT addback 10,000 = 180,000.
// Exemption $85,700 (single 2024) → AMTI − exemption = 94,300
// AMT pre-regular = 26% × 94,300 = 24,518
// Regular tax (single 2024 on $170k):
//   1,160 + 4,266 + 11,742.50 + (170,000-100,525) × 24% = 17,168.50 + 16,674
//   = wait: 1,160+4,266+11,742.50+ 24%×69,475 = 1,160+4,266+11,742.50+16,674 = 33,842.50
// AMT = max(0, 24,518 − 33,842.50) = 0 (regular tax dominates; no binding AMT,
// but AMTI correctly reflects the SALT addback).
// ════════════════════════════════════════════════════════════════════════════
header("Test A — SALT addback adds to AMTI when itemizing");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "NY", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 0, stateCode: "NY" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 25000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 20000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("Itemized deductions = $30,000 (SALT $10k + mortgage $20k)", r.itemizedDeductions ?? 0, 30000, 1);
  check("Taxable = $170,000", r.taxableIncome, 170000, 1);
  check("AMTI = $180,000 (taxable + SALT addback $10k)", r.detail.amt.amti, 180000, 1);
  check("AMT tax = $0 (regular tax dominates)", r.amtTax ?? 0, 0, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// Test B — SALT addback OFF when taking the standard deduction
// Single, $50k W-2, NY state tax $5k entered as adjustment.
// Itemized total $5k < std $14,600 → take std ded.
// Since no SALT was deducted on the return, no SALT addback for AMT.
// AGI = 50,000. Std ded = 14,600. Taxable = 35,400.
// AMTI = 35,400 (no SALT addback) — same as taxable.
// AMT pre-regular = 26% × max(0, 35,400 − 85,700) = 0 (exemption absorbs everything).
// ════════════════════════════════════════════════════════════════════════════
header("Test B — SALT addback OFF when taking standard deduction");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "NY", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 0, stateCode: "NY" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 5000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("Used standard deduction (itemizedDeductions null)", r.itemizedDeductions ?? -1, -1, 0.01);
  check("AMTI = $35,400 (taxable, no SALT addback)", r.detail.amt.amti, 35400, 1);
  check("AMT tax = $0 (well below exemption)", r.amtTax ?? 0, 0, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// Test C — SALT addback override replaces the auto value
// Same as Test A, but with amt_state_tax_addback_override = $7,500 → AMTI uses
// $7,500 instead of $10,000.
// AMTI = 170,000 + 7,500 = 177,500.
// ════════════════════════════════════════════════════════════════════════════
header("Test C — SALT addback override replaces auto-derived value");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "NY", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 0, stateCode: "NY" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 25000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 20000, isApplied: true },
      { adjustmentType: "amt_state_tax_addback_override", amount: 7500, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("AMTI = $177,500 (override $7,500 replaces auto $10,000)", r.detail.amt.amti, 177500, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// Test D — ISO bargain element bumps AMTI (small case — no AMT bind)
// Per spec: 1,000 sh @ $10 strike, FMV $40 → $30,000 bargain element.
// Single, $80k W-2, std ded, $30k ISO bargain (held past year-end).
// Taxable = 80,000 − 14,600 = 65,400.
// AMTI = 65,400 + 30,000 = 95,400.
// Exemption $85,700. AMTI − exemption = 9,700.
// AMT pre-regular = 26% × 9,700 = 2,522.
// Regular tax = 1,160 + 4,266 + (65,400-47,150)×22% = 9,441.
// AMT = max(0, 2,522 − 9,441) = 0 (regular tax dominates).
// Verify AMTI increased correctly.
// ════════════════════════════════════════════════════════════════════════════
header("Test D — ISO bargain element (1000 sh @ $10 strike, FMV $40 → $30k)");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "amt_iso_bargain_element", amount: 30000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("AMTI = $95,400 (taxable + $30k ISO bargain)", r.detail.amt.amti, 95400, 1);
  check("AMT tax = $0 (regular tax dominates)", r.amtTax ?? 0, 0, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// Test E — Large ISO bargain MAKES AMT BIND
// Single, $50k W-2, std ded, $150,000 ISO bargain element.
// Taxable = 50,000 − 14,600 = 35,400.
// Regular tax = 1,160 + 4,266 + (35,400-11,600 over 12% bracket)
//   Actually: 1,160 + 12% × (35,400 − 11,600) = 1,160 + 12% × 23,800 = 1,160 + 2,856 = 4,016.
// AMTI = 35,400 + 150,000 = 185,400.
// Exemption $85,700. AMTI − exemption = 99,700.
// AMT pre-regular = 26% × 99,700 = 25,922.
// AMT vs regular = max(0, 25,922 − 4,016) = 21,906.
// ════════════════════════════════════════════════════════════════════════════
header("Test E — Large ISO bargain makes AMT bind");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "amt_iso_bargain_element", amount: 150000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("Regular taxable = $35,400", r.taxableIncome, 35400, 1);
  check("AMTI = $185,400", r.detail.amt.amti, 185400, 1);
  check("AMT tax = $21,906", r.amtTax ?? 0, 21906, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// Test F — Combined SALT + ISO + legacy catch-all all sum into AMTI
// Single, $200k W-2, NY. Itemized: state tax $25k + mortgage $20k → SALT addback $10k.
// ISO bargain $40,000. Legacy amt_preferences $5,000 (catch-all).
// Taxable = 200,000 − 30,000 = 170,000.
// AMTI = 170,000 + 10,000 (SALT) + 40,000 (ISO) + 5,000 (legacy) = 225,000.
// ════════════════════════════════════════════════════════════════════════════
header("Test F — Combined: SALT addback + ISO + legacy catch-all");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "NY", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 0, stateCode: "NY" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 25000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 20000, isApplied: true },
      { adjustmentType: "amt_iso_bargain_element", amount: 40000, isApplied: true },
      { adjustmentType: "amt_preferences", amount: 5000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("AMTI = $225,000 (taxable $170k + SALT $10k + ISO $40k + legacy $5k)", r.detail.amt.amti, 225000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// Test G — MFJ filing: same brackets but different exemption/SALT-cap behavior
// MFJ, $400k W-2, NY itemized: $30k state tax (capped at $10k) + $50k mortgage = $60k itemized.
// AGI = 400,000. Std ded MFJ = 29,200. Itemized $60k > std → itemize.
// Taxable = 340,000.
// AMTI = 340,000 + 10,000 (SALT addback) = 350,000.
// MFJ exemption $133,300; phase-out starts at $1,218,700 → full exemption applies.
// AMTI − exemption = 216,700.
// AMT pre-regular = 26% × 216,700 = 56,342.
// Regular tax (MFJ 2024 on $340k): hand-calc:
//   23,200 × 10% = 2,320; (94,300-23,200) × 12% = 71,100 × 12% = 8,532; cum 10,852
//   (201,050-94,300) × 22% = 106,750 × 22% = 23,485; cum 34,337
//   (340,000-201,050) × 24% = 138,950 × 24% = 33,348; cum 67,685
// AMT = max(0, 56,342 − 67,685) = 0
// Verify AMTI reflects SALT addback for MFJ.
// ════════════════════════════════════════════════════════════════════════════
header("Test G — MFJ SALT addback flows through identically");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "NY", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 400000, federalTaxWithheldBox2: 0, stateCode: "NY" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 30000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 50000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("Itemized = $60,000 (SALT $10k + mortgage $50k)", r.itemizedDeductions ?? 0, 60000, 1);
  check("AMTI = $350,000 (taxable $340k + SALT addback $10k)", r.detail.amt.amti, 350000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// Form 6251 LINE 2e — taxable state refund removed from AMTI (fix 2026-06-01)
// ════════════════════════════════════════════════════════════════════════════
// A taxable state/local refund (§111) is included in regular taxable income but
// is NOT income for AMT (the underlying state-tax deduction was never allowed
// for AMT). The engine now subtracts it from the AMT base (a negative §6251
// adjustment); the AMTI floor moved from the prefs to AMTI itself so a negative
// net adjustment is honored.

// ── Direct mechanism: a negative net preference reduces AMTI by amount × rate ─
// taxableIncome $300,000. With prefs −$5,000 → AMTI = max(0, 295,000) = 295,000;
//   amtBase = 295,000 − 85,700 = 209,300; 26% = $54,418 (below $232,600).
// With prefs 0 → AMTI 300,000; amtBase 214,300; 26% = $55,718.
// Difference $1,300 = $5,000 × 26% (the refund's AMT effect).
{
  const withNeg = calculateAmt({ taxableIncome: 300000, amtPreferences: -5000, filingStatus: "single", regularTax: 0, taxYear: 2024 });
  const without = calculateAmt({ taxableIncome: 300000, amtPreferences: 0, filingStatus: "single", regularTax: 0, taxYear: 2024 });
  check("Line 2e direct: neg pref → AMTI $295,000", withNeg.amti, 295000, 1);
  check("Line 2e direct: TMT $54,418 (vs $55,718 without)", withNeg.amtAtFullRateOnAmtBase, 54418, 1);
  check("Line 2e direct: difference = $1,300 ($5k × 26%)", without.amtAtFullRateOnAmtBase - withNeg.amtAtFullRateOnAmtBase, 1300, 1);
}

// ── End-to-end: toggling ONLY the state refund leaves AMTI identical ──────
// Single NY itemizer (W-2 $200k, SALT capped $10k + mortgage $20k, prior-year
// itemized). A $5,000 state refund flows into REGULAR taxable income (170k →
// 175k) but line 2e removes it from AMTI → AMTI stays $180,000 either way.
// (Without the fix the refund run would show AMTI $185,000.)
{
  const base = {
    client: { filingStatus: "single", state: "NY", taxYear: 2024, priorYearItemized: true } as unknown as TaxReturnInputs["client"],
    w2s: [{ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 0, stateCode: "NY" }] as unknown as TaxReturnInputs["w2s"],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 25000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 20000, isApplied: true },
    ] as unknown as TaxReturnInputs["adjustments"],
    taxYear: 2024,
  };
  const withRefund = computeTaxReturnPure({ ...base, form1099s: [{ taxYear: 2024, formType: "g", stateLocalRefund: 5000 }] as unknown as TaxReturnInputs["form1099s"] });
  const noRefund = computeTaxReturnPure({ ...base, form1099s: [] });
  check("Line 2e E2E: refund flows to REGULAR taxable ($175k vs $170k)", withRefund.taxableIncome - noRefund.taxableIncome, 5000, 1);
  check("Line 2e E2E: AMTI identical $180,000 (refund excluded)", withRefund.detail.amt.amti, 180000, 1);
  check("Line 2e E2E: AMTI unchanged by the refund", withRefund.detail.amt.amti - noRefund.detail.amt.amti, 0, 0.5);
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
console.log(`\nAll ${PASS.length} AMT-preferences assertions passed.`);
