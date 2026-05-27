/**
 * Phase H — H6: Form 8606 pro-rata math — hand-calc'd tests.
 *
 * Pure engine; no API required.
 *
 * Reference: IRS Form 8606 (2024), IRC §408(d)(2).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-form8606-tests.ts
 */
import {
  computeForm8606ProRata,
} from "../../artifacts/api-server/src/lib/form8606";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 0.5): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

// ── Case 1: Pure-basis IRA → 100% tax-free conversion ─────────────────────
// IRA has $10,000 balance, all $10k is after-tax basis (e.g., a recently
// funded "clean" backdoor Roth setup). Convert $10k.
//   Line 10 fraction = 10000 / (0 + 0 + 10000) = 1.0
//   Excluded = 10000 × 1.0 = $10,000 (full conversion is tax-free)
//   Taxable = 10000 - 10000 = $0
{
  const r = computeForm8606ProRata({
    conversionAmount: 10000,
    totalTraditionalIraBalance: 0, // moved all to Roth
    totalAfterTaxBasis: 10000,
    nondeductibleContribution: 10000,
  });
  check("Case 1 pro-rata fraction = 1.0 (all basis)", r.proRataFraction, 1.0);
  check("Case 1 excluded amount = 10,000", r.excludedAmount, 10000);
  check("Case 1 taxable amount = 0", r.taxableAmount, 0);
  check("Case 1 basis carryforward = 0 (all recovered)", r.basisCarryforward, 0);
}

// ── Case 2: Mixed IRA — partial pro-rata ──────────────────────────────────
// Pre-existing $90k traditional IRA (all pre-tax) + $10k nondeductible
// contribution → total $100k. Convert $20k to Roth.
//   At year-end: balance is $80k (after $20k conversion out).
//   Line 6 = 80k year-end; Line 8 = 20k conversion.
//   Line 10 = 10000 basis / (80000 + 20000) = 10000/100000 = 0.10
//   Excluded = 20000 × 0.10 = $2,000
//   Taxable = 20000 - 2000 = $18,000
//   Basis carryforward = 10000 - 2000 = $8,000
{
  const r = computeForm8606ProRata({
    conversionAmount: 20000,
    totalTraditionalIraBalance: 80000, // year-end after conversion
    totalAfterTaxBasis: 10000,
    nondeductibleContribution: 10000,
  });
  check("Case 2 pro-rata fraction = 0.10", r.proRataFraction, 0.10, 0.001);
  check("Case 2 excluded amount = $2,000", r.excludedAmount, 2000);
  check("Case 2 taxable amount = $18,000", r.taxableAmount, 18000);
  check("Case 2 basis carryforward = $8,000", r.basisCarryforward, 8000);
}

// ── Case 3: Pure pre-tax IRA → 100% taxable ───────────────────────────────
// Client has $100k pre-tax IRA, no after-tax basis. Convert $20k.
//   Line 10 = 0 / (80k + 20k) = 0.0
//   Excluded = 0; taxable = $20k
{
  const r = computeForm8606ProRata({
    conversionAmount: 20000,
    totalTraditionalIraBalance: 80000,
    totalAfterTaxBasis: 0,
    nondeductibleContribution: 0,
  });
  check("Case 3 pro-rata fraction = 0", r.proRataFraction, 0);
  check("Case 3 excluded = 0", r.excludedAmount, 0);
  check("Case 3 taxable = full conversion", r.taxableAmount, 20000);
  check("Case 3 basis carryforward = 0", r.basisCarryforward, 0);
}

// ── Case 4: No conversion → all-zero result ───────────────────────────────
{
  const r = computeForm8606ProRata({
    conversionAmount: 0,
    totalTraditionalIraBalance: 50000,
    totalAfterTaxBasis: 5000,
    nondeductibleContribution: 5000,
  });
  check("Case 4 no conversion → fraction 0", r.proRataFraction, 0);
  check("Case 4 no conversion → excluded 0", r.excludedAmount, 0);
  check("Case 4 no conversion → taxable 0", r.taxableAmount, 0);
  check("Case 4 basis carries forward intact", r.basisCarryforward, 5000);
}

// ── Case 5: Distribution + conversion split correctly ─────────────────────
// $100k IRA with $20k basis. Take $10k distribution + $20k Roth conversion.
//   Year-end = 70k. Denominator = 70k + 10k + 20k = 100k.
//   Fraction = 20000 / 100000 = 0.20
//   Total basis recovered = 30000 × 0.20 = $6,000
//   Conversion share = 20000 / 30000 = 0.6667
//   Excluded (conversion) = 6000 × 0.6667 = $4,000
//   Taxable (conversion) = 20000 - 4000 = $16,000
{
  const r = computeForm8606ProRata({
    conversionAmount: 20000,
    totalTraditionalIraBalance: 70000,
    totalAfterTaxBasis: 20000,
    nondeductibleContribution: 0,
    otherDistributions: 10000,
  });
  check("Case 5 pro-rata fraction = 0.20", r.proRataFraction, 0.20, 0.001);
  check("Case 5 excluded conversion = $4,000", r.excludedAmount, 4000, 1);
  check("Case 5 taxable conversion = $16,000", r.taxableAmount, 16000, 1);
  check(
    "Case 5 basis carryforward = $14,000 (20k - 6k recovered)",
    r.basisCarryforward,
    14000,
    1,
  );
}

// ── Case 6: Backdoor Roth — clean execution (no other pre-tax IRA) ────────
// Client contributes $7,000 nondeductible, immediately converts $7,000.
// No other pre-tax IRA money exists.
//   Year-end = 0. Denominator = 0 + 0 + 7000 = 7000.
//   Fraction = 7000 / 7000 = 1.0
//   Excluded = $7,000 (all of conversion is basis)
//   Taxable = $0
//   Basis carryforward = $0
{
  const r = computeForm8606ProRata({
    conversionAmount: 7000,
    totalTraditionalIraBalance: 0,
    totalAfterTaxBasis: 7000,
    nondeductibleContribution: 7000,
  });
  check("Case 6 backdoor Roth fraction = 1.0", r.proRataFraction, 1.0);
  check("Case 6 backdoor Roth excluded = $7,000", r.excludedAmount, 7000);
  check("Case 6 backdoor Roth taxable = $0", r.taxableAmount, 0);
}

// ── Case 7: Pro-rata trap — backdoor Roth with existing pre-tax IRA ──────
// Client has $100k pre-tax 401(k) rollover IRA. Now does a $7,000 backdoor
// contribution + conversion. The §408(d)(2) aggregation forces pro-rata.
//   Year-end = 100k (the pre-existing pre-tax IRA remains).
//   Basis = 7000. Denominator = 100k + 7000 = 107000.
//   Fraction = 7000/107000 ≈ 0.0654
//   Excluded ≈ 7000 × 0.0654 ≈ $458
//   Taxable ≈ 7000 - 458 ≈ $6,542
//   This is THE trap that surprises clients — most of the supposedly-tax-
//   free backdoor Roth ends up taxable due to the IRA aggregation rule.
{
  const r = computeForm8606ProRata({
    conversionAmount: 7000,
    totalTraditionalIraBalance: 100000,
    totalAfterTaxBasis: 7000,
    nondeductibleContribution: 7000,
  });
  check("Case 7 pro-rata trap fraction ≈ 0.0654", r.proRataFraction, 0.0654, 0.001);
  check("Case 7 pro-rata trap excluded ≈ $458", r.excludedAmount, 458, 2);
  check("Case 7 pro-rata trap taxable ≈ $6,542", r.taxableAmount, 6542, 2);
}

// ── Case 8: Defensive — negative inputs are clamped to 0 ──────────────────
{
  const r = computeForm8606ProRata({
    conversionAmount: -5000, // bad input
    totalTraditionalIraBalance: -1000,
    totalAfterTaxBasis: -100,
    nondeductibleContribution: -50,
  });
  check("Case 8 negative conversion clamped to 0", r.conversionAmount, 0);
  check("Case 8 negative balance clamped to 0", r.yearEndBalance, 0);
}

// ── Print results ─────────────────────────────────────────────────────────
console.log(`\nForm 8606 (H6) tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) {
  FAIL.forEach((f) => console.log(`    ${f}`));
}
process.exit(FAIL.length > 0 ? 1 : 0);
