/**
 * Adoption Credit (Form 8839, IRC §23) — hand-calc'd tests (P2-13).
 *
 * Pure engine; no API required. Three levels:
 *   1. UNIT  — `calculateAdoptionCredit` directly (the §23 math: per-child cap,
 *      MAGI phase-out, OBBBA refundable split, §23(c) carryforward, MFS bar).
 *   2. E2E   — `computeTaxReturnPure` with `qualified_adoption_expenses` /
 *      `adoption_credit_carryforward` adjustments → the credit flows into
 *      `federalRefundOrOwed` (delta identity) + the §23(b)(2)(B) MAGI add-back.
 *   3. PLAN  — the G1.65 detector now reports the ENGINE-VERIFIED credit when a
 *      marker is present (vs the broad kids-under-17 heuristic otherwise).
 *
 * Every expected value is hand-calc'd against the IRS rules. Year-indexed
 * values (Rev. Proc. 2023-34 / 2024-40 / 2025-32; OBBBA P.L. 119-21 §70402):
 *   Max credit/child : 2024 $16,810 / 2025 $17,280 / 2026 $17,670
 *   Phase-out start  : 2024 $252,150 / 2025 $259,190 / 2026 $265,080  (band $40,000)
 *   Refundable cap   : 2024 $0 / 2025 $5,000 / 2026 $5,120
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-adoption-credit-tests.ts
 */
import { calculateAdoptionCredit } from "../../artifacts/api-server/src/lib/taxCalculator";
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
  type AdjustmentFact,
  type ClientFacts,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  evaluatePlanningOpportunities,
  annotateVerifiedSavings,
} from "../../artifacts/api-server/src/lib/planningEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function checkBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function checkEq<T>(label: string, actual: T, expected: T): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function header(t: string) { console.log(`\n-- ${t} --`); }
const A = (t: string, amt: number): AdjustmentFact => ({ adjustmentType: t, amount: amt, isApplied: true });

// ════════════════════════════════════════════════════════════════════════════
// 1. UNIT — calculateAdoptionCredit
// ════════════════════════════════════════════════════════════════════════════

// U1 — TY2025 MFJ, $20k expenses (> max), MAGI $150k (under phase-out), ample tax.
//   eligible = min(20000, 17280) = 17280 · phase-out 0 · tentative 17280.
//   refundable = min(17280, 5000) = 5000 · currentNonRef = 12280.
//   nonRefApplied = min(12280, 30000) = 12280 · carryforward 0.
header("U1: TY2025 full credit, $5k refundable, no phase-out");
{
  const r = calculateAdoptionCredit({
    qualifiedExpenses: 20000, specialNeeds: false, priorCarryforward: 0,
    magi: 150000, filingStatus: "married_filing_jointly", availableTax: 30000, taxYear: 2025,
  });
  check("U1 maxCreditPerChild", r.maxCreditPerChild, 17280);
  check("U1 eligibleExpenses (capped at max)", r.eligibleExpenses, 17280);
  check("U1 phaseOutFraction", r.phaseOutFraction, 0, 0.0001);
  check("U1 tentativeCredit", r.tentativeCredit, 17280);
  check("U1 refundablePortion", r.refundablePortion, 5000);
  check("U1 nonRefundableApplied", r.nonRefundableApplied, 12280);
  check("U1 carryforwardToNext", r.carryforwardToNext, 0);
  checkBool("U1 eligible", r.eligible, true);
}

// U2 — TY2025 SPECIAL-NEEDS ($0 actual expenses), MAGI $279,190 (mid-band), tax $3k.
//   §23(a)(3): deemed expenses = max = 17280.
//   phase-out = (279190 − 259190)/40000 = 0.5 · tentative = 17280 × 0.5 = 8640.
//   refundable = min(8640, 5000) = 5000 · currentNonRef = 3640.
//   nonRefApplied = min(3640, 3000) = 3000 · carryforward = 640.
header("U2: TY2025 special-needs deeming + 50% phase-out + tax-limited");
{
  const r = calculateAdoptionCredit({
    qualifiedExpenses: 0, specialNeeds: true, priorCarryforward: 0,
    magi: 279190, filingStatus: "married_filing_jointly", availableTax: 3000, taxYear: 2025,
  });
  check("U2 eligibleExpenses (special-needs = max)", r.eligibleExpenses, 17280);
  check("U2 phaseOutFraction", r.phaseOutFraction, 0.5, 0.0001);
  check("U2 tentativeCredit", r.tentativeCredit, 8640);
  check("U2 refundablePortion", r.refundablePortion, 5000);
  check("U2 nonRefundableApplied (tax-limited)", r.nonRefundableApplied, 3000);
  check("U2 carryforwardToNext", r.carryforwardToNext, 640);
}

// U3 — TY2024 (PRE-OBBBA), MFJ $10k expenses, MAGI $100k, tax $4k, no CF.
//   refundableCap = 0 → fully nonrefundable. tentative 10000.
//   nonRefApplied = min(10000, 4000) = 4000 · carryforward = 6000 (5-yr §23(c)).
header("U3: TY2024 all-nonrefundable, tax-limited, carryforward out");
{
  const r = calculateAdoptionCredit({
    qualifiedExpenses: 10000, specialNeeds: false, priorCarryforward: 0,
    magi: 100000, filingStatus: "married_filing_jointly", availableTax: 4000, taxYear: 2024,
  });
  check("U3 refundableCap (pre-OBBBA)", r.refundableCap, 0);
  check("U3 refundablePortion", r.refundablePortion, 0);
  check("U3 tentativeCredit", r.tentativeCredit, 10000);
  check("U3 nonRefundableApplied", r.nonRefundableApplied, 4000);
  check("U3 carryforwardToNext", r.carryforwardToNext, 6000);
}

// U4 — TY2026 prior CF $6k, NO current expenses, MAGI $400k (over top), tax $10k.
//   Current-year credit 0 (no expenses); the carryforward is NOT re-phased by
//   current MAGI → it applies against tax. nonRefApplied = min(6000, 10000) = 6000.
header("U4: TY2026 carryforward usable despite over-cap MAGI");
{
  const r = calculateAdoptionCredit({
    qualifiedExpenses: 0, specialNeeds: false, priorCarryforward: 6000,
    magi: 400000, filingStatus: "married_filing_jointly", availableTax: 10000, taxYear: 2026,
  });
  check("U4 tentativeCredit (no current expenses)", r.tentativeCredit, 0);
  check("U4 priorCarryforward", r.priorCarryforward, 6000);
  check("U4 nonRefundableApplied (CF not re-phased)", r.nonRefundableApplied, 6000);
  check("U4 carryforwardToNext", r.carryforwardToNext, 0);
  checkBool("U4 eligible", r.eligible, true);
}

// U5 — TY2025 over-top MAGI $310k, $20k expenses, no CF → fully phased out.
//   phase-out = min(1, (310000 − 259190)/40000) = 1 · tentative 0.
header("U5: TY2025 MAGI over top → credit fully eliminated");
{
  const r = calculateAdoptionCredit({
    qualifiedExpenses: 20000, specialNeeds: false, priorCarryforward: 0,
    magi: 310000, filingStatus: "married_filing_jointly", availableTax: 50000, taxYear: 2025,
  });
  check("U5 phaseOutFraction (capped at 1)", r.phaseOutFraction, 1, 0.0001);
  check("U5 tentativeCredit", r.tentativeCredit, 0);
  check("U5 refundablePortion", r.refundablePortion, 0);
  check("U5 nonRefundableApplied", r.nonRefundableApplied, 0);
  checkBool("U5 eligible (markers present)", r.eligible, true);
}

// U6 — MFS DISQUALIFIED (v1): $20k expenses ignored, nothing applied.
header("U6: MFS disqualified");
{
  const r = calculateAdoptionCredit({
    qualifiedExpenses: 20000, specialNeeds: false, priorCarryforward: 0,
    magi: 100000, filingStatus: "married_filing_separately", availableTax: 30000, taxYear: 2025,
  });
  checkBool("U6 eligible (MFS → false)", r.eligible, false);
  check("U6 tentativeCredit", r.tentativeCredit, 0);
  check("U6 refundablePortion", r.refundablePortion, 0);
  check("U6 nonRefundableApplied", r.nonRefundableApplied, 0);
}

// U7 — TY2025 small credit BELOW the refundable cap → entirely refundable.
//   $3k expenses, MAGI $269,190 (25% band) · tentative = 3000 × 0.75 = 2250.
//   refundable = min(2250, 5000) = 2250 (whole credit) · nonRefundable = 0.
header("U7: TY2025 credit below refundable cap → 100% refundable");
{
  const r = calculateAdoptionCredit({
    qualifiedExpenses: 3000, specialNeeds: false, priorCarryforward: 0,
    magi: 269190, filingStatus: "married_filing_jointly", availableTax: 50000, taxYear: 2025,
  });
  check("U7 phaseOutFraction", r.phaseOutFraction, 0.25, 0.0001);
  check("U7 tentativeCredit", r.tentativeCredit, 2250);
  check("U7 refundablePortion (whole credit)", r.refundablePortion, 2250);
  check("U7 nonRefundableApplied", r.nonRefundableApplied, 0);
  check("U7 carryforwardToNext", r.carryforwardToNext, 0);
}

// U8 — TY2026 max expenses + prior CF, tax-limited: refundable + CF stacking.
//   $17,670 expenses (= max), MAGI $200k (no phase-out), prior CF $2k, tax $5k.
//   refundable = min(17670, 5120) = 5120 · currentNonRef = 12550.
//   nonRefTentative = 12550 + 2000 = 14550 · applied = min(14550, 5000) = 5000.
//   carryforward = 9550.
header("U8: TY2026 max credit + prior CF, tax-limited stacking");
{
  const r = calculateAdoptionCredit({
    qualifiedExpenses: 17670, specialNeeds: false, priorCarryforward: 2000,
    magi: 200000, filingStatus: "married_filing_jointly", availableTax: 5000, taxYear: 2026,
  });
  check("U8 refundableCap (TY2026)", r.refundableCap, 5120);
  check("U8 refundablePortion", r.refundablePortion, 5120);
  check("U8 nonRefundableTentative (current + prior CF)", r.nonRefundableTentative, 14550);
  check("U8 nonRefundableApplied (tax-limited)", r.nonRefundableApplied, 5000);
  check("U8 carryforwardToNext", r.carryforwardToNext, 9550);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. E2E — computeTaxReturnPure (the credit flows into federalRefundOrOwed)
// ════════════════════════════════════════════════════════════════════════════

// The adoption adjustment ONLY drives the §23 credit (it is NOT a deduction), so
// federalRefundOrOwed(with) − federalRefundOrOwed(without) is exactly the credit
// applied (refundable + nonrefundable). We assert that identity plus the credit
// values themselves (hand-calc'd) and the §23(b)(2)(B) MAGI wiring.
function e2e(args: {
  taxYear: number;
  wages: number;
  adoptionAdjustments: AdjustmentFact[];
  state?: string;
  extraAdjustments?: AdjustmentFact[];
}) {
  const baseAdj = args.extraAdjustments ?? [];
  const mk = (adj: AdjustmentFact[]): TaxReturnInputs => ({
    client: { filingStatus: "married_filing_jointly", state: args.state ?? "FL", taxYear: args.taxYear },
    w2s: [{ taxYear: args.taxYear, wagesBox1: args.wages, federalTaxWithheldBox2: 0, stateCode: args.state ?? "FL" }],
    form1099s: [], adjustments: adj, taxYear: args.taxYear,
  } as unknown as TaxReturnInputs);
  const without = computeTaxReturnPure(mk(baseAdj));
  const withCredit = computeTaxReturnPure(mk([...baseAdj, ...args.adoptionAdjustments]));
  return {
    without, withCredit,
    delta: withCredit.federalRefundOrOwed - without.federalRefundOrOwed,
  };
}

// E1 — TY2025 MFJ W-2 $200k, $20k expenses. AGI $200k < $259,190 → no phase-out.
//   Full $17,280 (5,000 refundable + 12,280 nonref; income tax ≫ 12,280).
header("E1: TY2025 e2e — full credit flows to refund");
{
  const { withCredit, delta } = e2e({ taxYear: 2025, wages: 200000, adoptionAdjustments: [A("qualified_adoption_expenses", 20000)] });
  check("E1 magi = AGI (no FEIE)", withCredit.adoptionCredit.magi, withCredit.adjustedGrossIncome);
  check("E1 refundablePortion", withCredit.adoptionCredit.refundablePortion, 5000);
  check("E1 nonRefundableApplied (full)", withCredit.adoptionCredit.nonRefundableApplied, 12280);
  check("E1 carryforwardToNext", withCredit.adoptionCreditCarryforwardRemaining, 0);
  check("E1 refund delta = credit applied", delta, 17280);
}

// E2 — TY2025 MFJ W-2 $40k, prior CF $3,000, NO current expenses.
//   taxable = 40,000 − 31,500 std = 8,500 · income tax = 8,500 × 10% = $850.
//   No other credits → nonRefApplied = min(3000, 850) = 850 · carryforward = 2150.
header("E2: TY2025 e2e — carryforward applies, tax-limited, re-derives CF out");
{
  const { withCredit, delta } = e2e({ taxYear: 2025, wages: 40000, adoptionAdjustments: [A("adoption_credit_carryforward", 3000)] });
  check("E2 priorCarryforward", withCredit.adoptionCredit.priorCarryforward, 3000);
  check("E2 tentativeCredit (no current expenses)", withCredit.adoptionCredit.tentativeCredit, 0);
  check("E2 nonRefundableApplied = income tax $850", withCredit.adoptionCredit.nonRefundableApplied, 850);
  check("E2 carryforwardToNext", withCredit.adoptionCreditCarryforwardRemaining, 2150);
  check("E2 refund delta = $850", delta, 850);
}

// E3 — TY2025 MFJ W-2 $279,190, $20k expenses → 50% phase-out.
//   tentative 8,640 · refundable 5,000 · nonref 3,640 (income tax ≫ 3,640).
header("E3: TY2025 e2e — 50% MAGI phase-out flows through");
{
  const { withCredit, delta } = e2e({ taxYear: 2025, wages: 279190, adoptionAdjustments: [A("qualified_adoption_expenses", 20000)] });
  check("E3 magi = AGI $279,190", withCredit.adoptionCredit.magi, 279190);
  check("E3 phaseOutFraction", withCredit.adoptionCredit.phaseOutFraction, 0.5, 0.0001);
  check("E3 tentativeCredit", withCredit.adoptionCredit.tentativeCredit, 8640);
  check("E3 refundablePortion", withCredit.adoptionCredit.refundablePortion, 5000);
  check("E3 nonRefundableApplied", withCredit.adoptionCredit.nonRefundableApplied, 3640);
  check("E3 refund delta = $8,640", delta, 8640);
}

// E4 — §23(b)(2)(B) MAGI add-back: FEIE-excluded income re-enters the §23 MAGI.
//   W-2 $200k + $60k foreign earned income excluded. MAGI = AGI + FEIE exclusion,
//   which must exceed AGI (proving the add-back is wired). Without the add-back a
//   $200k AGI would see ZERO phase-out; with it the credit phases (MAGI > start).
header("E4: §23(b)(2)(B) FEIE MAGI add-back");
{
  const { withCredit } = e2e({
    taxYear: 2025, wages: 200000,
    adoptionAdjustments: [A("qualified_adoption_expenses", 20000)],
    extraAdjustments: [A("foreign_earned_income", 60000)],
  });
  const expectedMagi = Math.round(withCredit.adjustedGrossIncome + withCredit.feie.totalExclusion);
  check("E4 FEIE exclusion ≈ $60k", withCredit.feie.totalExclusion, 60000);
  check("E4 magi = AGI + FEIE exclusion", withCredit.adoptionCredit.magi, expectedMagi);
  checkBool("E4 magi > AGI (add-back applied)", withCredit.adoptionCredit.magi > withCredit.adjustedGrossIncome, true);
  checkBool("E4 phase-out engaged via add-back", withCredit.adoptionCredit.phaseOutFraction > 0, true);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. PLAN — G1.65 detector promotion (engine-verified vs heuristic)
// ════════════════════════════════════════════════════════════════════════════

function planG165(args: { dependentsUnder17?: number; adoptionAdjustments: AdjustmentFact[]; wages?: number }) {
  const adjustments = args.adoptionAdjustments;
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2025, dependentsUnder17: args.dependentsUnder17 ?? 0 },
    w2s: [{ taxYear: 2025, wagesBox1: args.wages ?? 200000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [], adjustments, taxYear: 2025,
  } as unknown as TaxReturnInputs;
  const computed = computeTaxReturnPure(inputs);
  const client = { filingStatus: "married_filing_jointly", dependentsUnder17: args.dependentsUnder17 ?? 0 } as unknown as ClientFacts;
  const hits = evaluatePlanningOpportunities({ client, computed, adjustments });
  return hits.find((h) => h.strategyId === "G1.65") ?? null;
}

// D1 — actual expenses entered → ENGINE-VERIFIED $17,280, preserved by annotate.
header("D1: G1.65 engine-verified path (actual expenses)");
{
  const hit = planG165({ adoptionAdjustments: [A("qualified_adoption_expenses", 20000)] });
  checkBool("D1 G1.65 hit present", hit != null, true);
  if (hit) {
    checkEq("D1 savingsSource", hit.savingsSource, "engine-verified");
    check("D1 verifiedSavings = $17,280", hit.verifiedSavings ?? -1, 17280);
    check("D1 estSavings = $17,280", hit.estSavings, 17280);
    annotateVerifiedSavings([hit]);
    checkEq("D1 savingsSource preserved post-annotate", hit.savingsSource, "engine-verified");
    check("D1 verifiedSavings preserved", hit.verifiedSavings ?? -1, 17280);
  }
}

// D2 — kids but NO adoption marker → heuristic (NOT engine-verified after annotate).
header("D2: G1.65 heuristic path (no marker)");
{
  const hit = planG165({ dependentsUnder17: 2, adoptionAdjustments: [] });
  checkBool("D2 G1.65 heuristic hit present", hit != null, true);
  if (hit) {
    annotateVerifiedSavings([hit]);
    checkEq("D2 savingsSource = estimate (heuristic)", hit.savingsSource, "estimate");
  }
}

// D3 — prior carryforward only → engine-verified ($3,000 applied; income tax ≫).
header("D3: G1.65 engine-verified path (carryforward)");
{
  const hit = planG165({ adoptionAdjustments: [A("adoption_credit_carryforward", 3000)] });
  checkBool("D3 G1.65 hit present", hit != null, true);
  if (hit) {
    checkEq("D3 savingsSource", hit.savingsSource, "engine-verified");
    check("D3 verifiedSavings = $3,000", hit.verifiedSavings ?? -1, 3000);
  }
}

// ── Summary ──
console.log(`\n== Adoption Credit §23 ==  PASS: ${PASS.length}  FAIL: ${FAIL.length}`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log("ALL ADOPTION CREDIT ASSERTIONS PASS");
