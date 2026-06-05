/**
 * P2-3 — Foreign Tax Credit carryover (Form 1116 Schedule B / §904(c)).
 *
 * The §904 limit (foreign-source fraction × US tax) caps the credit; the excess
 * carries forward (10 years). A prior-year carryover is consumed this year when
 * the limit has room. NO API.
 *
 * Anchor case (single, FL, TY2024, W-2 $100,000):
 *   AGI $100,000 − std $14,600 = taxable $85,400.
 *   Federal income tax = 1,160 + 4,266 + (85,400−47,150)×0.22 = $13,841 (hand-calc).
 *   §904 limit (foreign-src $10,000) = 10,000/85,400 × 13,841 = $1,620.73.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-ftc-carryforward-tests.ts
 */
import { computeTaxReturnPure, type TaxReturnInputs, type AdjustmentFact } from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.01): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function header(t: string) { console.log(`\n-- ${t} --`); }

const run = (adjustments: AdjustmentFact[]): ReturnType<typeof computeTaxReturnPure> => {
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 20000, stateCode: "FL" }],
    form1099s: [],
    adjustments,
    taxYear: 2024,
  };
  return computeTaxReturnPure(inputs);
};

// ── 1. §904 limit binds → carryover generated ─────────────────────────────
header("§904 limit binds → carryover generated");
{
  const r = run([
    { adjustmentType: "foreign_tax_paid", amount: 4000, isApplied: true },
    { adjustmentType: "foreign_source_taxable_income", amount: 10000, isApplied: true },
  ]);
  check("federal income tax = $13,841", r.federalTaxLiability, 13841, 1);
  check("§904 form limit = $1,620.73", r.foreignTaxCredit.formLimit ?? -1, 1620.726, 0.01);
  check("FTC credit = $1,620.73 (limit binds)", r.foreignTaxCredit.credit, 1620.726, 0.01);
  check("carryforward = $4,000 − $1,620.73 = $2,379.27", r.foreignTaxCreditCarryforwardRemaining, 2379.274, 0.01);
}

// ── 2. Prior carryover fully consumed (limit has room) ────────────────────
header("Prior carryover fully consumed when limit has room");
{
  // Current $1,000 + prior carryover $2,379.27 = combined $3,379.27.
  // §904 limit (foreign-src $40,000) = 40,000/85,400 × 13,841 = $6,483 (room).
  const r = run([
    { adjustmentType: "foreign_tax_paid", amount: 1000, isApplied: true },
    { adjustmentType: "foreign_tax_credit_carryforward", amount: 2379.27, isApplied: true },
    { adjustmentType: "foreign_source_taxable_income", amount: 40000, isApplied: true },
  ]);
  check("FTC credit = $3,379.27 (all used)", r.foreignTaxCredit.credit, 3379.27, 0.01);
  check("carryforward = $0 (fully absorbed)", r.foreignTaxCreditCarryforwardRemaining, 0, 0.01);
}

// ── 3. Prior carryover partially consumed → rest re-carried ───────────────
header("Prior carryover partially consumed, excess re-carried");
{
  // Current $1,000 + prior carryover $5,000 = combined $6,000.
  // §904 limit (foreign-src $10,000) = $1,620.73 binds → carryover $4,379.27.
  const r = run([
    { adjustmentType: "foreign_tax_paid", amount: 1000, isApplied: true },
    { adjustmentType: "foreign_tax_credit_carryforward", amount: 5000, isApplied: true },
    { adjustmentType: "foreign_source_taxable_income", amount: 10000, isApplied: true },
  ]);
  check("FTC credit = $1,620.73", r.foreignTaxCredit.credit, 1620.726, 0.01);
  check("carryforward = $6,000 − $1,620.73 = $4,379.27", r.foreignTaxCreditCarryforwardRemaining, 4379.274, 0.01);
}

// ── 4. Under the simplified $300 limit → no Form 1116, no carryover ────────
header("Under simplified limit → no carryover");
{
  const r = run([
    { adjustmentType: "foreign_tax_paid", amount: 250, isApplied: true },
  ]);
  check("FTC credit = $250 (full)", r.foreignTaxCredit.credit, 250, 0.01);
  check("carryforward = $0", r.foreignTaxCreditCarryforwardRemaining, 0, 0.01);
}

// ── 5. Over simplified but limit does NOT bind → no carryover ─────────────
header("Limit does not bind → no carryover");
{
  // Foreign tax $1,000, foreign-src $40,000 → limit $6,483 > $1,000 → full credit.
  const r = run([
    { adjustmentType: "foreign_tax_paid", amount: 1000, isApplied: true },
    { adjustmentType: "foreign_source_taxable_income", amount: 40000, isApplied: true },
  ]);
  check("FTC credit = $1,000 (limit has room)", r.foreignTaxCredit.credit, 1000, 0.01);
  check("carryforward = $0", r.foreignTaxCreditCarryforwardRemaining, 0, 0.01);
}

// ── 6. Carryover alone (no current-year foreign tax) is still usable ──────
header("Carryover usable with $0 current-year foreign tax");
{
  // No current foreign tax, $3,000 prior carryover, foreign-src $40,000 → room.
  const r = run([
    { adjustmentType: "foreign_tax_credit_carryforward", amount: 3000, isApplied: true },
    { adjustmentType: "foreign_source_taxable_income", amount: 40000, isApplied: true },
  ]);
  check("FTC credit = $3,000 (carryover used)", r.foreignTaxCredit.credit, 3000, 0.01);
  check("carryforward = $0", r.foreignTaxCreditCarryforwardRemaining, 0, 0.01);
}

console.log(`\n${"=".repeat(50)}`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.log(f); process.exit(1); }
console.log("ALL FTC CARRYFORWARD TESTS GREEN");
