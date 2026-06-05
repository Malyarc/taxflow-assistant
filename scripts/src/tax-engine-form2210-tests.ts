/**
 * Form 2210 / §6654 underpayment penalty — hand-calc'd tests (P1-6).
 *
 * Pure engine; no API required.
 *
 * Each case hand-calcs the required annual payment (safe-harbor target), the
 * penalty-applies determination, and the approximate penalty against §6654 +
 * the IRS Form 2210 instructions:
 *   - Required annual payment = min(90% current-year tax, prior-year safe harbor).
 *   - Prior-year safe harbor = 100% of prior tax, 110% if prior AGI > $150k
 *     ($75k MFS).
 *   - No penalty when prior-year tax was $0, or current tax − withholding < $1,000.
 *   - Penalty estimate = underpayment × year-rate × ⅔ (8% TY2024, 7% TY2025).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-form2210-tests.ts
 */
import { computeForm2210 } from "../../artifacts/api-server/src/lib/form2210";
import {
  computeTaxReturnPure,
  type ComputedTaxReturn,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 0.5): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkEq<T>(label: string, actual: T, expected: T): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Minimal stub — only the fields computeForm2210 reads. Line 4 (current-year
 *  tax) = federalTaxLiability − totalNonRefundableApplied − (ACTC + aocRefundable
 *  + eitc + max(0,netPtc)). */
function stub(args: {
  federalTaxLiability: number;
  federalTaxWithheld: number;
  totalNonRefundableApplied?: number;
  additionalChildTaxCredit?: number;
  aocRefundable?: number;
  eitcApplied?: number;
  netPtc?: number;
  filingStatus?: string;
  taxYear?: number;
}): ComputedTaxReturn {
  return {
    taxYear: args.taxYear ?? 2024,
    filingStatus: args.filingStatus ?? "single",
    federalTaxLiability: args.federalTaxLiability,
    federalTaxWithheld: args.federalTaxWithheld,
    totalNonRefundableApplied: args.totalNonRefundableApplied ?? 0,
    additionalChildTaxCredit: args.additionalChildTaxCredit ?? 0,
    eitc: { appliedCredit: args.eitcApplied ?? 0 },
    educationCredits: { aocRefundable: args.aocRefundable ?? 0 },
    premiumTaxCredit: { netPtc: args.netPtc ?? 0 },
  } as unknown as ComputedTaxReturn;
}

// ── Case 1: high-income, 110% prior harbor binds, penalty applies (TY2024) ──
// currentYearTax 40,000 · withholding 20,000 · prior tax 30,000 @ AGI 200,000.
//   90% current = 36,000 · prior harbor = 110% × 30,000 = 33,000 · required = 33,000.
//   underpayment = 33,000 − 20,000 = 13,000.
//   penalty = 13,000 × 8% × ⅔ = $693.33 → 693.
{
  const f = computeForm2210({
    ret: stub({ federalTaxLiability: 40000, federalTaxWithheld: 20000, taxYear: 2024 }),
    input: { priorYearTax: 30000, priorYearAgi: 200000, priorYearAvailable: true },
  });
  check("C1 currentYearTax", f.currentYearTax, 40000);
  check("C1 ninetyPercentCurrent", f.ninetyPercentCurrent, 36000);
  check("C1 priorYearSafeHarborPct", f.priorYearSafeHarborPct, 1.1, 0.001);
  check("C1 priorYearSafeHarbor (110%)", f.priorYearSafeHarbor ?? -1, 33000);
  check("C1 requiredAnnualPayment", f.requiredAnnualPayment, 33000);
  checkBool("C1 penaltyApplies", f.penaltyApplies, true);
  check("C1 underpayment", f.underpayment, 13000);
  check("C1 additionalToSafeHarbor", f.additionalToSafeHarbor, 13000);
  check("C1 estimatedPenalty (8% × ⅔)", f.estimatedPenalty ?? -1, 693);
  check("C1 penaltyRateUsed", f.penaltyRateUsed ?? -1, 0.08, 0.001);
}

// ── Case 2: 90% harbor binds, withholding meets it → no penalty ──
// currentYearTax 40,000 · withholding 38,000 · prior 50,000 @ AGI 300,000 (110%→55,000).
//   required = min(36,000, 55,000) = 36,000 · paid 38,000 ≥ 36,000 → met safe harbor.
{
  const f = computeForm2210({
    ret: stub({ federalTaxLiability: 40000, federalTaxWithheld: 38000, taxYear: 2024 }),
    input: { priorYearTax: 50000, priorYearAgi: 300000, priorYearAvailable: true },
  });
  check("C2 requiredAnnualPayment", f.requiredAnnualPayment, 36000);
  checkBool("C2 penaltyApplies", f.penaltyApplies, false);
  checkEq("C2 waived reason", f.penaltyWaivedReason, "met_safe_harbor");
  check("C2 estimatedPenalty", f.estimatedPenalty ?? -1, 0);
  check("C2 additionalToSafeHarbor", f.additionalToSafeHarbor, 0);
}

// ── Case 3: under-$1,000 exception (§6654(e)(1)) → no penalty ──
// currentYearTax 20,500 · withholding 20,000 → 20,500 − 20,000 = 500 < 1,000.
{
  const f = computeForm2210({
    ret: stub({ federalTaxLiability: 20500, federalTaxWithheld: 20000, taxYear: 2024 }),
  });
  checkBool("C3 penaltyApplies", f.penaltyApplies, false);
  checkEq("C3 waived reason", f.penaltyWaivedReason, "under_1000");
  check("C3 estimatedPenalty", f.estimatedPenalty ?? -1, 0);
}

// ── Case 4: prior-year zero-liability exception (§6654(e)(2)) → no penalty ──
{
  const f = computeForm2210({
    ret: stub({ federalTaxLiability: 30000, federalTaxWithheld: 5000, taxYear: 2024 }),
    input: { priorYearTax: 0, priorYearAgi: 40000, priorYearAvailable: true },
  });
  checkBool("C4 penaltyApplies", f.penaltyApplies, false);
  checkEq("C4 waived reason", f.penaltyWaivedReason, "prior_year_zero");
  check("C4 priorYearTax", f.priorYearTax ?? -1, 0);
}

// ── Case 5: 100% prior harbor (AGI ≤ 150k), TY2025 rate 7%, penalty applies ──
// currentYearTax 25,000 · withholding 10,000 · prior 18,000 @ AGI 120,000 (100%).
//   required = min(22,500, 18,000) = 18,000 · underpayment = 8,000.
//   penalty = 8,000 × 7% × ⅔ = $373.33 → 373.
{
  const f = computeForm2210({
    ret: stub({ federalTaxLiability: 25000, federalTaxWithheld: 10000, taxYear: 2025 }),
    input: { priorYearTax: 18000, priorYearAgi: 120000, priorYearAvailable: true },
  });
  check("C5 priorYearSafeHarborPct (100%)", f.priorYearSafeHarborPct, 1.0, 0.001);
  check("C5 priorYearSafeHarbor", f.priorYearSafeHarbor ?? -1, 18000);
  check("C5 requiredAnnualPayment", f.requiredAnnualPayment, 18000);
  checkBool("C5 penaltyApplies", f.penaltyApplies, true);
  check("C5 underpayment", f.underpayment, 8000);
  check("C5 estimatedPenalty (7% × ⅔)", f.estimatedPenalty ?? -1, 373);
  check("C5 penaltyRateUsed", f.penaltyRateUsed ?? -1, 0.07, 0.001);
}

// ── Case 6: MFS 110% threshold is $75k ──
// MFS · currentYearTax 30,000 · withholding 5,000 · prior 20,000 @ AGI 80,000 (>75k → 110%).
//   prior harbor = 110% × 20,000 = 22,000 · required = min(27,000, 22,000) = 22,000.
{
  const f = computeForm2210({
    ret: stub({ federalTaxLiability: 30000, federalTaxWithheld: 5000, filingStatus: "married_filing_separately", taxYear: 2024 }),
    input: { priorYearTax: 20000, priorYearAgi: 80000, priorYearAvailable: true },
  });
  check("C6 priorYearSafeHarborPct (MFS 110%)", f.priorYearSafeHarborPct, 1.1, 0.001);
  check("C6 priorYearSafeHarbor", f.priorYearSafeHarbor ?? -1, 22000);
  check("C6 requiredAnnualPayment", f.requiredAnnualPayment, 22000);
  check("C6 underpayment", f.underpayment, 17000);
}

// ── Case 7: TY2026 rate unpublished → penalty applies, penalty $ is null ──
{
  const f = computeForm2210({
    ret: stub({ federalTaxLiability: 40000, federalTaxWithheld: 10000, taxYear: 2026 }),
  });
  checkBool("C7 penaltyApplies", f.penaltyApplies, true);
  check("C7 requiredAnnualPayment (90% only, no prior)", f.requiredAnnualPayment, 36000);
  check("C7 underpayment", f.underpayment, 26000);
  checkEq("C7 penaltyRateUsed null", f.penaltyRateUsed, null);
  checkEq("C7 estimatedPenalty null", f.estimatedPenalty, null);
}

// ── Case 8: refundable + nonrefundable credits reduce the §6654 Line 4 tax ──
// fedTaxLiab 30,000 − nonrefundable 2,000 − refundable (ACTC 1,500 + AOC 1,000 +
// EITC 500 + netPTC 1,000 = 4,000) → currentYearTax = 24,000.
//   required = 90% × 24,000 = 21,600 · underpayment = 21,600 − 5,000 = 16,600.
//   penalty = 16,600 × 8% × ⅔ = $885.33 → 885.
{
  const f = computeForm2210({
    ret: stub({
      federalTaxLiability: 30000, federalTaxWithheld: 5000, totalNonRefundableApplied: 2000,
      additionalChildTaxCredit: 1500, aocRefundable: 1000, eitcApplied: 500, netPtc: 1000, taxYear: 2024,
    }),
  });
  check("C8 currentYearTax (net of credits)", f.currentYearTax, 24000);
  check("C8 requiredAnnualPayment", f.requiredAnnualPayment, 21600);
  check("C8 underpayment", f.underpayment, 16600);
  check("C8 estimatedPenalty", f.estimatedPenalty ?? -1, 885);
}

// ── Case 9: end-to-end via computeTaxReturnPure — Line 4 wiring on a real return ──
// Single FL TY2024, W-2 $100k, withholding $8,000, no credits → currentYearTax
// equals the engine's federalTaxLiability (no nonrefundable/refundable credits),
// withholding equals the engine's federalTaxWithheld, and the safe-harbor target
// is 90% of it (no prior-year data supplied).
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 } as TaxReturnInputs["client"],
    w2s: [{ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 8000, stateCode: "FL" } as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [], adjustments: [], taxYear: 2024,
  };
  const ret = computeTaxReturnPure(inputs);
  const f = computeForm2210({ ret });
  const expectedLine4 = Math.round(
    ret.federalTaxLiability - ret.totalNonRefundableApplied -
    (ret.additionalChildTaxCredit + ret.educationCredits.aocRefundable + ret.eitc.appliedCredit + Math.max(0, ret.premiumTaxCredit.netPtc)),
  );
  check("C9 currentYearTax = engine-derived Line 4", f.currentYearTax, expectedLine4);
  check("C9 withholding = engine federalTaxWithheld", f.withholding, Math.round(ret.federalTaxWithheld));
  check("C9 safe-harbor target = 90% of current (no prior)", f.requiredAnnualPayment, Math.round(0.9 * expectedLine4));
  checkBool("C9 currentYearTax > 0 (sanity)", f.currentYearTax > 0, true);
}

// ── Summary ──
console.log(`\n══ Form 2210 / §6654 ══  PASS: ${PASS.length}  FAIL: ${FAIL.length}`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log("ALL FORM 2210 ASSERTIONS PASS");
