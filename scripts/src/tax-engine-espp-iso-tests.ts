/**
 * C6 — ESPP + ISO disqualifying disposition — hand-calc'd tests.
 *
 * Pure engine; no API required.
 *
 * Reference: IRC §421(b)/§422 (ISO), §423 (ESPP); Pub 525; IRS Notice
 * 2002-47 (no FICA on disqualifying ISO); Rev Rul 71-52 (no FICA on
 * §423 ESPP disqualifying).
 *
 * Engine model (MVP):
 *   - iso_disqualifying_disposition_ordinary: aggregated ordinary-income
 *     recharacterization for all ISO sales failing the dual 2yr-from-
 *     grant + 1yr-from-exercise holding tests this year.
 *     CPA computes: min(FMV-at-exercise, sale-price) − strike  per grant.
 *   - espp_disqualifying_disposition_ordinary: aggregated for §423 ESPP
 *     sales failing the dual 2yr-from-grant + 1yr-from-purchase tests.
 *     CPA computes: FMV-at-purchase − purchase-price  per share.
 *   - Both flow to ordinary income → AGI.
 *   - Neither is FICA-taxed.
 *   - Capital-gain side (sale price − FMV-at-exercise/purchase) is the
 *     CPA's responsibility via 1099-B / capital-transactions (with
 *     basis-adjustment code "B" to avoid double-tax).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-espp-iso-tests.ts
 */
import { computeTaxReturnPure } from "../../artifacts/api-server/src/lib/taxReturnEngine";
import type { TaxReturnInputs } from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 1): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

function baseInputs(extra: Partial<TaxReturnInputs> = {}): TaxReturnInputs {
  const client = {
    id: 1, firstName: "Test", lastName: "EsppIso",
    email: "test@example.com", phone: null,
    filingStatus: "single", state: "FL", taxYear: 2024,
    dependentsUnder17: 0, otherDependents: 0, dependentsForCareCredit: 0,
    taxpayerAge: 40, spouseAge: null, spouseEarnedIncome: null,
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
    employerName: "Tech Co", employerEin: null,
    wagesBox1: "80000", federalWithholdingBox2: "10000",
    socialSecurityWagesBox3: "80000", socialSecurityTaxBox4: "4960",
    medicareWagesBox5: "80000", medicareTaxBox6: "1160",
    socialSecurityTipsBox7: "0", allocatedTipsBox8: "0",
    dependentCareBenefitsBox10: "0", nonqualifiedPlansBox11: "0",
    box12aCode: null, box12aAmount: "0", box12bCode: null, box12bAmount: "0",
    box12cCode: null, box12cAmount: "0", box12dCode: null, box12dAmount: "0",
    statutoryEmployeeBox13: false, retirementPlanBox13: false, thirdPartySickPayBox13: false,
    box14Description: null, box14Amount: "0",
    stateBox15: "FL", stateWagesBox16: "80000", stateTaxBox17: "0",
    localWagesBox18: "0", localTaxBox19: "0", localityNameBox20: null,
    spouse: null, createdAt: new Date(), updatedAt: new Date(),
  };
  return {
    client: client as TaxReturnInputs["client"],
    w2s: [w2 as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
    ...extra,
  };
}

function adj(type: string, amount: number, id = Math.floor(Math.random() * 1e9)): TaxReturnInputs["adjustments"][number] {
  return {
    id, clientId: 1, adjustmentType: type, amount: String(amount),
    description: `test ${type}`, category: null, isApplied: true,
    createdAt: new Date(), updatedAt: new Date(),
  } as unknown as TaxReturnInputs["adjustments"][number];
}

// ── Case 1: No ESPP/ISO — zero baseline ──────────────────────────────────
{
  const r = computeTaxReturnPure(baseInputs());
  check("Case 1 baseline ISO disqualifying = 0", r.isoDisqualifyingDispositionOrdinary, 0);
  check("Case 1 baseline ESPP disqualifying = 0", r.esppDisqualifyingDispositionOrdinary, 0);
  check("Case 1 baseline AGI = $80k W-2 only", r.adjustedGrossIncome, 80000);
}

// ── Case 2: ISO disqualifying disposition alone ──────────────────────────
// Hand-calc example: ISO exercised at $60 strike when FMV=$100; sold same
// year at $110. Disqualifying. Per-share comp = min($100, $110) − $60 = $40.
// 100 shares → $4,000 comp income to add. Cap gain ($110-$100 = $10/sh =
// $1,000) is the CPA's separate Sched D entry.
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [adj("iso_disqualifying_disposition_ordinary", 4000, 2001)],
  }));
  check("Case 2 ISO disqualifying comp = $4k", r.isoDisqualifyingDispositionOrdinary, 4000);
  check("Case 2 ESPP unchanged = 0", r.esppDisqualifyingDispositionOrdinary, 0);
  check("Case 2 AGI = $80k W-2 + $4k ISO comp", r.adjustedGrossIncome, 84000);
}

// ── Case 3: ESPP disqualifying disposition alone ─────────────────────────
// Hand-calc: §423 ESPP, $100 FMV at purchase, $85 purchase price (15%
// discount). 200 shares → $15/sh × 200 = $3,000 comp. Disqualifying sale
// → comp = $3,000.
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [adj("espp_disqualifying_disposition_ordinary", 3000, 2002)],
  }));
  check("Case 3 ESPP disqualifying comp = $3k", r.esppDisqualifyingDispositionOrdinary, 3000);
  check("Case 3 ISO unchanged = 0", r.isoDisqualifyingDispositionOrdinary, 0);
  check("Case 3 AGI = $80k + $3k", r.adjustedGrossIncome, 83000);
}

// ── Case 4: Both ISO + ESPP in same year ────────────────────────────────
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [
      adj("iso_disqualifying_disposition_ordinary", 12000, 2003),
      adj("espp_disqualifying_disposition_ordinary", 3000, 2004),
    ],
  }));
  check("Case 4 ISO = $12k", r.isoDisqualifyingDispositionOrdinary, 12000);
  check("Case 4 ESPP = $3k", r.esppDisqualifyingDispositionOrdinary, 3000);
  check("Case 4 AGI = $80k + $12k + $3k = $95k", r.adjustedGrossIncome, 95000);
}

// ── Case 5: Multiple adjustments per type aggregate ──────────────────────
// Two separate ISO grants disqualified — $10k + $20k = $30k total.
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [
      adj("iso_disqualifying_disposition_ordinary", 10000, 2005),
      adj("iso_disqualifying_disposition_ordinary", 20000, 2006),
    ],
  }));
  check("Case 5 aggregated ISO = $30k", r.isoDisqualifyingDispositionOrdinary, 30000);
  check("Case 5 AGI = $80k + $30k", r.adjustedGrossIncome, 110000);
}

// ── Case 6: Negative input — defensive floor at 0 ───────────────────────
// Per §422(c)(2), if FMV-at-exercise < sale price < strike (rare scenario
// where the stock crashed below strike before sale), comp income = 0
// not negative. CPA-side hand-calc, but engine defends.
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [adj("iso_disqualifying_disposition_ordinary", -5000, 2007)],
  }));
  check("Case 6 negative ISO floors at 0", r.isoDisqualifyingDispositionOrdinary, 0);
  check("Case 6 AGI unchanged from baseline", r.adjustedGrossIncome, 80000);
}

// ── Case 7: ISO comp doesn't add to NIIT (no investment income) ─────────
// Even at $300k W-2 + $50k ISO comp (well above NIIT threshold), the ISO
// comp itself is wages-like ordinary income, not investment income. NIIT
// should remain $0 (no qualifying investment income present).
{
  const inputs = baseInputs({
    w2s: [{
      ...baseInputs().w2s[0],
      wagesBox1: "300000",
      federalWithholdingBox2: "60000",
      socialSecurityWagesBox3: "168600", socialSecurityTaxBox4: "10453.20",
      medicareWagesBox5: "300000", medicareTaxBox6: "4350",
      stateWagesBox16: "300000",
    } as unknown as TaxReturnInputs["w2s"][number]],
    adjustments: [adj("iso_disqualifying_disposition_ordinary", 50000, 2008)],
  });
  const r = computeTaxReturnPure(inputs);
  check("Case 7 ISO comp = $50k", r.isoDisqualifyingDispositionOrdinary, 50000);
  check("Case 7 AGI = $300k + $50k", r.adjustedGrossIncome, 350000);
  check("Case 7 NIIT = 0 (comp not investment income)", r.niitTax, 0);
}

// ── Case 8: ISO comp doesn't trigger Additional Medicare on its own ─────
// Additional Medicare (Form 8959) is on Medicare wages (Box 5) + SE
// earnings above filing-status threshold. ISO comp ENTERS via an
// adjustment to ordinary income (not Box 5), so it does NOT push the
// Medicare-wage base over the $200k single threshold by itself.
//
// Hand-calc: $150k Box 5 wages + $80k ISO disq = $230k AGI. Box 5
// alone is $150k (below $200k threshold). Additional Medicare = $0.
{
  const inputs = baseInputs({
    w2s: [{
      ...baseInputs().w2s[0],
      wagesBox1: "150000", federalWithholdingBox2: "25000",
      socialSecurityWagesBox3: "150000", socialSecurityTaxBox4: "9300",
      medicareWagesBox5: "150000", medicareTaxBox6: "2175",
      stateWagesBox16: "150000",
    } as unknown as TaxReturnInputs["w2s"][number]],
    adjustments: [adj("iso_disqualifying_disposition_ordinary", 80000, 2009)],
  });
  const r = computeTaxReturnPure(inputs);
  check("Case 8 AGI = $150k + $80k", r.adjustedGrossIncome, 230000);
  check("Case 8 Additional Medicare = 0 (Box 5 wages below $200k)", r.additionalMedicareTax, 0);
}

// ── Case 9: Both ISO + ESPP increase tax through bracket ─────────────────
// $80k W-2 + $30k ISO + $5k ESPP = $115k AGI. Single TY2024 std ded $14,600.
// Taxable = $115k - $14,600 = $100,400. Bracket: 22% up to $100,525 → barely
// under that boundary, so all $100,400 is in lowest 3 brackets.
//   10% on $11,600 = $1,160
//   12% on (47,150 - 11,600) = $35,550 × 0.12 = $4,266
//   22% on (100,400 - 47,150) = $53,250 × 0.22 = $11,715
//   Total = $1,160 + $4,266 + $11,715 = $17,141
// (Hand-calc'd against IRS 2024 single brackets.)
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [
      adj("iso_disqualifying_disposition_ordinary", 30000, 2010),
      adj("espp_disqualifying_disposition_ordinary", 5000, 2011),
    ],
  }));
  check("Case 9 AGI = $115k", r.adjustedGrossIncome, 115000);
  check("Case 9 taxable = $100,400", r.taxableIncome, 100400);
  // Tolerance ±$2 for rounding.
  check("Case 9 federal tax = ~$17,141 (hand-calc'd brackets)", r.federalTaxLiability, 17141, 2);
}

// ── Case 10: ISO + ESPP self-stacking — distinct buckets ─────────────────
// Engine tracks them separately so reporting/CPA-overlay differentiates
// the two stock-comp types.
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [
      adj("iso_disqualifying_disposition_ordinary", 17500, 2012),
      adj("espp_disqualifying_disposition_ordinary", 17500, 2013),
    ],
  }));
  check("Case 10 ISO and ESPP each = $17,500 (no cross-bucket bleed)",
    r.isoDisqualifyingDispositionOrdinary + r.esppDisqualifyingDispositionOrdinary, 35000);
  check("Case 10 ISO bucket = $17,500", r.isoDisqualifyingDispositionOrdinary, 17500);
  check("Case 10 ESPP bucket = $17,500", r.esppDisqualifyingDispositionOrdinary, 17500);
}

console.log(`\nESPP + ISO disqualifying disposition (C6) tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) FAIL.forEach((f) => console.log(`    ${f}`));
process.exit(FAIL.length > 0 ? 1 : 0);
