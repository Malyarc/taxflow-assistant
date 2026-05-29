/**
 * Deep-audit regression suite — 2026-05-29.
 *
 * Locks the tax-correctness fixes from the 2026-05-29 deep audit. Each fix was
 * independently re-derived against the actual code + a cited IRS/state source
 * with a hand-calc before the engine was changed (see docs/accuracy-audit/).
 *
 *   FED-01  AMT 26/28% breakpoint halved for MFS (Form 6251).
 *   FED-02  Kiddie-tax (Form 8615) net-unearned threshold year-indexed
 *           ($2,600 TY2024 / $2,700 TY2025).
 *   STL-01  NYC self-employed MCTMT = flat 0.60% over $50k (Zone 1, TY2024+).
 *   STL-02  PA local EIT / OH SDIT / Philly NPT earned-income base includes
 *           self-employment net profit.
 *   STL-04  IL part-year personal-exemption AGI cliff tested on FULL-YEAR AGI.
 *
 * STL-03 (CA/MA surtax on taxable income) is locked by tax-engine-tests.ts.
 * FED-03 (NIIT FEIE add-back), FED-04 (QBI/NOL ordering) and FED-06 (EITC
 * §32(i) tax-exempt interest) are exercised end-to-end in
 * tax-engine-audit-2026-05-29-scenarios-tests.ts.
 */

import {
  calculateAmt,
  calculateFederalTaxWithCapitalGains,
  calculateNycLocalTax,
  calculateFlatRateLocalTax,
  calculateStateTax,
  KIDDIE_TAX_THRESHOLD,
} from "../../artifacts/api-server/src/lib/taxCalculator";

let pass = 0;
const failures: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.5) {
  if (Math.abs(actual - expected) <= tol) pass++;
  else failures.push(`  ✗ ${label}: expected ${expected}, got ${actual} (Δ ${(actual - expected).toFixed(2)})`);
}
function section(t: string) { console.log(`\n== ${t} ==`); }

// ── FED-01 — AMT 28%-rate breakpoint halved for MFS ────────────────────────
// Form 6251 (2024): 26% applies to AMT base ≤ $232,600 ($116,300 if MFS), 28%
// above. Hand-calc, MFS, AMTI $299,250: exemption $66,650 (no phase-out below
// $609,350) → amtBase = $232,600. TMT = 116,300×26% + (232,600−116,300)×28%
// = 30,238 + 32,564 = $62,802. Pre-fix (no MFS halving) = 232,600×26% = $60,476.
// The $2,326 gap is exactly Form 6251's MFS subtraction.
section("FED-01 — AMT MFS breakpoint");
{
  const mfs = calculateAmt({ taxableIncome: 299250, amtPreferences: 0, filingStatus: "married_filing_separately", regularTax: 0, taxYear: 2024 });
  check("AMT MFS amtBase $232,600 → TMT $62,802", mfs.amtAtFullRateOnAmtBase, 62802);
  check("AMT MFS tentative-minimum-tax $62,802 (regularTax 0)", mfs.amtTax, 62802);
  check("AMT MFS understatement closed = $2,326", mfs.amtAtFullRateOnAmtBase - 60476, 2326);
  // 2025 MFS breakpoint = $239,100 / 2 = $119,550. AMTI $305,750 → amtBase
  // = 305,750 − 68,500 exemption = $237,250. TMT = 119,550×26% +
  // (237,250−119,550)×28% = 31,083 + 32,956 = $64,039.
  const mfs25 = calculateAmt({ taxableIncome: 305750, amtPreferences: 0, filingStatus: "married_filing_separately", regularTax: 0, taxYear: 2025 });
  check("AMT MFS 2025 amtBase $237,250 → TMT $64,039", mfs25.amtAtFullRateOnAmtBase, 64039);
}

// ── FED-02 — Kiddie-tax threshold year-indexed ─────────────────────────────
// Form 8615 Line 2 = 2× the limited dependent std ded: $2,600 TY2024
// (Rev. Proc. 2023-34), $2,700 TY2025 (Rev. Proc. 2024-40). Child with $10,000
// ordinary taxable + $10,000 unearned, parent rate 35%:
//   2025: parent slice (10,000−2,700)=7,300 × 35% = 2,555; child 2,700 × 10% = 270 → $2,825.
//   2024: parent slice (10,000−2,600)=7,400 × 35% = 2,590; child 2,600 × 10% = 260 → $2,850.
section("FED-02 — kiddie-tax year-indexed threshold");
{
  check("KIDDIE_TAX_THRESHOLD 2024 = $2,600", KIDDIE_TAX_THRESHOLD[2024], 2600);
  check("KIDDIE_TAX_THRESHOLD 2025 = $2,700", KIDDIE_TAX_THRESHOLD[2025], 2700);
  const k25 = calculateFederalTaxWithCapitalGains({ ordinaryTaxableIncome: 10000, longTermGains: 0, qualifiedDividends: 0, shortTermGains: 0, filingStatus: "single", taxYear: 2025, kiddieTax: { isKiddieTaxFiler: true, unearnedIncome: 10000, parentsTopMarginalRate: 0.35 } });
  check("kiddie 2025 total tax $2,825", k25.totalFederalTax, 2825);
  const k24 = calculateFederalTaxWithCapitalGains({ ordinaryTaxableIncome: 10000, longTermGains: 0, qualifiedDividends: 0, shortTermGains: 0, filingStatus: "single", taxYear: 2024, kiddieTax: { isKiddieTaxFiler: true, unearnedIncome: 10000, parentsTopMarginalRate: 0.35 } });
  check("kiddie 2024 total tax $2,850 (unchanged)", k24.totalFederalTax, 2850);
}

// ── STL-01 — NYC self-employed MCTMT flat 0.60% (Zone 1, TY2024+) ──────────
// NY Tax Law Art. 23: flat 0.60% on net SE earnings over the $50,000 exclusion.
section("STL-01 — NYC MCTMT flat 0.60%");
{
  const mc = (netSe: number) => calculateNycLocalTax({ nysTaxableIncome: Math.max(0, netSe - 20000), federalAgi: netSe, filingStatus: "single", dependentCount: 1, taxYear: 2024, netSeEarnings: netSe }).nycMctmt;
  check("MCTMT $80k → $180 (DTF example)", mc(80000), 180);     // (80,000−50,000)×0.6%
  check("MCTMT $200k → $900", mc(200000), 900);                  // (150,000)×0.6%
  check("MCTMT $500k → $2,700", mc(500000), 2700);               // (450,000)×0.6%
  check("MCTMT $50k → $0 (at exclusion)", mc(50000), 0);
  check("MCTMT $100k → $300", mc(100000), 300);                  // (50,000)×0.6%
}

// ── STL-02 — PA EIT / OH SDIT / Philly NPT include SE net profit ──────────
// PA Act 32 / Philadelphia NPT and OH SDIT earned-income base legally include
// self-employment net profit (PA CLGS-32-1 Line 5; ORC 5748.01 via §1402(a)).
section("STL-02 — local earned-income base includes SE profit");
{
  const phila = (wages: number, se: number) => calculateFlatRateLocalTax({ localityCode: "PA-PHILADELPHIA", residentState: "PA", federalAgi: wages + Math.max(0, se), totalWages: wages, filingStatus: "single", taxYear: 2024, netSeProfit: se })?.netLocalTax ?? -1;
  check("Philly SE-only $150k → $5,625 (was $0)", phila(0, 150000), 5625);   // 150,000×3.75%
  check("Philly mixed $80k W-2 + $20k SE → $3,750", phila(80000, 20000), 3750); // 100,000×3.75%
  check("Philly net-SE-loss floored: $80k W-2 + (−$30k) SE → $3,000", phila(80000, -30000), 3000); // loss can't reduce wage EIT
  check("Philly regression: $80k W-2, no SE → $3,000 (unchanged)", phila(80000, 0), 3000);
}

// ── STL-04 — IL part-year exemption cliff on FULL-YEAR AGI ─────────────────
// IL-1040 Step 4 / Sched NR: the $250k single exemption cliff is tested on
// full-year federal AGI (Line 10 computed as a full-year resident). For a
// part-year filer the caller passes the full-year AGI; full-year filers omit it.
// $400k full-year AGI, IL→TX 2024-07-01 (182 IL days / 366): IL-allocated AGI
// = 400,000 × 182/366 = $198,907.10.
section("STL-04 — IL part-year exemption cliff (full-year AGI)");
{
  const ilPeriodAgi = 400000 * 182 / 366; // ≈ 198,907.10
  // Cliff tested on full-year $400k > $250k → exemption $0 → 198,907.10 × 4.95%.
  const withFullYear = calculateStateTax(ilPeriodAgi, "IL", "single", 2024, { fullYearFederalAgiForCliff: 400000 });
  check("IL part-year, full-year AGI $400k → exemption $0 → $9,845.90", withFullYear, ilPeriodAgi * 0.0495, 0.05);
  // Full-year filer (no option): cliff on $198,907.10 < $250k → exemption $2,775.
  const fullYearFiler = calculateStateTax(ilPeriodAgi, "IL", "single", 2024, {});
  check("IL full-year filer at same AGI keeps $2,775 exemption → $9,708.54", fullYearFiler, (ilPeriodAgi - 2775) * 0.0495, 0.05);
  // Guard: full-year AGI below cliff must NOT zero the exemption.
  const belowCliff = 200000 * 182 / 366; // ≈ 99,453.55
  const guard = calculateStateTax(belowCliff, "IL", "single", 2024, { fullYearFederalAgiForCliff: 200000 });
  check("IL part-year, full-year AGI $200k < cliff → exemption kept → $4,785.59", guard, (belowCliff - 2775) * 0.0495, 0.05);
}

console.log(`\nRESULTS: ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.join("\n")); process.exit(1); }
