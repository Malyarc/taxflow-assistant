/**
 * T2.2 D1 — Tax projection + 1040-ES quarterly estimate tests.
 *
 * Pure (no API). Builds TaxReturnInputs, runs computeTaxProjection, and asserts
 * HAND-CALC'D values: 2024 brackets, the §6654 safe-harbor min(90%-current,
 * prior-year-pct), the 110% high-income trigger ($150k AGI), and the quarterly
 * even-split with the statutory 1040-ES due dates.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-tax-projection-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { computeTaxProjection } from "../../artifacts/api-server/src/lib/taxProjection";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.5): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkStr(label: string, actual: string, expected: string): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected "${expected}", got "${actual}"`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

function project(inputs: TaxReturnInputs, growth: number) {
  const ret = computeTaxReturnPure(inputs);
  return computeTaxProjection({ baselineInputs: inputs, baselineReturn: ret, incomeGrowth: growth });
}

// ════════════════════════════════════════════════════════════════════════════
// S1 — W-2 over-withheld (no estimates needed). Single $100k W-2, $15k W/H, +3%.
//   Baseline 2024 tax (taxable 85,400): 1,160 + 4,266 + (85,400−47,150)×22%
//     = 1,160 + 4,266 + 8,415 = $13,841.
//   Projected 2025 income = 100,000 × 1.03 = $103,000; W/H = 15,000 × 1.03 = $15,450.
//   Required annual payment = 90% × projected-2025 tax = $12,698 (< 100%×13,841).
//   W/H $15,450 ≥ $12,698 → estimates $0, withholding covers the harbor.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 15000 }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const p = project(inputs, 1.03);
  check("S1 baseline 2024 federal tax $13,841", p.baseline.federalTaxLiability, 13841);
  check("S1 projected income $103,000 (×1.03)", p.projected.totalIncome, 103000);
  check("S1 projected withholding $15,450 (×1.03)", p.estimatedTax.projectedWithholding, 15450);
  check("S1 required annual payment $12,698 (90% of projected)", p.estimatedTax.requiredAnnualPayment, 12698);
  checkStr("S1 safe-harbor basis = 90%_current", p.estimatedTax.safeHarborBasis, "90%_current");
  check("S1 total estimated payments $0 (W/H covers)", p.estimatedTax.totalEstimatedPayments, 0);
  checkTrue("S1 withholdingCoversSafeHarbor = true", p.estimatedTax.withholdingCoversSafeHarbor);
  check("S1 YoY income delta +$3,000", p.yoyDelta.totalIncome, 3000);
  checkStr("S1 Q1 voucher due 2025-04-15", p.estimatedTax.vouchers[0].dueDate, "2025-04-15");
  checkStr("S1 Q2 voucher due 2025-06-15", p.estimatedTax.vouchers[1].dueDate, "2025-06-15");
  checkStr("S1 Q3 voucher due 2025-09-15", p.estimatedTax.vouchers[2].dueDate, "2025-09-15");
  checkStr("S1 Q4 voucher due 2026-01-15", p.estimatedTax.vouchers[3].dueDate, "2026-01-15");
  checkTrue("S1 four vouchers", p.estimatedTax.vouchers.length === 4);
}

// ════════════════════════════════════════════════════════════════════════════
// S2 — SE, no withholding (estimates needed). Single $120k 1099-NEC, +0%.
//   Projected (TY2025) §6654 tax = $28,725; 90% = $25,853 (< 100%×baseline 29,067).
//   No withholding → cover the full $25,853 over four quarters:
//     per-quarter = round(25,853 ÷ 4) = round(6,463.25) = $6,463.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 120000 }],
    adjustments: [],
    taxYear: 2024,
  };
  const p = project(inputs, 1.0);
  check("S2 baseline §6654 tax $29,067", p.baseline.section6654Tax, 29067);
  check("S2 projected §6654 tax $28,725", p.projected.section6654Tax, 28725);
  check("S2 required annual payment $25,853 (90% of projected)", p.estimatedTax.requiredAnnualPayment, 25853);
  checkStr("S2 basis = 90%_current", p.estimatedTax.safeHarborBasis, "90%_current");
  check("S2 total estimated payments $25,853 (no W/H)", p.estimatedTax.totalEstimatedPayments, 25853);
  check("S2 per-quarter $6,463", p.estimatedTax.vouchers[0].amount, 6463);
  checkTrue("S2 estimates required (W/H does not cover)", !p.estimatedTax.withholdingCoversSafeHarbor);
}

// ════════════════════════════════════════════════════════════════════════════
// S3 — Prior-year harbor BINDS. Single $80k W-2, $2k W/H, +50% raise projected.
//   Baseline 2024 tax (taxable 65,400): 1,160 + 4,266 + (65,400−47,150)×22%
//     = $9,441.  Projected income = 120,000; projected tax $17,867 → 90% = $16,080.
//   AGI $80k < $150k → prior-year harbor = 100% × 9,441 = $9,441 (the smaller).
//   W/H = 2,000 × 1.5 = $3,000 → cover 9,441 − 3,000 = $6,441 → per-quarter
//     round(6,441 ÷ 4) = $1,610.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 2000 }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const p = project(inputs, 1.5);
  check("S3 baseline §6654 tax $9,441", p.baseline.section6654Tax, 9441);
  check("S3 projected income $120,000 (×1.5)", p.projected.totalIncome, 120000);
  check("S3 required = prior-year harbor $9,441", p.estimatedTax.requiredAnnualPayment, 9441);
  checkStr("S3 basis = prior_year", p.estimatedTax.safeHarborBasis, "prior_year");
  check("S3 prior-year pct 1.0 (AGI < $150k)", p.estimatedTax.priorYearSafeHarborPct, 1.0);
  check("S3 projected W/H $3,000 (×1.5)", p.estimatedTax.projectedWithholding, 3000);
  check("S3 total estimated payments $6,441", p.estimatedTax.totalEstimatedPayments, 6441);
  check("S3 per-quarter $1,610", p.estimatedTax.vouchers[0].amount, 1610);
}

// ════════════════════════════════════════════════════════════════════════════
// S4 — 110% high-income harbor. Single $300k W-2 (AGI $300k > $150k), +0%.
//   Prior-year safe-harbor multiplier = 1.10 (§6654(d)(1)(C)). The 90%-current
//   harbor ($62,942) is still the smaller, so basis stays 90%_current — but the
//   1.10 multiplier must be detected.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 300000, federalTaxWithheldBox2: 20000 }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const p = project(inputs, 1.0);
  check("S4 prior-year multiplier 1.10 (AGI > $150k)", p.estimatedTax.priorYearSafeHarborPct, 1.1);
  check("S4 required annual payment $62,942 (90% of projected)", p.estimatedTax.requiredAnnualPayment, 62942);
  checkStr("S4 basis = 90%_current", p.estimatedTax.safeHarborBasis, "90%_current");
}

// ════════════════════════════════════════════════════════════════════════════
// S5 — OBBBA impact surfaces (TY2025 projection with tips). $60k W-2 + $8k tips.
//   Project from a TY2024 baseline → projected TY2025 has the §224 tip deduction.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 6000 }],
    form1099s: [],
    adjustments: [{ adjustmentType: "qualified_tips", amount: 8000, isApplied: true }],
    taxYear: 2024,
  };
  const p = project(inputs, 1.0);
  // Baseline is TY2024 (OBBBA not active) → 0; projected TY2025 → $8,000 tips deduction.
  check("S5 baseline OBBBA $0 (TY2024)", p.baseline.obbbaSchedule1A, 0);
  check("S5 projected OBBBA $8,000 tips (TY2025)", p.projected.obbbaSchedule1A, 8000);
  check("S5 obbbaImpact.deductionTotal $8,000", p.obbbaImpact.deductionTotal, 8000);
  checkTrue("S5 obbbaImpact note mentions Schedule 1-A", p.obbbaImpact.note.includes("Schedule 1-A"));
}

console.log(`\nT2.2 — tax projection + 1040-ES quarterly estimates:`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.error(`  ${f}`); process.exit(1); }
for (const p of PASS) console.log(`  ${p}`);
process.exit(0);
