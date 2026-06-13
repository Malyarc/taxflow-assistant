/**
 * T1.5 #3 — cross-year + filing-status METAMORPHIC relations.
 *
 * Metamorphic testing checks RELATIONSHIPS between outputs (no external oracle
 * needed): if input changes in a known direction, the output must move a known
 * way. These catch a whole class of bugs (a stale year-map, a transposed bracket,
 * a filing-status mix-up) that a finiteness check (`year-coverage`) and a single
 * differential snapshot both miss.
 *
 * (The differential-oracle harness — tax-engine-differential-oracle-harness.ts —
 * is the COMPLEMENTARY technique vs tenforty/OTS; its dependents/itemized/SE-QBI/
 * NY-NJ-MA column EXTENSION is CI-gated on the oracle, which does not build on
 * this Python 3.9 / Xcode toolchain. These metamorphic relations need no oracle
 * and run in the standard no-API battery.)
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-cross-year-metamorphic-tests.ts
 */
import {
  calculateFederalTax,
  getFederalStandardDeduction,
  type TaxYear,
} from "../../artifacts/api-server/src/lib/taxCalculator";
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function ok(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`); else FAIL.push(`✗ ${label}`);
}

const YEARS: TaxYear[] = [2024, 2025, 2026];
const STATUSES = ["single", "married_filing_jointly", "head_of_household", "qualifying_widow", "married_filing_separately"];
const INCOMES = [12000, 35000, 60000, 95000, 150000, 300000, 600000];

// ════════════════════════════════════════════════════════════════════════════
// M1 — CROSS-YEAR INFLATION MONOTONICITY: for a FIXED NOMINAL taxable income,
//   the rate-schedule tax is NON-INCREASING year-over-year, because the brackets
//   inflate (a stale/un-inflated year-map would break this). Caveat: compares
//   the exact formula, not the OBBBA structural deductions (those are upstream of
//   taxable income).
// ════════════════════════════════════════════════════════════════════════════
for (const status of STATUSES) {
  for (const ti of INCOMES) {
    const t24 = calculateFederalTax(ti, status, 2024);
    const t25 = calculateFederalTax(ti, status, 2025);
    const t26 = calculateFederalTax(ti, status, 2026);
    ok(`M1 ${status} $${ti}: tax non-increasing 2024≥2025≥2026 (brackets inflate)`, t24 >= t25 - 0.01 && t25 >= t26 - 0.01);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// M2 — FILING-STATUS BRACKET EQUALITY: a QSS uses the MFJ rate schedule, so the
//   ordinary tax is IDENTICAL to MFJ at every income/year. (The QSS cluster bug
//   was about thresholds, NOT brackets — this pins the bracket side.)
// ════════════════════════════════════════════════════════════════════════════
for (const year of YEARS) {
  for (const ti of INCOMES) {
    ok(`M2 ${year} $${ti}: QSS tax === MFJ tax (shared §1 schedule)`,
      Math.abs(calculateFederalTax(ti, "qualifying_widow", year) - calculateFederalTax(ti, "married_filing_jointly", year)) < 0.01);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// M3 — MARRIAGE-BONUS BOUND: at the SAME taxable income, MFJ tax ≤ single tax
//   (joint brackets are wider). And single tax ≤ 2× MFJ tax on half each (the
//   joint brackets are exactly 2× single in the lower brackets).
// ════════════════════════════════════════════════════════════════════════════
for (const year of YEARS) {
  for (const ti of INCOMES) {
    ok(`M3 ${year} $${ti}: MFJ tax ≤ single tax (wider joint brackets)`,
      calculateFederalTax(ti, "married_filing_jointly", year) <= calculateFederalTax(ti, "single", year) + 0.01);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// M4 — PROGRESSIVITY / CONVEXITY: doubling taxable income at least doubles the
//   tax (a progressive schedule is convex). tax(2X) ≥ 2·tax(X).
// ════════════════════════════════════════════════════════════════════════════
for (const year of YEARS) {
  for (const status of STATUSES) {
    for (const x of [20000, 50000, 120000]) {
      ok(`M4 ${year} ${status}: tax(2×$${x}) ≥ 2×tax($${x}) (progressivity)`,
        calculateFederalTax(2 * x, status, year) >= 2 * calculateFederalTax(x, status, year) - 0.01);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// M5 — STD-DED cross-year STRICTLY INCREASING (inflation): a stale copy would
//   leave two years equal — this catches it (year-coverage only checks finite).
// ════════════════════════════════════════════════════════════════════════════
for (const status of STATUSES) {
  ok(`M5 ${status}: std ded strictly increases 2024<2025<2026`,
    getFederalStandardDeduction(status, 2024) < getFederalStandardDeduction(status, 2025) &&
    getFederalStandardDeduction(status, 2025) < getFederalStandardDeduction(status, 2026));
}

// ════════════════════════════════════════════════════════════════════════════
// M6 — WHOLE-RETURN cross-year metamorphic: a FIXED nominal W-2 wage with no
//   other items pays NON-INCREASING total federal tax 2024→2025→2026 (std ded +
//   brackets both inflate; OBBBA raised the std ded further). Exercises the full
//   pipeline, not just the schedule.
// ════════════════════════════════════════════════════════════════════════════
function fedTax(wages: number, status: string, year: TaxYear): number {
  const r = computeTaxReturnPure({
    client: { filingStatus: status, state: "FL", taxYear: year } as TaxReturnInputs["client"],
    w2s: [{ taxYear: year, wagesBox1: wages, federalTaxWithheldBox2: 0 } as never],
    form1099s: [], adjustments: [], taxYear: year,
  } as TaxReturnInputs);
  return Number(r.federalTaxLiability);
}
for (const status of ["single", "married_filing_jointly", "head_of_household"]) {
  for (const wages of [40000, 85000, 200000]) {
    const a = fedTax(wages, status, 2024), b = fedTax(wages, status, 2025), c = fedTax(wages, status, 2026);
    ok(`M6 ${status} $${wages} W-2: total federal tax non-increasing 2024≥2025≥2026`, a >= b - 0.01 && b >= c - 0.01);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// M7 — INCOME MONOTONICITY (full pipeline): more wage income never lowers the
//   total federal tax (within a status/year).
// ════════════════════════════════════════════════════════════════════════════
for (const year of YEARS) {
  let prev = -1;
  let monotone = true;
  for (const wages of [20000, 40000, 80000, 160000, 320000]) {
    const t = fedTax(wages, "single", year);
    if (t < prev - 0.01) monotone = false;
    prev = t;
  }
  ok(`M7 ${year}: single total federal tax monotonic in wage income`, monotone);
}

console.log(`\nT1.5 #3 — cross-year + filing-status metamorphic relations (no external oracle needed):`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.error(`  ${f}`); process.exit(1); }
for (const p of PASS) console.log(`  ${p}`);
process.exit(0);
