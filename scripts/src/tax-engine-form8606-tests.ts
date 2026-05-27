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
  computeForm8606PartIII,
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

function checkBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

// ── PART III — Roth IRA distribution basis recovery (Lines 19-25) ─────────
// Reference: Treas. Reg. §1.408A-6 Q&A 8 (ordering rule); IRC §72(t) (10%).

// ── PIII Case 1: Qualified distribution (over 59½, 5-yr clock) ────────────
// Owner age 65, $50k distribution from $200k Roth balance with $80k basis,
// first Roth was 10 years ago. Entire $50k is tax-free, no penalty.
{
  const r = computeForm8606PartIII({
    rothDistribution: 50000,
    rothContributionsBasis: 80000,
    rothBalanceBeforeDistribution: 200000,
    ownerAge: 65,
    firstRothFiveYearsOld: true,
  });
  checkBool("PIII Case 1 isQualifiedDistribution = true", r.isQualifiedDistribution, true);
  check("PIII Case 1 basisRecovered = 50,000 (entire)", r.basisRecovered, 50000);
  check("PIII Case 1 taxableEarnings = 0", r.taxableEarnings, 0);
  check("PIII Case 1 earlyDistributionPenalty = 0", r.earlyDistributionPenalty, 0);
  check("PIII Case 1 basisRemaining = 30,000 (80k − 50k)", r.basisRemaining, 30000);
}

// ── PIII Case 2: Non-qualified, distribution entirely from basis ──────────
// Owner age 45 (under 59½), $40k distribution, $80k contribution basis.
// All $40k comes out of basis → tax-free, no penalty.
// Line 19 = 40k. Line 22 = 80k. Line 23 = 0. Line 25 = 0.
{
  const r = computeForm8606PartIII({
    rothDistribution: 40000,
    rothContributionsBasis: 80000,
    rothBalanceBeforeDistribution: 100000,
    ownerAge: 45,
    firstRothFiveYearsOld: true,
  });
  checkBool("PIII Case 2 isQualifiedDistribution = false (under 59½)", r.isQualifiedDistribution, false);
  check("PIII Case 2 basisRecovered = 40,000 (within basis)", r.basisRecovered, 40000);
  check("PIII Case 2 taxableEarnings = 0", r.taxableEarnings, 0);
  check("PIII Case 2 earlyDistributionPenalty = 0 (no taxable)", r.earlyDistributionPenalty, 0);
  check("PIII Case 2 line25_taxableAmount = 0", r.line25_taxableAmount, 0);
  check("PIII Case 2 basisRemaining = 40,000 (80k − 40k)", r.basisRemaining, 40000);
}

// ── PIII Case 3: Non-qualified, distribution exceeds basis ────────────────
// Owner age 50, $50k distribution, $30k basis, $100k balance.
// First $30k from basis (tax-free). Remaining $20k = earnings → taxable +
// 10% penalty.
// Line 19 = 50k. Line 22 = 30k. Line 23 = 20k. Line 25 = 20k.
// Penalty = 20k × 10% = $2,000.
{
  const r = computeForm8606PartIII({
    rothDistribution: 50000,
    rothContributionsBasis: 30000,
    rothBalanceBeforeDistribution: 100000,
    ownerAge: 50,
    firstRothFiveYearsOld: true,
  });
  checkBool("PIII Case 3 isQualifiedDistribution = false", r.isQualifiedDistribution, false);
  check("PIII Case 3 basisRecovered = 30,000 (full basis)", r.basisRecovered, 30000);
  check("PIII Case 3 taxableEarnings = 20,000", r.taxableEarnings, 20000);
  check("PIII Case 3 earlyDistributionPenalty = 2,000 (10% × 20k)", r.earlyDistributionPenalty, 2000);
  check("PIII Case 3 line25_taxableAmount = 20,000", r.line25_taxableAmount, 20000);
  check("PIII Case 3 basisRemaining = 0 (basis fully recovered)", r.basisRemaining, 0);
}

// ── PIII Case 4: Over 59½ but 5-yr clock NOT met → non-qualified ──────────
// Owner age 62 BUT first Roth was 3 years ago. Distribution $25k, basis $10k.
// Not qualified (clock not met). $10k from basis tax-free + no penalty
// (over 59½). $15k earnings taxable + NO penalty (over 59½ exempts §72(t)).
{
  const r = computeForm8606PartIII({
    rothDistribution: 25000,
    rothContributionsBasis: 10000,
    rothBalanceBeforeDistribution: 50000,
    ownerAge: 62,
    firstRothFiveYearsOld: false,
  });
  checkBool("PIII Case 4 isQualifiedDistribution = false (clock not met)", r.isQualifiedDistribution, false);
  check("PIII Case 4 basisRecovered = 10,000", r.basisRecovered, 10000);
  check("PIII Case 4 taxableEarnings = 15,000", r.taxableEarnings, 15000);
  // Penalty = 0 because age >= 59.5 — §72(t) exception
  check("PIII Case 4 earlyDistributionPenalty = 0 (over 59½)", r.earlyDistributionPenalty, 0);
}

// ── PIII Case 5: Zero distribution → all zeros, basis unchanged ───────────
{
  const r = computeForm8606PartIII({
    rothDistribution: 0,
    rothContributionsBasis: 50000,
    rothBalanceBeforeDistribution: 100000,
    ownerAge: 45,
  });
  check("PIII Case 5 line19_distribution = 0", r.line19_distribution, 0);
  check("PIII Case 5 basisRecovered = 0", r.basisRecovered, 0);
  check("PIII Case 5 basisRemaining = 50,000 (unchanged)", r.basisRemaining, 50000);
}

// ── PIII Case 6: Negative inputs clamped to 0 ─────────────────────────────
{
  const r = computeForm8606PartIII({
    rothDistribution: -5000,
    rothContributionsBasis: -1000,
    rothBalanceBeforeDistribution: -2000,
    ownerAge: 30,
  });
  check("PIII Case 6 negative distribution clamped", r.line19_distribution, 0);
  check("PIII Case 6 basisRecovered = 0 (negative)", r.basisRecovered, 0);
  check("PIII Case 6 basisRemaining = 0 (negative basis clamped)", r.basisRemaining, 0);
}

// ── PIII Case 7: Distribution exactly equals basis (edge: $0 earnings) ────
{
  const r = computeForm8606PartIII({
    rothDistribution: 25000,
    rothContributionsBasis: 25000,
    rothBalanceBeforeDistribution: 100000,
    ownerAge: 40,
    firstRothFiveYearsOld: true,
  });
  check("PIII Case 7 basisRecovered = 25,000 (exact match)", r.basisRecovered, 25000);
  check("PIII Case 7 taxableEarnings = 0", r.taxableEarnings, 0);
  check("PIII Case 7 earlyDistributionPenalty = 0", r.earlyDistributionPenalty, 0);
  check("PIII Case 7 basisRemaining = 0", r.basisRemaining, 0);
}

// ── PIII Case 8: Distribution > balance impossible but engine handles ─────
// Defensive: distribution $200k > balance $50k. Shouldn't happen in real
// returns but the engine doesn't validate balance>=distribution.
{
  const r = computeForm8606PartIII({
    rothDistribution: 200000,
    rothContributionsBasis: 50000,
    rothBalanceBeforeDistribution: 50000,
    ownerAge: 40,
    firstRothFiveYearsOld: true,
  });
  // basis $50k recovered; remaining $150k all treated as taxable
  // (over-reporting, but the right defensive direction).
  check("PIII Case 8 basisRecovered = 50,000 (full basis)", r.basisRecovered, 50000);
  check("PIII Case 8 taxableEarnings = 150,000", r.taxableEarnings, 150000);
  check("PIII Case 8 penalty = 15,000 (under 59½)", r.earlyDistributionPenalty, 15000);
}

// ── PIII Case 9: Age default behavior (firstRothFiveYearsOld default true) ─
// Omit firstRothFiveYearsOld → defaults to true. Age 70 → qualified.
{
  const r = computeForm8606PartIII({
    rothDistribution: 10000,
    rothContributionsBasis: 5000,
    rothBalanceBeforeDistribution: 50000,
    ownerAge: 70,
  });
  checkBool("PIII Case 9 default firstRothFiveYearsOld=true → qualified", r.isQualifiedDistribution, true);
  check("PIII Case 9 taxableEarnings = 0 (qualified)", r.taxableEarnings, 0);
}

// ── PIII Case 10: Age null (unknown) → not qualified, no penalty ──────────
// When age is null, we can't apply §72(t) penalty either way. Conservative
// engine behavior: treat as NOT over 59½ (apply penalty on earnings).
{
  const r = computeForm8606PartIII({
    rothDistribution: 30000,
    rothContributionsBasis: 10000,
    rothBalanceBeforeDistribution: 80000,
    ownerAge: null,
  });
  checkBool("PIII Case 10 null age → not qualified", r.isQualifiedDistribution, false);
  check("PIII Case 10 basisRecovered = 10,000", r.basisRecovered, 10000);
  check("PIII Case 10 taxableEarnings = 20,000", r.taxableEarnings, 20000);
  // age null → engine treats as "under 59.5" → apply penalty
  check("PIII Case 10 penalty applied (age unknown, treated as under 59½)",
    r.earlyDistributionPenalty, 2000);
}

// ── Print results ─────────────────────────────────────────────────────────
console.log(`\nForm 8606 (H6) tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) {
  FAIL.forEach((f) => console.log(`    ${f}`));
}
process.exit(FAIL.length > 0 ? 1 : 0);
