/**
 * Schedule C per-line depreciation reducing the SE base — hand-calc'd (P2-5 core).
 *
 * Pure engine; no API required. The engine now models Schedule C asset depreciation
 * (Form 4562 → Sch C line 13) via the `schedule_c_depreciation` adjustment, which
 * reduces the Schedule C NET PROFIT → the SE-tax base + §199A QBI + earned income +
 * §461(l). This fixes the documented gap: the above-the-line
 * `section_179_expense_election` / `bonus_depreciation_basis` reduce AGI but NOT the
 * SE base. (Gross receipts via `self_employment_income`, expenses via
 * `schedule_c_expenses`, depreciation via `schedule_c_depreciation` = the per-line P&L.)
 *
 * Hand-calc (single TY2024, gross Sch C $150,000):
 *   $30,000 Sch C depreciation → net SE $120,000. SE-tax base drops $30,000;
 *   SE tax drops $30,000 × 0.9235 × 0.153 = $4,238.87 (all under the $168,600 base).
 *   An above-the-line §179 election of $30,000 reduces SE tax by $0 (the gap).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-schedule-c-depreciation-tests.ts
 */
import { computeTaxReturnPure, type TaxReturnInputs, type AdjustmentFact } from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}±${tol}, got ${actual}`);
}
function checkBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function header(t: string) { console.log(`\n-- ${t} --`); }
const A = (t: string, amt: number): AdjustmentFact => ({ adjustmentType: t, amount: amt, isApplied: true });

function mk(adj: AdjustmentFact[]): TaxReturnInputs {
  return {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [],
    adjustments: [A("self_employment_income", 150000), ...adj],
    taxYear: 2024,
  } as unknown as TaxReturnInputs;
}

const base = computeTaxReturnPure(mk([]));
const withSchCDep = computeTaxReturnPure(mk([A("schedule_c_depreciation", 30000)]));
const withS179 = computeTaxReturnPure(mk([A("section_179_expense_election", 30000)]));

// ── SC-1: Sch C depreciation reduces the SE-tax base ──
header("SC-1: schedule_c_depreciation reduces SE tax");
{
  check("SC-1 scheduleCDepreciation surfaced = $30k", withSchCDep.scheduleCDepreciation, 30000);
  // SE tax delta = $30,000 × 0.9235 × 0.153 = $4,238.87.
  check("SC-1 SE tax drops by $4,238.87", base.selfEmploymentTax - withSchCDep.selfEmploymentTax, 4238.87, 1);
  checkBool("SC-1 net SE dropped (QBI base lower → QBI deduction lower)",
    withSchCDep.qbiDeduction < base.qbiDeduction, true);
}

// ── SC-2: above-the-line §179 does NOT reduce SE tax (the documented gap) ──
header("SC-2: §179 above-the-line does NOT touch the SE base");
{
  check("SC-2 §179 leaves SE tax unchanged", withS179.selfEmploymentTax, base.selfEmploymentTax, 1);
  checkBool("SC-2 §179 DOES reduce AGI (above-the-line)", withS179.adjustedGrossIncome < base.adjustedGrossIncome, true);
  checkBool("SC-2 Sch C depreciation reduces AGI too (via lower net SE)",
    withSchCDep.adjustedGrossIncome < base.adjustedGrossIncome, true);
}

// ── SC-3: depreciation can drive a Schedule C loss (SE tax floored at 0) ──
// Gross $50k − $80k depreciation = −$30k net; SE tax 0; the signed loss flows to
// AGI (offsetting other income), capped by §461(l) downstream.
header("SC-3: depreciation drives a Sch C loss → SE tax 0, loss flows to AGI");
{
  const lossCase = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [A("self_employment_income", 50000), A("schedule_c_depreciation", 80000)],
    taxYear: 2024,
  } as unknown as TaxReturnInputs);
  const noLoss = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [], adjustments: [A("self_employment_income", 50000)], taxYear: 2024,
  } as unknown as TaxReturnInputs);
  check("SC-3 SE tax floored at 0 (no SE tax on a loss)", lossCase.selfEmploymentTax, 0, 1);
  // The $30k net Sch C loss reduces AGI vs the $50k-profit case by 50k profit +
  // its half-SE add-back removed + the 30k loss — i.e., AGI is well below noLoss.
  checkBool("SC-3 net Sch C loss reduces AGI below the profit case",
    lossCase.adjustedGrossIncome < noLoss.adjustedGrossIncome, true);
}

// ── Summary ──
console.log(`\n== Schedule C depreciation (SE base) ==  PASS: ${PASS.length}  FAIL: ${FAIL.length}`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log("ALL SCHEDULE C DEPRECIATION ASSERTIONS PASS");
