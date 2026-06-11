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
 * §32(i) tax-exempt interest) are exercised end-to-end in the 16-scenario
 * battery, tax-engine-16-scenario-battery-tests.ts (N1/N2/N3 + N14).
 */

import {
  calculateAmt,
  calculateFederalTaxWithCapitalGains,
  calculateNycLocalTax,
  calculateFlatRateLocalTax,
  calculateStateTax,
  calculateSaversCredit,
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
// NY Tax Law §801(b): 0.60% "of the net earnings from self-employment ... if
// such earnings exceed" the threshold ($50,000 TY2024/2025). The $50,000 is a
// CLIFF THRESHOLD, not an exclusion — once exceeded, the 0.60% applies to the
// ENTIRE MCTD-allocated net earnings (tax.ny.gov "MCTMT individual
// definitions" / "Summary of 2025 PIT changes": tax = 0.60% OF the net
// earnings attributable to Zone 1 when those earnings exceed the threshold).
// LAW-READ CORRECTION (T1.0f #18, 2026-06-11): the original expectations used
// (netSe − 50,000) × 0.6% — an excess-over-threshold base that under-taxed
// every >$50k filer by a flat $300. Re-derived on the full-earnings base.
section("STL-01 — NYC MCTMT flat 0.60%");
{
  const mc = (netSe: number) => calculateNycLocalTax({ nysTaxableIncome: Math.max(0, netSe - 20000), federalAgi: netSe, filingStatus: "single", dependentCount: 1, taxYear: 2024, netSeEarnings: netSe }).nycMctmt;
  check("MCTMT $80k → $480 (0.6% × entire $80,000)", mc(80000), 480);   // 80,000×0.6%
  check("MCTMT $200k → $1,200", mc(200000), 1200);                       // 200,000×0.6%
  check("MCTMT $500k → $3,000", mc(500000), 3000);                       // 500,000×0.6%
  check("MCTMT $50k → $0 (at threshold — must EXCEED $50k)", mc(50000), 0);
  check("MCTMT $100k → $600", mc(100000), 600);                          // 100,000×0.6%
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

// ── PLAN-01 — Saver's Credit: QSS uses the SINGLE column (Form 8880) ──────
// §25B grants the doubled MFJ thresholds to joint returns + HoH (75%) only;
// Qualifying Surviving Spouse falls in the residual single/MFS column
// ($38,250 ceiling, $2,000 cap TY2024). Both the engine (SAVERS_CREDIT_TIERS +
// calculateSaversCredit cap) and the planning detector previously gave QSS the
// MFJ band + $4,000 cap → false positive + doubled credit.
section("PLAN-01 — Saver's Credit QSS = single column");
{
  const qssIneligible = calculateSaversCredit({ filingStatus: "qualifying_widow", agi: 50000, retirementContributions: 5000, taxYear: 2024 });
  check("Saver's QSS $50k > $38,250 → rate 0 (ineligible)", qssIneligible.rate, 0);
  check("Saver's QSS → $2,000 single cap, not $4,000", qssIneligible.eligibleContribution, 2000);
  check("Saver's QSS $50k → credit $0", qssIneligible.appliedCredit, 0);
  const qssEligible = calculateSaversCredit({ filingStatus: "qualifying_widow", agi: 24000, retirementContributions: 3000, taxYear: 2024 });
  check("Saver's QSS $24k → 20% band", qssEligible.rate, 0.20, 0.001);
  check("Saver's QSS $24k → credit $400 (min(3000,2000)×0.20)", qssEligible.appliedCredit, 400);
  // Control: MFJ unchanged — $60k is in the 10% band with the $4,000 cap.
  const mfj = calculateSaversCredit({ filingStatus: "married_filing_jointly", agi: 60000, retirementContributions: 5000, taxYear: 2024 });
  check("Saver's MFJ $60k → 10% band (unchanged)", mfj.rate, 0.10, 0.001);
  check("Saver's MFJ → $4,000 cap (unchanged)", mfj.eligibleContribution, 4000);
  check("Saver's MFJ $60k → credit $400", mfj.appliedCredit, 400);
}

console.log(`\nRESULTS: ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.join("\n")); process.exit(1); }
