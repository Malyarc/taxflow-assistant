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
// POST C3 ATI refinement (2026-05-27 PM):
// ATI = $100k W-2 − $14,600 single std ded = $85,400. Cap = 30% × $85,400 = $25,620.
// Gross $50k. Allowed = $25,620. Disallowed = $50,000 − $25,620 = $24,380.
// AGI = $100k − $25,620 = $74,380.
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [adj("section_163j_business_interest_expense", 50000, 3002)],
  }));
  check("Case 3 allowed = $25,620 (capped at 30% × ATI=$85,400)", r.section163jAllowedDeduction, 25620);
  check("Case 3 disallowed cf = $24,380", r.section163jDisallowedCarryforward, 24380);
  check("Case 3 AGI = $100k − $25,620 allowed", r.adjustedGrossIncome, 74380);
}

// ── Case 3-TY2026: TY2026 std-ded fall-through regression ─────────────────
// Same as Case 3 but TY2026. The ATI-proxy std ded must be the NATIVE TY2026
// $16,100 (via getFederalStandardDeduction), NOT the $14,600 the old inline
// two-year map fell through to. Hand-calc:
//   ATI = $100k W-2 − $16,100 std ded = $83,900. Cap = 30% × $83,900 = $25,170.
//   Gross $50k. Allowed = $25,170. Disallowed = $50,000 − $25,170 = $24,830.
//   AGI = $100k − $25,170 = $74,830.
//   (PRE-FIX this produced Case-3's TY2024 numbers: $25,620 / $24,380 / $74,380.)
{
  const base = baseInputs();
  const inputs: TaxReturnInputs = {
    ...base,
    taxYear: 2026,
    client: { ...base.client, taxYear: 2026 },
    w2s: [{ ...base.w2s[0], taxYear: 2026 }],
    adjustments: [adj("section_163j_business_interest_expense", 50000, 3099)],
  };
  const r = computeTaxReturnPure(inputs);
  check("Case 3-TY2026 allowed = $25,170 (cap on 2026 std ded $16,100)", r.section163jAllowedDeduction, 25170);
  check("Case 3-TY2026 disallowed cf = $24,830", r.section163jDisallowedCarryforward, 24830);
  check("Case 3-TY2026 AGI = $100k − $25,170", r.adjustedGrossIncome, 74830);
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
// POST C3 ATI refinement (2026-05-27 PM):
// Gross $20k + floor plan $40k. ATI = $30k W-2 − $14,600 std ded = $15,400.
//   Cap = 30% × $15,400 = $4,620.
//   Cap-subject allowance = min($20k, $4,620) = $4,620. Disallowed cf = $15,380.
//   Plus floor plan $40k always allowed.
//   Total allowed = $4,620 + $40k = $44,620.
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
  check("Case 6 allowed = $44,620 (4,620 cap + 40,000 floor)", r.section163jAllowedDeduction, 44620);
  check("Case 6 disallowed cf = $15,380", r.section163jDisallowedCarryforward, 15380);
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
// POST C3 ATI refinement (2026-05-27 PM): with $1k W-2 − $14,600 std ded,
// ATI clamps to $0. Cap = 30% × $0 = $0. Gross $10k. Allowed = $0.
// Disallowed cf = $10k.
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
  check("Case 9 allowed = $0 (ATI clamps to 0 after std ded)", r.section163jAllowedDeduction, 0);
  check("Case 9 disallowed cf = $10,000 (all gross disallowed)", r.section163jDisallowedCarryforward, 10000);
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

// ════════════════════════════════════════════════════════════════════════════
// §461(l) Schedule-C-LOSS FLOW (fix 2026-06-01)
// ════════════════════════════════════════════════════════════════════════════
// Before the fix the engine floored netSeIncome at 0, so a Schedule C loss
// could not offset other income (and, worse, the §461(l) auto-addback was still
// added → inflated AGI). The signed Sch C net now flows to AGI, capped by the
// §461(l) excess-business-loss limit ($305k single / $610k MFJ TY2024).

// ── Case L1: Sch C loss offsets W-2 (under §461(l) threshold) ─────────────
// W-2 $100,000 + self_employment_income −$30,000. schCLoss $30k < $305k → no
// §461(l) addback. AGI = 100,000 − 30,000 = 70,000. SE tax $0 (loss).
{
  const r = computeTaxReturnPure(baseInputs({ adjustments: [adj("self_employment_income", -30000)] }));
  check("Case L1 AGI = $70k (Sch C loss offsets W-2)", r.adjustedGrossIncome, 70000);
  check("Case L1 §461(l) addback = 0 (loss < threshold)", r.section461lExcessLossAddback, 0);
  check("Case L1 SE tax = 0 (no positive SE)", r.selfEmploymentTax, 0);
}

// ── Case L2: §461(l) caps a large Sch C loss (single $305k) ───────────────
// W-2 $500,000 + self_employment_income −$500,000. schCLoss $500k; addback =
// 500,000 − 305,000 = 195,000. AGI = 500,000 − 500,000 + 195,000 = 195,000
// (i.e. only the $305k allowed loss offsets W-2). Pre-fix this returned a
// nonsensical $695k (loss floored to 0 BUT addback still added).
{
  const inp = baseInputs({ adjustments: [adj("self_employment_income", -500000)] });
  (inp.w2s[0] as { wagesBox1: string }).wagesBox1 = "500000";
  const r = computeTaxReturnPure(inp);
  check("Case L2 §461(l) addback = $195k", r.section461lExcessLossAddback, 195000);
  check("Case L2 AGI = $195k (loss capped at $305k allowed)", r.adjustedGrossIncome, 195000);
}

// ── Case L2-TY2025/26: §461(l) threshold is year-indexed (was stale TY2024) ──
// Same $500k Sch C loss vs $500k W-2, per-year thresholds:
//   TY2025 $313,000 (Rev. Proc. 2024-40) → addback = 500,000 − 313,000 = $187,000.
//   TY2026 $256,000 (Rev. Proc. 2025-32 §4.31 — RE-DERIVED 2026-06-11, T1.0c #2:
//     OBBBA, P.L. 119-21, made §461(l) permanent and RE-BASED the indexation,
//     rolling the threshold back toward the TCJA $250k/$500k amounts, so TY2026
//     is LOWER than TY2025; the prior expectation held 2026 at the 2025 value)
//     → addback = 500,000 − 256,000 = $244,000.
// AGI = 500,000 − 500,000 + addback. W-2 wages stay OUT of the aggregation
// (performing services as an employee is not a §461(l) trade or business).
for (const [ty, threshold] of [[2025, 313000], [2026, 256000]] as const) {
  const addback = 500000 - threshold;
  const base = baseInputs({ adjustments: [adj("self_employment_income", -500000)] });
  const inp: TaxReturnInputs = {
    ...base,
    taxYear: ty,
    client: { ...base.client, taxYear: ty },
    w2s: [{ ...base.w2s[0], taxYear: ty, wagesBox1: "500000" }],
  };
  const r = computeTaxReturnPure(inp);
  check(`Case L2-TY${ty} §461(l) addback = $${addback / 1000}k (threshold $${threshold / 1000}k)`, r.section461lExcessLossAddback, addback);
  check(`Case L2-TY${ty} AGI = $${addback / 1000}k`, r.adjustedGrossIncome, addback);
}

// ── Case L3: MFJ §461(l) higher threshold ($610k) ────────────────────────
// MFJ, W-2 $800,000 + self_employment_income −$700,000. addback = 700,000 −
// 610,000 = 90,000. AGI = 800,000 − 700,000 + 90,000 = 190,000.
{
  const inp = baseInputs({ adjustments: [adj("self_employment_income", -700000)] });
  (inp.client as { filingStatus: string }).filingStatus = "married_filing_jointly";
  (inp.w2s[0] as { wagesBox1: string }).wagesBox1 = "800000";
  const r = computeTaxReturnPure(inp);
  check("Case L3 MFJ §461(l) addback = $90k", r.section461lExcessLossAddback, 90000);
  check("Case L3 MFJ AGI = $190k (loss capped at $610k)", r.adjustedGrossIncome, 190000);
}

// ── Case L4: positive Sch C unaffected (regression control) ───────────────
// W-2 $100,000 + self_employment_income +$50,000. netSE = 50,000 × 0.9235 =
// 46,175 → SE tax 7,064.78; half 3,532.39. AGI = 100,000 + 50,000 − 3,532.39
// = 146,467.61. (Signed net == floored net when positive.)
{
  const r = computeTaxReturnPure(baseInputs({ adjustments: [adj("self_employment_income", 50000)] }));
  check("Case L4 AGI = $146,467.61 (positive Sch C unchanged)", r.adjustedGrossIncome, 146467.61, 1);
  check("Case L4 SE tax = $7,064.78", r.selfEmploymentTax, 7064.78, 1);
}

// ── Case L5: Sch C loss via expenses > gross also flows ───────────────────
// W-2 $100,000 + self_employment_income +$20,000 + schedule_c_expenses $50,000.
// scheduleCNetSigned = 20,000 − 50,000 = −30,000. AGI = 100,000 − 30,000 = 70,000.
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [adj("self_employment_income", 20000), adj("schedule_c_expenses", 50000)],
  }));
  check("Case L5 AGI = $70k (expenses-path loss flows)", r.adjustedGrossIncome, 70000);
  check("Case L5 SE tax = 0 (net loss)", r.selfEmploymentTax, 0);
}

// ── Case L6: loss exceeds total income → AGI floors at 0 (NOL not auto-gen) ─
// W-2 $100,000 + self_employment_income −$150,000. income = −50,000 → AGI = 0.
// The $50k excess would be an NOL the CPA carries via nol_carryforward
// (documented sub-gap — engine does not auto-generate the NOL).
{
  const r = computeTaxReturnPure(baseInputs({ adjustments: [adj("self_employment_income", -150000)] }));
  check("Case L6 AGI floors at $0 (loss > income)", r.adjustedGrossIncome, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// §163(j)(3) SMALL-BUSINESS GROSS-RECEIPTS EXEMPTION (§448(c))
// §448(c) thresholds (Rev. Proc. 2023-34 / 2024-40 / 2025-32):
//   TY2024 $30,000,000 · TY2025 $31,000,000 · TY2026 $32,000,000
// ════════════════════════════════════════════════════════════════════════════
function bcheck(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

// Case S1 — gross receipts BELOW threshold → EXEMPT: 30% cap lifted, full allow.
// Base $100k W-2; gross interest $50k (would cap to $25,620 — see Case 3);
// gross receipts $5,000,000 ≤ $30M (2024) → exempt → allowed = $50k, cf = $0.
{
  const r = computeTaxReturnPure(baseInputs({ adjustments: [
    adj("section_163j_business_interest_expense", 50000, 7001),
    adj("section_163j_gross_receipts", 5_000_000, 7002),
  ] }));
  bcheck("Case S1 small-biz EXEMPT", r.section163jSmallBusinessExempt, true);
  check("Case S1 allowed = $50k (cap lifted)", r.section163jAllowedDeduction, 50000);
  check("Case S1 disallowed cf = $0", r.section163jDisallowedCarryforward, 0);
  check("Case S1 threshold = $30M (2024)", r.section163jGrossReceiptsThreshold, 30_000_000);
  check("Case S1 AGI = $100k − $50k", r.adjustedGrossIncome, 50000);
}

// Case S2 — gross receipts ABOVE threshold → NOT exempt → 30% cap applies.
// Same as Case 3: allowed $25,620 (30% × ATI $85,400), disallowed $24,380.
{
  const r = computeTaxReturnPure(baseInputs({ adjustments: [
    adj("section_163j_business_interest_expense", 50000, 7011),
    adj("section_163j_gross_receipts", 40_000_000, 7012),
  ] }));
  bcheck("Case S2 NOT exempt", r.section163jSmallBusinessExempt, false);
  check("Case S2 allowed = $25,620 (capped)", r.section163jAllowedDeduction, 25620);
  check("Case S2 disallowed cf = $24,380", r.section163jDisallowedCarryforward, 24380);
}

// Case S3 — gross receipts EXACTLY at threshold ($30M, 2024) → exempt (≤).
{
  const r = computeTaxReturnPure(baseInputs({ adjustments: [
    adj("section_163j_business_interest_expense", 50000, 7021),
    adj("section_163j_gross_receipts", 30_000_000, 7022),
  ] }));
  bcheck("Case S3 at-threshold EXEMPT (≤)", r.section163jSmallBusinessExempt, true);
  check("Case S3 allowed = $50k", r.section163jAllowedDeduction, 50000);
}

// Case S4 — gross receipts $1 over threshold → NOT exempt.
{
  const r = computeTaxReturnPure(baseInputs({ adjustments: [
    adj("section_163j_business_interest_expense", 50000, 7031),
    adj("section_163j_gross_receipts", 30_000_001, 7032),
  ] }));
  bcheck("Case S4 $1-over NOT exempt", r.section163jSmallBusinessExempt, false);
  check("Case S4 allowed = $25,620 (capped)", r.section163jAllowedDeduction, 25620);
}

// Case S5 — exemption also frees the prior-year carryforward.
// Gross $20k + carryforward $40k = $60k subject; exempt → all $60k allowed, cf $0.
{
  const r = computeTaxReturnPure(baseInputs({ adjustments: [
    adj("section_163j_business_interest_expense", 20000, 7041),
    adj("section_163j_carryforward_from_prior", 40000, 7042),
    adj("section_163j_gross_receipts", 10_000_000, 7043),
  ] }));
  bcheck("Case S5 EXEMPT (incl. carryforward)", r.section163jSmallBusinessExempt, true);
  check("Case S5 allowed = $60k (gross + cf, no cap)", r.section163jAllowedDeduction, 60000);
  check("Case S5 disallowed cf = $0", r.section163jDisallowedCarryforward, 0);
  check("Case S5 AGI = $100k − $60k", r.adjustedGrossIncome, 40000);
}

// Case S6 — TY2025 threshold = $31M. Gross receipts $30.5M is ABOVE the 2024 $30M
// but ≤ the 2025 $31M → exempt for 2025 (year-keyed threshold).
{
  const inp = baseInputs({ taxYear: 2025, adjustments: [
    adj("section_163j_business_interest_expense", 50000, 7051),
    adj("section_163j_gross_receipts", 30_500_000, 7052),
  ] });
  (inp.client as unknown as { taxYear: number }).taxYear = 2025;
  (inp.w2s[0] as unknown as { taxYear: number }).taxYear = 2025;
  const r = computeTaxReturnPure(inp);
  check("Case S6 threshold = $31M (2025)", r.section163jGrossReceiptsThreshold, 31_000_000);
  bcheck("Case S6 EXEMPT at $30.5M for 2025", r.section163jSmallBusinessExempt, true);
  check("Case S6 allowed = $50k (cap lifted)", r.section163jAllowedDeduction, 50000);
}

console.log(`\n§163(j) + §461(l) (C7) tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) FAIL.forEach((f) => console.log(`    ${f}`));
process.exit(FAIL.length > 0 ? 1 : 0);
