/**
 * C7 — §163(j) business interest limit + §461(l) excess business loss
 * addback — hand-calc'd tests.
 *
 * Pure engine; no API required.
 *
 * Reference: IRC §163(j) (post-TCJA 30%-of-ATI cap with indefinite
 * carryforward); IRC §461(l) (TCJA excess business loss limit, TY2024
 * thresholds $305k single / $610k MFJ).
 *
 * Engine model (MVP):
 *   §163(j):
 *     CPA enters 4 adjustments (any subset; defaults 0):
 *       - section_163j_business_interest_expense   gross expense
 *       - section_163j_business_interest_income    add to allowance
 *       - section_163j_carryforward_from_prior     stack on gross
 *       - section_163j_floor_plan_financing_interest  100% allowed (uncapped)
 *     Engine: ATI proxy ≈ pre-§163(j) ordinary income. Cap = 30% × ATI.
 *       allowed = min(gross + cf, cap) + bizIntIncome + floorPlan
 *       disallowed = (gross + cf) − cap-capped portion → carries forward indefinitely.
 *     Allowed deduction subtracted from ordinary income.
 *     CPA confirms: small-biz ≤$30M-gross-receipts exception not invoked;
 *     real-property-trade-or-business election not made.
 *
 *   §461(l):
 *     CPA enters section_461l_excess_loss_addback (positive amount).
 *     Engine adds to ordinary income (reversing the over-deduction).
 *     Disallowed loss carries forward as NOL next year — CPA uses
 *     `nol_carryforward` adjustment going forward.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-section163j-461l-tests.ts
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
    id: 1, firstName: "Test", lastName: "C7",
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
    employerName: "Co", employerEin: null,
    wagesBox1: "100000", federalWithholdingBox2: "15000",
    socialSecurityWagesBox3: "100000", socialSecurityTaxBox4: "6200",
    medicareWagesBox5: "100000", medicareTaxBox6: "1450",
    socialSecurityTipsBox7: "0", allocatedTipsBox8: "0",
    dependentCareBenefitsBox10: "0", nonqualifiedPlansBox11: "0",
    box12aCode: null, box12aAmount: "0", box12bCode: null, box12bAmount: "0",
    box12cCode: null, box12cAmount: "0", box12dCode: null, box12dAmount: "0",
    statutoryEmployeeBox13: false, retirementPlanBox13: false, thirdPartySickPayBox13: false,
    box14Description: null, box14Amount: "0",
    stateBox15: "FL", stateWagesBox16: "100000", stateTaxBox17: "0",
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

// ── Case 1: Baseline — no §163(j), no §461(l) — all zeros ─────────────────
{
  const r = computeTaxReturnPure(baseInputs());
  check("Case 1 §163(j) gross = 0", r.section163jBusinessInterestExpense, 0);
  check("Case 1 §163(j) allowed = 0", r.section163jAllowedDeduction, 0);
  check("Case 1 §163(j) disallowed cf = 0", r.section163jDisallowedCarryforward, 0);
  check("Case 1 §461(l) addback = 0", r.section461lExcessLossAddback, 0);
  check("Case 1 AGI = $100k W-2", r.adjustedGrossIncome, 100000);
}

// ── Case 2: §163(j) below 30% cap — full allowance ───────────────────────
// ATI proxy ≈ $100k W-2. Cap = 30% × $100k = $30k. Gross $10k. Allowed = $10k.
// Net AGI = $100k − $10k = $90k.
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [adj("section_163j_business_interest_expense", 10000, 3001)],
  }));
  check("Case 2 gross = $10k", r.section163jBusinessInterestExpense, 10000);
  check("Case 2 allowed = $10k (under cap)", r.section163jAllowedDeduction, 10000);
  check("Case 2 disallowed cf = $0", r.section163jDisallowedCarryforward, 0);
  check("Case 2 AGI = $100k − $10k deduction", r.adjustedGrossIncome, 90000);
}

// ── Case 3: §163(j) above 30% cap — partial allowance, cf created ────────
// ATI ≈ $100k. Cap = $30k. Gross $50k. Allowed = $30k. Disallowed = $20k.
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [adj("section_163j_business_interest_expense", 50000, 3002)],
  }));
  check("Case 3 allowed = $30k (capped)", r.section163jAllowedDeduction, 30000);
  check("Case 3 disallowed cf = $20k", r.section163jDisallowedCarryforward, 20000);
  check("Case 3 AGI = $100k − $30k allowed", r.adjustedGrossIncome, 70000);
}

// ── Case 4: Prior-year carryforward stacks on current gross ──────────────
// $5k carryforward + $10k current = $15k subject to cap.
// ATI ≈ $100k. Cap = $30k. min($15k, $30k) = $15k. Disallowed = $0.
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [
      adj("section_163j_business_interest_expense", 10000, 3003),
      adj("section_163j_carryforward_from_prior", 5000, 3004),
    ],
  }));
  check("Case 4 allowed = $15k (gross + cf, under cap)", r.section163jAllowedDeduction, 15000);
  check("Case 4 disallowed cf = $0", r.section163jDisallowedCarryforward, 0);
  check("Case 4 AGI = $100k − $15k", r.adjustedGrossIncome, 85000);
}

// ── Case 5: Biz interest income adds to allowance (uncapped) ─────────────
// Gross $20k + biz interest income $5k. Cap = $30k. min($20k, $30k) = $20k
// for cap-subject portion. Plus $5k biz int income added uncapped.
//   Total allowed = $20k + $5k = $25k. Disallowed = $0.
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [
      adj("section_163j_business_interest_expense", 20000, 3005),
      adj("section_163j_business_interest_income", 5000, 3006),
    ],
  }));
  check("Case 5 allowed = $25k (gross + biz int income)", r.section163jAllowedDeduction, 25000);
  check("Case 5 disallowed cf = $0", r.section163jDisallowedCarryforward, 0);
}

// ── Case 6: Floor plan financing — 100% allowed, uncapped ────────────────
// Gross $20k + floor plan $40k. ATI ≈ $30k → cap = $9k.
//   Cap-subject allowance = min($20k, $9k) = $9k. Disallowed cf = $11k.
//   Plus floor plan $40k always allowed.
//   Total allowed = $9k + $40k = $49k.
{
  // Smaller W-2 to get a smaller ATI so the cap binds.
  const inputs = baseInputs({
    w2s: [{
      ...baseInputs().w2s[0],
      wagesBox1: "30000", federalWithholdingBox2: "3000",
      socialSecurityWagesBox3: "30000", socialSecurityTaxBox4: "1860",
      medicareWagesBox5: "30000", medicareTaxBox6: "435",
      stateWagesBox16: "30000",
    } as unknown as TaxReturnInputs["w2s"][number]],
    adjustments: [
      adj("section_163j_business_interest_expense", 20000, 3007),
      adj("section_163j_floor_plan_financing_interest", 40000, 3008),
    ],
  });
  const r = computeTaxReturnPure(inputs);
  check("Case 6 allowed = $49k (9 cap + 40 floor)", r.section163jAllowedDeduction, 49000);
  check("Case 6 disallowed cf = $11k", r.section163jDisallowedCarryforward, 11000);
}

// ── Case 7: §461(l) addback alone ────────────────────────────────────────
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [adj("section_461l_excess_loss_addback", 50000, 3009)],
  }));
  check("Case 7 §461(l) addback = $50k", r.section461lExcessLossAddback, 50000);
  check("Case 7 AGI = $100k + $50k addback", r.adjustedGrossIncome, 150000);
}

// ── Case 8: Both §163(j) and §461(l) together ────────────────────────────
// §461(l) addback $50k (income +$50k). §163(j) gross $10k → allowed $10k
// (under cap). Income −$10k. Net AGI = $100k + $50k − $10k = $140k.
// Note: §461(l) addback IS in ATI proxy (so cap now bigger). ATI ≈
// $100k W-2 + $50k §461(l) addback = $150k. Cap = $45k. Allowed = $10k.
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [
      adj("section_461l_excess_loss_addback", 50000, 3010),
      adj("section_163j_business_interest_expense", 10000, 3011),
    ],
  }));
  check("Case 8 §461(l) addback = $50k", r.section461lExcessLossAddback, 50000);
  check("Case 8 §163(j) allowed = $10k (under bigger cap)", r.section163jAllowedDeduction, 10000);
  check("Case 8 AGI = $100k + $50k − $10k", r.adjustedGrossIncome, 140000);
}

// ── Case 9: §163(j) with ATI ≈ 0 — fully disallowed ───────────────────────
// ATI proxy: simulate near-zero income by setting W-2 wages near 0.
// (We can't set 0 because W-2 sums; use small $1k W-2.)
//   ATI ≈ $1k. Cap = $300. Gross $10k. Allowed (capped portion) = $300.
//   Disallowed = $9,700.
{
  const r = computeTaxReturnPure(baseInputs({
    w2s: [{
      ...baseInputs().w2s[0],
      wagesBox1: "1000", federalWithholdingBox2: "0",
      socialSecurityWagesBox3: "1000", socialSecurityTaxBox4: "62",
      medicareWagesBox5: "1000", medicareTaxBox6: "14.50",
      stateWagesBox16: "1000",
    } as unknown as TaxReturnInputs["w2s"][number]],
    adjustments: [adj("section_163j_business_interest_expense", 10000, 3012)],
  }));
  check("Case 9 allowed ≈ $300 (30% of $1k ATI)", r.section163jAllowedDeduction, 300);
  check("Case 9 disallowed cf ≈ $9,700", r.section163jDisallowedCarryforward, 9700);
}

// ── Case 10: Negative inputs — defensive floor at 0 ──────────────────────
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [
      adj("section_163j_business_interest_expense", -500, 3013),
      adj("section_461l_excess_loss_addback", -1000, 3014),
    ],
  }));
  check("Case 10 §163(j) gross floors at 0", r.section163jBusinessInterestExpense, 0);
  check("Case 10 §163(j) allowed = 0", r.section163jAllowedDeduction, 0);
  check("Case 10 §461(l) floors at 0", r.section461lExcessLossAddback, 0);
  check("Case 10 AGI unaffected", r.adjustedGrossIncome, 100000);
}

// ── Case 11: Floor plan with $0 gross — only floor plan allowed ──────────
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [adj("section_163j_floor_plan_financing_interest", 25000, 3015)],
  }));
  check("Case 11 gross = 0", r.section163jBusinessInterestExpense, 0);
  check("Case 11 allowed = $25k (all floor plan)", r.section163jAllowedDeduction, 25000);
  check("Case 11 disallowed cf = 0 (no capped portion)", r.section163jDisallowedCarryforward, 0);
  check("Case 11 AGI = $100k − $25k", r.adjustedGrossIncome, 75000);
}

// ── Case 12: §163(j) full disallowance — biz interest income only allowance ─
// Gross $50k, ATI $0 (no W-2 income), biz int income $5k.
//   Capped portion: gross $50k, cap = $0 → allowed (capped) = $0. Disallowed = $50k.
//   Plus biz int income $5k.
//   Total allowed = $5k.
{
  const r = computeTaxReturnPure(baseInputs({
    w2s: [{
      ...baseInputs().w2s[0],
      wagesBox1: "0", federalWithholdingBox2: "0",
      socialSecurityWagesBox3: "0", socialSecurityTaxBox4: "0",
      medicareWagesBox5: "0", medicareTaxBox6: "0",
      stateWagesBox16: "0",
    } as unknown as TaxReturnInputs["w2s"][number]],
    adjustments: [
      adj("section_163j_business_interest_expense", 50000, 3016),
      adj("section_163j_business_interest_income", 5000, 3017),
    ],
  }));
  check("Case 12 allowed = $5k (only biz int income)", r.section163jAllowedDeduction, 5000);
  check("Case 12 disallowed cf = $50k", r.section163jDisallowedCarryforward, 50000);
}

console.log(`\n§163(j) + §461(l) (C7) tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) FAIL.forEach((f) => console.log(`    ${f}`));
process.exit(FAIL.length > 0 ? 1 : 0);
