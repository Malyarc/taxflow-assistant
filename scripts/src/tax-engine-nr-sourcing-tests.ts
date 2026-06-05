/**
 * PREP-B1 — per-line non-resident income sourcing (NY IT-203 / CA 540NR).
 *
 * Verifies the proportional ("as-if-resident × source-fraction") method for NY
 * and CA non-residents, the per-income-type NR source base (wages + NR business/
 * rental/real-property gains via perStateNonResidentOtherSourced), and the federal
 * sourcing exclusions: intangibles (interest/dividends — 4 U.S.C. §114(a)) and
 * retirement (pension/IRA/401(k)/SS — 4 U.S.C. §114(b)) are NEVER NR-source.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-nr-sourcing-tests.ts
 */

import {
  calculateMultiStateTax,
  calculateStateTax,
} from "../../artifacts/api-server/src/lib/taxCalculator";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.5): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}
function checkTruthy(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}
function header(t: string): void { console.log(`\n-- ${t} --`); }
const nyEntry = (r: ReturnType<typeof calculateMultiStateTax>, s: string) =>
  r.nonresidentStateTaxes.find((x) => x.state === s);

// ════════════════════════════════════════════════════════════════════════════
// NY IT-203 worked example (NY DTF IT-203 instructions):
// Single NJ resident, $80,000 NY-source wages + $40,000 NJ interest = $120,000.
//   NY tax AS-IF a full-year resident on $120,000: taxable = 120,000 − $8,000 NY
//   std ded = 112,000. NY single brackets → 4%×8,500 + 4.5%×3,200 + 5.25%×2,200
//   + 5.5%×66,750 + 6%×31,350 = 340 + 144 + 115.50 + 3,671.25 + 1,881 = $6,151.75.
//   Income % (IT-203 Line 45) = 80,000/120,000 = 66.667%.
//   NY NR tax = 6,151.75 × 0.66667 = $4,101.17.
// ════════════════════════════════════════════════════════════════════════════
header("NY IT-203 — NJ resident, $80k NY wages + $40k NJ interest");
{
  const r = calculateMultiStateTax({
    residentState: "NJ",
    federalAgi: 120000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NY", wages: 80000 }],
  });
  const ny = nyEntry(r, "NY");
  // Anchor: the engine's NY-as-resident tax on $120k matches the published brackets.
  check("NY-as-resident($120k single) = $6,151.75", calculateStateTax(120000, "NY", "single", 2024), 6151.75, 0.5);
  // The IT-203 method: NY-as-resident × income% (80k/120k).
  check("NY NR tax = $4,101.17 (IT-203 income % method)", ny?.tax ?? -1, 4101.17, 0.5);
  check("NY NR tax == NY-as-resident × 0.66667 (relational)",
    ny?.tax ?? -1, calculateStateTax(120000, "NY", "single", 2024) * (80000 / 120000), 0.5);
  checkTruthy("> the old direct-bracket-on-$80k value",
    (ny?.tax ?? 0) > calculateStateTax(80000, "NY", "single", 2024));
}

// ════════════════════════════════════════════════════════════════════════════
// CA 540NR worked example (FTB 540NR Schedule CA):
// Single TX resident, $100,000 CA wages + $50,000 TX wages = $150,000.
//   CA tax as-if resident on $150,000 (taxable 150,000 − $5,540 std ded = 144,460):
//     1%×10,756 + 2%×14,743 + 4%×14,746 + 6%×15,621 + 8%×14,740 + 9.3%×73,854
//     = 107.56 + 294.86 + 589.84 + 937.26 + 1,179.20 + 6,868.42 = $9,977.14.
//   CA ratio = 100,000/150,000 = 66.667% → CA NR tax = $6,651.43.
// ════════════════════════════════════════════════════════════════════════════
header("CA 540NR — TX resident, $100k CA + $50k TX wages");
{
  const r = calculateMultiStateTax({
    residentState: "TX",
    federalAgi: 150000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "CA", wages: 100000 }, { stateCode: "TX", wages: 50000 }],
  });
  const ca = nyEntry(r, "CA");
  check("CA-as-resident($150k single) = $9,977.14", calculateStateTax(150000, "CA", "single", 2024), 9977.14, 0.5);
  check("CA NR tax = $6,651.43 (540NR ratio)", ca?.tax ?? -1, 6651.43, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// Per-income-type NR source: a TX resident with NY REAL-PROPERTY RENTAL income
// (situs-sourced to NY) but NO NY wages. Supplied via perStateNonResidentOther-
// Sourced. NY taxes the rental via the IT-203 method even with zero NY wages.
//   TX resident, $80k TX wages + $20k NY rental = $100k; NY source = $20k.
//   NY NR tax = NY-as-resident($100k) × (20,000/100,000).
// ════════════════════════════════════════════════════════════════════════════
header("Per-type NR source — TX resident, $20k NY rental (no NY wages)");
{
  const r = calculateMultiStateTax({
    residentState: "TX",
    federalAgi: 100000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "TX", wages: 80000 }],
    options: { perStateNonResidentOtherSourced: { NY: 20000 } },
  });
  const ny = nyEntry(r, "NY");
  checkTruthy("NY appears as a non-resident state from rental alone (no wages)", ny != null);
  check("NY NR tax on rental = NY-as-resident($100k) × 20%",
    ny?.tax ?? -1, calculateStateTax(100000, "NY", "single", 2024) * (20000 / 100000), 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// §114 / intangible exclusion: a TX resident who WORKED in NY ($80k wages) and
// also has $40k interest (intangible — §114(a)) + $30k IRA distribution (§114(b)).
// Only the $80k wages are NY-source; the interest + IRA are in total AGI ($150k,
// the denominator) but NOT in the NY-source numerator.
//   NY NR tax = NY-as-resident($150k) × (80,000/150,000), NOT × (150k/150k).
// ════════════════════════════════════════════════════════════════════════════
header("§114 — interest + IRA are NOT NY-source for a non-resident");
{
  const r = calculateMultiStateTax({
    residentState: "TX",
    federalAgi: 150000, // 80k NY wages + 40k interest + 30k IRA
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NY", wages: 80000 }],
    // interest + IRA deliberately NOT in perStateNonResidentOtherSourced (§114).
  });
  const ny = nyEntry(r, "NY");
  check("NY NR tax = NY-as-resident($150k) × (80k/150k) — intangibles+IRA excluded",
    ny?.tax ?? -1, calculateStateTax(150000, "NY", "single", 2024) * (80000 / 150000), 0.5);
  checkTruthy("NY NR tax < taxing all $150k as NY-source (intangibles+IRA escape NY)",
    (ny?.tax ?? Infinity) < calculateStateTax(150000, "NY", "single", 2024) * 0.99);
}

console.log(`\n========================================`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed  (NR per-line sourcing)`);
if (FAIL.length) {
  console.log(`\nFAILURES:`);
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log(`ALL NR-SOURCING ASSERTIONS PASS`);
