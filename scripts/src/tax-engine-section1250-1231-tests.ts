/**
 * T1.1a + T1.1b — Unrecaptured §1250 (25%), Collectibles (28%) & §1231/Form 4797
 * — hand-calc'd tests against the engine's `calculateFederalTaxWithCapitalGains`,
 * `computeForm4797`, and `computeTaxReturnPure`.
 *
 * Pure engine; no API required.
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-section1250-1231-tests.ts
 *
 * References:
 *   • IRC §1(h) — preferential rates; §1(h)(1)(E) unrecaptured §1250 (25% cap);
 *     §1(h)(1)(F)/(4)/(5) 28%-rate gain (collectibles + §1202).
 *   • IRS Schedule D Tax Worksheet (lines 1–47; T1.0(l) 2026-06-11: the §1250/
 *     28% layers INTERLEAVE — absorbed at ordinary rates up to the 24%-bracket
 *     top via line 21, consuming the 0% zone via line 14; 25%/28% only on the
 *     line-39/42 remainders; line-47 global min).
 *   • IRC §1231/§1245/§1250 + 2024 Form 4797 instructions; §1231(c) lookback.
 *   • 2024 single brackets (Rev. Proc. 2023-34): 10% to 11,600 / 12% to 47,150 /
 *     22% to 100,525 / 24% to 191,950 / 32% to 243,725 / 35% to 609,350 / 37%.
 *     2024 single LTCG breakpoints: 0% to 47,025 / 15% to 518,900 / 20% above.
 *     2024 single standard deduction: $14,600.
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { calculateFederalTaxWithCapitalGains, calculateAmt } from "../../artifacts/api-server/src/lib/taxCalculator";
import {
  computeForm4797,
  type BusinessPropertySaleFact,
} from "../../artifacts/api-server/src/lib/form4797";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 1): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

// ════════════════════════════════════════════════════════════════════════════
// PART 1 — Schedule D Tax Worksheet (calculateFederalTaxWithCapitalGains direct)
// ════════════════════════════════════════════════════════════════════════════

function wsTax(p: {
  ord: number; lt: number; qd?: number; st?: number;
  u1250?: number; c28?: number; status?: string; year?: number;
}) {
  return calculateFederalTaxWithCapitalGains({
    ordinaryTaxableIncome: p.ord,
    longTermGains: p.lt,
    qualifiedDividends: p.qd ?? 0,
    shortTermGains: p.st ?? 0,
    filingStatus: p.status ?? "single",
    taxYear: p.year ?? 2024,
    unrecaptured1250Gain: p.u1250 ?? 0,
    collectibles28Gain: p.c28 ?? 0,
  });
}

// W1 — Low-income §1250 = all-ordinary. ordinary $40k + §1250 $60k (taxable 100k).
//   Worksheet (T1.0(l)): l13=0 → l14=100,000; l20=min(100,000, min(l1,191,950))
//   =100,000; l21=max(40,000,100,000)=100,000 — the WHOLE §1250 absorbed at
//   ordinary rates (§1(h)(1)(A)(ii)); l35..l39: l38=60,000+100,000−100,000=60,000
//   → l39=0. l47=l44=tax(100,000)=17,053 (same value the old global-min gave).
//   pref piece = 17,053 − tax(40k)=4,568 → 12,485.
{
  const r = wsTax({ ord: 40000, lt: 60000, u1250: 60000 });
  check("W1 §1250 low-income total = ordinary rate", r.totalFederalTax, 17053);
  check("W1 §1250 low-income preferential piece", r.preferentialRateTax, 12485);
}

// W2 — High-income §1250: 25% cap BINDS (ordinary 35% > 25%). ordinary $500k + §1250 $100k.
//   ordinaryTax(500k)=145,374.75. §1250 stacks 500k→600k: ordTax(600k)−ordTax(500k)=35,000.
//   min(0.25·100k=25,000, 35,000)=25,000. total=145,374.75+25,000=170,374.75.
{
  const r = wsTax({ ord: 500000, lt: 100000, u1250: 100000 });
  check("W2 §1250 high-income total (25% cap binds)", r.totalFederalTax, 170374.75);
  check("W2 §1250 high-income preferential piece", r.preferentialRateTax, 25000);
}

// W3 — High-income collectibles: 28% cap BINDS. ordinary $500k + collectibles $100k.
//   min(0.28·100k=28,000, 35,000)=28,000. total=145,374.75+28,000=173,374.75.
{
  const r = wsTax({ ord: 500000, lt: 100000, c28: 100000 });
  check("W3 collectibles high-income total (28% cap binds)", r.totalFederalTax, 173374.75);
  check("W3 collectibles high-income preferential piece", r.preferentialRateTax, 28000);
}

// W4 — Mixed: ordinary $400k + regular LTCG $100k + §1250 $100k (LTCG total $200k).
//   ordinaryTax(400k)=110,374.75. regular LTCG 100k stacks 400k→500k @15%=15,000.
//   §1250 stacks 500k→600k: ordTax(600k)−ordTax(500k)=35,000 → min(25,000,35,000)=25,000.
//   total=110,374.75+15,000+25,000=150,374.75.
{
  const r = wsTax({ ord: 400000, lt: 200000, u1250: 100000 });
  check("W4 mixed regular+§1250 total", r.totalFederalTax, 150374.75);
  check("W4 mixed preferential piece (15k+25k)", r.preferentialRateTax, 40000);
}

// W5 — All three buckets, 37% bracket: ordinary $700k + LTCG $200k
//   (= $50k regular @20% + $100k §1250 @25% + $50k collectibles @28%).
//   ordinaryTax(700k)=217,187.75. pref=0.20·50k + 25,000 + 14,000 = 10,000+25,000+14,000=49,000.
//   total=217,187.75+49,000=266,187.75. (Benefit vs all-ordinary 291,187.75 = 25,000.)
{
  const r = wsTax({ ord: 700000, lt: 200000, u1250: 100000, c28: 50000 });
  check("W5 three-bucket total", r.totalFederalTax, 266187.75);
  check("W5 three-bucket preferential piece", r.preferentialRateTax, 49000);
}

// W6 — Schedule D Tax Worksheet INTERLEAVING (T1.0(l) adjudication 2026-06-11;
//   supersedes the 2026-06-08 flat-25% expectation of 6,000, which was proven
//   wrong by the line-by-line worksheet). ordinary $10k + ANCG $30k + §1250
//   $20k (lt 50k total). 2024 Sch D Tax Worksheet, single:
//     l1=60,000; l9=50,000; l10=50,000; l11=20,000; l12=20,000; l13=30,000
//     l14=60,000−30,000=30,000; l15=47,025; l16=min(60,000,47,025)=47,025
//     l17=min(30,000,47,025)=30,000; l18=60,000−50,000=10,000
//     l19=min(60,000,191,950)=60,000; l20=min(30,000,60,000)=30,000
//     l21=max(10,000,30,000)=30,000 ← the §1250 absorbed at ORDINARY 10/12%
//     l22=47,025−30,000=17,025 @0% ← the §1250 layer CONSUMED 0%-zone space
//     l23=30,000; l24=17,025; l25=12,975; l27=60,000; l28=47,025; l29=12,975
//     l30=12,975 @15% → l31=1,946.25; l32=30,000
//     l33=0; l35=20,000; l36=50,000+30,000=80,000; l38=80,000−60,000=20,000
//     l39=20,000−20,000=0 → l40=0 (§1250 fully absorbed into line 21)
//     l44=tax(30,000)=1,160+0.12·18,400=3,368; l45=1,946.25+3,368=5,314.25
//     l46=tax(60,000)=8,253 → l47=5,314.25.
//   pref piece = 5,314.25 − tax(10,000)=1,000 → 4,314.25.
{
  const r = wsTax({ ord: 10000, lt: 50000, u1250: 20000 });
  check("W6 worksheet interleave: §1250 absorbed at 10/12%, ANCG 0%-zone consumed", r.totalFederalTax, 5314.25);
  check("W6 preferential piece (wksht l47 − tax(ord))", r.preferentialRateTax, 4314.25);
}

// W8 — Schedule D Tax Worksheet (T1.0(l) adjudication 2026-06-11; supersedes
//   BOTH prior readings: the original per-layer-min 10,253 AND the 2026-06-08
//   flat-25% 12,168 — the worksheet interleaves instead). ordinary $20k +
//   ANCG $20k + §1250 $40k (lt 60k). 2024 Sch D Tax Worksheet, single:
//     l1=80,000; l9=60,000; l10=60,000; l11=40,000; l12=40,000; l13=20,000
//     l14=80,000−20,000=60,000; l16=min(80,000,47,025)=47,025
//     l17=min(60,000,47,025)=47,025; l18=80,000−60,000=20,000
//     l19=min(80,000,191,950)=80,000; l20=min(60,000,80,000)=60,000
//     l21=max(20,000,60,000)=60,000 ← §1250 absorbed at ORDINARY 12/22%
//     l22=47,025−47,025=0 @0%
//     l23=20,000; l24=0; l25=20,000; l27=80,000; l28=60,000; l29=20,000
//     l30=20,000 @15% → l31=3,000; l32=20,000
//     l33=0; l35=40,000; l36=60,000+60,000=120,000; l38=120,000−80,000=40,000
//     l39=40,000−40,000=0 → l40=0 (§1250 fully absorbed into line 21)
//     l44=tax(60,000)=8,253; l45=3,000+8,253=11,253
//     l46=tax(80,000)=12,653 → l47=11,253.
//   pref piece = 11,253 − tax(20,000)=2,168 → 9,085.
{
  const r = wsTax({ ord: 20000, lt: 60000, u1250: 40000 });
  check("W8 worksheet interleave on mid-income §1250 (not flat 25%)", r.totalFederalTax, 11253);
  check("W8 preferential piece (wksht l47 − tax(ord))", r.preferentialRateTax, 9085);
}

// W7 — Backward-compat: no special buckets → plain QDCGT worksheet.
//   ordinary $100k + LTCG $50k. ordinaryTax(100k)=17,053. LTCG 50k stacks 100k→150k @15%=7,500.
{
  const r = wsTax({ ord: 100000, lt: 50000 });
  check("W7 no special buckets = plain path total", r.totalFederalTax, 24553);
  check("W7 no special buckets preferential = 15%", r.preferentialRateTax, 7500);
}

// ════════════════════════════════════════════════════════════════════════════
// PART 2 — computeForm4797 (pure)
// ════════════════════════════════════════════════════════════════════════════

function sale(p: Partial<BusinessPropertySaleFact>): BusinessPropertySaleFact {
  return {
    taxYear: 2024,
    grossSalePrice: 0,
    costOrBasis: 0,
    depreciationAllowed: 0,
    assetClass: "section1245",
    ...p,
  };
}

// F1 — empty
{
  const r = computeForm4797([]);
  check("F1 empty ordinary", r.ordinaryComponent, 0);
  check("F1 empty LTCG", r.netSection1231LtcgGain, 0);
  check("F1 empty §1250", r.unrecaptured1250Gain, 0);
}

// F2 — §1245 fully depreciated equipment. sale 30k, cost 50k, depr 50k → adjBasis 0,
//   gain 30k; recapture min(30k,50k)=30k ordinary; §1231 gain 0.
{
  const r = computeForm4797([sale({ grossSalePrice: 30000, costOrBasis: 50000, depreciationAllowed: 50000, assetClass: "section1245" })]);
  check("F2 §1245 recapture ordinary", r.ordinaryComponent, 30000);
  check("F2 §1245 recapture amount", r.section1245OrdinaryRecapture, 30000);
  check("F2 §1245 no §1231 LTCG", r.netSection1231LtcgGain, 0);
}

// F3 — §1245 sold ABOVE original cost: sale 70k, cost 50k, depr 50k → adjBasis 0, gain 70k.
//   recapture=min(70k,50k)=50k ordinary; §1231 gain=20k (appreciation) → net §1231 gain 20k → LTCG.
{
  const r = computeForm4797([sale({ grossSalePrice: 70000, costOrBasis: 50000, depreciationAllowed: 50000, assetClass: "section1245" })]);
  check("F3 §1245 recapture capped at depreciation", r.section1245OrdinaryRecapture, 50000);
  check("F3 §1245 appreciation → §1231 LTCG", r.netSection1231LtcgGain, 20000);
  check("F3 §1245 ordinary = recapture only", r.ordinaryComponent, 50000);
}

// F4 — §1250 straight-line real property. sale 500k, cost 400k, depr 100k, addl 0 →
//   adjBasis 300k, gain 200k; ordinary recapture 0; unrecap §1250 = min(200k,100k)=100k;
//   §1231 gain 200k → LTCG 200k (of which 100k is 25% bucket).
{
  const r = computeForm4797([sale({ grossSalePrice: 500000, costOrBasis: 400000, depreciationAllowed: 100000, assetClass: "section1250", additionalDepreciation: 0 })]);
  check("F4 §1250 SL no ordinary recapture", r.section1250OrdinaryRecapture, 0);
  check("F4 §1250 net §1231 LTCG", r.netSection1231LtcgGain, 200000);
  check("F4 §1250 unrecaptured (25% bucket)", r.unrecaptured1250Gain, 100000);
  check("F4 §1250 ordinary component 0", r.ordinaryComponent, 0);
}

// F5 — §1250 with $20k accelerated (additional) depreciation. sale 500k, cost 400k,
//   depr 120k, addl 20k → adjBasis 280k, gain 220k; ordinary recapture min(220k,20k)=20k;
//   remaining 200k; SL depr=120k−20k=100k; unrecap=min(200k,100k)=100k; §1231 gain 200k.
{
  const r = computeForm4797([sale({ grossSalePrice: 500000, costOrBasis: 400000, depreciationAllowed: 120000, assetClass: "section1250", additionalDepreciation: 20000 })]);
  check("F5 §1250 additional-depr ordinary recapture", r.section1250OrdinaryRecapture, 20000);
  check("F5 §1250 ordinary component = recapture", r.ordinaryComponent, 20000);
  check("F5 §1250 net §1231 LTCG", r.netSection1231LtcgGain, 200000);
  check("F5 §1250 unrecaptured 25% bucket", r.unrecaptured1250Gain, 100000);
}

// F6 — §1231 net LOSS (land). sale 50k, cost 200k → loss 150k → fully ordinary (no $3k cap).
{
  const r = computeForm4797([sale({ grossSalePrice: 50000, costOrBasis: 200000, depreciationAllowed: 0, assetClass: "land" })]);
  check("F6 §1231 net loss → ordinary (signed)", r.ordinaryComponent, -150000);
  check("F6 §1231 net loss → no LTCG", r.netSection1231LtcgGain, 0);
  check("F6 §1231 loss gross", r.section1231LossGross, 150000);
}

// F7 — §1231(c) 5-year lookback. land gain 80k, lookback loss 30k →
//   30k recharacterized ordinary, 50k LTCG.
{
  const r = computeForm4797([sale({ grossSalePrice: 280000, costOrBasis: 200000, depreciationAllowed: 0, assetClass: "land" })], 30000);
  check("F7 lookback recapture", r.section1231LookbackRecapture, 30000);
  check("F7 lookback ordinary", r.ordinaryComponent, 30000);
  check("F7 lookback residual LTCG", r.netSection1231LtcgGain, 50000);
}

// F8 — Part II (held ≤ 1 year): all ordinary, no §1231/§1245 split.
//   §1245 equipment sale 30k, cost 20k, depr 5k → adjBasis 15k, gain 15k → ordinary.
{
  const r = computeForm4797([sale({ grossSalePrice: 30000, costOrBasis: 20000, depreciationAllowed: 5000, assetClass: "section1245", heldMoreThanOneYear: false })]);
  check("F8 short-term Part II ordinary", r.ordinaryComponent, 15000);
  check("F8 short-term Part II amount", r.partIIOrdinary, 15000);
  check("F8 short-term no LTCG", r.netSection1231LtcgGain, 0);
}

// F9 — mixed: §1245 recapture gain 30k + §1231 land loss 50k → ordinary = 30k − 50k = −20k.
{
  const r = computeForm4797([
    sale({ grossSalePrice: 30000, costOrBasis: 50000, depreciationAllowed: 50000, assetClass: "section1245" }),
    sale({ grossSalePrice: 50000, costOrBasis: 100000, depreciationAllowed: 0, assetClass: "land" }),
  ]);
  check("F9 recapture + §1231 loss ordinary", r.ordinaryComponent, -20000);
  check("F9 recapture preserved", r.section1245OrdinaryRecapture, 30000);
  check("F9 net §1231 (gain0 − loss50k)", r.netSection1231, -50000);
}

// F10 — §1250 building (unrecap 100k, §1231 gain 200k) + §1231 land loss 60k →
//   net §1231 = 140k gain → LTCG 140k; unrecap bounded to surviving LTCG = 100k.
{
  const r = computeForm4797([
    sale({ grossSalePrice: 500000, costOrBasis: 400000, depreciationAllowed: 100000, assetClass: "section1250", additionalDepreciation: 0 }),
    sale({ grossSalePrice: 40000, costOrBasis: 100000, depreciationAllowed: 0, assetClass: "land" }),
  ]);
  check("F10 net §1231 gain LTCG", r.netSection1231LtcgGain, 140000);
  check("F10 unrecaptured bounded by surviving LTCG", r.unrecaptured1250Gain, 100000);
  check("F10 ordinary 0", r.ordinaryComponent, 0);
}

// F11 — lookback EXCEEDS the gain: net §1231 gain 50k, lookback 80k → all 50k ordinary,
//   LTCG 0, §1250 bucket bounded to 0.
{
  const r = computeForm4797([sale({ grossSalePrice: 250000, costOrBasis: 200000, depreciationAllowed: 0, assetClass: "land" })], 80000);
  check("F11 lookback-exceeds ordinary", r.ordinaryComponent, 50000);
  check("F11 lookback-exceeds no LTCG", r.netSection1231LtcgGain, 0);
  check("F11 lookback recapture capped at gain", r.section1231LookbackRecapture, 50000);
}

// ════════════════════════════════════════════════════════════════════════════
// PART 3 — End-to-end via computeTaxReturnPure
// ════════════════════════════════════════════════════════════════════════════

function baseInputs(extra: Partial<TaxReturnInputs> = {}, wages = 700000): TaxReturnInputs {
  const client = {
    id: 1, firstName: "Test", lastName: "S1250",
    email: "test@example.com", phone: null,
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
    employerName: "Test Employer", employerEin: null,
    wagesBox1: String(wages), federalWithholdingBox2: "0",
    socialSecurityWagesBox3: "0", socialSecurityTaxBox4: "0",
    medicareWagesBox5: String(wages), medicareTaxBox6: "0",
    socialSecurityTipsBox7: "0", allocatedTipsBox8: "0",
    dependentCareBenefitsBox10: "0", nonqualifiedPlansBox11: "0",
    box12aCode: null, box12aAmount: "0", box12bCode: null, box12bAmount: "0",
    box12cCode: null, box12cAmount: "0", box12dCode: null, box12dAmount: "0",
    statutoryEmployeeBox13: false, retirementPlanBox13: false, thirdPartySickPayBox13: false,
    box14Description: null, box14Amount: "0",
    stateBox15: "FL", stateWagesBox16: String(wages), stateTaxBox17: "0",
    localWagesBox18: "0", localTaxBox19: "0", localityNameBox20: null,
    spouse: null, createdAt: new Date(), updatedAt: new Date(),
  };
  return {
    client: client as TaxReturnInputs["client"],
    w2s: [w2 as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [], adjustments: [], taxYear: 2024, ...extra,
  };
}

type CapTxn = NonNullable<TaxReturnInputs["capitalTransactions"]>[number];
function ltTxn(p: { proceeds: number; basis: number; gainClass?: string; u1250?: number }): CapTxn {
  return {
    taxYear: 2024, description: "lot", formBox: "F",
    proceeds: String(p.proceeds), costBasis: String(p.basis),
    gainClass: p.gainClass ?? null,
    unrecaptured1250Amount: p.u1250 != null ? String(p.u1250) : null,
  } as unknown as CapTxn;
}

function adj(type: string, amount: number): TaxReturnInputs["adjustments"][number] {
  return {
    id: Math.floor(Math.random() * 1e9), clientId: 1, adjustmentType: type,
    amount: String(amount), description: `test ${type}`, category: null,
    isApplied: true, createdAt: new Date(), updatedAt: new Date(),
  } as unknown as TaxReturnInputs["adjustments"][number];
}

// E1 — differential §1250 vs regular LTCG (W-2 $700k, LTCG $100k). 37% bracket.
//   Regular: 100k @20% = 20,000. §1250: min(25%·100k, 37%·100k)=25,000. Δ=5,000.
{
  const a = computeTaxReturnPure(baseInputs({ capitalTransactions: [ltTxn({ proceeds: 100000, basis: 0 })] }));
  const b = computeTaxReturnPure(baseInputs({ capitalTransactions: [ltTxn({ proceeds: 100000, basis: 0, gainClass: "section1250", u1250: 100000 })] }));
  check("E1 regular LTCG capitalGainsTax @20%", a.capitalGainsTax, 20000);
  check("E1 §1250 capitalGainsTax @25% cap", b.capitalGainsTax, 25000);
  check("E1 §1250 reported bucket", b.unrecapturedSection1250Gain, 100000);
  check("E1 AGI unchanged by character", b.adjustedGrossIncome, a.adjustedGrossIncome);
  check("E1 federal tax delta = (25-20)%·100k", b.federalTaxLiability - a.federalTaxLiability, 5000);
}

// E2 — differential collectibles 28% (W-2 $700k, LTCG $100k). Δ=(28-20)%·100k=8,000.
{
  const a = computeTaxReturnPure(baseInputs({ capitalTransactions: [ltTxn({ proceeds: 100000, basis: 0 })] }));
  const b = computeTaxReturnPure(baseInputs({ capitalTransactions: [ltTxn({ proceeds: 100000, basis: 0, gainClass: "collectible" })] }));
  check("E2 collectibles capitalGainsTax @28% cap", b.capitalGainsTax, 28000);
  check("E2 collectibles reported bucket", b.collectibles28RateGain, 100000);
  check("E2 federal tax delta = (28-20)%·100k", b.federalTaxLiability - a.federalTaxLiability, 8000);
}

// E3 — Form 4797 §1250 real property (sale 500k/cost 400k/depr 100k) vs plain $200k LTCG.
//   Plain: 200k @20% = 40,000. 4797: 100k regular @20% + 100k §1250 @25% = 45,000. Δ=5,000.
{
  const a = computeTaxReturnPure(baseInputs({ capitalTransactions: [ltTxn({ proceeds: 200000, basis: 0 })] }));
  const b = computeTaxReturnPure(baseInputs({
    form4797: [sale({ grossSalePrice: 500000, costOrBasis: 400000, depreciationAllowed: 100000, assetClass: "section1250", additionalDepreciation: 0 })],
  }));
  check("E3 plain LTCG capitalGainsTax", a.capitalGainsTax, 40000);
  check("E3 §1250 building capitalGainsTax", b.capitalGainsTax, 45000);
  check("E3 form4797 net §1231 LTCG", b.form4797!.netSection1231LtcgGain, 200000);
  check("E3 form4797 unrecaptured §1250", b.form4797!.unrecaptured1250Gain, 100000);
  check("E3 form4797 ordinary 0", b.form4797!.ordinaryComponent, 0);
  check("E3 AGI = wages + 200k §1231 gain", b.adjustedGrossIncome, a.adjustedGrossIncome);
  check("E3 federal tax delta = (25-20)%·100k", b.federalTaxLiability - a.federalTaxLiability, 5000);
}

// E4 — §1245 recapture → ORDINARY income (fully-depreciated equipment, sale 30k).
{
  const base = computeTaxReturnPure(baseInputs());
  const b = computeTaxReturnPure(baseInputs({
    form4797: [sale({ grossSalePrice: 30000, costOrBasis: 50000, depreciationAllowed: 50000, assetClass: "section1245" })],
  }));
  check("E4 §1245 ordinary component", b.form4797!.ordinaryComponent, 30000);
  check("E4 §1245 no LTCG", b.form4797!.netSection1231LtcgGain, 0);
  check("E4 §1245 AGI +30k ordinary", b.adjustedGrossIncome - base.adjustedGrossIncome, 30000);
  check("E4 §1245 no capital-gains tax", b.capitalGainsTax, 0);
}

// E5 — §1231 net LOSS is ORDINARY & FULLY deductible (NOT $3k-capped like a cap loss).
//   land sale 50k/cost 200k → loss 150k. AGI drops by the FULL 150k.
{
  const base = computeTaxReturnPure(baseInputs());
  const b = computeTaxReturnPure(baseInputs({
    form4797: [sale({ grossSalePrice: 50000, costOrBasis: 200000, depreciationAllowed: 0, assetClass: "land" })],
  }));
  check("E5 §1231 loss ordinary component", b.form4797!.ordinaryComponent, -150000);
  check("E5 §1231 loss fully deductible (AGI −150k, not −3k)", b.adjustedGrossIncome - base.adjustedGrossIncome, -150000);
}

// E6 — §1231(c) lookback via adjustment. land gain 80k + lookback 30k.
{
  const b = computeTaxReturnPure(baseInputs({
    form4797: [sale({ grossSalePrice: 280000, costOrBasis: 200000, depreciationAllowed: 0, assetClass: "land" })],
    adjustments: [adj("section_1231_lookback_loss", 30000)],
  }));
  check("E6 lookback recapture", b.form4797!.section1231LookbackRecapture, 30000);
  check("E6 lookback ordinary", b.form4797!.ordinaryComponent, 30000);
  check("E6 lookback residual LTCG", b.form4797!.netSection1231LtcgGain, 50000);
}

// E7 — low-income §1250 gets NO 0% benefit (W-2 $50k, gain $40k).
//   Regular LTCG: 11,625 @0% + 28,375 @15% = 4,256.25. §1250: ordinary 12/22% blend = 7,625.
{
  const a = computeTaxReturnPure(baseInputs({ capitalTransactions: [ltTxn({ proceeds: 40000, basis: 0 })] }, 50000));
  const b = computeTaxReturnPure(baseInputs({ capitalTransactions: [ltTxn({ proceeds: 40000, basis: 0, gainClass: "section1250", u1250: 40000 })] }, 50000));
  check("E7 low-income regular LTCG (0%+15%)", a.capitalGainsTax, 4256.25);
  check("E7 low-income §1250 at ordinary (no 0%)", b.capitalGainsTax, 7625);
  check("E7 low-income §1250 vs regular delta", b.federalTaxLiability - a.federalTaxLiability, 3368.75);
}

// E8 — regression: plain LTCG with no special tags → buckets 0, form4797 null.
{
  const r = computeTaxReturnPure(baseInputs({ capitalTransactions: [ltTxn({ proceeds: 100000, basis: 0 })] }));
  check("E8 no §1250 bucket", r.unrecapturedSection1250Gain, 0);
  check("E8 no 28% bucket", r.collectibles28RateGain, 0);
  check("E8 form4797 null when absent", r.form4797 === null ? 0 : 1, 0);
}

// E9 — REGRESSION (independent review 2026-06-08): loss-absorption ordering. A
//   capital loss erodes net LTCG below §1250+28%; the loss must clip the 28%
//   bucket FIRST (preserve §1250) per the IRS 28%-Rate-Gain + Unrecaptured-§1250
//   worksheets (Sched D lines 18/19) — taxpayer-favorable since 28% > 25%.
//   W-2 $700k + LT collectible $50k + LT §1250 $50k + ST loss $30k → net LTCG
//   $70k. §1250 preserved $50k; 28% clipped to the $20k remainder.
//   capGainsTax = 25%·50k + 28%·20k = 12,500 + 5,600 = 18,100. (The pre-fix
//   engine preserved 28% / clipped §1250 → 14,000+5,000 = 19,000, a $900 OVER-charge.)
{
  const stLoss = { taxYear: 2024, description: "st loss", formBox: "A", proceeds: "0", costBasis: "30000", gainClass: null, unrecaptured1250Amount: null } as unknown as CapTxn;
  const r = computeTaxReturnPure(baseInputs({ capitalTransactions: [
    ltTxn({ proceeds: 50000, basis: 0, gainClass: "collectible" }),
    ltTxn({ proceeds: 50000, basis: 0, gainClass: "section1250", u1250: 50000 }),
    stLoss,
  ] }));
  check("E9 §1250 preserved (loss clips 28% first)", r.unrecapturedSection1250Gain, 50000);
  check("E9 28% bucket clipped to remainder", r.collectibles28RateGain, 20000);
  check("E9 capGainsTax = 25%·50k + 28%·20k", r.capitalGainsTax, 18100);
}

// ════════════════════════════════════════════════════════════════════════════
// PART 4 — AMT Form 6251 Part III: §1250 at 25% / collectibles at 28%
//   (independent-review fix 2026-06-08: AMT was taxing them at 0/15/20%, under-
//   stating TMT — an asymmetry vs the sharpened regular-tax side.)
// ════════════════════════════════════════════════════════════════════════════

// AMT1 — single, taxableIncome $300k (incl. $100k §1250 LTCG), AMT prefs $100k.
//   amti=400k; exemption $85,700; amtBase=314,300. Path 2 ordinary 214,300 @26%
//   = 55,718; §1250 FLAT 25% × 100k = 25,000 → amtWithPreferential = 80,718.
//   Without the bucket the §1250 would get 15% (518,900 LTCG band) = 15,000 →
//   70,718. The bucket correctly adds (25−15)%·100k = $10,000 to the AMT.
{
  const base = { taxableIncome: 300000, amtPreferences: 100000, filingStatus: "single", regularTax: 0, taxYear: 2024, ltcgPlusQdiv: 100000 };
  const withBucket = calculateAmt({ ...base, unrecaptured1250Gain: 100000 });
  const without = calculateAmt({ ...base, unrecaptured1250Gain: 0 });
  check("AMT1 §1250 at FLAT 25% in Form 6251 Part III", withBucket.amtWithPreferentialRates, 80718);
  check("AMT1 without bucket → 0/15/20%", without.amtWithPreferentialRates, 70718);
  check("AMT1 §1250 bucket adds (25-15)%·100k", withBucket.amtWithPreferentialRates - without.amtWithPreferentialRates, 10000);
}
// AMT2 — same but $100k collectibles (28%): ltcgTax = 0.28·100k = 28,000 →
//   amtWithPreferential = 55,718 + 28,000 = 83,718 (adds (28-15)%·100k = 13,000).
{
  const withBucket = calculateAmt({ taxableIncome: 300000, amtPreferences: 100000, filingStatus: "single", regularTax: 0, taxYear: 2024, ltcgPlusQdiv: 100000, collectibles28Gain: 100000 });
  check("AMT2 collectibles at FLAT 28% in AMT", withBucket.amtWithPreferentialRates, 83718);
}

// ════════════════════════════════════════════════════════════════════════════
// PART 5 — §1231 gain NIIT exclusion for non-passive (materially-participated)
//   business dispositions (§1411(c)(1); independent-review fix 2026-06-08).
// ════════════════════════════════════════════════════════════════════════════

// N1 — W-2 $700k + a §1231 land gain $200k. NIIT (3.8%) on the gain unless the
//   disposition is flagged nonPassive (active trade/business → excluded from NII).
{
  const passive = computeTaxReturnPure(baseInputs({
    form4797: [sale({ grossSalePrice: 250000, costOrBasis: 50000, depreciationAllowed: 0, assetClass: "land" })],
  }));
  const active = computeTaxReturnPure(baseInputs({
    form4797: [sale({ grossSalePrice: 250000, costOrBasis: 50000, depreciationAllowed: 0, assetClass: "land", nonPassive: true })],
  }));
  check("N1 non-passive §1231 gain reported", active.form4797!.nonPassiveSection1231Gain, 200000);
  check("N1 passive §1231 gain stays in NIIT (not excluded)", passive.form4797!.nonPassiveSection1231Gain, 0);
  check("N1 non-passive exclusion drops NIIT by 3.8%·200k", passive.niitTax - active.niitTax, 7600);
  check("N1 §1231 gain still in AGI either way (only NIIT differs)", active.adjustedGrossIncome, passive.adjustedGrossIncome);
}

console.log(`\nT1.1 §1250 (25%) / Collectibles (28%) / §1231 Form 4797 tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) { FAIL.forEach((f) => console.log(`    ${f}`)); }
process.exit(FAIL.length > 0 ? 1 : 0);
