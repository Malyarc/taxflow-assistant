/**
 * P2-6 — Federal sub-gap batch (PREP-B5). Hand-calc'd. NO API.
 *   (a) §1202 QSBS acquisition-date exclusion % (50/75/100) + §57(a)(7) AMT pref
 *   (b) K-1 §704(d)/§1366(d) basis reduced by distributions + sep-stated deductions
 *   (c) §168(k) bonus depreciation TY2025 dual rate (40% pre-1/19 vs 100% post)
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-fed-subgaps-tests.ts
 */
import { computeTaxReturnPure, type TaxReturnInputs, type AdjustmentFact } from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.5): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function checkBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function header(t: string) { console.log(`\n-- ${t} --`); }
const A = (t: string, amt: number): AdjustmentFact => ({ adjustmentType: t, amount: amt, isApplied: true });
const qsbs = (year: number, adj: AdjustmentFact[]) => computeTaxReturnPure({
  client: { filingStatus: "single", state: "FL", taxYear: year }, w2s: [], form1099s: [], adjustments: adj, taxYear: year,
} as TaxReturnInputs);

// ════════════════════════════════════════════════════════════════════════════
// (a) §1202 QSBS exclusion percentage by acquisition date
// ════════════════════════════════════════════════════════════════════════════
header("(a) §1202 — 50% exclusion (pre-2009-02-18 stock)");
{
  // gross $5M, basis $0 → cap = max($10M, 0) = $10M; cappedEligible = $5M.
  // exclusion = 50% × $5M = $2.5M; taxable = $5M − $2.5M = $2.5M.
  const r = qsbs(2024, [A("qsbs_gross_gain", 5_000_000), A("qsbs_adjusted_basis", 0), A("qsbs_exclusion_pct", 50)]);
  check("excluded = $2.5M", r.qsbsSection1202Exclusion, 2_500_000, 1);
  check("taxable remainder = $2.5M", r.qsbsTaxableGain, 2_500_000, 1);
  // §57(a)(7): 7% × $2.5M = $175k AMT preference → AMT now binds (>$0).
  checkBool("§57(a)(7) AMT preference fires (amtTax > 0)", r.amtTax > 0, true);
}
header("(a) §1202 — 75% exclusion (2009-02-18..2010-09-27 stock)");
{
  const r = qsbs(2024, [A("qsbs_gross_gain", 5_000_000), A("qsbs_adjusted_basis", 0), A("qsbs_exclusion_pct", 75)]);
  check("excluded = $3.75M", r.qsbsSection1202Exclusion, 3_750_000, 1);
  check("taxable remainder = $1.25M", r.qsbsTaxableGain, 1_250_000, 1);
}
header("(a) §1202 — 100% default (post-2010-09-27) unchanged + no AMT pref");
{
  const r = qsbs(2024, [A("qsbs_gross_gain", 5_000_000), A("qsbs_adjusted_basis", 0)]);
  check("excluded = $5M (full)", r.qsbsSection1202Exclusion, 5_000_000, 1);
  check("taxable remainder = $0", r.qsbsTaxableGain, 0, 1);
  checkBool("100% stock has NO §57(a)(7) preference (amtTax = 0)", r.amtTax === 0, true);
}
header("(a) §1202 — cap binds with 50% exclusion");
{
  // gross $15M, basis $0 → cap $10M; cappedEligible $10M.
  // exclusion = 50% × $10M = $5M; taxable = $15M − $5M = $10M.
  const r = qsbs(2024, [A("qsbs_gross_gain", 15_000_000), A("qsbs_adjusted_basis", 0), A("qsbs_exclusion_pct", 50)]);
  check("excluded = $5M (50% of the $10M cap)", r.qsbsSection1202Exclusion, 5_000_000, 1);
  check("taxable remainder = $10M", r.qsbsTaxableGain, 10_000_000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// (b) K-1 basis reduced by distributions + separately-stated deductions
// ════════════════════════════════════════════════════════════════════════════
header("(b) K-1 §704(d) basis — distributions reduce loss-absorbing basis");
{
  // W-2 $200k + partnership K-1 Box 1 loss −$50k, basis $40k.
  // No distributions → allowed loss min($50k,$40k)=$40k → AGI $160k, suspended $10k.
  const noDist: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, stateCode: "FL" }], form1099s: [], adjustments: [],
    scheduleK1: [{ taxYear: 2024, entityType: "partnership", activityType: "active", box1OrdinaryIncome: -50000, basisAtYearStart: 40000 }],
    taxYear: 2024,
  };
  const r0 = computeTaxReturnPure(noDist);
  check("no-dist: AGI $160,000 (allowed $40k loss)", r0.adjustedGrossIncome, 160000, 1);
  check("no-dist: suspended $10,000", r0.scheduleK1.k1BasisAtRiskLossSuspended, 10000, 1);

  // Distributions $15k reduce basis to $25k → allowed $25k → AGI $175k, suspended $25k.
  const dist: TaxReturnInputs = {
    ...noDist,
    scheduleK1: [{ taxYear: 2024, entityType: "partnership", activityType: "active", box1OrdinaryIncome: -50000, basisAtYearStart: 40000, distributions: 15000 }],
  };
  const r1 = computeTaxReturnPure(dist);
  check("dist $15k: AGI $175,000 (allowed $25k loss)", r1.adjustedGrossIncome, 175000, 1);
  check("dist $15k: suspended $25,000", r1.scheduleK1.k1BasisAtRiskLossSuspended, 25000, 1);

  // Distributions $40k wipe basis to $0 → allowed $0 → AGI $200k, full $50k suspended.
  const wipe: TaxReturnInputs = {
    ...noDist,
    scheduleK1: [{ taxYear: 2024, entityType: "partnership", activityType: "active", box1OrdinaryIncome: -50000, basisAtYearStart: 40000, distributions: 40000 }],
  };
  const r2 = computeTaxReturnPure(wipe);
  check("dist $40k: AGI $200,000 (loss fully suspended)", r2.adjustedGrossIncome, 200000, 1);
  check("dist $40k: suspended $50,000", r2.scheduleK1.k1BasisAtRiskLossSuspended, 50000, 1);

  // Separately-stated deductions also draw down basis: $10k sep-stated + $10k dist
  // → basis $20k → allowed $20k → AGI $180k, suspended $30k.
  const sep: TaxReturnInputs = {
    ...noDist,
    scheduleK1: [{ taxYear: 2024, entityType: "partnership", activityType: "active", box1OrdinaryIncome: -50000, basisAtYearStart: 40000, distributions: 10000, separatelyStatedDeductions: 10000 }],
  };
  const r3 = computeTaxReturnPure(sep);
  check("dist $10k + sepDed $10k: AGI $180,000 (allowed $20k)", r3.adjustedGrossIncome, 180000, 1);
  check("dist+sepDed: suspended $30,000", r3.scheduleK1.k1BasisAtRiskLossSuspended, 30000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// (c) Bonus depreciation TY2025 dual rate
// ════════════════════════════════════════════════════════════════════════════
header("(c) §168(k) bonus — TY2025 40%/100% dual rate by acquisition date");
{
  const base = (year: number): TaxReturnInputs => ({
    client: { filingStatus: "single", state: "FL", taxYear: year }, w2s: [], form1099s: [],
    adjustments: [A("self_employment_income", 300000), A("bonus_depreciation_basis", 100000), A("bonus_depreciation_basis_obbba", 100000)],
    taxYear: year,
  });
  // TY2025: pre-1/19 $100k × 40% + post-1/19 $100k × 100% = $40k + $100k = $140k.
  const r25 = computeTaxReturnPure(base(2025));
  check("TY2025 bonus applied = $140,000 (40% + 100%)", r25.bonusDepreciationApplied, 140000, 1);
  // TY2026: both 100% → $100k + $100k = $200k.
  const r26 = computeTaxReturnPure(base(2026));
  check("TY2026 bonus applied = $200,000 (both 100%)", r26.bonusDepreciationApplied, 200000, 1);
  // Backward-compat: TY2024, only legacy basis at 60% → $60k.
  const r24 = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 }, w2s: [], form1099s: [],
    adjustments: [A("self_employment_income", 300000), A("bonus_depreciation_basis", 100000)], taxYear: 2024,
  });
  check("TY2024 legacy bonus = $60,000 (60%, unchanged)", r24.bonusDepreciationApplied, 60000, 1);
}

console.log(`\n${"=".repeat(50)}`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.log(f); process.exit(1); }
console.log("ALL FED SUB-GAP TESTS GREEN");
