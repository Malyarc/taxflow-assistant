/**
 * T2.2 D1 + D3 — Year-over-year + OBBBA-impact + threshold-crossing tests.
 *
 * Pure (no API). HAND-CALC'D: NIIT 3.8% × net investment income, Additional
 * Medicare 0.9% over the $200k threshold, the IRMAA tier thresholds, and the
 * OBBBA Schedule 1-A delta.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-year-over-year-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { computeYearOverYear } from "../../artifacts/api-server/src/lib/yearOverYear";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.5): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

function single(year: number, wages: number, ltcg: number, withhold = 0): TaxReturnInputs {
  return {
    client: { filingStatus: "single", state: "FL", taxYear: year },
    w2s: [{ taxYear: year, wagesBox1: wages, medicareWagesBox5: wages, federalTaxWithheldBox2: withhold || Math.round(wages * 0.18) }],
    form1099s: [],
    adjustments: ltcg ? [{ adjustmentType: "long_term_capital_gain", amount: ltcg, isApplied: true }] : [],
    taxYear: year,
  };
}
const crossing = (r: ReturnType<typeof computeYearOverYear>, id: string) =>
  r.thresholdCrossings.find((x) => x.id === id);

// ════════════════════════════════════════════════════════════════════════════
// S1 — Income jump crosses NIIT + Additional Medicare + IRMAA (single, TY2024).
//   Prior: $150k wages + $30k LTCG → AGI $180,000 (no NIIT, no Add'l Medicare).
//   Current: $260k wages + $30k LTCG → AGI $290,000.
//     NIIT = 3.8% × min($30k NII, $290k−$200k) = 3.8% × 30,000 = $1,140.
//     Add'l Medicare = 0.9% × ($260k − $200k) = $540.
//     IRMAA single: $180k = tier 3 (>$161k); $290k = tier 4 (>$193k) → 3→4.
// ════════════════════════════════════════════════════════════════════════════
{
  const prior = computeTaxReturnPure(single(2024, 150000, 30000));
  const curr = computeTaxReturnPure(single(2024, 260000, 30000));
  const yoy = computeYearOverYear({ priorReturn: prior, currentReturn: curr });

  check("S1 current NIIT $1,140 (hand-calc)", curr.niitTax, 1140);
  check("S1 current Add'l Medicare $540 (hand-calc)", curr.additionalMedicareTax, 540);
  checkTrue("S1 NIIT crossing entered", crossing(yoy, "niit")?.direction === "entered");
  checkTrue("S1 Add'l Medicare crossing entered", crossing(yoy, "addl-medicare")?.direction === "entered");
  checkTrue("S1 IRMAA crossing entered (tier 3 → 4)", crossing(yoy, "irmaa-tier")?.direction === "entered");
  // Deltas.
  const incomeDelta = yoy.deltas.find((d) => d.label === "Total income")!;
  check("S1 total-income change +$110,000", incomeDelta.change, 110000);
  check("S1 total-income pctChange 0.6111", incomeDelta.pctChange ?? NaN, 110000 / 180000, 0.001);
  const niitDelta = yoy.deltas.find((d) => d.label === "Net investment income tax")!;
  check("S1 NIIT delta change +$1,140", niitDelta.change, 1140);
  checkTrue("S1 NIIT delta pctChange null (prior 0)", niitDelta.pctChange === null);
  checkTrue("S1 NIIT is a notable swing", yoy.notableSwings.some((d) => d.label === "Net investment income tax"));
}

// ════════════════════════════════════════════════════════════════════════════
// S2 — Income DROP back below the thresholds → crossings EXIT.
//   $290k AGI prior → $180k AGI current → NIIT exited, IRMAA tier 4 → 3 exited.
// ════════════════════════════════════════════════════════════════════════════
{
  const prior = computeTaxReturnPure(single(2024, 260000, 30000));
  const curr = computeTaxReturnPure(single(2024, 150000, 30000));
  const yoy = computeYearOverYear({ priorReturn: prior, currentReturn: curr });
  checkTrue("S2 NIIT crossing exited", crossing(yoy, "niit")?.direction === "exited");
  checkTrue("S2 Add'l Medicare crossing exited", crossing(yoy, "addl-medicare")?.direction === "exited");
  checkTrue("S2 IRMAA crossing exited (4 → 3)", crossing(yoy, "irmaa-tier")?.direction === "exited");
}

// ════════════════════════════════════════════════════════════════════════════
// S3 — OBBBA impact appears TY2024 → TY2025 ($8k qualified tips).
//   TY2024 has no §224 tip deduction; TY2025 deducts the full $8,000.
// ════════════════════════════════════════════════════════════════════════════
{
  const tips = (year: number): TaxReturnInputs => ({
    client: { filingStatus: "single", state: "FL", taxYear: year },
    w2s: [{ taxYear: year, wagesBox1: 50000, federalTaxWithheldBox2: 5000 }],
    form1099s: [],
    adjustments: [{ adjustmentType: "qualified_tips", amount: 8000, isApplied: true }],
    taxYear: year,
  });
  const yoy = computeYearOverYear({
    priorReturn: computeTaxReturnPure(tips(2024)),
    currentReturn: computeTaxReturnPure(tips(2025)),
  });
  check("S3 OBBBA prior total $0 (TY2024)", yoy.obbbaImpact.priorTotal, 0);
  check("S3 OBBBA current total $8,000 (TY2025)", yoy.obbbaImpact.currentTotal, 8000);
  check("S3 OBBBA new benefit $8,000", yoy.obbbaImpact.newBenefit, 8000);
  checkTrue("S3 OBBBA note quantifies the benefit", yoy.obbbaImpact.note.includes("8,000"));
}

// ════════════════════════════════════════════════════════════════════════════
// S4 — Refund → balance-due flip (withholding cut). $80k W-2, $15k → $2k W/H.
// ════════════════════════════════════════════════════════════════════════════
{
  const prior = computeTaxReturnPure(single(2024, 80000, 0, 15000));
  const curr = computeTaxReturnPure(single(2024, 80000, 0, 2000));
  const yoy = computeYearOverYear({ priorReturn: prior, currentReturn: curr });
  checkTrue("S4 prior is a refund", prior.federalRefundOrOwed > 0);
  checkTrue("S4 current owes", curr.federalRefundOrOwed < 0);
  checkTrue("S4 refund-to-owed crossing entered", crossing(yoy, "refund-to-owed")?.direction === "entered");
}

// ════════════════════════════════════════════════════════════════════════════
// S5 — Stable return (identical both years) → no crossings, no notable swings.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = computeTaxReturnPure(single(2024, 90000, 0, 12000));
  const yoy = computeYearOverYear({ priorReturn: r, currentReturn: r });
  checkTrue("S5 no threshold crossings", yoy.thresholdCrossings.length === 0);
  checkTrue("S5 no notable swings", yoy.notableSwings.length === 0);
  check("S5 all deltas are zero", yoy.deltas.reduce((s, d) => s + Math.abs(d.change), 0), 0);
  checkTrue("S5 OBBBA note = none in either year", yoy.obbbaImpact.note.includes("No OBBBA"));
  check("S5 14 comparison lines", yoy.deltas.length, 14);
}

console.log(`\nT2.2 — year-over-year + OBBBA impact + threshold crossings:`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.error(`  ${f}`); process.exit(1); }
for (const p of PASS) console.log(`  ${p}`);
process.exit(0);
