/**
 * T1.0(l) — §1(h) Schedule D Tax Worksheet adjudication (2026-06-11).
 *
 * Every expected value below is a BY-HAND completion of the IRS Schedule D Tax
 * Worksheet (2024 Schedule D instructions, lines 1–47; 2025 values per Rev.
 * Proc. 2024-40 where marked). The full worksheet fill is in each case's
 * comment — these tests pin the engine to the official worksheet, NOT to any
 * model of it. Adjudication verdict: audit finding FC-1 CONFIRMED — the
 * special-rate layers (unrecaptured §1250 / 28%-rate gain) INTERLEAVE with the
 * ordinary brackets (worksheet lines 14, 19–21, 28, 35–43), superseding the
 * 2026-06-08 "flat 25%/28% + global-min only" reading.
 *
 * 2024 single ordinary anchors (Rev. Proc. 2023-34): 10% ≤ 11,600 / 12% ≤
 * 47,150 (tax 5,426) / 22% ≤ 100,525 (17,168.50) / 24% ≤ 191,950 (39,110.50) /
 * 32% ≤ 243,725 (55,678.50) / 35% ≤ 609,350 (183,647.25) / 37%.
 * 2024 single LTCG breakpoints: 0% ≤ 47,025 / 15% ≤ 518,900.
 * Worksheet line 19 ("maximum amount taxed below 25%") 2024: $191,950 single /
 * $383,900 MFJ. Std deduction 2024 single: $14,600.
 *
 * Pure engine; no API. Run:
 *   pnpm --filter @workspace/scripts exec tsx src/tax-engine-t10l-sched-d-worksheet-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  calculateFederalTaxWithCapitalGains,
  calculateAmt,
} from "../../artifacts/api-server/src/lib/taxCalculator";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, actual: number, expected: number, tol = 0.01): void {
  if (Math.abs(actual - expected) <= tol) passed++;
  else {
    failed++;
    failures.push(`✗ ${label}: expected ${expected}, got ${actual}`);
  }
}

function wsTax(p: {
  ord: number; lt: number; qd?: number; u1250?: number; c28?: number;
  status?: string; year?: number; feie?: number;
}) {
  return calculateFederalTaxWithCapitalGains({
    ordinaryTaxableIncome: p.ord,
    longTermGains: p.lt,
    qualifiedDividends: p.qd ?? 0,
    shortTermGains: 0,
    filingStatus: p.status ?? "single",
    taxYear: p.year ?? 2024,
    unrecaptured1250Gain: p.u1250 ?? 0,
    collectibles28Gain: p.c28 ?? 0,
    feieExclusion: p.feie ?? 0,
  });
}

// ── SD-A — FC-1 repro case A (the UNDER-TAX direction): ordinary 20,000 +
// §1250 25,000 + ANCG 30,000 (lt 55,000). Worksheet, single 2024:
//   l1=75,000  l2–l6=0  l7=l9=55,000  l10=55,000  l11=25,000  l12=25,000
//   l13=30,000  l14=75,000−30,000=45,000  l15=47,025  l16=min(75,000,47,025)=47,025
//   l17=min(45,000,47,025)=45,000  l18=75,000−55,000=20,000
//   l19=min(75,000,191,950)=75,000  l20=min(45,000,75,000)=45,000
//   l21=max(20,000,45,000)=45,000 ← §1250 pulled into the 12% bracket
//   l22=47,025−45,000=2,025 @0% ← §1250 consumed the rest of the 0% zone
//   (l1≠l16) l23=min(75,000,30,000)=30,000  l24=2,025  l25=27,975
//   l26=518,900  l27=75,000  l28=45,000+2,025=47,025  l29=27,975
//   l30=27,975 @15% → l31=4,196.25  l32=30,000
//   (l1≠l32) l33=30,000−30,000=0  l34=0
//   (SchD19≠0) l35=min(55,000,25,000)=25,000  l36=55,000+45,000=100,000
//   l37=75,000  l38=25,000  l39=25,000−25,000=0 → l40=0
//   (SchD18=0 → skip 41–43)
//   l44=tax(45,000)=1,160+0.12·33,400=5,168  l45=4,196.25+5,168=9,364.25
//   l46=tax(75,000)=5,426+0.22·27,850=11,553  l47=min=9,364.25.
// (The pre-fix engine gave 8,864.25 — a $500.00 UNDER-tax.)
{
  const r = wsTax({ ord: 20000, lt: 55000, u1250: 25000 });
  check("SD-A worksheet l47 total", r.totalFederalTax, 9364.25);
  check("SD-A preferential piece (l47 − tax(20,000)=2,168)", r.preferentialRateTax, 7196.25);
}

// ── SD-B — FC-1 repro case B (zero ordinary income): §1250 40,000 + ANCG
// 10,000 (lt 50,000). Worksheet, single 2024:
//   l1=50,000  l9=l10=50,000  l11=40,000  l12=40,000  l13=10,000
//   l14=50,000−10,000=40,000  l16=min(50,000,47,025)=47,025
//   l17=min(40,000,47,025)=40,000  l18=50,000−50,000=0
//   l19=min(50,000,191,950)=50,000  l20=min(40,000,50,000)=40,000
//   l21=max(0,40,000)=40,000 ← the §1250 IS the ordinary-rate base (10/12%)
//   l22=47,025−40,000=7,025 @0%
//   (l1≠l16) l23=10,000  l24=7,025  l25=2,975  l27=50,000  l28=47,025
//   l29=2,975  l30=2,975 @15% → l31=446.25  l32=10,000
//   (l1≠l32) l33=0  l34=0
//   (SchD19≠0) l35=min(50,000,40,000)=40,000  l36=50,000+40,000=90,000
//   l37=50,000  l38=40,000  l39=0 → l40=0
//   l44=tax(40,000)=1,160+0.12·28,400=4,568  l45=446.25+4,568=5,014.25
//   l46=tax(50,000)=5,426+0.22·2,850=6,053  l47=5,014.25.
// (The pre-fix engine gave 6,053.00 — a $1,038.75 OVER-tax.)
{
  const r = wsTax({ ord: 0, lt: 50000, u1250: 40000 });
  check("SD-B worksheet l47 total", r.totalFederalTax, 5014.25);
  check("SD-B preferential piece (ordinary = 0)", r.preferentialRateTax, 5014.25);
}

// ── SD-C — FC-1 repro case C (PARTIAL absorption to the 24%-bracket top):
// ordinary 100,000 + §1250 300,000 + ANCG 200,000 (lt 500,000).
//   l1=600,000  l9=l10=500,000  l11=300,000  l12=300,000  l13=200,000
//   l14=600,000−200,000=400,000  l16=min(600,000,47,025)=47,025  l17=47,025
//   l18=600,000−500,000=100,000  l19=min(600,000,191,950)=191,950
//   l20=min(400,000,191,950)=191,950  l21=max(100,000,191,950)=191,950
//     ← 91,950 of the §1250 absorbed at 22/24% (below 25%); the rest stays 25%
//   l22=47,025−47,025=0
//   (l1≠l16) l23=min(600,000,200,000)=200,000  l24=0  l25=200,000
//   l27=min(600,000,518,900)=518,900  l28=191,950+0=191,950
//   l29=518,900−191,950=326,950  l30=min(200,000,326,950)=200,000
//   l31=30,000  l32=200,000
//   (l1≠l32) l33=200,000−200,000=0  l34=0
//   (SchD19≠0) l35=min(500,000,300,000)=300,000  l36=500,000+191,950=691,950
//   l37=600,000  l38=91,950  l39=300,000−91,950=208,050  l40=52,012.50
//   l44=tax(191,950)=39,110.50  l45=30,000+52,012.50+39,110.50=121,123
//   l46=tax(600,000)=55,678.50+0.35·356,275=180,374.75  l47=121,123.00.
//   Cross-check: absorption saves tax(191,950)−tax(100,000)=22,057.50 vs
//   25%·91,950=22,987.50 → $930 (the pre-fix engine's exact over-tax).
{
  const r = wsTax({ ord: 100000, lt: 500000, u1250: 300000 });
  check("SD-C worksheet l47 total", r.totalFederalTax, 121123.00);
  check("SD-C preferential piece (l47 − tax(100,000)=17,053)", r.preferentialRateTax, 104070.00);
}

// ── SD-X — FC-1 extra repro ("W-2 earner sells a depreciated rental"):
// ordinary 60,000 + §1250 50,000 + ANCG 40,000 (lt 90,000).
//   l1=150,000  l9=l10=90,000  l11=50,000  l12=50,000  l13=40,000
//   l14=150,000−40,000=110,000  l16=47,025  l17=47,025
//   l18=150,000−90,000=60,000  l19=min(150,000,191,950)=150,000
//   l20=min(110,000,150,000)=110,000  l21=max(60,000,110,000)=110,000
//   l22=0
//   (l1≠l16) l23=min(150,000,40,000)=40,000  l24=0  l25=40,000
//   l27=150,000  l28=110,000  l29=40,000  l30=40,000  l31=6,000  l32=40,000
//   (l1≠l32) l33=0  l34=0
//   (SchD19≠0) l35=min(90,000,50,000)=50,000  l36=90,000+110,000=200,000
//   l37=150,000  l38=50,000  l39=0 → l40=0 (§1250 fully absorbed at 22/24%)
//   l44=tax(110,000)=17,168.50+0.24·9,475=19,442.50  l45=6,000+19,442.50=25,442.50
//   l46=tax(150,000)=17,168.50+0.24·49,475=29,042.50  l47=25,442.50.
// (Pre-fix engine: 26,753.00 — a $1,310.50 OVER-tax on the bread-and-butter case.)
{
  const r = wsTax({ ord: 60000, lt: 90000, u1250: 50000 });
  check("SD-X worksheet l47 total", r.totalFederalTax, 25442.50);
  check("SD-X preferential piece (l47 − tax(60,000)=8,253)", r.preferentialRateTax, 17189.50);
  // The exported worksheet lines (consumed by Form 6251 Part III):
  check("SD-X worksheet line 10 (total preferential)", r.schedDWorksheet?.line10 ?? -1, 90000);
  check("SD-X worksheet line 13 (ANCG)", r.schedDWorksheet?.line13 ?? -1, 40000);
  check("SD-X worksheet line 14 (taxable − ANCG)", r.schedDWorksheet?.line14 ?? -1, 110000);
  check("SD-X worksheet line 21 (§1(h)(1)(A) ordinary base)", r.schedDWorksheet?.line21 ?? -1, 110000);
}

// ── SD-E — 28%-rate gain interleaves too (lines 41–43 residual): ordinary
// 30,000 + collectibles 40,000 + ANCG 10,000 (lt 50,000).
//   l1=80,000  l9=l10=50,000  l11=40,000  l12=40,000  l13=10,000
//   l14=80,000−10,000=70,000  l16=47,025  l17=47,025  l18=80,000−50,000=30,000
//   l19=min(80,000,191,950)=80,000  l20=min(70,000,80,000)=70,000
//   l21=max(30,000,70,000)=70,000 ← collectibles absorbed at 12/22%
//   l22=0
//   (l1≠l16) l23=10,000  l24=0  l25=10,000  l27=80,000  l28=70,000  l29=10,000
//   l30=10,000 @15% → l31=1,500  l32=10,000
//   (l1≠l32) l33=0  l34=0   (SchD19=0 → skip 35–40, l39=0)
//   (SchD18≠0) l41=70,000+0+10,000+0+0=80,000  l42=80,000−80,000=0  l43=0
//   l44=tax(70,000)=5,426+0.22·22,850=10,453  l45=1,500+10,453=11,953
//   l46=tax(80,000)=12,653  l47=11,953.
// (Pre-fix engine: min(3,368 + 0 + 0.28·40,000, tax(80k)) → 12,653 — $700 over.)
{
  const r = wsTax({ ord: 30000, lt: 50000, c28: 40000 });
  check("SD-E 28% gain absorbed at ordinary rates (l42 residual = 0)", r.totalFederalTax, 11953);
  check("SD-E preferential piece (l47 − tax(30,000)=3,368)", r.preferentialRateTax, 8585);
}

// ── SD-F — both buckets + QDIV (QDIV rides in the ANCG, line 13): ordinary
// 20,000 + lt 30,000 (§1250 10,000 + collectibles 10,000 + plain 10,000) +
// QDIV 15,000 → ANCG = 10,000 + 15,000 = 25,000.
//   l1=65,000  l2=l6=15,000  l9=30,000  l10=45,000  l11=20,000
//   l12=min(30,000,20,000)=20,000  l13=25,000  l14=65,000−25,000=40,000
//   l16=min(65,000,47,025)=47,025  l17=min(40,000,47,025)=40,000
//   l18=65,000−45,000=20,000  l19=min(65,000,191,950)=65,000
//   l20=min(40,000,65,000)=40,000  l21=max(20,000,40,000)=40,000
//   l22=47,025−40,000=7,025 @0%
//   (l1≠l16) l23=min(65,000,25,000)=25,000  l24=7,025  l25=17,975
//   l27=65,000  l28=40,000+7,025=47,025  l29=17,975  l30=17,975 @15%
//   → l31=2,696.25  l32=25,000
//   (l1≠l32) l33=0  l34=0
//   (SchD19≠0) l35=min(30,000,10,000)=10,000  l36=45,000+40,000=85,000
//   l37=65,000  l38=20,000  l39=max(0,10,000−20,000)=0  l40=0
//   (SchD18≠0) l41=40,000+7,025+17,975+0+0=65,000  l42=0  l43=0
//   l44=tax(40,000)=4,568  l45=2,696.25+4,568=7,264.25
//   l46=tax(65,000)=5,426+0.22·17,850=9,353  l47=7,264.25.
{
  const r = wsTax({ ord: 20000, lt: 30000, qd: 15000, u1250: 10000, c28: 10000 });
  check("SD-F both buckets + QDIV total", r.totalFederalTax, 7264.25);
  check("SD-F preferential piece (l47 − tax(20,000)=2,168)", r.preferentialRateTax, 5096.25);
}

// ── SD-G — MFJ (status-indexed lines 15/19/26: 94,050 / 383,900 / 583,750):
// ordinary 40,000 + §1250 50,000 + ANCG 30,000 (lt 80,000). MFJ 2024 ordinary:
// 10% ≤ 23,200 (2,320) / 12% ≤ 94,300 (10,852) / 22% ≤ 201,050.
//   l1=120,000  l9=l10=80,000  l11=50,000  l12=50,000  l13=30,000
//   l14=120,000−30,000=90,000  l15=94,050  l16=min(120,000,94,050)=94,050
//   l17=min(90,000,94,050)=90,000  l18=120,000−80,000=40,000
//   l19=min(120,000,383,900)=120,000  l20=min(90,000,120,000)=90,000
//   l21=max(40,000,90,000)=90,000  l22=94,050−90,000=4,050 @0%
//   (l1≠l16) l23=min(120,000,30,000)=30,000  l24=4,050  l25=25,950
//   l27=min(120,000,583,750)=120,000  l28=90,000+4,050=94,050  l29=25,950
//   l30=25,950 @15% → l31=3,892.50  l32=30,000
//   (l1≠l32) l33=0  l34=0
//   (SchD19≠0) l35=min(80,000,50,000)=50,000  l36=80,000+90,000=170,000
//   l37=120,000  l38=50,000  l39=0  l40=0
//   l44=tax_mfj(90,000)=2,320+0.12·66,800=10,336  l45=3,892.50+10,336=14,228.50
//   l46=tax_mfj(120,000)=10,852+0.22·25,700=16,506  l47=14,228.50.
{
  const r = wsTax({ ord: 40000, lt: 80000, u1250: 50000, status: "married_filing_jointly" });
  check("SD-G MFJ worksheet l47 total", r.totalFederalTax, 14228.50);
  check("SD-G MFJ preferential piece (l47 − tax_mfj(40,000)=4,336)", r.preferentialRateTax, 9892.50);
}

// ── SD-H — HIGH-INCOME EXACTNESS (the regime where the old flat model was
// already right — pins zero regression): ordinary 250,000 (> the 191,950
// line-19 amount) + §1250 60,000 + ANCG 40,000 (lt 100,000).
//   l1=350,000  l13=40,000  l14=310,000  l16=47,025  l17=47,025  l18=250,000
//   l19=min(350,000,191,950)=191,950  l20=min(310,000,191,950)=191,950
//   l21=max(250,000,191,950)=250,000 ← ordinary income wins; NO absorption
//   l22=0
//   (l1≠l16) l23=40,000  l24=0  l25=40,000  l27=min(350,000,518,900)=350,000
//   l28=250,000  l29=100,000  l30=40,000 @15% → l31=6,000  l32=40,000
//   (l1≠l32) l33=0  l34=0
//   (SchD19≠0) l35=60,000  l36=100,000+250,000=350,000  l37=350,000  l38=0
//   l39=60,000 → l40=15,000 (the FULL §1250 at 25% — flat-equivalent here)
//   l44=tax(250,000)=55,678.50+0.35·6,275=57,874.75
//   l45=6,000+15,000+57,874.75=78,874.75  l46=tax(350,000)=92,874.75
//   l47=78,874.75 — IDENTICAL to the old flat-25% model's value.
{
  const r = wsTax({ ord: 250000, lt: 100000, u1250: 60000 });
  check("SD-H high-income total (= old flat model; no regression)", r.totalFederalTax, 78874.75);
  check("SD-H preferential piece 6,000 + 15,000", r.preferentialRateTax, 21000);
}

// ── SD-I — the "lines 1 and 16 are the same" SKIP GATE (taxable ≤ 0% top):
// ordinary 5,000 + §1250 10,000 + ANCG 15,000 (lt 25,000).
//   l1=30,000  l9=l10=25,000  l11=10,000  l12=10,000  l13=15,000
//   l14=30,000−15,000=15,000  l16=min(30,000,47,025)=30,000 = l1 → SKIP 23–43
//   l17=min(15,000,30,000)=15,000  l18=30,000−25,000=5,000
//   l19=min(30,000,191,950)=30,000  l20=min(15,000,30,000)=15,000
//   l21=max(5,000,15,000)=15,000  l22=30,000−15,000=15,000 @0%
//   l44=tax(15,000)=1,160+0.12·3,400=1,568  l45=1,568
//   l46=tax(30,000)=3,368  l47=1,568.
//   (§1250 taxed at 10/12% inside line 21; the ANCG rides the 0% zone.)
{
  const r = wsTax({ ord: 5000, lt: 25000, u1250: 10000 });
  check("SD-I skip-gate (l1=l16): tax = l44 only", r.totalFederalTax, 1568);
  check("SD-I preferential piece (l47 − tax(5,000)=500)", r.preferentialRateTax, 1068);
}

// ── SD-J — DEDUCTION OVERHANG (signed ordinary < 0): ordinaryTaxableIncome
// −5,000 + lt 30,000 (§1250 10,000, ANCG 20,000). Taxable = 25,000; the
// engine passes line 1 = 25,000 with the FULL Schedule D line amounts:
//   l1=25,000  l9=l10=30,000  l11=10,000  l12=10,000  l13=20,000
//   l14=max(0,25,000−20,000)=5,000  l16=min(25,000,47,025)=25,000 = l1 → SKIP 23–43
//   l17=min(5,000,25,000)=5,000  l18=max(0,25,000−30,000)=0
//   l19=min(25,000,191,950)=25,000  l20=min(5,000,25,000)=5,000
//   l21=max(0,5,000)=5,000  l22=25,000−5,000=20,000 @0%
//   l44=tax(5,000)=500  l45=500  l46=tax(25,000)=2,768  l47=500.
//   (The overhang erodes the §1250 layer FIRST — down to the 5,000 taxed at
//   10% inside line 21 — while the full ANCG keeps the 0% zone, exactly the
//   worksheet's lines 12–14 geometry.)
{
  const r = wsTax({ ord: -5000, lt: 30000, u1250: 10000 });
  check("SD-J deduction overhang via worksheet lines 12–14", r.totalFederalTax, 500);
}

// ── SD-K — TY2025 year-indexed lines (Rev. Proc. 2024-40: 0% top 48,350;
// line 19 = 197,300; brackets 10% ≤ 11,925 / 12% ≤ 48,475): ordinary 10,000 +
// §1250 30,000 + ANCG 10,000 (lt 40,000).
//   l1=50,000  l13=10,000  l14=40,000  l15=48,350  l16=min(50,000,48,350)=48,350
//   l17=min(40,000,48,350)=40,000  l18=50,000−40,000=10,000
//   l19=min(50,000,197,300)=50,000  l20=min(40,000,50,000)=40,000
//   l21=max(10,000,40,000)=40,000  l22=48,350−40,000=8,350 @0%
//   (l1≠l16) l23=10,000  l24=8,350  l25=1,650  l27=min(50,000,533,400)=50,000
//   l28=40,000+8,350=48,350  l29=1,650  l30=1,650 @15% → l31=247.50  l32=10,000
//   (l1≠l32) l33=0  l34=0
//   (SchD19≠0) l35=min(40,000,30,000)=30,000  l36=40,000+40,000=80,000
//   l37=50,000  l38=30,000  l39=0  l40=0
//   l44=tax25(40,000)=1,192.50+0.12·28,075=4,561.50  l45=247.50+4,561.50=4,809
//   l46=tax25(50,000)=1,192.50+0.12·36,550+0.22·1,525=5,914  l47=4,809.
{
  const r = wsTax({ ord: 10000, lt: 40000, u1250: 30000, year: 2025 });
  check("SD-K TY2025 worksheet l47 total", r.totalFederalTax, 4809);
  check("SD-K TY2025 preferential piece (l47 − tax25(10,000)=1,000)", r.preferentialRateTax, 3809);
}

// ── SD-O — FEIE modification (Foreign Earned Income Tax Worksheet: complete
// the Sch D Tax Worksheet with line 1 = taxable + FEIE, subtract tax(FEIE)):
// ordinary 50,000 + FEIE 30,000 + §1250 20,000 + ANCG 10,000 (lt 30,000).
//   Inflated l1=50,000+30,000+30,000=110,000.  l9=l10=30,000  l11=20,000
//   l12=20,000  l13=10,000  l14=110,000−10,000=100,000  l16=47,025  l17=47,025
//   l18=110,000−30,000=80,000  l19=min(110,000,191,950)=110,000
//   l20=min(100,000,110,000)=100,000  l21=max(80,000,100,000)=100,000  l22=0
//   (l1≠l16) l23=10,000  l24=0  l25=10,000  l27=110,000  l28=100,000  l29=10,000
//   l30=10,000 @15% → l31=1,500  l32=10,000
//   (l1≠l32) l33=0  l34=0
//   (SchD19≠0) l35=20,000  l36=30,000+100,000=130,000  l37=110,000  l38=20,000
//   l39=0  l40=0
//   l44=tax(100,000)=17,053  l45=1,500+17,053=18,553  l46=tax(110,000)=19,442.50
//   l47=18,553.  FEIE wksht: 18,553 − tax(30,000)=3,368 → 15,185.
//   Decomposition: ordinaryTax (K9 stacking) = tax(80,000)−tax(30,000)=9,285;
//   pref piece = 15,185 − 9,285 = 5,900 (= §1250 absorbed at 22%: 4,400 + 1,500).
{
  const r = wsTax({ ord: 50000, lt: 30000, u1250: 20000, feie: 30000 });
  check("SD-O FEIE-modified worksheet total", r.totalFederalTax, 15185);
  check("SD-O FEIE preferential piece", r.preferentialRateTax, 5900);
}

// ── SD-L — END-TO-END (computeTaxReturnPure): single FL, W-2 wages 74,600 →
// taxable ordinary 60,000 after the 14,600 std deduction; capital transactions
// plain LT 40,000 + §1250-classed LT 50,000 = the SD-X worksheet exactly.
// Income tax = 25,442.50 (worksheet l47); no SE/NIIT/credits on this profile.
{
  const client = {
    id: 1, firstName: "T", lastName: "SDW", email: "t@example.com", phone: null,
    filingStatus: "single", state: "FL", taxYear: 2024,
    dependentsUnder17: 0, otherDependents: 0, dependentsForCareCredit: 0,
    taxpayerAge: 45, spouseAge: null, spouseEarnedIncome: null,
    hsaIsFamilyCoverage: false, iraCoveredByWorkplacePlan: false,
    eligibleEducatorCount: 0, acaAnnualPremium: null, acaAnnualSlcsp: null,
    acaAdvanceAptc: null, acaHouseholdSize: null,
    rentalActiveParticipant: true, rentalRealEstateProfessional: false,
    localityCode: null, socialSecurityBenefits: null,
    mfsLivedApartAllYear: false, isKiddieTaxFiler: false,
    parentsTopMarginalRate: null, priorYearItemized: null,
    residencyChangedInYear: false, formerState: null, residencyChangeDate: null,
    notes: null, createdAt: new Date(), updatedAt: new Date(),
  };
  const w2 = {
    id: 1, clientId: 1, taxYear: 2024, documentId: null,
    employerName: "E", employerEin: null,
    wagesBox1: "74600", federalWithholdingBox2: "0",
    socialSecurityWagesBox3: "0", socialSecurityTaxBox4: "0",
    medicareWagesBox5: "74600", medicareTaxBox6: "0",
    socialSecurityTipsBox7: "0", allocatedTipsBox8: "0",
    dependentCareBenefitsBox10: "0", nonqualifiedPlansBox11: "0",
    box12aCode: null, box12aAmount: "0", box12bCode: null, box12bAmount: "0",
    box12cCode: null, box12cAmount: "0", box12dCode: null, box12dAmount: "0",
    statutoryEmployeeBox13: false, retirementPlanBox13: false, thirdPartySickPayBox13: false,
    box14Description: null, box14Amount: "0",
    stateBox15: "FL", stateWagesBox16: "74600", stateTaxBox17: "0",
    localWagesBox18: "0", localTaxBox19: "0", localityNameBox20: null,
    spouse: null, createdAt: new Date(), updatedAt: new Date(),
  };
  type CapTxn = NonNullable<TaxReturnInputs["capitalTransactions"]>[number];
  const txns = [
    { taxYear: 2024, description: "plain LT", formBox: "F", proceeds: "40000", costBasis: "0", gainClass: null, unrecaptured1250Amount: null },
    { taxYear: 2024, description: "rental bldg", formBox: "F", proceeds: "50000", costBasis: "0", gainClass: "section1250", unrecaptured1250Amount: "50000" },
  ] as unknown as CapTxn[];
  const inputs = {
    client, w2s: [w2], form1099s: [], adjustments: [],
    capitalTransactions: txns, taxYear: 2024,
  } as unknown as TaxReturnInputs;
  const r = computeTaxReturnPure(inputs);
  check("SD-L e2e federal income tax = worksheet l47", r.federalTaxLiability, 25442.50);
  check("SD-L e2e capitalGainsTax = preferential piece", r.capitalGainsTax, 17189.50);
  check("SD-L e2e §1250 bucket reported", r.unrecapturedSection1250Gain, 50000);
}

// ── SD-M — Form 6251 Part III FAITHFUL MIRROR (lines 12–40, 2024 form), fed
// by the regular worksheet's lines (the SD-X return's: l10=90,000 l13=40,000
// l14=110,000 l21=110,000). taxableIncome 150,000 + prefs 14,600 (std-ded
// addback) → AMTI 164,600; exemption 85,700 → l12 = amtBase = 78,900.
//   l13=40,000  l14(§1250 in base)=min(50,000,78,900)=50,000
//   l15=min(40,000+50,000, 90,000)=90,000  l16=min(78,900,90,000)=78,900
//   l17=0 → l18=0
//   l19=47,025  l20=wksht l14=110,000  l21=max(0,47,025−110,000)=0
//   l22=min(78,900,40,000)=40,000  l23=min(0,40,000)=0 @0%  l24=40,000
//   l25=518,900  l26=0  l27=wksht l21=110,000  l28=110,000
//   l29=518,900−110,000=408,900  l30=min(40,000,408,900)=40,000 @15%
//   → l31=6,000  l32=40,000
//   (l12≠l32) l33=40,000−40,000=0  l34=0
//   (l14≠0) l35=0+40,000+0=40,000  l36=78,900−40,000=38,900  l37=25%·38,900=9,725
//   l38=0+6,000+0+9,725=15,725  l39=26%·78,900=20,514  l40=min=15,725.
{
  const r = calculateAmt({
    taxableIncome: 150000, amtPreferences: 14600, filingStatus: "single",
    regularTax: 0, taxYear: 2024, ltcgPlusQdiv: 90000,
    unrecaptured1250Gain: 50000, collectibles28Gain: 0,
    schedDWorksheet: { line10: 90000, line13: 40000, line14: 110000, line21: 110000 },
  });
  check("SD-M Form 6251 Part III faithful (l40)", r.amtWithPreferentialRates, 15725);
}

// ── SD-N — AMT BACKWARD-COMPAT: the same call WITHOUT schedDWorksheet keeps
// the prior simplified path: ordinaryPortion = 78,900−78,900 = 0 → 0;
// gNormal = 78,900−50,000 = 28,900 stacked at 0 (all ≤ 47,025 → 0%) = 0;
// + 25%·50,000 = 12,500.
{
  const r = calculateAmt({
    taxableIncome: 150000, amtPreferences: 14600, filingStatus: "single",
    regularTax: 0, taxYear: 2024, ltcgPlusQdiv: 90000,
    unrecaptured1250Gain: 50000, collectibles28Gain: 0,
  });
  check("SD-N AMT without worksheet lines = prior simplified path", r.amtWithPreferentialRates, 12500);
}

console.log(`\nT1.0(l) Schedule D Tax Worksheet adjudication tests:`);
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length) failures.forEach((f) => console.log(`  ${f}`));
process.exit(failed > 0 ? 1 : 0);
