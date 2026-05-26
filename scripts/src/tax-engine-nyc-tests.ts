/**
 * BP2 — NYC personal income tax pure-engine tests.
 *
 * Hand-calc references (NY DTF Form IT-201-I 2024, page 40):
 *
 * 2024 NYC PIT brackets (unchanged since TY2017):
 *   Single / MFS:
 *     3.078% on $0 – $12,000
 *     3.762% on excess over $12,000 (up to $25,000)
 *     3.819% on excess over $25,000 (up to $50,000)
 *     3.876% on excess over $50,000
 *   MFJ / Qual Surv Spouse:
 *     3.078% on $0 – $21,600
 *     3.762% on excess over $21,600 (up to $45,000)
 *     3.819% on excess over $45,000 (up to $90,000)
 *     3.876% on excess over $90,000
 *   Head of Household:
 *     3.078% on $0 – $14,400
 *     3.762% on excess over $14,400 (up to $30,000)
 *     3.819% on excess over $30,000 (up to $60,000)
 *     3.876% on excess over $60,000
 *
 * Tax base = NYS taxable income (≈ federalAgi − NY std ded − NY retirement
 * exemption). NY 2024 std ded: $8,000 single, $16,050 MFJ, $11,200 HoH,
 * $8,000 MFS.
 *
 * NYC household credit (IT-201 line 48) — small (max ~$30/person, low-FAGI
 * only). Tested separately.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-nyc-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 0.5) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}
function checkExact<T>(label: string, actual: T, expected: T) {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

// ════════════════════════════════════════════════════════════════════════════
// Test 1 — NYC single, $58k W-2, taxable income = $58k − $8k NY std = $50k
// Hand-calc NYC tax (tier 3 boundary):
//   3.078% × 12000 = 369.36
//   3.762% × 13000 = 489.06    (cum 858.42)
//   3.819% × 25000 = 954.75    (cum 1,813.17)
//   = $1,813.17  (IT-201 schedule rounds to $1,813)
// ════════════════════════════════════════════════════════════════════════════
header("Test 1 — NYC single, NYS taxable $50k → NYC tax $1,813.17");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "NY", localityCode: "NYC", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 58000, federalTaxWithheldBox2: 0, stateCode: "NY" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("NYC tax = $1,813.17", r.localTaxLiability, 1813.17, 1);
  checkExact("NYC jurisdiction reported", r.localTaxJurisdiction, "NYC");
}

// ════════════════════════════════════════════════════════════════════════════
// Test 2 — NYC single, NYS taxable $100k → fully into top bracket
// Hand-calc:
//   cum @ $50k: 1,813.17
//   3.876% × 50000 = 1,938.00  (cum 3,751.17)
//   = $3,751.17
// AGI to hit $100k taxable for NY single: $100k + $8k std = $108k W-2
// ════════════════════════════════════════════════════════════════════════════
header("Test 2 — NYC single, NYS taxable $100k → NYC tax $3,751.17");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "NY", localityCode: "NYC", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 108000, federalTaxWithheldBox2: 0, stateCode: "NY" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("NYC tax = $3,751.17", r.localTaxLiability, 3751.17, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 3 — NYC MFJ, NYS taxable $100k
// Hand-calc (MFJ thresholds 21.6k / 45k / 90k):
//   3.078% × 21600 = 664.848
//   3.762% × 23400 = 880.308   (cum 1,545.156)
//   3.819% × 45000 = 1,718.55  (cum 3,263.706)
//   3.876% × 10000 = 387.60    (cum 3,651.306)
//   = $3,651.31
// AGI to hit $100k taxable for NY MFJ: $100k + $16.05k std = $116.05k W-2
// ════════════════════════════════════════════════════════════════════════════
header("Test 3 — NYC MFJ, NYS taxable $100k → NYC tax $3,651.31");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "NY", localityCode: "NYC", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 116050, federalTaxWithheldBox2: 0, stateCode: "NY" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("NYC tax = $3,651.31", r.localTaxLiability, 3651.31, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 4 — NYC HoH, NYS taxable $60k (tier 3 boundary)
// Hand-calc (HoH thresholds 14.4k / 30k / 60k):
//   3.078% × 14400 = 443.232
//   3.762% × 15600 = 586.872   (cum 1,030.104)
//   3.819% × 30000 = 1,145.70  (cum 2,175.804)
//   = $2,175.80  (IT-201 schedule rounds to $2,176)
// AGI: $60k + $11.2k = $71.2k W-2
// ════════════════════════════════════════════════════════════════════════════
header("Test 4 — NYC HoH, NYS taxable $60k → NYC tax $2,175.80");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "head_of_household", state: "NY", localityCode: "NYC", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 71200, federalTaxWithheldBox2: 0, stateCode: "NY" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("NYC tax = $2,175.80", r.localTaxLiability, 2175.80, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 5 — Bracket-boundary edges (single): exactly $12k, $25k, $50k
// Hand-calcs:
//   At $12k: 3.078% × 12000 = $369.36
//   At $25k: $369.36 + 3.762% × 13000 = $858.42
//   At $50k: $858.42 + 3.819% × 25000 = $1,813.17
// ════════════════════════════════════════════════════════════════════════════
header("Test 5 — Bracket boundary edges (single)");
for (const [label, taxable, expected] of [
  ["12k", 12000, 369.36],
  ["25k", 25000, 858.42],
  ["50k", 50000, 1813.17],
] as const) {
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "NY", localityCode: "NYC", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: (taxable as number) + 8000, federalTaxWithheldBox2: 0, stateCode: "NY" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check(`Single at $${label} → NYC tax $${expected}`, r.localTaxLiability, expected, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 6 — Non-NYC client (NY resident, no localityCode) → NYC tax $0
// ════════════════════════════════════════════════════════════════════════════
header("Test 6 — NY resident, no localityCode → NYC tax $0");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "NY", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 0, stateCode: "NY" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("NYC tax = $0 (no localityCode)", r.localTaxLiability, 0, 0.01);
  checkExact("No NYC jurisdiction", r.localTaxJurisdiction, null);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 7 — Non-NY state with localityCode "NYC" (defensive — must be NY) → $0
// A client residing in CA but with localityCode=NYC is a CPA error; the
// engine must not apply NYC tax to a non-NY resident.
// ════════════════════════════════════════════════════════════════════════════
header("Test 7 — Non-NY state + localityCode NYC → NYC tax $0 (safety)");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "CA", localityCode: "NYC", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 0, stateCode: "CA" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("NYC tax = $0 (state is CA)", r.localTaxLiability, 0, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 8 — NYC household credit applies at very low income (single)
// Hand-calc: NYC single, AGI $9,000 (≤ $10k → $15 credit)
// NYS taxable = max(0, 9000 − 8000) = 1000
// NYC baseline tax = 3.078% × 1000 = $30.78
// Household credit = $15. Subtotal = 30.78 − 15 = $15.78
// G1 (2026-05-26): NYC EITC sliding scale now applies. Single childless
// at $9k AGI gets federal EITC ~$632; NYC EITC rate at $9k = 30% →
// $189.60. This exceeds the $15.78 NYC tax → net local tax = $0;
// refundable excess flows to stateRefundOrOwed.
// ════════════════════════════════════════════════════════════════════════════
header("Test 8 — NYC household credit + NYC EITC (single, AGI $9k)");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "NY", localityCode: "NYC", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 9000, federalTaxWithheldBox2: 0, stateCode: "NY" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("Net NYC tax after household credit + NYC EITC = $0", r.localTaxLiability, 0, 0.5);
  check("NYC EITC > $15.78 (wipes out NYC tax)",
    (r.multiState.localTax?.nycEitc ?? 0) > 15.78 ? 1 : 0, 1, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 9 — NYC household credit phased out at higher FAGI
// Single, FAGI $50k → no household credit; full NYC tax applies.
// NYS taxable = 50000 − 8000 = 42000. Brackets:
//   3.078% × 12000 = 369.36
//   3.762% × 13000 = 489.06   (cum 858.42)
//   3.819% × 17000 = 649.23   (cum 1,507.65)
//   = $1,507.65 — no household credit reduction.
// ════════════════════════════════════════════════════════════════════════════
header("Test 9 — Household credit phased out at FAGI $50k");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "NY", localityCode: "NYC", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 0, stateCode: "NY" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("NYC tax = $1,507.65 (no household credit)", r.localTaxLiability, 1507.65, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 10 — State tax + local tax both report separately
// Make sure stateTaxLiability is unchanged when NYC tax is layered on.
// Single, NY, NYC, AGI $58k:
//   NY std ded = 8000; NY taxable = 50000
//   NY tax (bracket 4 on full taxable):
//     4% × 8500 = 340
//     4.5% × 3200 = 144         (cum 484)
//     5.25% × 2200 = 115.50     (cum 599.50)
//     5.5% × 36100 = 1985.50    (cum 2,585.00)
//     = $2,585.00
//   Plus NYC tax = $1,813.17 (per test 1)
// stateTaxLiability should be ~$2,585; localTaxLiability should be ~$1,813.
// ════════════════════════════════════════════════════════════════════════════
header("Test 10 — State + local report separately");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "NY", localityCode: "NYC", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 58000, federalTaxWithheldBox2: 0, stateCode: "NY" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("NY state tax ≈ $2,585.00", r.stateTaxLiability, 2585.00, 1);
  check("NYC local tax = $1,813.17", r.localTaxLiability, 1813.17, 1);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────────────");
console.log(`PASS: ${PASS.length}`);
for (const p of PASS) console.log("  " + p);
if (FAIL.length > 0) {
  console.log(`\nFAIL: ${FAIL.length}`);
  for (const f of FAIL) console.log("  " + f);
  process.exit(1);
}
console.log(`\nAll ${PASS.length} NYC tax assertions passed.`);
