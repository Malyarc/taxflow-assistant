/**
 * T1.5 #1 — IRS Tax Table emulation mode.
 *
 * The IRS Tax Table (Form 1040, taxable income < $100,000) is BUILT by computing
 * the rate-schedule tax at the MIDPOINT of each income row, rounded to the
 * nearest dollar (round half up). Row widths: $50 (income ≥ $3,000), $25
 * ($25–$3,000), and the small $5/$10 rows below $25. For income ≥ $100,000 the
 * IRS uses the Tax Computation Worksheet (the exact formula). The default engine
 * mode is "formula" (exact schedule); "table" matches a FILED return to the
 * dollar.
 *
 * The GOLDEN values below are the REAL published 2024 IRS Tax Table values
 * (i1040tt--2024), extracted from the IRS PDF:
 *   $12,000–12,050: S 1,211 · MFJ 1,203 · MFS 1,211 · HoH 1,203
 *   $50,000–50,050: S 6,059 · MFJ 5,539 · MFS 6,059 · HoH 5,672
 *   $53,000–53,050: S 6,719 · MFJ 5,899 · MFS 6,719 · HoH 6,032
 *   $56,000–56,050: S 7,379 · MFJ 6,259 · MFS 7,379 · HoH 6,392
 * (MFJ/HoH $12,025 = $1,202.50 → $1,203 pins the round-half-up convention.)
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-tax-table-mode-tests.ts
 */
import {
  irsTaxTableTax,
  calculateFederalTax,
} from "../../artifacts/api-server/src/lib/taxCalculator";
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.0): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function ok(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`); else FAIL.push(`✗ ${label}`);
}

// ════════════════════════════════════════════════════════════════════════════
// G — GOLDEN: the real published 2024 IRS Tax Table values, all four statuses.
// ════════════════════════════════════════════════════════════════════════════
const GOLDEN: Array<[number, Record<string, number>]> = [
  [12000, { single: 1211, married_filing_jointly: 1203, married_filing_separately: 1211, head_of_household: 1203 }],
  [50000, { single: 6059, married_filing_jointly: 5539, married_filing_separately: 6059, head_of_household: 5672 }],
  [53000, { single: 6719, married_filing_jointly: 5899, married_filing_separately: 6719, head_of_household: 6032 }],
  [56000, { single: 7379, married_filing_jointly: 6259, married_filing_separately: 7379, head_of_household: 6392 }],
];
for (const [rowStart, vals] of GOLDEN) {
  for (const [status, expected] of Object.entries(vals)) {
    check(`2024 table $${rowStart} ${status} = $${expected}`, irsTaxTableTax(rowStart, status, 2024), expected);
    // Any income in the $50 row maps to the SAME table value (start, mid, end).
    check(`2024 table $${rowStart + 25} (mid-row) ${status} = $${expected}`, irsTaxTableTax(rowStart + 25, status, 2024), expected);
    check(`2024 table $${rowStart + 49} (row-end) ${status} = $${expected}`, irsTaxTableTax(rowStart + 49, status, 2024), expected);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// C — CONSTRUCTION: table value === round(formula at the row midpoint).
//   $50 rows for income ≥ $3,000; $25 rows for $25–$3,000.
// ════════════════════════════════════════════════════════════════════════════
function rowMidpoint(ti: number): number {
  if (ti < 5) return 0;
  if (ti < 15) return 10;
  if (ti < 25) return 20;
  if (ti < 3000) return Math.floor(ti / 25) * 25 + 12.5;
  return Math.floor(ti / 50) * 50 + 25;
}
for (const year of [2024, 2025] as const) {
  for (const status of ["single", "married_filing_jointly", "head_of_household"]) {
    for (const ti of [37, 850, 2999, 3001, 18234, 47150, 73500, 99999]) {
      const expected = Math.round(calculateFederalTax(rowMidpoint(ti), status, year));
      check(`${year} table($${ti}, ${status}) = round(formula(midpoint))`, irsTaxTableTax(ti, status, year), expected);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// H — HIGH INCOME (≥ $100,000): Tax Computation Worksheet = exact formula,
//   whole-dollar. The table function returns the rounded exact formula.
// ════════════════════════════════════════════════════════════════════════════
for (const ti of [100000, 150000, 412350.49, 1_000_000]) {
  check(`table($${ti}) = round(exact formula) [≥ $100k]`, irsTaxTableTax(ti, "single", 2024), Math.round(calculateFederalTax(ti, "single", 2024)));
}

// ════════════════════════════════════════════════════════════════════════════
// B — BOTTOM ROWS + degenerate inputs.
//   $0–$5 → 0; $5–$15 → round(10% × 10) = $1; $15–$25 → round(10% × 20) = $2.
// ════════════════════════════════════════════════════════════════════════════
check("table($0) = 0", irsTaxTableTax(0, "single", 2024), 0);
check("table(−500) = 0 (defensive)", irsTaxTableTax(-500, "single", 2024), 0);
check("table($4) = 0 ($0–$5 row)", irsTaxTableTax(4, "single", 2024), 0);
check("table($10) = $1 ($5–$15 row, 10%×10)", irsTaxTableTax(10, "single", 2024), 1);
check("table($20) = $2 ($15–$25 row, 10%×20)", irsTaxTableTax(20, "single", 2024), 2);
check("table($1000) = $101 ($25 row mid $1,012.50 ×10%)", irsTaxTableTax(1000, "single", 2024), 101);

// ════════════════════════════════════════════════════════════════════════════
// D — DELTA BOUND: |table − exact formula| is small (the documented ±~$14 the
//   table introduces vs the exact-at-TI formula), and the table is centered on
//   the row so the deviation is at most ~$50 × top-marginal-in-band ÷ 2 + $0.5.
// ════════════════════════════════════════════════════════════════════════════
{
  let maxDev = 0;
  for (let ti = 3000; ti < 100000; ti += 137) {
    const dev = Math.abs(irsTaxTableTax(ti, "single", 2024) - calculateFederalTax(ti, "single", 2024));
    if (dev > maxDev) maxDev = dev;
  }
  ok(`table within ~$14 of exact formula across $3k–$100k (max dev ${maxDev.toFixed(2)})`, maxDev <= 15);
}

// ════════════════════════════════════════════════════════════════════════════
// M — calculateFederalTax method param: "table" === irsTaxTableTax; default and
//   "formula" === exact (zero behavioral change for existing callers).
// ════════════════════════════════════════════════════════════════════════════
check("calcFedTax(table) === irsTaxTableTax", calculateFederalTax(35400, "single", 2024, "table"), irsTaxTableTax(35400, "single", 2024));
check("calcFedTax(default) === exact formula", calculateFederalTax(35400, "single", 2024), 1160 + 0.12 * (35400 - 11600));
check("calcFedTax('formula') === exact formula", calculateFederalTax(35400, "single", 2024, "formula"), 1160 + 0.12 * (35400 - 11600));

// ════════════════════════════════════════════════════════════════════════════
// E2E-1 — end-to-end: single $50k W-2, no dependents (TY2024).
//   AGI 50,000; std ded 14,600; taxable 35,400.
//   FORMULA line 16 = 1,160 + 12%×(35,400−11,600) = $4,016.
//   TABLE   line 16 = round(formula(midpoint 35,425)) = 1,160 + 12%×23,825 = $4,019.
//   Only line 16 differs between the two modes → ΔfederalTaxLiability = $3.
// ════════════════════════════════════════════════════════════════════════════
{
  const base: Omit<TaxReturnInputs, "taxComputationMethod"> = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 0 }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const formula = computeTaxReturnPure({ ...base });
  const table = computeTaxReturnPure({ ...base, taxComputationMethod: "table" });
  const dflt = computeTaxReturnPure({ ...base, taxComputationMethod: "formula" });
  check("E2E formula line 16 = $4,016", Number(formula.federalTaxLiability), 4016);
  check("E2E table line 16 = $4,019 (matches filed)", Number(table.federalTaxLiability), 4019);
  check("E2E table − formula = $3", Number(table.federalTaxLiability) - Number(formula.federalTaxLiability), 3);
  check("E2E default === explicit formula (zero regression)", Number(dflt.federalTaxLiability), Number(formula.federalTaxLiability));
  check("E2E taxable income unchanged by mode", Number(table.taxableIncome), Number(formula.taxableIncome));
}

// ════════════════════════════════════════════════════════════════════════════
// E2E-2 — table mode threads through the cap-gains worksheet's ORDINARY line.
//   single $40k W-2 + $5k qualified dividends (TY2024).
//   taxable 45,000 − 14,600 = 30,400; ordinary portion 25,400; QD $5k at 0%
//   (taxable < $47,025 0%-bracket top). So only the ordinary line differs:
//   FORMULA tax(25,400) = 1,160 + 12%×13,800 = $2,816; TABLE tax(mid 25,425) =
//   1,160 + 12%×13,825 = $2,819 → ΔfederalTaxLiability = $3 (QD pref tax = $0).
// ════════════════════════════════════════════════════════════════════════════
{
  const base: Omit<TaxReturnInputs, "taxComputationMethod"> = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 40000, federalTaxWithheldBox2: 0 }],
    form1099s: [{ taxYear: 2024, formType: "div", ordinaryDividends: 5000, qualifiedDividends: 5000 }],
    adjustments: [],
    taxYear: 2024,
  };
  const formula = computeTaxReturnPure({ ...base });
  const table = computeTaxReturnPure({ ...base, taxComputationMethod: "table" });
  check("E2E2 QD pref tax = 0 (0%-bracket) → only ordinary line moves; Δ = $3",
    Number(table.federalTaxLiability) - Number(formula.federalTaxLiability), 3);
}

console.log(`\nT1.5 #1 — IRS Tax Table emulation mode (golden vs 2024 i1040tt + construction + e2e):`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.error(`  ${f}`); process.exit(1); }
for (const p of PASS) console.log(`  ${p}`);
process.exit(0);
