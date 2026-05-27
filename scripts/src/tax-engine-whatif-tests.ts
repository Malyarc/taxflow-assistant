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
import {
  evaluatePlanningOpportunities,
  evaluateCrossStrategyScenario,
} from "../../artifacts/api-server/src/lib/planningEngine";

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
  checkTruthy("Case D1 whatIf attached", sepWith?.whatIf != null);
  checkTruthy("Case D1 whatIf.mutations populated", (sepWith?.whatIf?.mutations?.length ?? 0) === 1);
  checkExact("Case D1 whatIf.semantics = savings", sepWith?.whatIf?.semantics, "savings");
  if (sepWith?.whatIf) {
    check(
      "Case D1 whatIf.delta.federalTaxLiability ≈ −$4,503 (hand-calc)",
      sepWith.whatIf.delta.federalTaxLiability,
      -4503,
      2,
    );
    check(
      "Case D1 whatIf.delta.combinedTaxDelta = federal (FL no state tax)",
      sepWith.whatIf.delta.combinedTaxDelta,
      sepWith.whatIf.delta.federalTaxLiability,
    );
    // Heuristic estSavings is reported as a positive savings number; whatIf.delta
    // is the engine arithmetic so combinedTaxDelta is negative (tax reduced).
    check(
      "Case D1 estSavings ≈ |combinedTaxDelta| (heuristic matches engine in 22% bracket)",
      sepWith.estSavings,
      Math.abs(sepWith.whatIf.delta.combinedTaxDelta),
      5,
    );
    // H12 sensitivity range — should be present for SEP (variable amount)
    checkTruthy("Case D1 sensitivity range present", sepWith.whatIf.sensitivity != null);
    if (sepWith.whatIf.sensitivity) {
      checkTruthy(
        "Case D1 sensitivity low < mid < high",
        sepWith.whatIf.sensitivity.low < sepWith.whatIf.sensitivity.mid &&
          sepWith.whatIf.sensitivity.mid < sepWith.whatIf.sensitivity.high,
      );
      // Mid should equal |combinedRefundDelta| (the customer-facing magnitude;
      // see runDetectorWhatIf comment for why we use refundDelta not taxDelta).
      check(
        "Case D1 sensitivity.mid = |combinedRefundDelta|",
        sepWith.whatIf.sensitivity.mid,
        Math.abs(Math.round(sepWith.whatIf.delta.combinedRefundDelta)),
        1,
      );
    }
  }
  // H12 assumptions list populated (5 entries from detectSepIra)
  checkTruthy("Case D1 assumptions populated", Array.isArray(sepWith?.assumptions) && (sepWith?.assumptions?.length ?? 0) >= 3);
}

// Case D2: NO baselineInputs supplied → whatIf undefined. Confirms the
// planning-hit-list path (which skips H2 for perf) still works.
// Assumptions array is still populated (no I/O dependency).
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
  checkTruthy("Case D2 whatIf absent when baselineInputs omitted", sepWithout?.whatIf == null);
  checkTruthy("Case D2 assumptions still populated (no I/O dep)", Array.isArray(sepWithout?.assumptions));
  check("Case D2 estSavings still computed via heuristic", sepWithout!.estSavings, 4503, 5);
}

// ── Case D3: NIIT cliff detector (G1.6) — H2 wire-up ──────────────────────
// Build a single FL client with AGI ~$205k just above NIIT threshold ($200k
// single) with investment income $10k.
//
// Hand-calc:
//   - W-2 $200k + $5k 1099-INT interest → AGI $205,000.
//   - Excess above NIIT threshold: $5,000.
//   - Baseline NIIT: min($5k NII, $5k excess) × 3.8% = $190.
//   - Federal marginal at $205k single TY2024: 32% (190,400 vs 191,950
//     means a slice still in 24%; let me recompute):
//       Taxable = 205,000 − 14,600 = 190,400. 24% bracket goes 100,525-191,950.
//       So baseline is at 24% marginal.
//   - H2 mutation: add $5,000 `deduction` → AGI 200,000 → NIIT 0 (excess goes
//     from $5k to $0).
//     Taxable = 200,000 − 14,600 = 185,400 (down $5k from baseline).
//     Federal tax delta = -$5,000 × 24% = -$1,200.
//     NIIT delta = -$190.
//     Combined fed tax delta = -$1,200 + -$190 = -$1,390.
//   - H2 reports MUCH MORE savings than the heuristic ($190 NIIT only).
//     This is correct — the strategy IS adding a tax-deferred contribution.
{
  const niitInputs = baseInputs({
    w2s: [{
      id: 1, clientId: 1, taxYear: 2024, documentId: null,
      employerName: "Big Co", employerEin: null,
      wagesBox1: "200000", federalWithholdingBox2: "0",
      socialSecurityWagesBox3: "168600", socialSecurityTaxBox4: "0",
      medicareWagesBox5: "200000", medicareTaxBox6: "0",
      socialSecurityTipsBox7: "0", allocatedTipsBox8: "0",
      dependentCareBenefitsBox10: "0", nonqualifiedPlansBox11: "0",
      box12aCode: null, box12aAmount: "0", box12bCode: null, box12bAmount: "0",
      box12cCode: null, box12cAmount: "0", box12dCode: null, box12dAmount: "0",
      statutoryEmployeeBox13: false, retirementPlanBox13: false, thirdPartySickPayBox13: false,
      box14Description: null, box14Amount: "0",
      stateBox15: "FL", stateWagesBox16: "200000", stateTaxBox17: "0",
      localWagesBox18: "0", localTaxBox19: "0", localityNameBox20: null,
      spouse: null, createdAt: new Date(), updatedAt: new Date(),
    } as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [{
      id: 10, clientId: 1, taxYear: 2024, documentId: null,
      formType: "int",
      payerName: "Vanguard", payerEin: null, payerAddress: null,
      recipientName: null, recipientTin: null, recipientAddress: null,
      interestIncome: "5000",
      federalTaxWithheld: "0", stateTaxWithheld: "0", stateCode: null,
      spouse: null, createdAt: new Date(), updatedAt: new Date(),
    } as unknown as TaxReturnInputs["form1099s"][number]],
  });
  const computed = computeTaxReturnPure(niitInputs);
  const hits = evaluatePlanningOpportunities({
    client: niitInputs.client,
    computed,
    adjustments: niitInputs.adjustments,
    baselineInputs: niitInputs,
  });
  const niitHit = hits.find((h) => h.strategyId === "G1.6");
  checkTruthy("Case D3 NIIT hit fires", niitHit != null);
  if (niitHit) {
    checkTruthy("Case D3 NIIT whatIf attached", niitHit.whatIf != null);
    checkExact("Case D3 NIIT semantics = savings", niitHit.whatIf?.semantics, "savings");
    if (niitHit.whatIf) {
      check(
        "Case D3 NIIT combinedTaxDelta ≈ -$1,390 (NIIT + ordinary 24%)",
        niitHit.whatIf.delta.combinedTaxDelta,
        -1390,
        5,
      );
      check(
        "Case D3 NIIT niitTax delta = -$190 (eliminates NIIT)",
        niitHit.whatIf.delta.niitTax,
        -190,
        2,
      );
      check(
        "Case D3 NIIT AGI delta = -$5,000",
        niitHit.whatIf.delta.adjustedGrossIncome,
        -5000,
        1,
      );
    }
    checkTruthy("Case D3 NIIT assumptions populated", Array.isArray(niitHit.assumptions));
  }
}

// ── Case D4: Tax-loss harvesting (G1.9) — H2 wire-up ──────────────────────
// Single FL filer with $80k W-2 and $5k LTCG (so detector fires — has cap
// market activity). Harvest the $3,000 cap.
//
// Hand-calc:
//   - Baseline: $80k W-2 + $5k LTCG.
//     AGI = $85,000 (LTCG is in AGI per CLAUDE.md invariant 1).
//     Taxable = 85,000 − 14,600 = 70,400. But ordinary portion =
//     70,400 − 5,000 LTCG = 65,400 (LTCG taxed at preferential).
//     Federal tax: ordinary $9,441 + LTCG 0% (below $47,025 threshold...
//     wait single LTCG 0% threshold TY2024 is $47,025 taxable. 65,400 is
//     above, so LTCG is at 15%: 5,000 × 15% = $750. Total $10,191.
//   - H2 mutation: add `capital_loss_carryforward_short` of $3,000.
//     The harvested loss offsets first LTCG, then if any left, ordinary
//     via the $3k cap. Actually short-term loss offsets short-term first,
//     then long-term, then ordinary up to $3k.
//     Engine behavior: the $3k STCG loss reduces total net cap gain by
//     $3k. So net cap gain = 5,000 LTCG − 3,000 ST loss carryforward =
//     $2,000 (still treated as LTCG since LTCG > ST loss).
//     Taxable income = 80,000 + 2,000 − 14,600 = 67,400.
//     Federal tax: ordinary on 67,400 − 2,000 LTCG = 65,400; tax = $9,441.
//     LTCG at 15% on $2,000 = $300.
//     Total fed tax = $9,741.
//   - Federal tax delta = 9,741 − 10,191 = -$450.
//
// Note: this DIFFERS from the heuristic ($3,000 × 22% = $660). The H2 is
// more accurate — the loss first offsets LTCG (taxed at 15%, not 22%), so
// the real savings is 3,000 × 15% = $450.
{
  const tlhInputs = baseInputs({
    form1099s: [{
      id: 20, clientId: 1, taxYear: 2024, documentId: null,
      formType: "b",
      payerName: "Fidelity", payerEin: null, payerAddress: null,
      recipientName: null, recipientTin: null, recipientAddress: null,
      longTermGainLoss: "5000", shortTermGainLoss: "0",
      proceeds: "10000", costBasis: "5000",
      federalTaxWithheld: "0", stateTaxWithheld: "0", stateCode: null,
      spouse: null, createdAt: new Date(), updatedAt: new Date(),
    } as unknown as TaxReturnInputs["form1099s"][number]],
  });
  const computed = computeTaxReturnPure(tlhInputs);
  const hits = evaluatePlanningOpportunities({
    client: tlhInputs.client,
    computed,
    adjustments: tlhInputs.adjustments,
    baselineInputs: tlhInputs,
  });
  const tlhHit = hits.find((h) => h.strategyId === "G1.9");
  checkTruthy("Case D4 TLH hit fires", tlhHit != null);
  if (tlhHit) {
    checkTruthy("Case D4 TLH whatIf attached", tlhHit.whatIf != null);
    checkExact("Case D4 TLH semantics = savings", tlhHit.whatIf?.semantics, "savings");
    if (tlhHit.whatIf) {
      // H2-verified federal delta should be NEGATIVE (savings) — actual value
      // depends on whether loss offsets LTCG (15%) or ordinary (22%).
      checkTruthy(
        "Case D4 TLH combinedTaxDelta < 0 (savings)",
        tlhHit.whatIf.delta.combinedTaxDelta < 0,
      );
      // Heuristic was $3k × 22% = $660; H2 is the actual engine number.
      // Should be within a reasonable range (say -$200 to -$800).
      checkTruthy(
        "Case D4 TLH savings within plausible $200-$800 range",
        Math.abs(tlhHit.whatIf.delta.combinedTaxDelta) >= 200 &&
          Math.abs(tlhHit.whatIf.delta.combinedTaxDelta) <= 800,
      );
    }
    checkTruthy(
      "Case D4 TLH no sensitivity (fixed $3k cap)",
      tlhHit.whatIf?.sensitivity == null,
    );
  }
}

// ── Case D5: FTC unclaimed (G1.10) — H2 wire-up ──────────────────────────
// G1.10 fires when Form 1116 has been attempted (`foreign_source_taxable_income`
// adjustment present) but the limit binds the credit below paid. Setup:
// $100k W-2 single FL + $5,000 foreign tax paid + $5,000 fst supplied.
//
// Hand-calc:
//   - Baseline: AGI $100k, std ded $14,600, taxable $85,400.
//     Federal tax (pre-credit) = $13,841.
//     Form 1116 limit = (fst / tti) × pre_credit_tax = (5,000 / 85,400) ×
//     13,841 ≈ $810. Engine claims min($5,000 paid, $810 limit) = $810.
//     Net fed tax = 13,841 − 810 = $13,031.
//     recoverable = 5,000 − 810 = $4,190 → G1.10 fires.
//   - H2 mutation: set fst to max(85,400, 25,000) = $85,400.
//     New limit = (85,400 / 85,400) × 13,841 = $13,841 → bound at paid $5,000.
//     Full FTC claimed. Net fed tax = 13,841 − 5,000 = $8,841.
//   - Federal tax delta = 8,841 − 13,031 = -$4,190.
{
  const ftcInputs = baseInputs({
    w2s: [{
      id: 1, clientId: 1, taxYear: 2024, documentId: null,
      employerName: "Big Co", employerEin: null,
      wagesBox1: "100000", federalWithholdingBox2: "0",
      socialSecurityWagesBox3: "100000", socialSecurityTaxBox4: "0",
      medicareWagesBox5: "100000", medicareTaxBox6: "0",
      socialSecurityTipsBox7: "0", allocatedTipsBox8: "0",
      dependentCareBenefitsBox10: "0", nonqualifiedPlansBox11: "0",
      box12aCode: null, box12aAmount: "0", box12bCode: null, box12bAmount: "0",
      box12cCode: null, box12cAmount: "0", box12dCode: null, box12dAmount: "0",
      statutoryEmployeeBox13: false, retirementPlanBox13: false, thirdPartySickPayBox13: false,
      box14Description: null, box14Amount: "0",
      stateBox15: "FL", stateWagesBox16: "100000", stateTaxBox17: "0",
      localWagesBox18: "0", localTaxBox19: "0", localityNameBox20: null,
      spouse: null, createdAt: new Date(), updatedAt: new Date(),
    } as unknown as TaxReturnInputs["w2s"][number]],
    adjustments: [
      adj("foreign_tax_paid", 5000, 5001),
      // Small foreign source income → Form 1116 limit binds well below paid.
      adj("foreign_source_taxable_income", 5000, 5002),
    ],
  });
  const computed = computeTaxReturnPure(ftcInputs);
  const hits = evaluatePlanningOpportunities({
    client: ftcInputs.client,
    computed,
    adjustments: ftcInputs.adjustments,
    baselineInputs: ftcInputs,
  });
  const ftcHit = hits.find((h) => h.strategyId === "G1.10");
  checkTruthy("Case D5 FTC hit fires", ftcHit != null);
  if (ftcHit) {
    checkTruthy("Case D5 FTC whatIf attached", ftcHit.whatIf != null);
    if (ftcHit.whatIf) {
      // For credit-based strategies, federalTaxLiability is pre-credit and
      // doesn't change. The savings show in combinedRefundDelta (post-credit).
      // Hand-calc: FTC goes from $810 to $5,000, refund delta = +$4,190.
      check(
        "Case D5 FTC combinedTaxDelta ≈ 0 (pre-credit unchanged)",
        ftcHit.whatIf.delta.combinedTaxDelta,
        0,
        5,
      );
      checkTruthy(
        "Case D5 FTC combinedRefundDelta > 0 (savings via credit)",
        ftcHit.whatIf.delta.combinedRefundDelta > 0,
      );
      checkTruthy(
        "Case D5 FTC refund savings within $3,500-$4,500 range (hand-calc +$4,190)",
        ftcHit.whatIf.delta.combinedRefundDelta >= 3500 &&
          ftcHit.whatIf.delta.combinedRefundDelta <= 4500,
      );
    }
    checkTruthy("Case D5 FTC no sensitivity (fixed gap)", ftcHit.whatIf?.sensitivity == null);
  }
}

// ── Case D6: Roth conversion (G1.4) — H2 wire-up with "cost" semantics ─────
// Single FL $50k W-2 client (12% bracket; has bracket headroom to top of
// 12% at $47,150 taxable). Strategy: convert IRA up to top of bracket.
//
// Hand-calc:
//   - Baseline AGI $50k, std ded $14,600, taxable $35,400.
//     Federal tax: 10%×11,600 + 12%×(35,400−11,600) = 1,160 + 2,856 = $4,016.
//     Marginal rate at $35,400 = 12% (in the 12% bracket).
//   - Bracket top for 12% single TY2024 = $47,150 taxable.
//     Headroom = 47,150 − 35,400 = $11,750.
//   - H2 mutation: add `additional_income` of $11,750.
//     New AGI = 61,750. Taxable = 47,150 (exactly fills 12% bracket).
//     Federal tax: 1,160 + 12%×(47,150−11,600) = 1,160 + 4,266 = $5,426.
//   - Federal tax delta = 5,426 − 4,016 = +$1,410 (COST).
//   - This is the CURRENT-YEAR COST. The semantic is "cost", not "savings".
//   - Heuristic estSavings = 11,750 × (32% − 12%) = $2,350 — the long-term
//     net benefit. Both pieces of info matter.
{
  const rothInputs = baseInputs({
    w2s: [{
      id: 1, clientId: 1, taxYear: 2024, documentId: null,
      employerName: "Acme", employerEin: null,
      wagesBox1: "50000", federalWithholdingBox2: "0",
      socialSecurityWagesBox3: "50000", socialSecurityTaxBox4: "0",
      medicareWagesBox5: "50000", medicareTaxBox6: "0",
      socialSecurityTipsBox7: "0", allocatedTipsBox8: "0",
      dependentCareBenefitsBox10: "0", nonqualifiedPlansBox11: "0",
      box12aCode: null, box12aAmount: "0", box12bCode: null, box12bAmount: "0",
      box12cCode: null, box12cAmount: "0", box12dCode: null, box12dAmount: "0",
      statutoryEmployeeBox13: false, retirementPlanBox13: false, thirdPartySickPayBox13: false,
      box14Description: null, box14Amount: "0",
      stateBox15: "FL", stateWagesBox16: "50000", stateTaxBox17: "0",
      localWagesBox18: "0", localTaxBox19: "0", localityNameBox20: null,
      spouse: null, createdAt: new Date(), updatedAt: new Date(),
    } as unknown as TaxReturnInputs["w2s"][number]],
  });
  const computed = computeTaxReturnPure(rothInputs);
  const hits = evaluatePlanningOpportunities({
    client: rothInputs.client,
    computed,
    adjustments: rothInputs.adjustments,
    baselineInputs: rothInputs,
  });
  const rothHit = hits.find((h) => h.strategyId === "G1.4");
  checkTruthy("Case D6 Roth hit fires", rothHit != null);
  if (rothHit) {
    checkTruthy("Case D6 Roth whatIf attached", rothHit.whatIf != null);
    checkExact("Case D6 Roth semantics = cost", rothHit.whatIf?.semantics, "cost");
    if (rothHit.whatIf) {
      check(
        "Case D6 Roth combinedTaxDelta ≈ +$1,410 (CURRENT-YEAR COST)",
        rothHit.whatIf.delta.combinedTaxDelta,
        1410,
        10,
      );
      // estSavings is long-term net benefit; should be ~$2,350
      check(
        "Case D6 Roth estSavings ≈ +$2,350 (long-term spread benefit)",
        rothHit.estSavings,
        2350,
        10,
      );
      // Sensitivity should be present (variable conversion amount)
      checkTruthy(
        "Case D6 Roth sensitivity present",
        rothHit.whatIf.sensitivity != null,
      );
    }
  }
}

// ── Case D7: Hit-list path skips H2 — backward compat for all detectors ────
// Confirm that when baselineInputs is omitted, NONE of the H2-wired
// detectors crash; they all return hits with `whatIf` undefined and
// `assumptions` populated. This is the /planning-hit-list endpoint behavior.
{
  // Use a high-income client likely to fire multiple detectors
  const heavyInputs = baseInputs({
    w2s: [{
      id: 1, clientId: 1, taxYear: 2024, documentId: null,
      employerName: "Big Co", employerEin: null,
      wagesBox1: "205000", federalWithholdingBox2: "0",
      socialSecurityWagesBox3: "168600", socialSecurityTaxBox4: "0",
      medicareWagesBox5: "205000", medicareTaxBox6: "0",
      socialSecurityTipsBox7: "0", allocatedTipsBox8: "0",
      dependentCareBenefitsBox10: "0", nonqualifiedPlansBox11: "0",
      box12aCode: null, box12aAmount: "0", box12bCode: null, box12bAmount: "0",
      box12cCode: null, box12cAmount: "0", box12dCode: null, box12dAmount: "0",
      statutoryEmployeeBox13: false, retirementPlanBox13: false, thirdPartySickPayBox13: false,
      box14Description: null, box14Amount: "0",
      stateBox15: "FL", stateWagesBox16: "205000", stateTaxBox17: "0",
      localWagesBox18: "0", localTaxBox19: "0", localityNameBox20: null,
      spouse: null, createdAt: new Date(), updatedAt: new Date(),
    } as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [{
      id: 30, clientId: 1, taxYear: 2024, documentId: null,
      formType: "int",
      payerName: "Vanguard", payerEin: null, payerAddress: null,
      interestIncome: "5000",
      federalTaxWithheld: "0", stateTaxWithheld: "0", stateCode: null,
      spouse: null, createdAt: new Date(), updatedAt: new Date(),
    } as unknown as TaxReturnInputs["form1099s"][number]],
  });
  const computed = computeTaxReturnPure(heavyInputs);
  const hits = evaluatePlanningOpportunities({
    client: heavyInputs.client,
    computed,
    adjustments: heavyInputs.adjustments,
    // baselineInputs intentionally omitted
  });
  let allOk = true;
  for (const h of hits) {
    if (h.whatIf != null) {
      allOk = false;
      break;
    }
  }
  checkTruthy("Case D7 all hits omit whatIf when baselineInputs absent", allOk);
  checkTruthy("Case D7 at least one hit still fires (heuristic path)", hits.length > 0);
}

// ── Case D8: H7 cross-strategy combined scenario ──────────────────────────
// Build a high-AGI SE filer with foreign tax + investment income. Multiple
// detectors should fire (SEP, possibly NIIT, possibly FTC). Verify the
// cross-strategy aggregator:
//   - Fires when ≥2 stackable hits present
//   - Returns combinedDelta from joint scenario
//   - sumOfIndividualSavings = sum of each hit's |combinedRefundDelta|
//   - interactionEffect = jointSavings - sumOfIndividualSavings
//     (typically negative due to bracket-stacking erosion)
{
  const heavyInputs = baseInputs({
    form1099s: [
      {
        id: 1, clientId: 1, taxYear: 2024, documentId: null,
        formType: "nec",
        payerName: "Client A", payerEin: null, payerAddress: null,
        nonemployeeCompensation: "200000",
        federalTaxWithheld: "0", stateTaxWithheld: "0", stateCode: null,
        spouse: null, createdAt: new Date(), updatedAt: new Date(),
      } as unknown as TaxReturnInputs["form1099s"][number],
      {
        id: 2, clientId: 1, taxYear: 2024, documentId: null,
        formType: "int",
        payerName: "Vanguard", payerEin: null, payerAddress: null,
        interestIncome: "8000",
        federalTaxWithheld: "0", stateTaxWithheld: "0", stateCode: null,
        spouse: null, createdAt: new Date(), updatedAt: new Date(),
      } as unknown as TaxReturnInputs["form1099s"][number],
    ],
    w2s: [],
  });
  const computed = computeTaxReturnPure(heavyInputs);
  const hits = evaluatePlanningOpportunities({
    client: heavyInputs.client,
    computed,
    adjustments: heavyInputs.adjustments,
    baselineInputs: heavyInputs,
  });
  const stackable = hits.filter((h) => h.whatIf?.semantics === "savings");
  // For this scenario expect at least SEP (G1.1) to fire; may or may not
  // fire NIIT depending on whether AGI is in the cliff band.
  checkTruthy("Case D8 at least one savings hit fires", stackable.length >= 1);

  const xstrat = evaluateCrossStrategyScenario({
    hits,
    baselineInputs: heavyInputs,
  });
  if (stackable.length >= 2) {
    checkTruthy("Case D8 cross-strategy returned for >= 2 stackable hits", xstrat != null);
    if (xstrat) {
      check(
        "Case D8 stackedStrategyIds length matches stackable count",
        xstrat.stackedStrategyIds.length,
        stackable.length,
      );
      checkTruthy(
        "Case D8 sumOfIndividualSavings > 0",
        xstrat.sumOfIndividualSavings > 0,
      );
      // Joint savings (|combinedDelta.combinedRefundDelta|) should be in
      // a plausible neighborhood of the sum — interaction effect should
      // be a modest fraction (not larger than the sum itself).
      const jointSavings = Math.abs(Math.round(xstrat.combinedDelta.combinedRefundDelta));
      checkTruthy("Case D8 joint savings > 0", jointSavings > 0);
      checkTruthy(
        "Case D8 interactionEffect = jointSavings - sumOfIndividualSavings",
        xstrat.interactionEffect === jointSavings - xstrat.sumOfIndividualSavings,
      );
    }
  } else {
    checkTruthy("Case D8 cross-strategy undefined when < 2 stackable", xstrat == null);
  }
}

// ── Case D9: H7 omitted when 0 stackable hits ────────────────────────────
// Pure-W-2 client with no SE, no investment — should produce no H2 hits.
{
  const inputs = baseInputs(); // $80k W-2 single FL, nothing else
  const computed = computeTaxReturnPure(inputs);
  const hits = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
  const xstrat = evaluateCrossStrategyScenario({
    hits,
    baselineInputs: inputs,
  });
  // Either no hits or all heuristic-only; in either case, < 2 stackable.
  checkTruthy("Case D9 cross-strategy undefined for pure-W-2 client", xstrat == null);
}

// ── Print results ─────────────────────────────────────────────────────────
console.log(`\nH2 What-If engine tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) {
  FAIL.forEach((f) => console.log(`    ${f}`));
}
process.exit(FAIL.length > 0 ? 1 : 0);
