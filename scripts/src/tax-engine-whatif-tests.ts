/**
 * H2 — What-if scenario engine — hand-calc'd tests.
 *
 * Pure engine; no API required.
 *
 * Hand-calc'd against IRS published TY2024 rules:
 *   Single std ded $14,600.
 *   Single brackets: 10%/$0-11,600 · 12%/$11,600-47,150 · 22%/$47,150-100,525.
 *   MFJ std ded $29,200.
 *   MFJ brackets:    10%/$0-23,200 · 12%/$23,200-94,300.
 *   FL has no state income tax.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-whatif-tests.ts
 */
import {
  applyWhatIfMutations,
  computeWhatIfDelta,
  runWhatIfScenario,
  runWhatIfScenarios,
  type WhatIfScenario,
} from "../../artifacts/api-server/src/lib/whatIfEngine";
import {
  computeTaxReturnPure,
  type ComputedTaxReturn,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { evaluatePlanningOpportunities } from "../../artifacts/api-server/src/lib/planningEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 1): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

function checkExact(label: string, actual: number | string, expected: number | string): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

function checkTruthy(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

/** Minimal-viable TaxReturnInputs (single, FL, $80k W-2, no kids). */
function baseInputs(extra: Partial<TaxReturnInputs> = {}): TaxReturnInputs {
  const client = {
    id: 1, firstName: "Test", lastName: "WhatIf",
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
    employerName: "Acme", employerEin: null,
    wagesBox1: "80000", federalWithholdingBox2: "0",
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

function adj(type: string, amount: number, id = 1000 + Math.floor(Math.random() * 1e6)): TaxReturnInputs["adjustments"][number] {
  return {
    id, clientId: 1, adjustmentType: type, amount: String(amount),
    description: `test ${type}`, category: null, isApplied: true,
    createdAt: new Date(), updatedAt: new Date(),
  } as unknown as TaxReturnInputs["adjustments"][number];
}

// ── Baseline sanity ───────────────────────────────────────────────────────
// Verify the hand-calc baseline before running any what-if math.
// $80k W-2 single FL: AGI $80,000; Std ded $14,600; Taxable $65,400.
// Federal tax = 10% × 11,600 + 12% × (47,150 − 11,600) + 22% × (65,400 − 47,150)
//             = 1,160 + 4,266 + 4,015 = $9,441.
{
  const r = computeTaxReturnPure(baseInputs());
  check("Baseline AGI ($80k W-2)", r.adjustedGrossIncome, 80000);
  check("Baseline std ded (TY2024 single)", r.standardDeduction, 14600);
  check("Baseline taxable income", r.taxableIncome, 65400);
  check("Baseline federal tax (22% bracket)", r.federalTaxLiability, 9441);
  check("Baseline state tax (FL = 0)", r.stateTaxLiability, 0);
}

// ── Case 1: Empty mutation list → zero delta ──────────────────────────────
{
  const scenario: WhatIfScenario = { label: "no-op", mutations: [] };
  const result = runWhatIfScenario(baseInputs(), scenario);
  check("Case 1 AGI delta (no-op)", result.delta.adjustedGrossIncome, 0);
  check("Case 1 federal tax delta (no-op)", result.delta.federalTaxLiability, 0);
  check("Case 1 state tax delta (no-op)", result.delta.stateTaxLiability, 0);
  check("Case 1 combined tax delta (no-op)", result.delta.combinedTaxDelta, 0);
  check("Case 1 combined refund delta (no-op)", result.delta.combinedRefundDelta, 0);
  checkExact("Case 1 label pass-through", result.label, "no-op");
  checkExact("Case 1 scenarioId default null", result.scenarioId, null);
}

// ── Case 2: Add $20k additional_income → AGI +$20k, tax +$4,400 ─────────────
// Hand-calc:
//   AGI: 80,000 → 100,000 (+20,000)
//   Taxable: 65,400 → 85,400 (+20,000)
//   Federal tax: 9,441 → 13,841 (+4,400 = 22% × 20,000, all in 22% bracket)
//   State (FL): 0 → 0
//   Combined tax delta: +4,400 (scenario INCREASES tax)
//   Refund delta: −4,400 (smaller refund because more tax owed)
{
  const result = runWhatIfScenario(baseInputs(), {
    label: "add 20k income",
    mutations: [{ kind: "add_adjustment", adjustmentType: "additional_income", amount: 20000 }],
  });
  check("Case 2 AGI delta", result.delta.adjustedGrossIncome, 20000);
  check("Case 2 taxable delta", result.delta.taxableIncome, 20000);
  check("Case 2 federal tax delta", result.delta.federalTaxLiability, 4400);
  check("Case 2 state tax delta (FL)", result.delta.stateTaxLiability, 0);
  check("Case 2 combined tax delta", result.delta.combinedTaxDelta, 4400);
  check("Case 2 combined refund delta", result.delta.combinedRefundDelta, -4400);
}

// ── Case 3: Add $5k `deduction` (above-the-line) → AGI −$5k, tax −$1,100 ────
// Hand-calc:
//   AGI: 80,000 → 75,000 (−5,000)
//   Taxable: 65,400 → 60,400 (−5,000, all in 22% bracket)
//   Federal tax: 9,441 → 8,341 (−1,100 = 22% × 5,000)
//   Combined tax delta: −1,100 (savings)
//   Refund delta: +1,100 (smaller owed → bigger refund)
{
  const result = runWhatIfScenario(baseInputs(), {
    label: "add 5k deduction",
    mutations: [{ kind: "add_adjustment", adjustmentType: "deduction", amount: 5000 }],
  });
  check("Case 3 AGI delta", result.delta.adjustedGrossIncome, -5000);
  check("Case 3 taxable delta", result.delta.taxableIncome, -5000);
  check("Case 3 federal tax delta", result.delta.federalTaxLiability, -1100);
  check("Case 3 combined tax delta (savings)", result.delta.combinedTaxDelta, -1100);
  check("Case 3 combined refund delta", result.delta.combinedRefundDelta, 1100);
}

// ── Case 4: Combined mutation — +$20k income AND −$5k deduction ─────────────
// Hand-calc:
//   AGI: 80,000 + 20,000 − 5,000 = 95,000 (delta +15,000)
//   Taxable: 95,000 − 14,600 = 80,400 (delta +15,000, still in 22% bracket)
//   Federal tax: 9,441 + 22% × 15,000 = 9,441 + 3,300 = 12,741 (delta +3,300)
{
  const result = runWhatIfScenario(baseInputs(), {
    label: "income up, deduction up",
    mutations: [
      { kind: "add_adjustment", adjustmentType: "additional_income", amount: 20000 },
      { kind: "add_adjustment", adjustmentType: "deduction", amount: 5000 },
    ],
  });
  check("Case 4 AGI delta", result.delta.adjustedGrossIncome, 15000);
  check("Case 4 taxable delta", result.delta.taxableIncome, 15000);
  check("Case 4 federal tax delta", result.delta.federalTaxLiability, 3300);
  check("Case 4 combined tax delta", result.delta.combinedTaxDelta, 3300);
}

// ── Case 5: set_adjustment REPLACES existing adjustment ─────────────────────
// Baseline has $10k additional_income; scenario sets it to $25k.
// Hand-calc:
//   Baseline AGI: 80,000 + 10,000 = 90,000; Taxable 75,400; Tax 9,441 + 22%×10,000 = 11,641.
//   Scenario AGI: 80,000 + 25,000 = 105,000; Taxable 90,400; Tax 9,441 + 22%×25,000 = 14,941.
//   Delta: AGI +15,000; Federal tax +3,300.
{
  const baseline = baseInputs({ adjustments: [adj("additional_income", 10000, 5001)] });
  const result = runWhatIfScenario(baseline, {
    label: "replace income with 25k",
    mutations: [{ kind: "set_adjustment", adjustmentType: "additional_income", amount: 25000 }],
  });
  check("Case 5 AGI delta (replace, not add)", result.delta.adjustedGrossIncome, 15000);
  check("Case 5 federal tax delta", result.delta.federalTaxLiability, 3300);
  // Sanity: baseline values reflect the original $10k of income
  check("Case 5 baseline AGI = 90k", result.baseline.adjustedGrossIncome, 90000);
  check("Case 5 scenario AGI = 105k", result.scenario.adjustedGrossIncome, 105000);
}

// ── Case 6: remove_adjustment strips matching rows ──────────────────────────
// Baseline has $20k of additional_income; scenario removes it.
//   Delta: AGI −$20,000; federal tax −$4,400.
{
  const baseline = baseInputs({ adjustments: [adj("additional_income", 20000, 6001)] });
  const result = runWhatIfScenario(baseline, {
    label: "drop additional income",
    mutations: [{ kind: "remove_adjustment", adjustmentType: "additional_income" }],
  });
  check("Case 6 AGI delta (remove)", result.delta.adjustedGrossIncome, -20000);
  check("Case 6 federal tax delta (remove)", result.delta.federalTaxLiability, -4400);
}

// ── Case 7: remove_adjustment that doesn't exist is a no-op ─────────────────
{
  const result = runWhatIfScenario(baseInputs(), {
    label: "remove non-existent",
    mutations: [{ kind: "remove_adjustment", adjustmentType: "iso_disqualifying_disposition_ordinary" }],
  });
  check("Case 7 AGI delta (no match)", result.delta.adjustedGrossIncome, 0);
  check("Case 7 federal tax delta (no match)", result.delta.federalTaxLiability, 0);
}

// ── Case 8: set_client_field swaps single → MFJ ─────────────────────────────
// $80k MFJ: AGI 80,000; Std ded 29,200; Taxable 50,800.
// MFJ brackets: 10%×23,200 + 12%×(50,800−23,200) = 2,320 + 3,312 = 5,632.
//   Single baseline tax: 9,441.
//   Delta federal tax: 5,632 − 9,441 = −3,809 (savings of $3,809).
// AGI unchanged (filing status doesn't change AGI). Std ded changes.
{
  const result = runWhatIfScenario(baseInputs(), {
    label: "switch to MFJ",
    mutations: [{ kind: "set_client_field", field: "filingStatus", value: "married_filing_jointly" }],
  });
  check("Case 8 AGI delta (filing status doesn't shift AGI)", result.delta.adjustedGrossIncome, 0);
  check("Case 8 std ded delta (single 14,600 → MFJ 29,200)", result.delta.standardDeduction, 14600);
  check("Case 8 taxable delta (lower because bigger std ded)", result.delta.taxableIncome, -14600);
  check("Case 8 federal tax delta (MFJ saves $3,809)", result.delta.federalTaxLiability, -3809);
  check("Case 8 combined tax delta", result.delta.combinedTaxDelta, -3809);
}

// ── Case 9: Purity — baseline inputs are NOT mutated ────────────────────────
{
  const baseline = baseInputs({ adjustments: [adj("additional_income", 5000, 9001)] });
  const adjBefore = JSON.stringify(baseline.adjustments);
  const clientBefore = JSON.stringify({ filingStatus: baseline.client.filingStatus, state: baseline.client.state });
  runWhatIfScenario(baseline, {
    label: "mutate everything",
    mutations: [
      { kind: "set_adjustment", adjustmentType: "additional_income", amount: 99999 },
      { kind: "add_adjustment", adjustmentType: "deduction", amount: 12345 },
      { kind: "remove_adjustment", adjustmentType: "additional_income" },
      { kind: "set_client_field", field: "filingStatus", value: "head_of_household" },
      { kind: "set_client_field", field: "state", value: "CA" },
    ],
  });
  checkExact("Case 9 baseline adjustments not mutated", JSON.stringify(baseline.adjustments), adjBefore);
  checkExact(
    "Case 9 baseline client not mutated",
    JSON.stringify({ filingStatus: baseline.client.filingStatus, state: baseline.client.state }),
    clientBefore,
  );
}

// ── Case 10: applyWhatIfMutations returns a fresh object ────────────────────
{
  const baseline = baseInputs();
  const next = applyWhatIfMutations(baseline, [
    { kind: "add_adjustment", adjustmentType: "deduction", amount: 1000 },
  ]);
  checkTruthy("Case 10 returns a new TaxReturnInputs (not same ref)", next !== baseline);
  checkTruthy("Case 10 adjustments array is a fresh array", next.adjustments !== baseline.adjustments);
  check("Case 10 baseline adjustments still empty", baseline.adjustments.length, 0);
  check("Case 10 next adjustments has 1 row", next.adjustments.length, 1);
}

// ── Case 11: runWhatIfScenarios batches against shared baseline ─────────────
// Three scenarios run independently; each delta is computed from same baseline.
{
  const baseline = baseInputs();
  const scenarios: WhatIfScenario[] = [
    { scenarioId: "s1", label: "+20k income", mutations: [{ kind: "add_adjustment", adjustmentType: "additional_income", amount: 20000 }] },
    { scenarioId: "s2", label: "+5k deduction", mutations: [{ kind: "add_adjustment", adjustmentType: "deduction", amount: 5000 }] },
    { scenarioId: "s3", label: "no-op", mutations: [] },
  ];
  const results = runWhatIfScenarios(baseline, scenarios);
  check("Case 11 result count", results.length, 3);
  check("Case 11 s1 federal delta (+4,400)", results[0].delta.federalTaxLiability, 4400);
  check("Case 11 s2 federal delta (−1,100)", results[1].delta.federalTaxLiability, -1100);
  check("Case 11 s3 federal delta (0)", results[2].delta.federalTaxLiability, 0);
  checkExact("Case 11 s1 scenarioId", results[0].scenarioId, "s1");
  checkExact("Case 11 s2 label", results[1].label, "+5k deduction");
  // All scenarios share the same baseline computation (object identity)
  checkTruthy(
    "Case 11 baseline shared across scenarios (same ComputedTaxReturn ref)",
    results[0].baseline === results[1].baseline && results[1].baseline === results[2].baseline,
  );
}

// ── Case 12: computeWhatIfDelta — direct pair diff (no engine) ──────────────
// Pass two raw ComputedTaxReturn objects; verify field-level subtraction +
// itemized null handling + combined aggregates.
{
  const base = {
    adjustedGrossIncome: 100000, taxableIncome: 85400, standardDeduction: 14600,
    itemizedDeductions: null,
    qbiDeduction: 0,
    federalTaxLiability: 13841, stateTaxLiability: 0,
    selfEmploymentTax: 0, niitTax: 0, amtTax: 0, additionalMedicareTax: 0,
    eitc: 0, additionalChildTaxCredit: 0,
    federalRefundOrOwed: -3841, stateRefundOrOwed: 0,
    effectiveTaxRate: 0.13841,
  } as unknown as ComputedTaxReturn;
  const scen = {
    adjustedGrossIncome: 105000, taxableIncome: 88000, standardDeduction: 14600,
    itemizedDeductions: 20000, // switched to itemized in scenario
    qbiDeduction: 200,
    federalTaxLiability: 14400, stateTaxLiability: 350,
    selfEmploymentTax: 0, niitTax: 380, amtTax: 0, additionalMedicareTax: 0,
    eitc: 0, additionalChildTaxCredit: 0,
    federalRefundOrOwed: -4400, stateRefundOrOwed: -350,
    effectiveTaxRate: 0.1410,
  } as unknown as ComputedTaxReturn;
  const d = computeWhatIfDelta(base, scen);
  check("Case 12 AGI delta", d.adjustedGrossIncome, 5000);
  check("Case 12 itemized delta (null→20k)", d.itemizedDeductions, 20000);
  check("Case 12 QBI delta", d.qbiDeduction, 200);
  check("Case 12 NIIT delta", d.niitTax, 380);
  check("Case 12 federal tax delta", d.federalTaxLiability, 559);
  check("Case 12 state tax delta", d.stateTaxLiability, 350);
  check("Case 12 combined tax delta (federal + state)", d.combinedTaxDelta, 909);
  check("Case 12 combined refund delta", d.combinedRefundDelta, -909);
}

// ── Case 13: State tax delta non-zero for CA filer ──────────────────────────
// Switch baseline to CA. Add −$5k deduction. Federal delta = −$1,100 (22%).
// State delta should be negative (CA marginal ~9.3% at $80k taxable).
// We don't hard-code CA's exact delta (engine encapsulates the brackets +
// std ded); we assert the SIGN + bounds.
{
  const baseline = baseInputs();
  (baseline.client as { state: string }).state = "CA";
  ((baseline.w2s[0] as unknown) as { stateBox15: string }).stateBox15 = "CA";
  const result = runWhatIfScenario(baseline, {
    label: "5k deduction in CA",
    mutations: [{ kind: "add_adjustment", adjustmentType: "deduction", amount: 5000 }],
  });
  check("Case 13 federal tax delta (CA, same 22% bracket)", result.delta.federalTaxLiability, -1100);
  checkTruthy("Case 13 state tax delta < 0 (CA savings)", result.delta.stateTaxLiability < 0);
  checkTruthy(
    "Case 13 state delta within plausible CA marginal range (~$300-$500)",
    result.delta.stateTaxLiability >= -500 && result.delta.stateTaxLiability <= -300,
  );
  // Combined tax delta strictly more negative than federal alone (CA adds savings)
  checkTruthy(
    "Case 13 combined < federal alone (CA stacks)",
    result.delta.combinedTaxDelta < result.delta.federalTaxLiability,
  );
}

// ── Case 14: Mutation order matters (set then remove) ──────────────────────
// set_adjustment then remove_adjustment of the same type → net = removed.
// Baseline empty; mutations: set $30k then remove. Final state: no adjustment.
//   Delta: 0 across the board.
{
  const result = runWhatIfScenario(baseInputs(), {
    label: "set then remove",
    mutations: [
      { kind: "set_adjustment", adjustmentType: "additional_income", amount: 30000 },
      { kind: "remove_adjustment", adjustmentType: "additional_income" },
    ],
  });
  check("Case 14 AGI delta (set then remove = 0)", result.delta.adjustedGrossIncome, 0);
  check("Case 14 federal tax delta (set then remove = 0)", result.delta.federalTaxLiability, 0);
}

// ── Case 15: Multiple add_adjustment entries sum together ──────────────────
// Three $5k charitable_cash adjustments → adds $15k itemized (engine sums).
// At $80k AGI single, std ded $14,600 → still chooses std ded (15,000 > 14,600
// itemized would only be $15k if no SALT etc. — wait: itemized total is just
// the $15k charity here, which JUST barely beats std ded).
// Itemized = $15,000; chosen ded = max($14,600, $15,000) = $15,000.
// Taxable = 80,000 − 15,000 = 65,000.
// Tax = 1,160 + 4,266 + 22% × (65,000 − 47,150) = 1,160 + 4,266 + 3,927 = 9,353.
// Federal tax delta = 9,353 − 9,441 = −88.
{
  const result = runWhatIfScenario(baseInputs(), {
    label: "three charitable adj",
    mutations: [
      { kind: "add_adjustment", adjustmentType: "charitable_cash", amount: 5000 },
      { kind: "add_adjustment", adjustmentType: "charitable_cash", amount: 5000 },
      { kind: "add_adjustment", adjustmentType: "charitable_cash", amount: 5000 },
    ],
  });
  check("Case 15 federal tax delta (3×$5k charity, itemize)", result.delta.federalTaxLiability, -88);
}

// ── Case 16: scenarioId pass-through ─────────────────────────────────────
{
  const result = runWhatIfScenario(baseInputs(), {
    scenarioId: "G1.1-sep-14800",
    label: "SEP-IRA $14,800",
    mutations: [],
  });
  checkExact("Case 16 scenarioId pass-through", result.scenarioId, "G1.1-sep-14800");
}

// ── Case 17: result.baseline matches direct computeTaxReturnPure ───────────
{
  const inp = baseInputs();
  const direct = computeTaxReturnPure(inp);
  const result = runWhatIfScenario(inp, { label: "noop", mutations: [] });
  check("Case 17 baseline AGI matches direct compute", result.baseline.adjustedGrossIncome, direct.adjustedGrossIncome);
  check("Case 17 baseline federal tax matches direct compute", result.baseline.federalTaxLiability, direct.federalTaxLiability);
  check("Case 17 scenario equals baseline (noop)", result.scenario.federalTaxLiability, direct.federalTaxLiability);
}

// ── Case 18: Refund delta sign convention ─────────────────────────────────
// Baseline: $80k W-2 no withholding → owed $9,441 (refundOrOwed = −9,441).
// Scenario: add $5k deduction → owed $8,341 (refundOrOwed = −8,341).
// combinedRefundDelta = (−8,341) − (−9,441) = +1,100 (less-owed = bigger
// "refund" in the engine's sign convention).
{
  const result = runWhatIfScenario(baseInputs(), {
    label: "5k deduction",
    mutations: [{ kind: "add_adjustment", adjustmentType: "deduction", amount: 5000 }],
  });
  check("Case 18 federalRefundOrOwed delta = +1,100", result.delta.federalRefundOrOwed, 1100);
  check("Case 18 combinedRefundDelta = +1,100", result.delta.combinedRefundDelta, 1100);
  // Confirm sign convention: combinedTaxDelta is OPPOSITE sign of refund delta
  check("Case 18 combinedTaxDelta = −1,100 (opposite)", result.delta.combinedTaxDelta, -1100);
}

// ── Case 19: isApplied=false adjustments in baseline preserved through mutation ─
// A disabled adjustment in baseline should remain disabled after the mutation —
// not silently re-enabled or removed.
{
  const disabled = adj("additional_income", 99999, 19001);
  (disabled as unknown as { isApplied: boolean }).isApplied = false;
  const baseline = baseInputs({ adjustments: [disabled] });
  const next = applyWhatIfMutations(baseline, [
    { kind: "add_adjustment", adjustmentType: "deduction", amount: 1000 },
  ]);
  const stillDisabled = next.adjustments.find((a) => a.adjustmentType === "additional_income");
  checkTruthy("Case 19 disabled adjustment preserved", stillDisabled != null);
  checkExact("Case 19 disabled adjustment stays disabled", (stillDisabled as unknown as { isApplied: boolean }).isApplied, false);
}

// ── Case 20: Empty mutation list returns same-ref adjustments (shallow optimization tolerance) ─
// Even with no mutations, the returned object must NOT be the same reference
// (so callers can safely mutate the result without aliasing the baseline).
{
  const baseline = baseInputs();
  const next = applyWhatIfMutations(baseline, []);
  checkTruthy("Case 20 returns new top-level object even with no mutations", next !== baseline);
  // adjustments must be a fresh array (so callers don't accidentally mutate baseline)
  checkTruthy("Case 20 adjustments array fresh even with no mutations", next.adjustments !== baseline.adjustments);
}

// ── Detector wiring (G1.1 SEP-IRA + H2) ──────────────────────────────────
// Verify the planning engine attaches a whatIfDelta when baselineInputs is
// supplied, and leaves it undefined when not. Sets up a self-employed FL
// filer that triggers the SEP-IRA detector and inspects the resulting hit.

function buildSeFilerInputs(): TaxReturnInputs {
  const client = {
    id: 99, firstName: "SE", lastName: "Test",
    email: "se@example.com", phone: null,
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
  const form1099 = {
    id: 1, clientId: 99, taxYear: 2024, documentId: null,
    formType: "nec",
    payerName: "Test Client LLC", payerEin: null, payerAddress: null,
    recipientName: null, recipientTin: null, recipientAddress: null,
    nonemployeeCompensation: "120000",
    federalTaxWithheld: "0", stateTaxWithheld: "0", stateCode: null,
    spouse: null, createdAt: new Date(), updatedAt: new Date(),
  };
  return {
    client: client as TaxReturnInputs["client"],
    w2s: [],
    form1099s: [form1099 as unknown as TaxReturnInputs["form1099s"][number]],
    adjustments: [],
    taxYear: 2024,
  };
}

// Case D1: baselineInputs supplied → whatIfDelta attached on SEP hit.
//
// Hand-calc (SE $120k single FL 2024):
//   Net SE = 120,000 × 0.9235 = $110,820.
//   SE tax = 110,820 × 0.153 ≈ $16,955.
//   Half-SE = $8,478.
//   SEP contribution = (110,820 − 8,478) × 0.20 = $20,468.
//
//   Baseline AGI = 120,000 − 8,478 = 111,522. Taxable = 111,522 − 14,600 = 96,922.
//     Fed tax on $96,922 single 2024:
//       10%×11,600 + 12%×(47,150−11,600) + 22%×(96,922−47,150)
//       = 1,160 + 4,266 + 10,950 = 16,376. Plus SE tax 16,955 = 33,331.
//   Scenario (with +$20,468 deduction): AGI = 91,054. Taxable = 76,454.
//     Fed tax = 1,160 + 4,266 + 22%×(76,454−47,150) = 1,160 + 4,266 + 6,447 = 11,873.
//     Plus SE tax 16,955 = 28,828.
//   Federal tax delta = 28,828 − 33,331 = −$4,503.
//   Heuristic estSavings = contribution × marginal = 20,468 × 0.22 = $4,503 (matches in
//     this case because we stay within the 22% bracket; H2 confirms the heuristic).
{
  const inputs = buildSeFilerInputs();
  const computed = computeTaxReturnPure(inputs);
  const hitsWith = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
  const sepWith = hitsWith.find((h) => h.strategyId === "G1.1");
  checkTruthy("Case D1 SEP hit fires", sepWith != null);
  checkTruthy("Case D1 whatIfDelta attached", sepWith?.whatIfDelta != null);
  if (sepWith?.whatIfDelta) {
    check(
      "Case D1 whatIfDelta.federalTaxLiability ≈ −$4,503 (hand-calc)",
      sepWith.whatIfDelta.federalTaxLiability,
      -4503,
      2,
    );
    check(
      "Case D1 whatIfDelta.combinedTaxDelta = federal (FL no state tax)",
      sepWith.whatIfDelta.combinedTaxDelta,
      sepWith.whatIfDelta.federalTaxLiability,
    );
    // Heuristic estSavings is reported as a positive savings number; whatIfDelta
    // is the engine arithmetic so combinedTaxDelta is negative (tax reduced).
    check(
      "Case D1 estSavings ≈ |combinedTaxDelta| (heuristic matches engine in 22% bracket)",
      sepWith.estSavings,
      Math.abs(sepWith.whatIfDelta.combinedTaxDelta),
      5,
    );
  }
}

// Case D2: NO baselineInputs supplied → whatIfDelta undefined. Confirms the
// planning-hit-list path (which skips H2 for perf) still works.
{
  const inputs = buildSeFilerInputs();
  const computed = computeTaxReturnPure(inputs);
  const hitsWithout = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
  });
  const sepWithout = hitsWithout.find((h) => h.strategyId === "G1.1");
  checkTruthy("Case D2 SEP hit fires without baselineInputs", sepWithout != null);
  checkTruthy("Case D2 whatIfDelta absent when baselineInputs omitted", sepWithout?.whatIfDelta == null);
  check("Case D2 estSavings still computed via heuristic", sepWithout!.estSavings, 4503, 5);
}

// ── Print results ─────────────────────────────────────────────────────────
console.log(`\nH2 What-If engine tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) {
  FAIL.forEach((f) => console.log(`    ${f}`));
}
process.exit(FAIL.length > 0 ? 1 : 0);
