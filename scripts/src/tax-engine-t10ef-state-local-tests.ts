/**
 * T1.0e/f — state-law currency + multistate/local regression suite (2026-06-11).
 *
 * Pins every fix from the T1.0 groups (e) state-engine + (f) multistate/local
 * audits, each hand-calc'd against the state's PRIMARY SOURCE (cited inline):
 *   KS SB 1 (2024 SS) · MS component decomposition · WV 2024/2025/2026 rate
 *   tables (HB 2526 / trigger+SB 2033 / SB 392) · NM pre-/post-HB 252 ·
 *   HI Act 46 (2025 brackets + 2026 std ded) · MD HB 352 (brackets + std ded
 *   + 2% cap-gains surtax) · CO TY2025 4.40% (trigger NOT met) · LA/ME/DC/VA
 *   std deds · DC + VA EITC year-indexing · IL CTC (% of IL EITC) · VT CTC
 *   ($20/$1k phase-out) · CA AMT (real Schedule P exemption + phase-out) ·
 *   SS-exclusion depth (NM/CO/VT/MN/RI/UT + KS full exemption) · PA Schedule
 *   SP $250-step single application · MCTMT §801(b) entire-earnings base +
 *   TY2026 $150k threshold · NYC school credit HoH $63 · Reading 3.6% ·
 *   locality rateByYear refresh · locality SS subtraction + Box-5 wage base ·
 *   per-state resident-credit limitation · OR method-(b) · AZ reciprocity ·
 *   part-year option-amount proration · childrenUnder6 e2e ·
 *   calculateStateTaxWithBreakdown parity.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-t10ef-state-local-tests.ts
 */

import {
  calculateStateTax,
  calculateStateTaxWithBreakdown,
  calculateMultiStateTax,
  calculateNycLocalTax,
  calculateFlatRateLocalTax,
  calculatePaScheduleSpForgivenessPct,
  calculateStateEitc,
  calculateStateCtc,
} from "../../artifacts/api-server/src/lib/taxCalculator";
import { computeTaxReturnPure } from "../../artifacts/api-server/src/lib/taxReturnEngine";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.05): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) {
    passed++;
  } else {
    failed++;
    failures.push(`✗ ${label}: expected ${expected}, got ${actual} (Δ ${(actual - expected).toFixed(2)})`);
  }
}
function ok(label: string, cond: boolean): void {
  if (cond) passed++;
  else { failed++; failures.push(`✗ ${label}`); }
}
function header(t: string): void { console.log(`\n── ${t} ──`); }

// ════════════════════════════════════════════════════════════════════════════
// 1. KANSAS — SB 1 (2024 Special Session, signed 6/21/2024, retroactive TY2024).
// KLRD bill summary + the enrolled text (kslegislature.gov): two brackets
// 5.2% ≤ $23,000 single / $46,000 MFJ, 5.58% above; std ded $3,605/$8,240/
// $6,180; personal exemption $9,160/filer ($18,320 MFJ) + $2,320/dependent;
// Social Security 100% exempt for ALL income levels beginning TY2024.
// ════════════════════════════════════════════════════════════════════════════
header("KS — SB 1 (2024): brackets, std ded, exemptions, SS exemption");
{
  // Single $60k: taxable = 60,000 − 3,605 − 9,160 = 47,235.
  //   23,000 × 5.2% (1,196) + 24,235 × 5.58% (1,352.31) = $2,548.31
  check("KS 2024 single $60k → $2,548.31 (SB 1 two-bracket + $9,160 exemption)",
    calculateStateTax(60000, "KS", "single", 2024), 2548.31);
  // MFJ $100k + 2 dependents: taxable = 100,000 − 8,240 − (18,320 + 2×2,320)
  //   = 100,000 − 8,240 − 22,960 = 68,800.
  //   46,000 × 5.2% (2,392) + 22,800 × 5.58% (1,272.24) = $3,664.24
  check("KS 2024 MFJ $100k + 2 deps → $3,664.24 ($2,320/dependent)",
    calculateStateTax(100000, "KS", "married_filing_jointly", 2024, { dependentCount: 2 }), 3664.24);
  // SS 100% exempt TY2024+ (KS removed from STATES_TAXING_SS): retiree single
  // $60k AGI incl. $20k taxable SS → taxable = 60,000 − 3,605 − 9,160 − 20,000
  // = 27,235 → 23,000 × 5.2% (1,196) + 4,235 × 5.58% (236.31) = $1,432.31
  check("KS 2024 single $60k incl. $20k SS → $1,432.31 (SS fully exempt, no cliff)",
    calculateStateTax(60000, "KS", "single", 2024, { taxableSocialSecurity: 20000 }), 1432.31);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. MISSISSIPPI — decomposed components (MS DOR dor.ms.gov; Form 80-105):
// 0% on the FIRST $10,000 of taxable income (single band — does NOT double for
// MFJ), then the 2022 HB 531 phase-down rate (4.7% TY2024 / 4.4% TY2025 /
// 4.0% TY2026); std ded $2,300 single / $4,600 MFJ; personal exemption $6,000
// single / $12,000 MFJ.
// ════════════════════════════════════════════════════════════════════════════
header("MS — std ded + exemption + single $10k 0% band; rate phase-down");
{
  // Single $80k: taxable = 80,000 − 2,300 − 6,000 = 71,700.
  check("MS 2024 single $80k → $2,899.90 ((71,700 − 10,000) × 4.7%)",
    calculateStateTax(80000, "MS", "single", 2024), 2899.90);
  check("MS 2025 single $80k → $2,714.80 (rate 4.4%)",
    calculateStateTax(80000, "MS", "single", 2025), 2714.80);
  check("MS 2026 single $80k → $2,468.00 (rate 4.0%)",
    calculateStateTax(80000, "MS", "single", 2026), 2468.00);
  // MFJ $80k: taxable = 80,000 − 4,600 − 12,000 = 63,400; the $10k 0% band
  // does NOT double → (63,400 − 10,000) × 4.7% = $2,509.80.
  check("MS 2024 MFJ $80k → $2,509.80 ($10k band does NOT double)",
    calculateStateTax(80000, "MS", "married_filing_jointly", 2024), 2509.80);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. WEST VIRGINIA — three different rate tables (T1.0e #4):
//   TY2024 = HB 2526 (2023): 2.36/3.15/3.54/4.72/5.12% (tax.wv.gov 2024
//     IT-140 rate schedules; the trigger + SB 2033 cuts start 1/1/2025).
//   TY2025 = 2.22/2.96/3.33/4.44/4.82% (EY Tax Alert 2024-2154).
//   TY2026 = SB 392 (signed 3/31/2026, retroactive 1/1/2026, §11-21-4j):
//     2.11/2.81/3.16/4.22/4.58% — enrolled table anchor "$1,950.50 + 4.58%
//     of excess over $60,000".
// WV std ded $0 ($2,000/filer exemption not modeled — documented).
// ════════════════════════════════════════════════════════════════════════════
header("WV — 2024 HB 2526 / 2025 trigger+SB 2033 / 2026 SB 392 rate tables");
{
  // $60k single hits the bracket-table anchors exactly:
  // 2024: 236 + 472.50 + 531 + 944 = $2,183.50
  check("WV 2024 single $60k → $2,183.50 (HB 2526 rates)",
    calculateStateTax(60000, "WV", "single", 2024), 2183.50);
  // 2025: 222 + 444 + 499.50 + 888 = $2,053.50
  check("WV 2025 single $60k → $2,053.50 (post-trigger + SB 2033)",
    calculateStateTax(60000, "WV", "single", 2025), 2053.50);
  // 2026: 211 + 421.50 + 474 + 844 = $1,950.50 (SB 392 enrolled-table anchor)
  check("WV 2026 single $60k → $1,950.50 (SB 392 retroactive 5% cut)",
    calculateStateTax(60000, "WV", "single", 2026), 1950.50);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. NEW MEXICO — TY2024 pre-HB-252 five-bracket law vs TY2025+ HB 252
// six-bracket law (L.2024 ch.67, eff. 1/1/2025; LegiScan enrolled text +
// tax.newmexico.gov). NM conforms to the federal std ded ($14,600 2024 /
// $15,750 OBBBA 2025).
// ════════════════════════════════════════════════════════════════════════════
header("NM — TY2024 (pre-HB 252) vs TY2025 (HB 252 six brackets)");
{
  // 2024 single $50k: taxable = 50,000 − 14,600 = 35,400.
  //   1.7%×5,500 (93.50) + 3.2%×5,500 (176) + 4.7%×5,000 (235)
  //   + 4.9%×(35,400 − 16,000) (950.60) = $1,455.10
  check("NM 2024 single $50k → $1,455.10 (1.7/3.2/4.7/4.9 at $5.5k/$11k/$16k)",
    calculateStateTax(50000, "NM", "single", 2024), 1455.10);
  // 2025 single $50k: taxable = 50,000 − 15,750 = 34,250. HB 252 single
  // bands: 1.5% ≤ $5.5k / 3.2% ≤ $16.5k / 4.3% ≤ $33.5k / 4.7% ≤ $66.5k.
  //   1.5%×5,500 (82.50) + 3.2%×11,000 (352) + 4.3%×17,000 (731)
  //   + 4.7%×(34,250 − 33,500) (35.25) = $1,200.75
  check("NM 2025 single $50k → $1,200.75 (HB 252 six-bracket: crosses into 4.7%)",
    calculateStateTax(50000, "NM", "single", 2025), 1200.75);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. HAWAII — Act 46 SLH 2024: TY2025 bracket widening (1.4% band → $9,600
// single; 11% starts $325,000) with the std ded HELD at $4,400 for 2025;
// TY2026 std ded doubles to $8,000/$16,000/$12,000 (HI DOTAX FAQ "2026 tax
// year standard deduction amounts"; brackets hold until TY2027).
// ════════════════════════════════════════════════════════════════════════════
header("HI — Act 46: TY2025 widened brackets; TY2026 std ded $8,000");
{
  // 2025 single $90k: taxable = 90,000 − 4,400 = 85,600.
  //   1.4%×9,600 (134.40) + 3.2%×4,800 (153.60) + 5.5%×4,800 (264)
  //   + 6.4%×4,800 (307.20) + 6.8%×12,000 (816) + 7.2%×12,000 (864)
  //   + 7.6%×(85,600 − 48,000) (2,857.60) = $5,396.80
  check("HI 2025 single $90k → $5,396.80 (Act 46 widened brackets)",
    calculateStateTax(90000, "HI", "single", 2025), 5396.80);
  // 2026 single $90k: taxable = 90,000 − 8,000 = 82,000 → same brackets:
  //   134.40 + 153.60 + 264 + 307.20 + 816 + 864 + 7.6%×34,000 (2,584)
  //   = $5,123.20
  check("HI 2026 single $90k → $5,123.20 (std ded doubles to $8,000)",
    calculateStateTax(90000, "HI", "single", 2026), 5123.20);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. MARYLAND — HB 352 (Budget Reconciliation & Financing Act of 2025,
// TY2025+; MD Comptroller / DLS fiscal note): NEW brackets 6.25% over $500k
// single ($600k MFJ) and 6.5% over $1M ($1.2M MFJ); flat std ded $3,350/
// $6,700 (15%-of-AGI phase-in repealed); and a 2% capital-gains surtax on
// individuals with FEDERAL AGI > $350,000.
// ════════════════════════════════════════════════════════════════════════════
header("MD — HB 352: new top brackets + std ded + 2% cap-gains surtax");
{
  // Single $600k 2025: taxable = 600,000 − 3,350 = 596,650.
  //   20 + 30 + 40 + 4.75%×97,000 (4,607.50) + 5%×25,000 (1,250)
  //   + 5.25%×25,000 (1,312.50) + 5.5%×100,000 (5,500) + 5.75%×250,000
  //   (14,375) + 6.25%×(596,650 − 500,000) (6,040.63) = $33,175.63
  check("MD 2025 single $600k → $33,175.63 (6.25% band above $500k)",
    calculateStateTax(600000, "MD", "single", 2025), 33175.63);
  // MFJ $1.5M 2025: taxable = 1,493,300 → 90 + 6,982.50 + 1,250 + 2,625
  //   + 4,125 + 17,250 + 37,500 + 6.5%×293,300 (19,064.50) = $88,887.00
  check("MD 2025 MFJ $1.5M → $88,887.00 (6.5% top band above $1.2M)",
    calculateStateTax(1500000, "MD", "married_filing_jointly", 2025), 88887.00);
  // 2% cap-gains surtax (federal AGI > $350k): isolate via the delta of two
  // otherwise-identical multi-state runs (resident MD, no localities).
  const mdSurtaxOn = calculateMultiStateTax({
    residentState: "MD", federalAgi: 400000, filingStatus: "single", taxYear: 2025,
    perStateWages: [], options: { netCapitalGains: 50000 },
  }).residentStateTax;
  const mdSurtaxOff = calculateMultiStateTax({
    residentState: "MD", federalAgi: 400000, filingStatus: "single", taxYear: 2025,
    perStateWages: [],
  }).residentStateTax;
  check("MD 2025 surtax: $50k gains @ $400k AGI adds exactly 2% = $1,000",
    mdSurtaxOn - mdSurtaxOff, 1000.00);
  const mdUnder = calculateMultiStateTax({
    residentState: "MD", federalAgi: 300000, filingStatus: "single", taxYear: 2025,
    perStateWages: [], options: { netCapitalGains: 50000 },
  }).residentStateTax;
  const mdUnderOff = calculateMultiStateTax({
    residentState: "MD", federalAgi: 300000, filingStatus: "single", taxYear: 2025,
    perStateWages: [],
  }).residentStateTax;
  check("MD 2025 surtax: NOT applied at $300k AGI (≤ $350k threshold)",
    mdUnder - mdUnderOff, 0);
  const md2024 = calculateMultiStateTax({
    residentState: "MD", federalAgi: 400000, filingStatus: "single", taxYear: 2024,
    perStateWages: [], options: { netCapitalGains: 50000 },
  }).residentStateTax;
  const md2024Off = calculateMultiStateTax({
    residentState: "MD", federalAgi: 400000, filingStatus: "single", taxYear: 2024,
    perStateWages: [],
  }).residentStateTax;
  check("MD surtax: NOT applied in TY2024 (HB 352 is TY2025+)", md2024 - md2024Off, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. COLORADO TY2025 = 4.40% — the SB24-228 TABOR temporary reduction did NOT
// trigger for 2025 (certified net excess ≈ $293.3M < the $300M floor; the
// official 2025 DR 0104 booklet states "the income tax rate is 4.4%").
// CO conforms to the federal std ded ($15,750 OBBBA for 2025).
// ════════════════════════════════════════════════════════════════════════════
header("CO — TY2025 holds 4.40% (TABOR trigger not met)");
{
  // (100,000 − 15,750) × 4.4% = 84,250 × 0.044 = $3,707.00
  check("CO 2025 single $100k → $3,707.00 (4.40%, OBBBA fed std ded)",
    calculateStateTax(100000, "CO", "single", 2025), 3707.00);
  // 2024 stays at the certified 4.25% temporary rate (SB24-228 — already
  // pinned elsewhere; relational guard here): 2024 < 2025 at equal income
  // is rate-driven (4.25% vs 4.40%) net of the std-ded change.
  check("CO 2024 single $100k → $3,629.50 ((100,000 − 14,600) × 4.25%)",
    calculateStateTax(100000, "CO", "single", 2024), 3629.50);
}

// ════════════════════════════════════════════════════════════════════════════
// 8. LA / ME / DC / VA standard deductions (T1.0e #8 + M1/M2):
//   LA TY2025: $12,500 single/MFS, $25,000 for JOINT **and HoH** and QSS
//     (LDR income-tax-reform FAQ; the old override wrongly gave HoH $12,500).
//   ME TY2025: $15,000/$30,000 — Maine did NOT conform to OBBBA's $15,750
//     (fixed-date conformity; MRS 2025 1040ME instructions). TY2026 ME-indexed
//     $15,300/$30,600 + MRS 2026 rate schedule ($27,400/$64,850 single).
//   DC TY2025: Law 26-89 DECOUPLED basic std ded $15,000/$30,000/$22,500.
//   VA TY2025+: $8,750/$17,500 (HB 1600; tax.virginia.gov July-2025 changes).
// ════════════════════════════════════════════════════════════════════════════
header("LA / ME / DC / VA std deductions");
{
  // LA 2025 flat 3%: HoH gets the $25,000 combined deduction-exemption.
  check("LA 2025 HoH $60k → $1,050 ((60,000 − 25,000) × 3%)",
    calculateStateTax(60000, "LA", "head_of_household", 2025), 1050.00);
  check("LA 2025 single $60k → $1,425 ((60,000 − 12,500) × 3%)",
    calculateStateTax(60000, "LA", "single", 2025), 1425.00);
  // ME 2025: taxable = 50,000 − 15,000 = 35,000; the brackets are inflation-
  // indexed for 2025 (R3-C20; first-bracket top $26,800, was $26,050 in 2024):
  //   5.8%×26,800 (1,554.40) + 6.75%×(35,000−26,800) (553.50) = $2,107.90
  check("ME 2025 single $50k → $2,107.90 (MRS $15,000 std ded + 2025-indexed brackets)",
    calculateStateTax(50000, "ME", "single", 2025), 2107.90);
  // ME 2026: taxable = 50,000 − 15,300 = 34,700 (MRS 2026 schedule:
  //   5.8% < $27,400): 5.8%×27,400 (1,589.20) + 6.75%×7,300 (492.75) = $2,081.95
  check("ME 2026 single $50k → $2,081.95 (ME-indexed $15,300 + 2026 brackets)",
    calculateStateTax(50000, "ME", "single", 2026), 2081.95);
  // DC 2025: taxable = 80,000 − 15,000 = 65,000.
  //   4%×10,000 (400) + 6%×30,000 (1,800) + 6.5%×20,000 (1,300)
  //   + 8.5%×5,000 (425) = $3,925.00
  check("DC 2025 single $80k → $3,925.00 (Law 26-89 $15,000 std ded)",
    calculateStateTax(80000, "DC", "single", 2025), 3925.00);
  // VA 2025: taxable = 50,000 − 8,750 = 41,250.
  //   2%×3,000 (60) + 3%×2,000 (60) + 5%×12,000 (600)
  //   + 5.75%×(41,250 − 17,000) (1,394.38) = $2,114.38
  check("VA 2025 single $50k → $2,114.38 (HB 1600 $8,750 std ded)",
    calculateStateTax(50000, "VA", "single", 2025), 2114.38);
}

// ════════════════════════════════════════════════════════════════════════════
// 9. DC + VA EITC year-indexing (T1.0e #14):
//   DC: 70% of federal TY2024 → 100% TY2025+ (Law 26-89 accelerated the
//     statutory 85%-for-2025 schedule to the full match; OTR DC-EITC page).
//   VA: refundable option 15% TY2024 → 20% TY2025+ (HB 1600 budget).
// ════════════════════════════════════════════════════════════════════════════
header("DC + VA EITC year-indexing");
{
  const eitc = (state: string, year: number) => calculateStateEitc({
    state, federalEitcApplied: 3000, federalEitcEligible: true, agi: 25000,
    earnedIncome: 25000, investmentIncome: 0, qualifyingChildren: 2, taxYear: year,
  }).credit;
  check("DC EITC 2024 = 70% × $3,000 = $2,100", eitc("DC", 2024), 2100.00);
  check("DC EITC 2025 = 100% × $3,000 = $3,000 (Law 26-89 acceleration)", eitc("DC", 2025), 3000.00);
  check("DC EITC 2026 = 100% × $3,000 = $3,000", eitc("DC", 2026), 3000.00);
  check("VA EITC 2024 = 15% × $3,000 = $450", eitc("VA", 2024), 450.00);
  check("VA EITC 2025 = 20% × $3,000 = $600 (HB 1600)", eitc("VA", 2025), 600.00);
}

// ════════════════════════════════════════════════════════════════════════════
// 10. IL CTC = % of the IL EITC (PA 103-0592; IL DOR "Child Tax Credit"):
// 20% TY2024 → 40% TY2025+, qualifying child under 12 (engine proxy:
// under-17), NO separate AGI phase-out. VT CTC (32 V.S.A. §5830f): $1,000 per
// child under 6, reduced $20 per $1,000 (or part thereof) of AGI over
// $125,000 — fully phased at $175,000 (tax.vermont.gov; VT LJFO brief).
// ════════════════════════════════════════════════════════════════════════════
header("IL CTC (% × IL EITC) + VT CTC ($20/$1k phase-out)");
{
  const ctc = (state: string, p: Record<string, unknown>) => calculateStateCtc({
    state, agi: 30000, filingStatus: "single", childrenUnder6: 0,
    childrenUnder17: 1, federalCtcApplied: 0, taxYear: 2024, ...p,
  } as Parameters<typeof calculateStateCtc>[0]).credit;
  check("IL CTC 2024 = 20% × $500 IL EITC = $100", ctc("IL", { stateEitcCredit: 500 }), 100.00);
  check("IL CTC 2025 = 40% × $500 IL EITC = $200", ctc("IL", { stateEitcCredit: 500, taxYear: 2025 }), 200.00);
  check("IL CTC = $0 without IL EITC", ctc("IL", { stateEitcCredit: 0 }), 0);
  check("VT CTC $130k AGI 1 child → $900 ($1,000 − 5 × $20)",
    ctc("VT", { agi: 130000, childrenUnder6: 1 }), 900.00);
  check("VT CTC $175k AGI 1 child → $0 (fully phased)",
    ctc("VT", { agi: 175000, childrenUnder6: 1 }), 0);
  check("VT CTC $150k AGI 2 children → $1,000 ($500/child)",
    ctc("VT", { agi: 150000, childrenUnder6: 2 }), 1000.00);
}

// ════════════════════════════════════════════════════════════════════════════
// 11. CA AMT — real FTB Schedule P (540) parameters (T1.0e #11). 2024:
// exemption $90,048 single/HoH ($120,065 MFJ / $60,029 MFS), phased out 25¢/$
// of AMTI over $337,678 ($450,238 / $225,115) — zero at $697,870 ($930,498 /
// $465,231, the FTB-published zero-points = start + 4 × exemption). 2025:
// $92,749 etc. (FTB 2025 instructions). The boundary cases are pinned in
// tax-engine-accuracy-audit-tests (G5); here: the full-exemption region.
// ════════════════════════════════════════════════════════════════════════════
header("CA AMT — Schedule P exemption at the phase-out start");
{
  // CA resident 2024 single, federal AGI $37,678 + ISO prefs $300,000 →
  // AMTI = $337,678 (exactly the phase-out start → FULL $90,048 exemption).
  //   Tentative = 7% × (337,678 − 90,048) = 7% × 247,630 = $17,334.10.
  //   Regular CA on $37,678: taxable = 32,138 → 1%×10,756 (107.56)
  //   + 2%×14,743 (294.86) + 4%×6,639 (265.56) = $667.98 → AMT binds.
  const caAmt = calculateMultiStateTax({
    residentState: "CA", federalAgi: 37678, filingStatus: "single", taxYear: 2024,
    perStateWages: [], options: { amtPreferences: 300000 },
  }).residentStateTax;
  check("CA 2024 AMTI $337,678 → $17,334.10 (full $90,048 exemption at the start)",
    caAmt, 17334.10);
}

// ════════════════════════════════════════════════════════════════════════════
// 12. SS-exclusion depth — NM / CO / VT (T1.0e #13).
//   NM §7-2-5.14: SS fully exempt at/below $100k single / $150k joint / $75k
//     MFS federal AGI — a CLIFF (NM Tax & Rev "SS Income Tax Exemption").
//   CO §39-22-104(4)(g)/(g.7): 65+ subtract ALL federally-taxed SS; 55-64
//     capped at the $20k pension subtraction (TY2025+: full if AGI ≤ $75k/$95k).
//   VT 32 V.S.A. §5830e: full below $50k/$65k AGI; linear phase-out over the
//     next $10,000; zero at $60k/$75k.
// ════════════════════════════════════════════════════════════════════════════
header("SS-exclusion depth — NM cliff / CO age tiers / VT linear phase");
{
  // NM single $60k AGI incl. $20k taxable SS (≤ $100k → fully exempt):
  //   taxable = 60,000 − 14,600 − 20,000 = 25,400
  //   → 93.50 + 176 + 235 + 4.9%×9,400 (460.60) = $965.10
  check("NM 2024 single $60k incl. $20k SS → $965.10 (SS exempt ≤ $100k)",
    calculateStateTax(60000, "NM", "single", 2024, { taxableSocialSecurity: 20000 }), 965.10);
  // NM single $110k AGI (> $100k cliff → NO exemption):
  //   taxable = 110,000 − 14,600 = 95,400 → 93.50 + 176 + 235
  //   + 4.9%×79,400 (3,890.60) = $4,395.10
  check("NM 2024 single $110k incl. $20k SS → $4,395.10 (over the cliff — SS taxed)",
    calculateStateTax(110000, "NM", "single", 2024, { taxableSocialSecurity: 20000 }), 4395.10);
  // CO age 70 (65+ → full subtraction): (70,000 − 14,600 − 30,000) × 4.25%
  //   = 25,400 × 0.0425 = $1,079.50
  check("CO 2024 age 70 $70k incl. $30k SS → $1,079.50 (full 65+ subtraction)",
    calculateStateTax(70000, "CO", "single", 2024, { taxableSocialSecurity: 30000, taxpayerAge: 70 }), 1079.50);
  // CO age 60 TY2024 (55-64 → capped at $20k): (70,000 − 14,600 − 20,000)
  //   × 4.25% = 35,400 × 0.0425 = $1,504.50
  check("CO 2024 age 60 $70k incl. $30k SS → $1,504.50 ($20k pension cap)",
    calculateStateTax(70000, "CO", "single", 2024, { taxableSocialSecurity: 30000, taxpayerAge: 60 }), 1504.50);
  // CO age 60 TY2025 AGI ≤ $75k → FULL subtraction (SB22-233 expansion path):
  //   (70,000 − 15,750 − 30,000) × 4.4% = 24,250 × 0.044 = $1,067.00
  check("CO 2025 age 60 $70k incl. $30k SS → $1,067.00 (55-64 full ≤ $75k)",
    calculateStateTax(70000, "CO", "single", 2025, { taxableSocialSecurity: 30000, taxpayerAge: 60 }), 1067.00);
  // CO age 40 → no SS subtraction: (70,000 − 14,600) × 4.25% = $2,354.50
  check("CO 2024 age 40 $70k incl. $30k SS → $2,354.50 (no subtraction under 55)",
    calculateStateTax(70000, "CO", "single", 2024, { taxableSocialSecurity: 30000, taxpayerAge: 40 }), 2354.50);
  // VT full exemption below $50k: base = 45,000 − 7,400 − 4,850 − 15,000
  //   = 17,750 × 3.35% = $594.63
  check("VT 2024 single $45k incl. $15k SS → $594.63 (full exemption < $50k)",
    calculateStateTax(45000, "VT", "single", 2024, { taxableSocialSecurity: 15000 }), 594.63);
  // VT mid-phase at $55k (50% through the $10k band): exclusion = 7,500 →
  //   base = 55,000 − 7,400 − 4,850 − 7,500 = 35,250 × 3.35% = $1,180.88
  check("VT 2024 single $55k incl. $15k SS → $1,180.88 (50% partial exclusion)",
    calculateStateTax(55000, "VT", "single", 2024, { taxableSocialSecurity: 15000 }), 1180.88);
  // VT $62k (≥ $60k → zero exclusion): base = 62,000 − 7,400 − 4,850 = 49,750
  //   → 3.35%×45,400 (1,520.90) + 6.6%×4,350 (287.10) = $1,808.00
  check("VT 2024 single $62k incl. $15k SS → $1,808.00 (phase-out complete)",
    calculateStateTax(62000, "VT", "single", 2024, { taxableSocialSecurity: 15000 }), 1808.00);
}

// ════════════════════════════════════════════════════════════════════════════
// 13. SS-exclusion depth — MN / RI / UT (T1.0e #13).
//   MN Schedule M1M simplified method (Minn. Stat. §290.0132 subd. 26; 2024
//     M1M instructions): full subtraction below $108,320 MFJ / $84,490
//     single-HoH / $54,160 MFS; −10% per $4,000 ($2,000 MFS) or fraction.
//   RI §44-30-12(c)(8): full-retirement-age + AGI below $104,200/$130,250
//     (TY2024, PUB 2025-01) / $107,000/$133,750 (TY2025, ADV 2024-26).
//   UT §59-10-1042 (TC-40): credit = UT rate × taxable SS, reduced 2.5¢/$ of
//     MAGI over $45k single/$37.5k MFS/$75k joint (TY2024); SB 71 (2025)
//     raises to $54k/$45k/$90k.
// ════════════════════════════════════════════════════════════════════════════
header("SS-exclusion depth — MN M1M / RI FRA limits / UT credit");
{
  // MN single $90k AGI incl. $20k SS 2024: excess = 5,510 → ceil(/4,000) = 2
  //   → 20% phased out → exclusion $16,000.
  //   base = 90,000 − 14,575 − 16,000 = 59,425
  //   → 5.35%×31,690 (1,695.42) + 6.8%×27,735 (1,885.98) = $3,581.40
  check("MN 2024 single $90k incl. $20k SS → $3,581.40 (M1M 80% subtraction)",
    calculateStateTax(90000, "MN", "single", 2024, { taxableSocialSecurity: 20000 }), 3581.40);
  // MN below threshold (full): $80k AGI → base = 80,000 − 14,575 − 20,000
  //   = 45,425 → 5.35%×31,690 (1,695.42) + 6.8%×13,735 (934)... = 1,695.42
  //   + 933.98 = $2,629.40
  check("MN 2024 single $80k incl. $20k SS → $2,629.40 (full subtraction < $84,490)",
    calculateStateTax(80000, "MN", "single", 2024, { taxableSocialSecurity: 20000 }), 2629.40);
  // RI relational: age-70 filer below the limit excludes ALL SS; the same
  // income at age 50 doesn't. (Exact RI bracket math pinned elsewhere.)
  const ri70 = calculateStateTax(100000, "RI", "single", 2024, { taxableSocialSecurity: 25000, taxpayerAge: 70 });
  const ri50 = calculateStateTax(100000, "RI", "single", 2024, { taxableSocialSecurity: 25000, taxpayerAge: 50 });
  ok("RI 2024: FRA filer < $104,200 excludes SS (tax strictly lower than age-50)", ri70 < ri50 - 1);
  // RI 2025 limit $107,000: $105k qualifies, $108k does not (cliff).
  const riIn = calculateStateTax(105000, "RI", "single", 2025, { taxableSocialSecurity: 25000, taxpayerAge: 70 });
  const riOut = calculateStateTax(108000, "RI", "single", 2025, { taxableSocialSecurity: 25000, taxpayerAge: 70 });
  ok("RI 2025: $105k (< $107,000) excludes; $108k cliff does not", riIn < riOut - 1000 * 0.0375);
  // UT 2024 single $40k incl. $15k SS (≤ $45k threshold → full credit):
  //   tax = 40,000 × 4.55% = 1,820; credit = 15,000 × 4.55% = 682.50
  //   → $1,137.50
  check("UT 2024 single $40k incl. $15k SS → $1,137.50 (full SS credit)",
    calculateStateTax(40000, "UT", "single", 2024, { taxableSocialSecurity: 15000 }), 1137.50);
  // UT 2024 $50k (over $45k): credit = 682.50 − 2.5%×5,000 (125) = 557.50
  //   → tax = 2,275 − 557.50 = $1,717.50
  check("UT 2024 single $50k incl. $15k SS → $1,717.50 (credit phased 2.5¢/$)",
    calculateStateTax(50000, "UT", "single", 2024, { taxableSocialSecurity: 15000 }), 1717.50);
  // UT 2025 (SB 71: threshold $54k; rate 4.50%): $50k → full credit:
  //   tax = 2,250 − 675 = $1,575.00
  check("UT 2025 single $50k incl. $15k SS → $1,575.00 (SB 71 $54k threshold)",
    calculateStateTax(50000, "UT", "single", 2025, { taxableSocialSecurity: 15000 }), 1575.00);
}

// ════════════════════════════════════════════════════════════════════════════
// 14. PA Schedule SP — $250-step table, applied ONCE (T1.0e #2).
// PA-40 SP Eligibility Income Table 1 (72 P.S. §7304): unmarried 0-dep
// ≤$6,500 → 100%; −10 pts per $250; ≤$8,750 → 10%; above → 0%.
// ════════════════════════════════════════════════════════════════════════════
header("PA Schedule SP — $250 steps; gross tax + single application");
{
  check("PA SP single $7,000 → 80% (Table 1: ≤ $7,000 row)",
    calculatePaScheduleSpForgivenessPct({ eligibilityIncome: 7000, filingStatus: "single", dependentCount: 0 }), 0.80, 0.001);
  check("PA SP single $12,000 → 0% (past the $8,750 table top)",
    calculatePaScheduleSpForgivenessPct({ eligibilityIncome: 12000, filingStatus: "single", dependentCount: 0 }), 0, 0.001);
  check("PA SP married $15,250 → 10% (Table 2 last row)",
    calculatePaScheduleSpForgivenessPct({ eligibilityIncome: 15250, filingStatus: "married_filing_jointly", dependentCount: 0 }), 0.10, 0.001);
  // calculateStateTax returns the GROSS PA-40 line-12 tax — the inline
  // forgiveness was REMOVED (it double-applied with the Schedule SP credit
  // and leaked PA-source-only "eligibility income" onto the NR path).
  check("PA gross tax $7,000 single = $214.90 (no inline forgiveness)",
    calculateStateTax(7000, "PA", "single", 2024, { dependentCount: 0 }), 214.90);
  // NR-leak guard: a $300k-income NY resident with $10k PA wages owes the
  // full 3.07% — SP keys off TOTAL income, which the NR fallback can't see,
  // so it must NOT forgive. (H2 from the multistate audit.)
  const paNr = calculateMultiStateTax({
    residentState: "NY", federalAgi: 300000, filingStatus: "single", taxYear: 2024,
    perStateWages: [{ stateCode: "PA", wages: 10000 }, { stateCode: "NY", wages: 290000 }],
  }).nonresidentStateTaxes.find((e) => e.state === "PA");
  check("PA NR $10k wages @ $300k AGI → $307.00 (no SP leak on the NR path)",
    paNr?.tax ?? -1, 307.00);
}

// ════════════════════════════════════════════════════════════════════════════
// 15. MCTMT — NY Tax Law §801(b) (T1.0f #18): 0.60% of the ENTIRE Zone-1 net
// SE earnings once they exceed the threshold (cliff, not exclusion;
// tax.ny.gov "MCTMT individual definitions"). Threshold $50,000 TY2024/2025;
// the FY2025-26 budget (A3009) raises it to $150,000 for TY2026+.
// ════════════════════════════════════════════════════════════════════════════
header("MCTMT — entire-earnings base + TY2026 $150k threshold");
{
  const mc = (netSe: number, year: number) => calculateNycLocalTax({
    nysTaxableIncome: Math.max(0, netSe - 20000), federalAgi: netSe,
    filingStatus: "single", dependentCount: 0, taxYear: year, netSeEarnings: netSe,
  }).nycMctmt;
  check("MCTMT 2025 $150k SE → $900 (0.6% × entire $150,000)", mc(150000, 2025), 900.00);
  check("MCTMT 2024 $80k SE → $480 (0.6% × entire $80,000)", mc(80000, 2024), 480.00);
  check("MCTMT 2024 $50k SE → $0 (must EXCEED the threshold)", mc(50000, 2024), 0);
  check("MCTMT 2026 $100k SE → $0 (threshold now $150,000)", mc(100000, 2026), 0);
  check("MCTMT 2026 $150k SE → $0 (at, not over, the new threshold)", mc(150000, 2026), 0);
  check("MCTMT 2026 $200k SE → $1,200 (0.6% × entire $200,000)", mc(200000, 2026), 1200.00);
}

// ════════════════════════════════════════════════════════════════════════════
// 16. NYC school tax credit (IT-201 line 69 / Form NYC-210; T1.0f #22):
// $125 ONLY for MFJ/QSS; single, MFS, AND HoH get $63; income test is
// "$250,000 or less" (inclusive).
// ════════════════════════════════════════════════════════════════════════════
header("NYC school tax credit — HoH $63 + inclusive $250k boundary");
{
  const school = (fs: string, fagi: number) => calculateNycLocalTax({
    nysTaxableIncome: Math.max(0, fagi - 20000), federalAgi: fagi,
    filingStatus: fs, dependentCount: 1, taxYear: 2024,
  }).nycSchoolTaxCredit;
  check("NYC school credit HoH → $63 (NOT the $125 joint amount)", school("head_of_household", 100000), 63);
  check("NYC school credit MFJ → $125", school("married_filing_jointly", 100000), 125);
  check("NYC school credit single at exactly $250,000 → $63 ('or less' is inclusive)", school("single", 250000), 63);
  check("NYC school credit single $250,001 → $0", school("single", 250001), 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 17. Localities — Reading 3.6% (T1.0f #20), rateByYear refresh (T1.0f #25:
// Philadelphia 7/2025 cut, MD Dorchester 2025, IN Monroe 2025), the SS
// subtraction from state_taxable bases (T1.0f #19), and the Box-5
// qualifying-wage base (T1.0f #24).
// ════════════════════════════════════════════════════════════════════════════
header("Localities — Reading / rateByYear / SS subtraction / Box-5 base");
{
  const local = (p: Partial<Parameters<typeof calculateFlatRateLocalTax>[0]> & { localityCode: string; residentState: string }) =>
    calculateFlatRateLocalTax({
      federalAgi: 0, totalWages: 0, filingStatus: "single", taxYear: 2024,
      ...p,
    })?.netLocalTax ?? -1;
  // Reading resident EIT = 3.6% (readingpa.gov "2025 City of Reading Taxes &
  // Tax Rates"; Berks EIT Bureau — the prior 2.70% under-taxed 0.9pp).
  check("Reading, PA $50k wages → $1,800 (3.6% resident EIT)",
    local({ localityCode: "PA-READING", residentState: "PA", totalWages: 50000 }), 1800.00);
  // Philadelphia July-2025 cut: resident 3.75% → 3.74% (phila.gov DOR).
  check("Philadelphia $100k wages TY2024 → $3,750 (3.75%)",
    local({ localityCode: "PA-PHILADELPHIA", residentState: "PA", totalWages: 100000 }), 3750.00);
  check("Philadelphia $100k wages TY2025 → $3,740 (3.74% per 7/2025 cut)",
    local({ localityCode: "PA-PHILADELPHIA", residentState: "PA", totalWages: 100000, taxYear: 2025 }), 3740.00);
  // MD Dorchester 3.20% → 3.30% TY2025 (MD Comptroller local-rate table;
  // 2025 MD std ded $3,350): (80,000 − 3,350) × 3.3% = $2,529.45.
  check("MD Dorchester TY2025 $80k AGI → $2,529.45 (3.3% + HB 352 std ded)",
    local({ localityCode: "MD-DORCHESTER", residentState: "MD", federalAgi: 80000, taxYear: 2025 }), 2529.45);
  check("MD Dorchester TY2024 $80k AGI → $2,473.60 (3.2% × (80,000 − 2,700))",
    local({ localityCode: "MD-DORCHESTER", residentState: "MD", federalAgi: 80000 }), 2473.60);
  // IN Monroe 2.035% → 2.14% effective 1/1/2025 (IN DOR Departmental Notice
  // #1). IN locality base = federal AGI (IN std ded $0 — exemption sub-gap
  // documented): 50,000 × 2.14% = $1,070.
  check("IN Monroe TY2025 $50k AGI → $1,070.00 (2.14% per DN #1)",
    local({ localityCode: "IN-MONROE", residentState: "IN", federalAgi: 50000, taxYear: 2025 }), 1070.00);
  check("IN Monroe TY2024 $50k AGI → $1,017.50 (2.035%)",
    local({ localityCode: "IN-MONROE", residentState: "IN", federalAgi: 50000 }), 1017.50);
  // T1.0f #19 — MD county base excludes taxable SS (MD exempts SS; the county
  // tax piggybacks state taxable income): Montgomery 3.2%, AGI $80k incl.
  // $30k SS → (80,000 − 2,700 − 30,000) × 3.2% = $1,513.60 (was $2,473.60 —
  // a ~$960 retiree over-tax).
  check("MD Montgomery $80k AGI incl. $30k SS → $1,513.60 (SS excluded from base)",
    local({ localityCode: "MD-MONTGOMERY", residentState: "MD", federalAgi: 80000, taxableSocialSecurity: 30000 }), 1513.60);
  check("MD Montgomery $80k AGI no SS → $2,473.60 (control)",
    local({ localityCode: "MD-MONTGOMERY", residentState: "MD", federalAgi: 80000 }), 2473.60);
  // T1.0f #24 — OH municipal "qualifying wages" = W-2 Box 5 (ORC 718.01(R)):
  // $100k Medicare wages with $80k Box 1 (a $20k 401(k) deferral) → Columbus
  // 2.5% × 100,000 = $2,500 (Box-1-only base under-taxed $500).
  check("Columbus $80k Box-1 / $100k Box-5 → $2,500 (qualifying wages = Box 5)",
    local({ localityCode: "OH-COLUMBUS", residentState: "OH", totalWages: 80000, totalMedicareWages: 100000, federalAgi: 100000 }), 2500.00);
  check("Columbus $80k Box-1, no Box-5 supplied → $2,000 (fallback unchanged)",
    local({ localityCode: "OH-COLUMBUS", residentState: "OH", totalWages: 80000, federalAgi: 80000 }), 2000.00);
}

// ════════════════════════════════════════════════════════════════════════════
// 18. Resident credit for taxes paid to other states — PER-STATE limitation
// (T1.0f #23; CA Sch S / CO DR 0104CR / NY IT-112-R all limit per state):
// credit_i = min(NR tax_i, resident tax × source_i / AGI). Pooling let one
// state's excess absorb another's unused headroom ($1,804.75 over-credit in
// the audit repro, reproduced here exactly).
// ════════════════════════════════════════════════════════════════════════════
header("Resident credit — per-state limitation (CO + CA/AZ repro)");
{
  // CO resident 2024, AGI $200k = $100k CA wages + $100k AZ wages.
  //   CO resident tax (full) = (200,000 − 14,600) × 4.25% = $7,879.50
  //   CA NR (method a) = CA-as-resident(200k) × ½: CA tax on 194,460 taxable
  //     = 3,108.72 + 9.3%×123,854 (11,518.42) = 14,627.14 → × 0.5 = $7,313.57
  //   AZ NR (direct) = (100,000 − 14,600) × 2.5% = $2,135.00
  //   Per-state caps: CA min(7,313.57, 7,879.50×0.5 = 3,939.75) = 3,939.75;
  //   AZ min(2,135, 3,939.75) = 2,135 → credit = $6,074.75 (NOT the pooled
  //   min(9,448.57, 7,879.50) = 7,879.50).
  //   CO net = 7,879.50 − 6,074.75 = $1,804.75.
  const r = calculateMultiStateTax({
    residentState: "CO", federalAgi: 200000, filingStatus: "single", taxYear: 2024,
    perStateWages: [{ stateCode: "CA", wages: 100000 }, { stateCode: "AZ", wages: 100000 }],
  });
  check("CO/CA/AZ per-state credit = $6,074.75 (not the pooled $7,879.50)",
    r.residentCreditApplied, 6074.75);
  check("CO net resident tax = $1,804.75 after the per-state limitation",
    r.residentStateTax, 1804.75);
  check("CA NR = $7,313.57 (method a, ½ ratio)",
    r.nonresidentStateTaxes.find((e) => e.state === "CA")?.tax ?? -1, 7313.57);
  check("AZ NR = $2,135.00 (direct 2.5% on (100,000 − 14,600))",
    r.nonresidentStateTaxes.find((e) => e.state === "AZ")?.tax ?? -1, 2135.00);
}

// ════════════════════════════════════════════════════════════════════════════
// 19. AZ reciprocity (T1.0f #27) — AZ Form WEC (azdor.gov): residents of CA,
// IN, OR, VA are exempt from AZ tax on AZ wages. One-directional: an AZ
// resident working in CA is NOT exempt from CA tax.
// ════════════════════════════════════════════════════════════════════════════
header("AZ reciprocity — Form WEC (CA/IN/OR/VA residents)");
{
  const az = (resident: string) => calculateMultiStateTax({
    residentState: resident, federalAgi: 100000, filingStatus: "single", taxYear: 2024,
    perStateWages: [{ stateCode: "AZ", wages: 60000 }, { stateCode: resident, wages: 40000 }],
  }).nonresidentStateTaxes.find((e) => e.state === "AZ");
  for (const res of ["CA", "IN", "OR", "VA"]) {
    ok(`${res} resident with AZ wages → AZ NR $0 (Form WEC reciprocity)`,
      (az(res)?.tax ?? -1) === 0 && (az(res)?.reciprocityApplied ?? false));
  }
  // Reverse direction is NOT reciprocal: AZ resident with CA wages owes CA NR.
  const caNr = calculateMultiStateTax({
    residentState: "AZ", federalAgi: 100000, filingStatus: "single", taxYear: 2024,
    perStateWages: [{ stateCode: "CA", wages: 60000 }, { stateCode: "AZ", wages: 40000 }],
  }).nonresidentStateTaxes.find((e) => e.state === "CA");
  ok("AZ resident with CA wages → CA NR tax > 0 (one-directional)", (caNr?.tax ?? 0) > 1000);
}

// ════════════════════════════════════════════════════════════════════════════
// 20. Part-year — option dollar amounts pro-rated by residency days
// (T1.0f #26): the SS exclusion is granted ONCE across the move, not in full
// in BOTH periods. NC → CO mover, exactly half-year (2024 is a leap year;
// change 2024-07-02 → 183/183 days), AGI $100k, taxable SS $40k, age 70.
//   Each period: AGI 50,000; prorated SS 40,000 × ½ = 20,000.
//   NC std ded is NC's OWN $12,750 (NC is NOT federal-conforming) → prorated
//   $6,375:  NC = (50,000 − 6,375 − 20,000) × 4.5%  = 23,625 × 0.045
//              = $1,063.13
//   CO conforms to the federal $14,600 → prorated $7,300:
//            CO = (50,000 − 7,300 − 20,000) × 4.25% = 22,700 × 0.0425
//              = $964.75
//   Total = $2,027.88. (The old full-amount-in-both-periods bug produced
//   (50,000−6,375−40,000)×4.5% + (50,000−7,300−40,000)×4.25% = $277.88 —
//   the one-time exclusion taken ~twice.)
// ════════════════════════════════════════════════════════════════════════════
header("Part-year — SS exclusion pro-rated once across the move");
{
  const py = calculateMultiStateTax({
    residentState: "CO", federalAgi: 100000, filingStatus: "single", taxYear: 2024,
    perStateWages: [],
    partYearResidency: { formerState: "NC", residencyChangeDate: "2024-07-02" },
    options: { taxableSocialSecurity: 40000, taxpayerAge: 70 },
  });
  check("NC former-period tax = $1,063.13 (half AGI, half NC $12,750 std ded, HALF the SS)",
    py.partYearResidency?.formerStateTax ?? -1, 1063.13);
  check("CO current-period tax = $964.75", py.partYearResidency?.currentStateTax ?? -1, 964.75);
  check("Part-year total = $2,027.88 (exclusion granted exactly once)",
    py.totalStateTax, 2027.88);
}

// ════════════════════════════════════════════════════════════════════════════
// 21. calculateStateTaxWithBreakdown parity (T1.0e #17) — the breakdown
// surface now delegates to the same core as calculateStateTax, so exemptions,
// sliding deductions, SS exclusions, and credits can no longer diverge.
// ════════════════════════════════════════════════════════════════════════════
header("calculateStateTaxWithBreakdown — parity with calculateStateTax");
{
  const parity = (label: string, agi: number, st: string, fs: string, yr: number, opts?: Parameters<typeof calculateStateTax>[4]) =>
    check(`breakdown.total == calculateStateTax (${label})`,
      calculateStateTaxWithBreakdown(agi, st, fs, yr, opts).total,
      calculateStateTax(agi, st, fs, yr, opts), 0.001);
  parity("IL exemption", 100000, "IL", "single", 2024);
  parity("WI sliding std ded", 50000, "WI", "single", 2024);
  parity("KS SB 1 exemptions", 60000, "KS", "single", 2024);
  parity("VT SS phase", 55000, "VT", "single", 2024, { taxableSocialSecurity: 15000 });
  parity("UT SS credit", 40000, "UT", "single", 2024, { taxableSocialSecurity: 15000 });
  parity("PA gross (no SP inline)", 7000, "PA", "single", 2024, { dependentCount: 0 });
}

// ════════════════════════════════════════════════════════════════════════════
// 22. childrenUnder6 e2e (T1.0f/M4, migration 0021) — the pipeline now
// threads the client field into the under-6 state CTCs.
// NJ CTC (NJ-1040 line 67): a STEPPED per-child amount by NJ taxable income
// (R3-C10): ≤$30k→$1,000; ≤$40k→$800; ≤$50k→$600; ≤$60k→$400; ≤$70k→$300;
// ≤$80k→$200; else $0. (The old "$1,000/child full ≤$50k linear" rule was wrong.)
// ════════════════════════════════════════════════════════════════════════════
header("childrenUnder6 — e2e through computeTaxReturnPure (NJ CTC)");
{
  const r = computeTaxReturnPure({
    client: {
      filingStatus: "single", state: "NJ", taxYear: 2024,
      dependentsUnder17: 2, childrenUnder6: 2,
    },
    w2s: [{ taxYear: 2024, wagesBox1: 40000, stateCode: "NJ" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  } as Parameters<typeof computeTaxReturnPure>[0]);
  // $40k AGI lands in the >$30k–$40k band = $800/child × 2 = $1,600.
  check("NJ client, 2 children under 6, $40k → stateChildTaxCredit $1,600",
    (r as { stateChildTaxCredit: number }).stateChildTaxCredit, 1600.00);
  // Defensive cap: childrenUnder6 can never exceed dependentsUnder17.
  const r2 = computeTaxReturnPure({
    client: {
      filingStatus: "single", state: "NJ", taxYear: 2024,
      dependentsUnder17: 1, childrenUnder6: 5,
    },
    w2s: [{ taxYear: 2024, wagesBox1: 40000, stateCode: "NJ" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  } as Parameters<typeof computeTaxReturnPure>[0]);
  // $40k AGI → $800/child band; capped to 1 child → $800 × 1 = $800.
  check("childrenUnder6 capped at dependentsUnder17 (5 → 1 → $800)",
    (r2 as { stateChildTaxCredit: number }).stateChildTaxCredit, 800.00);
  // Default 0 → no under-6 credit (prior behavior preserved).
  const r3 = computeTaxReturnPure({
    client: { filingStatus: "single", state: "NJ", taxYear: 2024, dependentsUnder17: 2 },
    w2s: [{ taxYear: 2024, wagesBox1: 40000, stateCode: "NJ" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  } as Parameters<typeof computeTaxReturnPure>[0]);
  check("childrenUnder6 absent → NJ CTC $0 (backward compatible)",
    (r3 as { stateChildTaxCredit: number }).stateChildTaxCredit, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT
// ════════════════════════════════════════════════════════════════════════════
console.log("\n══════════════════════════════════════════════════════════════");
for (const f of failures) console.log(f);
console.log(`RESULTS: ${passed} passed, ${failed} failed  (T1.0e/f state + local)`);
if (failed > 0) process.exit(1);
