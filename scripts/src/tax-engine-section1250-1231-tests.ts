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
 *   • IRS Schedule D Tax Worksheet (stacks ordinary → 0/15/20 → 25% → 28%).
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
import { calculateFederalTaxWithCapitalGains } from "../../artifacts/api-server/src/lib/taxCalculator";
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

// W1 — Low-income §1250: 25% is a CAP, so the gain is taxed at the ORDINARY rate
// (22% top) since that is below 25%. ordinary $40k + §1250 $60k.
//   ordinaryTax(40k)=1,160+0.12·28,400=4,568.
//   §1250 stacks 40k→100k at ordinary: ordTax(100k)−ordTax(40k)=17,053−4,568=12,485.
//   min(0.25·60k=15,000, 12,485)=12,485. total=4,568+12,485=17,053 (= all-ordinary).
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

// W6 — 0%-bracket PRESERVATION + FLAT 25% on §1250. ordinary $10k + regular
//   LTCG $30k + §1250 $20k. The regular 30k stacks 10k→40k entirely under the
//   0% breakpoint (47,025) → $0 (the §1250 does NOT steal the regular gain's
//   0% bracket). The §1250 is taxed at a FLAT 25% (NOT the 12/22% bracket it
//   physically occupies): 0.25·20k = 5,000. The global floor ord(60k)−ord(10k)
//   = 8,253−1,000 = 7,253 is SLACK, so it does not reduce the flat result.
//   total = 1,000(ord 10k) + 0 + 5,000 = 6,000.
{
  const r = wsTax({ ord: 10000, lt: 50000, u1250: 20000 });
  check("W6 0%-bracket preserved; §1250 at FLAT 25% (not its 12/22% bracket)", r.totalFederalTax, 6000);
  check("W6 preferential piece = flat 25% §1250", r.preferentialRateTax, 5000);
}

// W8 — REGRESSION (independent review 2026-06-08): the per-layer-min bug. A
//   regular gain pushes the §1250 layer into a sub-25% ordinary bracket while
//   the global floor is SLACK. ordinary $20k + regular LTCG $20k + §1250 $40k.
//   The OLD per-layer min wrongly taxed §1250 at its 12/22% blend ($8,085 →
//   total $10,253); the IRS worksheet (IRC §1(h)(1)(E)) taxes it FLAT 25%.
//   ord(20k)=2,168. tax015: reg 20k stacks 20k→40k @0% = 0. §1250 flat = 0.25·40k
//   = 10,000. global floor ord(80k)−ord(20k)=12,653−2,168=10,485 (slack).
//   total = 2,168 + 10,000 = 12,168.
{
  const r = wsTax({ ord: 20000, lt: 60000, u1250: 40000 });
  check("W8 flat 25% (not per-layer marginal) on mid-income §1250", r.totalFederalTax, 12168);
  check("W8 §1250 flat 25% piece", r.preferentialRateTax, 10000);
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

console.log(`\nT1.1 §1250 (25%) / Collectibles (28%) / §1231 Form 4797 tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) { FAIL.forEach((f) => console.log(`    ${f}`)); }
process.exit(FAIL.length > 0 ? 1 : 0);
