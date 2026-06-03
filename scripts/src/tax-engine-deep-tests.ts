/**
 * Deep edge-case tests for the tax engine. Probes every permutation I could
 * think of — multi-bracket capital gains, capital losses, double-counting
 * pitfalls, year filtering, NIIT thresholds at exact boundaries, etc.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-deep-tests.ts
 */

import {
  calculateFederalTax,
  calculateFederalTaxWithCapitalGains,
  calculateChildTaxCredit,
  calculateNiit,
  calculateSelfEmploymentTax,
  resolveTaxYear,
} from "../../artifacts/api-server/src/lib/taxCalculator";

const PASS: string[] = [];
const FAIL: string[] = [];

function near(a: number, b: number, tol = 0.01): boolean { return Math.abs(a - b) <= tol; }
function check(label: string, actual: number, expected: number, tol = 0.01) {
  if (near(actual, expected, tol)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(4)}, got ${actual.toFixed(4)}`);
}
function checkExact<T>(label: string, actual: T, expected: T) {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

// ═══════════════════════════════════════════════════════════════════════════
// SECTION A: Capital gains math — every bracket boundary
// ═══════════════════════════════════════════════════════════════════════════
header("A. Capital gains: ordinary income exactly AT the 0% threshold");
// Single 2024: 0% cap is $47,025
{
  // Ordinary = $47,025 exactly. Add $10k LTCG. All LTCG is in 15% bracket.
  const r = calculateFederalTaxWithCapitalGains({
    ordinaryTaxableIncome: 47025, longTermGains: 10000, qualifiedDividends: 0, shortTermGains: 0,
    filingStatus: "single", taxYear: 2024,
  });
  check("Ordinary AT $47,025: LTCG fully at 15%", r.preferentialRateTax, 10000 * 0.15);
}
{
  // Ordinary = $40k. LTCG = $7,025 (fits exactly in remaining 0% room).
  const r = calculateFederalTaxWithCapitalGains({
    ordinaryTaxableIncome: 40000, longTermGains: 7025, qualifiedDividends: 0, shortTermGains: 0,
    filingStatus: "single", taxYear: 2024,
  });
  check("LTCG fits exactly in 0% room → $0", r.preferentialRateTax, 0);
}

header("A. Capital gains: LTCG that crosses 0% → 15% boundary");
{
  // Single 2024, ordinary $30k. LTCG $30k. Fills 30k-60k.
  // 0% slice: 30k-47025 = $17,025; tax = $0
  // 15% slice: 47025-60000 = $12,975; tax = $1,946.25
  const r = calculateFederalTaxWithCapitalGains({
    ordinaryTaxableIncome: 30000, longTermGains: 30000, qualifiedDividends: 0, shortTermGains: 0,
    filingStatus: "single", taxYear: 2024,
  });
  check("Single 2024 ordinary $30k + LTCG $30k crosses 0%→15%", r.preferentialRateTax, 1946.25);
}

header("A. Capital gains: LTCG that crosses 15% → 20% boundary");
{
  // Single 2024, 15%/20% boundary at $518,900. Ordinary $400k, LTCG $200k.
  // 15% slice: 400k-518,900 = $118,900; tax = $17,835
  // 20% slice: 518,900-600,000 = $81,100; tax = $16,220
  const r = calculateFederalTaxWithCapitalGains({
    ordinaryTaxableIncome: 400000, longTermGains: 200000, qualifiedDividends: 0, shortTermGains: 0,
    filingStatus: "single", taxYear: 2024,
  });
  check("Single 2024 LTCG crosses 15%→20%", r.preferentialRateTax, 17835 + 16220);
}

header("A. Capital gains: very large LTCG, all in 20%");
{
  // Single, ordinary $1M, LTCG $500k. All LTCG in 20%.
  const r = calculateFederalTaxWithCapitalGains({
    ordinaryTaxableIncome: 1000000, longTermGains: 500000, qualifiedDividends: 0, shortTermGains: 0,
    filingStatus: "single", taxYear: 2024,
  });
  check("Single 2024 ordinary $1M + LTCG $500k all at 20%", r.preferentialRateTax, 500000 * 0.20);
}

header("A. Capital gains: capital LOSS (negative LTCG)");
{
  // Negative LTCG should be clamped to 0 for the preferential calc — capital losses
  // offset other gains in real tax law, but our simple model treats them as $0.
  const r = calculateFederalTaxWithCapitalGains({
    ordinaryTaxableIncome: 50000, longTermGains: -10000, qualifiedDividends: 0, shortTermGains: 0,
    filingStatus: "single", taxYear: 2024,
  });
  check("Negative LTCG → $0 preferential tax", r.preferentialRateTax, 0);
}
{
  // Negative STCG: should also clamp.
  const r = calculateFederalTaxWithCapitalGains({
    ordinaryTaxableIncome: 50000, longTermGains: 0, qualifiedDividends: 0, shortTermGains: -5000,
    filingStatus: "single", taxYear: 2024,
  });
  // Federal tax should equal ordinary tax on $50k (STCG of -5k clamped to 0)
  // 1160 + (47150-11600)*.12 + (50000-47150)*.22 = 1160 + 4266 + 627 = $6,053
  check("Negative STCG → ordinary tax on ordinary only", r.totalFederalTax, 6053);
}

header("A. Capital gains: STCG and LTCG together");
{
  // Single 2024, ordinary $40k, STCG $10k (taxed ordinary), LTCG $20k
  // Ordinary + STCG = $50k → ordinary tax = 1160 + 4266 + (50000-47150)*.22 = 1160 + 4266 + 627 = $6,053
  // LTCG fills $50k → $70k. 0% cap at $47,025 (already past). All LTCG in 15%. Tax = $3,000
  const r = calculateFederalTaxWithCapitalGains({
    ordinaryTaxableIncome: 40000, longTermGains: 20000, qualifiedDividends: 0, shortTermGains: 10000,
    filingStatus: "single", taxYear: 2024,
  });
  check("STCG + LTCG: ordinary tax on ord+STCG", r.totalFederalTax - r.preferentialRateTax, 6053);
  check("STCG + LTCG: LTCG tax at 15%", r.preferentialRateTax, 20000 * 0.15);
}

header("A. Capital gains: HoH and MFS thresholds");
{
  // HoH 2024 0% threshold: $63,000
  const r = calculateFederalTaxWithCapitalGains({
    ordinaryTaxableIncome: 60000, longTermGains: 5000, qualifiedDividends: 0, shortTermGains: 0,
    filingStatus: "head_of_household", taxYear: 2024,
  });
  // 60k+5k = 65k; 0% cap is $63k. 0% slice: $3k × 0% = 0. 15% slice: $2k × 15% = $300
  check("HoH 2024 LTCG crosses 0% threshold", r.preferentialRateTax, 300);
}
{
  // MFS 2024 0% threshold: $47,025 (same as single)
  const r = calculateFederalTaxWithCapitalGains({
    ordinaryTaxableIncome: 50000, longTermGains: 10000, qualifiedDividends: 0, shortTermGains: 0,
    filingStatus: "married_filing_separately", taxYear: 2024,
  });
  // All LTCG above $47,025 → 15%
  check("MFS 2024 LTCG fully at 15%", r.preferentialRateTax, 10000 * 0.15);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION B: NIIT edge cases
// ═══════════════════════════════════════════════════════════════════════════
header("B. NIIT: AGI exactly AT threshold (no NIIT)");
{
  const r = calculateNiit({ investmentIncome: 50000, modifiedAgi: 200000, filingStatus: "single" });
  checkExact("NIIT at AGI = $200k single → $0 (no excess)", r.niitTax, 0);
}
{
  const r = calculateNiit({ investmentIncome: 50000, modifiedAgi: 250000, filingStatus: "married_filing_jointly" });
  checkExact("NIIT at AGI = $250k MFJ → $0", r.niitTax, 0);
}

header("B. NIIT: AGI just $1 above threshold");
{
  const r = calculateNiit({ investmentIncome: 50000, modifiedAgi: 200001, filingStatus: "single" });
  // excess = $1, min(50k, 1) = $1, × 3.8% = $0.038
  check("NIIT at AGI = $200,001 single → $0.038", r.niitTax, 0.038);
}

header("B. NIIT: investment income = 0 → no NIIT");
{
  const r = calculateNiit({ investmentIncome: 0, modifiedAgi: 500000, filingStatus: "single" });
  checkExact("NIIT with $0 investment income → $0", r.niitTax, 0);
}

header("B. NIIT: negative investment income clamped to 0");
{
  const r = calculateNiit({ investmentIncome: -5000, modifiedAgi: 500000, filingStatus: "single" });
  checkExact("NIIT with negative invest income → $0", r.niitTax, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION C: CTC/ACTC permutations
// ═══════════════════════════════════════════════════════════════════════════
header("C. CTC: edge cases");
{
  // Earned income exactly $2,500 → ACTC = 0
  const r = calculateChildTaxCredit({
    qualifyingChildren: 2, otherDependents: 0, agi: 2500,
    filingStatus: "single", taxYear: 2024, taxBeforeCredit: 0, earnedIncome: 2500,
  });
  checkExact("Earned income = $2,500 (= threshold) → ACTC $0", r.refundableActc, 0);
}
{
  // Earned income $1, below threshold
  const r = calculateChildTaxCredit({
    qualifyingChildren: 2, otherDependents: 0, agi: 1,
    filingStatus: "single", taxYear: 2024, taxBeforeCredit: 0, earnedIncome: 1,
  });
  checkExact("Earned income $1 → ACTC $0", r.refundableActc, 0);
}
{
  // Tax exactly equals total CTC: full non-refundable, no ACTC
  const r = calculateChildTaxCredit({
    qualifyingChildren: 1, otherDependents: 0, agi: 50000,
    filingStatus: "single", taxYear: 2024, taxBeforeCredit: 2000, earnedIncome: 50000,
  });
  checkExact("Tax = CTC → all non-refundable, $0 ACTC", r.appliedCredit, 2000);
  checkExact("  refundable portion = $0", r.refundableActc, 0);
}
{
  // No taxBeforeCredit specified (legacy mode) → all credit treated as one number
  const r = calculateChildTaxCredit({
    qualifyingChildren: 2, otherDependents: 0, agi: 50000,
    filingStatus: "single", taxYear: 2024,
  });
  checkExact("No taxBeforeCredit (legacy) → applied = preliminary", r.appliedCredit, 4000);
}
{
  // Phase-out exactly at increment boundary: $200,001 single → ceil(1/1000) = 1 increment × $50 = $50 reduction
  const r = calculateChildTaxCredit({
    qualifyingChildren: 1, otherDependents: 0, agi: 201000,
    filingStatus: "single", taxYear: 2024,
  });
  // excess $1k, ceil(1) = 1 increment, × $50 = $50; CTC = $2000 - $50 = $1950
  checkExact("Phase-out at $201k single, 1 child → $1,950", r.appliedCredit, 1950);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION D: SE tax edge cases
// ═══════════════════════════════════════════════════════════════════════════
header("D. SE tax: SS wage base boundaries");
{
  // 2024 SS wage base: $168,600. Net earnings (after 0.9235) = SS_BASE.
  // Gross at boundary: 168600 / 0.9235 ≈ $182,565
  const grossAtBoundary = 168600 / 0.9235;
  const r = calculateSelfEmploymentTax(grossAtBoundary, 2024);
  // Net earnings = $168,600 exactly. Both SS and Medicare apply.
  // SS = 168,600 × 12.4% = 20,906.40
  // Medicare = 168,600 × 2.9% = 4,889.40
  // Total = 25,795.80
  check("SE at SS wage base exactly", r.seTaxTotal, 25795.80, 1);
}
{
  // SE income just over base — only Medicare applies on excess
  const grossOverBase = (168600 / 0.9235) + 10000;
  const r = calculateSelfEmploymentTax(grossOverBase, 2024);
  // Net earnings = 168,600 + (10,000 × 0.9235) = 168,600 + 9,235 = 177,835
  // SS = 168,600 × 12.4% = 20,906.40
  // Medicare = 177,835 × 2.9% = 5,157.215
  // Total = 26,063.615
  check("SE just over wage base, Medicare on excess", r.seTaxTotal, 26063.615, 0.5);
}
{
  // Zero SE income — no tax
  const r = calculateSelfEmploymentTax(0, 2024);
  checkExact("Zero SE income → $0", r.seTaxTotal, 0);
  checkExact("Zero SE income → $0 deductible half", r.deductibleHalf, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION E: Tax year resolution
// ═══════════════════════════════════════════════════════════════════════════
header("E. Tax year resolution edge cases");
checkExact("Year 0 → 2024 (clamps to nearest)", resolveTaxYear(0), 2024);
checkExact("Year null → 2025 (latest)", resolveTaxYear(null), 2025);
checkExact("Year undefined → 2025 (latest)", resolveTaxYear(undefined), 2025);
checkExact("Year 2024 → 2024", resolveTaxYear(2024), 2024);
checkExact("Year 2025 → 2025", resolveTaxYear(2025), 2025);
checkExact("Year 2023 → 2024 (just below)", resolveTaxYear(2023), 2024);
checkExact("Year 2026 → 2026 (now natively supported)", resolveTaxYear(2026), 2026);
checkExact("Year 2027 → 2025 (just above supported range → LATEST_YEAR)", resolveTaxYear(2027), 2025);
checkExact("Year 2050 → 2025 (far future)", resolveTaxYear(2050), 2025);

// ═══════════════════════════════════════════════════════════════════════════
// SECTION F: Federal tax: filing status sanity
// ═══════════════════════════════════════════════════════════════════════════
header("F. Federal tax: same income across all filing statuses, 2024 + 2025");
{
  // $100k taxable income across statuses
  const ty = 2024;
  const single = calculateFederalTax(100000, "single", ty);
  const mfj = calculateFederalTax(100000, "married_filing_jointly", ty);
  const hoh = calculateFederalTax(100000, "head_of_household", ty);
  const mfs = calculateFederalTax(100000, "married_filing_separately", ty);
  // MFS rates = single in lower brackets, so MFS = single at this income level
  checkExact("MFS = Single at $100k 2024", mfs, single);
  // MFJ pays less than single on same income
  if (mfj < single) PASS.push("✓ MFJ < Single at $100k 2024 (joint advantage)");
  else FAIL.push(`✗ MFJ should be < Single: mfj=${mfj}, single=${single}`);
  // HoH between single and MFJ
  if (hoh < single && hoh > mfj) PASS.push("✓ HoH between MFJ and Single at $100k 2024");
  else FAIL.push(`✗ HoH should be between MFJ and Single: hoh=${hoh}, single=${single}, mfj=${mfj}`);
}

console.log("\n");
console.log("══════════════════════════════════════════════════════════════════");
console.log(`  DEEP TEST RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
console.log("══════════════════════════════════════════════════════════════════");
if (FAIL.length > 0) {
  console.log("\nFAILURES:");
  for (const f of FAIL) console.log("  " + f);
  process.exit(1);
}
process.exit(0);
