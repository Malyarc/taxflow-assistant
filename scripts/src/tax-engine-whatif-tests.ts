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
// Hand-calc (SE $120k single FL 2024), POST C3 QBI auto-default (2026-05-27 PM):
//   Net SE = 120,000 × 0.9235 = $110,820.
//   SE tax = 110,820 × 0.153 ≈ $16,955.
//   Half-SE = $8,478.
//   SEP contribution = (110,820 − 8,478) × 0.20 = $20,468.
//
//   ── BASELINE (no SEP) ──
//     AGI = 120,000 − 8,478 = $111,522.
//     Pre-QBI taxable = 111,522 − 14,600 (std ded) = $96,922.
//     QBI auto-default: qbiIncome = max(0, netSE $120k − halfSE $8,478) = $111,522.
//       Preliminary = 20% × $111,522 = $22,304.
//       Cap = 20% × pre-QBI taxable $96,922 = $19,384.
//       QBI deduction = min($22,304, $19,384) = $19,384.
//     Post-QBI taxable = 96,922 − 19,384 = $77,538.
//     Fed reg tax = 10%×$11,600 + 12%×$35,550 + 22%×($77,538−$47,150)
//                 = 1,160 + 4,266 + 6,685.32 = $12,111.32.
//     Plus SE tax $16,955 = $29,066.78.
//   ── SCENARIO (with +$20,468 deduction) ──
//     AGI = 91,054. Pre-QBI taxable = 76,454.
//     QBI: qbiIncome still $111,522 (SEP doesn't change net SE). Cap = 20% × $76,454 = $15,291. Final = $15,291.
//     Post-QBI taxable = 76,454 − 15,291 = $61,163.
//     Fed reg tax = 1,160 + 4,266 + 22%×($61,163−$47,150) = 1,160 + 4,266 + 3,082.86 = $8,508.86.
//     Plus SE tax $16,955 = $25,464.32.
//   Federal tax delta = 25,464.32 − 29,066.78 = −$3,602.46.
//
//   Heuristic estSavings = contribution × marginal = $20,468 × 22% = $4,503.
//   Engine-computed delta = −$3,602. These DIFFER by ~$901 because the SEP
//   contribution lowers AGI which TIGHTENS the §199A QBI cap, partially
//   offsetting the deduction. The heuristic does not account for this
//   interaction. H2 engine-computed value is the more accurate one.
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
      "Case D1 whatIf.delta.federalTaxLiability ≈ −$3,602 (post-C3 QBI auto-default)",
      sepWith.whatIf.delta.federalTaxLiability,
      -3602.46,
      2,
    );
    check(
      "Case D1 whatIf.delta.combinedTaxDelta = federal (FL no state tax)",
      sepWith.whatIf.delta.combinedTaxDelta,
      sepWith.whatIf.delta.federalTaxLiability,
    );
    // After C3 QBI auto-default: heuristic estSavings ($4,503 = SEP × 22%
    // marginal) NO LONGER matches engine-computed delta (−$3,602) because
    // SEP contribution tightens the §199A QBI cap (lower pre-QBI taxable →
    // lower QBI cap → less QBI deduction). The H2 engine-computed value is
    // the accurate one; the heuristic over-estimates by ~$901 in this case.
    checkTruthy(
      "Case D1 heuristic estSavings OVER-states engine by ~$901 (QBI cap interaction)",
      sepWith.estSavings > Math.abs(sepWith.whatIf.delta.combinedTaxDelta),
    );
    checkTruthy(
      "Case D1 heuristic estSavings within $1,500 of engine delta",
      Math.abs(sepWith.estSavings - Math.abs(sepWith.whatIf.delta.combinedTaxDelta)) < 1500,
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

// ── Case D10: G1.11 QCD detector (Phase H — H1 expansion) ────────────────
// Age 72 client with $30k IRA distribution + $20k charitable cash. QCD
// directs up to min($20k cash, $105k cap, $30k retirement) = $20k of the
// distribution direct-to-charity.
//
// Hand-calc:
//   Single FL filer, age 72, $80k W-2 + $30k 1099-R retirement +
//   $20k charitable_cash.
//   Baseline AGI = $80k + $30k = $110k (charitable is itemized deduction,
//     not above-the-line, so AGI is gross-of-charity).
//   Std ded $14,600 vs itemized $20k → engine picks itemized ($20k).
//   Taxable = $110k - $20k = $90k. Federal tax = 10%×11600 + 12%×35550 +
//     22%×(90000-47150) = 1160 + 4266 + 9427 = $14,853.
//
//   H2 mutation: SET charitable_cash to 0 (all $20k goes through QCD)
//                ADD deduction = $20k (the above-the-line QCD exclusion).
//   New AGI = $110k - $20k = $90k. Itemized = $0 (charitable_cash now 0).
//   Engine picks std ded $14,600. Taxable = $90k - $14,600 = $75,400.
//   Federal tax = 1160 + 4266 + 22%×(75400-47150) = 1160 + 4266 + 6215 =
//     $11,641.
//   Federal tax delta = 11641 - 14853 = -$3,212.
//
//   Note: this is BETTER than the simple-itemize case ($20k itemized
//   only saves $20k × 22% = $4,400 vs std-ded would've been $14,600 ×
//   22% = $3,212). The engine sees that QCD lets the client take BOTH
//   the QCD exclusion AND the std-ded — a net win when itemized barely
//   exceeds std-ded.
//
//   For this client: QCD saves the spread of (charitable × marginal) -
//   (max(0, itemized - stdDed) × marginal) = $4,400 - $1,188 ≈ $3,212.
//
//   IMPORTANT: TY2024 std-ded for age 65+ single = $14,600 + $1,950 elderly
//   bonus = $16,550. So in the scenario (no itemized), engine uses $16,550
//   std ded → taxable = $90k - $16,550 = $73,450 → tax = $11,212.
//   Federal tax delta = $11,212 - $14,853 = -$3,641. Engine is right; raw
//   hand-calc missed the elderly bonus.
{
  const qcdInputs = baseInputs();
  (qcdInputs.client as { taxpayerAge: number }).taxpayerAge = 72;
  qcdInputs.form1099s = [
    {
      id: 1, clientId: 1, taxYear: 2024, documentId: null,
      formType: "r",
      payerName: "Vanguard IRA", payerEin: null, payerAddress: null,
      grossDistribution: "30000", taxableAmount: "30000",
      distributionCode: "7", // normal distribution
      federalTaxWithheld: "0", stateTaxWithheld: "0", stateCode: null,
      spouse: null, createdAt: new Date(), updatedAt: new Date(),
    } as unknown as TaxReturnInputs["form1099s"][number],
  ];
  qcdInputs.adjustments = [adj("charitable_cash", 20000, 10001)];
  const computed = computeTaxReturnPure(qcdInputs);
  const hits = evaluatePlanningOpportunities({
    client: qcdInputs.client,
    computed,
    adjustments: qcdInputs.adjustments,
    baselineInputs: qcdInputs,
  });
  const qcdHit = hits.find((h) => h.strategyId === "G1.11");
  checkTruthy("Case D10 QCD hit fires (age 72 + ret income + charity)", qcdHit != null);
  if (qcdHit) {
    checkExact("Case D10 QCD semantics = savings", qcdHit.whatIf?.semantics, "savings");
    checkTruthy("Case D10 QCD whatIf attached", qcdHit.whatIf != null);
    if (qcdHit.whatIf) {
      // Federal delta is the engine-verified savings. Should be roughly
      // -$3,212 per hand-calc but engine details (rounding, exact bracket
      // edges) may differ slightly.
      checkTruthy(
        "Case D10 QCD federal tax delta < 0 (savings)",
        qcdHit.whatIf.delta.federalTaxLiability < 0,
      );
      // Engine produces -$3,641 (matches hand-calc with elderly $1,950 bonus
      // applied to std ded — see comment above the case).
      check(
        "Case D10 QCD combined refund delta ≈ +$3,641 (hand-calc with elderly std-ded bonus)",
        qcdHit.whatIf.delta.combinedRefundDelta,
        3641,
        10,
      );
      // Two mutations recorded
      check("Case D10 QCD records 2 mutations", qcdHit.whatIf.mutations.length, 2);
    }
    checkTruthy("Case D10 QCD assumptions populated", (qcdHit.assumptions?.length ?? 0) >= 5);
  }
}

// ── Case D11: QCD detector age-gating (suppresses < 71) ───────────────────
// Same fixture but age 65 → QCD detector should NOT fire.
{
  const inputs = baseInputs();
  (inputs.client as { taxpayerAge: number }).taxpayerAge = 65;
  inputs.form1099s = [
    {
      id: 1, clientId: 1, taxYear: 2024, documentId: null,
      formType: "r",
      payerName: "Vanguard IRA", payerEin: null, payerAddress: null,
      grossDistribution: "30000", taxableAmount: "30000",
      distributionCode: "7",
      federalTaxWithheld: "0", stateTaxWithheld: "0", stateCode: null,
      spouse: null, createdAt: new Date(), updatedAt: new Date(),
    } as unknown as TaxReturnInputs["form1099s"][number],
  ];
  inputs.adjustments = [adj("charitable_cash", 20000, 11001)];
  const computed = computeTaxReturnPure(inputs);
  const hits = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
  checkTruthy(
    "Case D11 QCD suppressed for age < 71",
    hits.find((h) => h.strategyId === "G1.11") == null,
  );
}

// ── Case D12: G1.12 Appreciated stock detector (heuristic only) ──────────
// Single FL client with $20k charitable + $30k LTCG → strategy fires.
// Heuristic: donationAmount = min(20k, 30k) = $20k. Unrealized 30% × LTCG
// 15% = 4.5% × $20k = $900.
{
  const inputs = baseInputs();
  inputs.adjustments = [adj("charitable_cash", 20000, 12001)];
  inputs.form1099s = [{
    id: 1, clientId: 1, taxYear: 2024, documentId: null,
    formType: "b",
    payerName: "Fidelity", payerEin: null, payerAddress: null,
    longTermGainLoss: "30000", shortTermGainLoss: "0",
    proceeds: "60000", costBasis: "30000",
    federalTaxWithheld: "0", stateTaxWithheld: "0", stateCode: null,
    spouse: null, createdAt: new Date(), updatedAt: new Date(),
  } as unknown as TaxReturnInputs["form1099s"][number]];
  const computed = computeTaxReturnPure(inputs);
  const hits = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
  const apprHit = hits.find((h) => h.strategyId === "G1.12");
  checkTruthy("Case D12 appreciated stock hit fires", apprHit != null);
  if (apprHit) {
    // Hand-calc: 20000 × 0.30 × 0.15 = $900
    check("Case D12 estSavings ≈ $900 (heuristic)", apprHit.estSavings, 900, 1);
    // No H2 wire (deferred to H5)
    checkTruthy("Case D12 no whatIf (deferred to H5)", apprHit.whatIf == null);
    checkTruthy("Case D12 assumptions explain H5 dependency", (apprHit.assumptions ?? []).some((a) => a.includes("H5")));
  }
}

// ── Case D13: G1.13 Augusta Rule detector ────────────────────────────────
// SE filer with $120k income (above $50k threshold) → strategy fires.
// Mutation: add $21k deduction. At ~22% marginal in FL (no state):
// expected savings = $21,000 × 22% = $4,620.
{
  const inputs = baseInputs();
  inputs.w2s = [];
  inputs.form1099s = [{
    id: 1, clientId: 1, taxYear: 2024, documentId: null,
    formType: "nec",
    payerName: "Client A", payerEin: null, payerAddress: null,
    nonemployeeCompensation: "120000",
    federalTaxWithheld: "0", stateTaxWithheld: "0", stateCode: null,
    spouse: null, createdAt: new Date(), updatedAt: new Date(),
  } as unknown as TaxReturnInputs["form1099s"][number]];
  const computed = computeTaxReturnPure(inputs);
  const hits = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
  const augustaHit = hits.find((h) => h.strategyId === "G1.13");
  checkTruthy("Case D13 Augusta Rule hit fires (SE > $50k)", augustaHit != null);
  if (augustaHit) {
    checkTruthy("Case D13 whatIf attached", augustaHit.whatIf != null);
    if (augustaHit.whatIf) {
      checkTruthy(
        "Case D13 Augusta savings > 0",
        Math.abs(augustaHit.whatIf.delta.combinedRefundDelta) > 0,
      );
      // Marginal rate on $120k SE income (after half-SE deduction) is ~22%.
      // Expected: ~$21,000 × 22% ≈ $4,620.
      checkTruthy(
        "Case D13 Augusta savings within $3,500-$5,500 range",
        Math.abs(augustaHit.whatIf.delta.combinedRefundDelta) >= 3500 &&
          Math.abs(augustaHit.whatIf.delta.combinedRefundDelta) <= 5500,
      );
      // Sensitivity should be present (variable-amount strategy)
      checkTruthy(
        "Case D13 Augusta sensitivity present",
        augustaHit.whatIf.sensitivity != null,
      );
    }
  }
}

// ── Case D14: G1.13 Augusta suppressed when SE income below threshold ────
{
  const inputs = baseInputs(); // $80k W-2, no SE
  const computed = computeTaxReturnPure(inputs);
  const hits = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
  checkTruthy(
    "Case D14 Augusta suppressed for pure-W-2 client",
    hits.find((h) => h.strategyId === "G1.13") == null,
  );
}

// ── Case D15: G1.14 HSA max detector ─────────────────────────────────────
// Family HDHP, $80k W-2, age 52 (no catch-up), zero existing HSA contribution.
// Cap = $8,300 (TY2024 family). Mutation adds $8,300 above-the-line.
// Expected savings ≈ $8,300 × 22% = $1,826.
{
  const inputs = baseInputs();
  (inputs.client as { hsaIsFamilyCoverage: boolean }).hsaIsFamilyCoverage = true;
  (inputs.client as { taxpayerAge: number }).taxpayerAge = 52;
  const computed = computeTaxReturnPure(inputs);
  const hits = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
  const hsaHit = hits.find((h) => h.strategyId === "G1.14");
  checkTruthy("Case D15 HSA max hit fires (family HDHP, no contribution)", hsaHit != null);
  if (hsaHit) {
    checkTruthy("Case D15 HSA whatIf attached", hsaHit.whatIf != null);
    if (hsaHit.whatIf) {
      // Hand-calc: $8,300 × 22% = $1,826
      check(
        "Case D15 HSA combined tax delta ≈ -$1,826",
        hsaHit.whatIf.delta.combinedTaxDelta,
        -1826,
        15,
      );
      check("Case D15 HSA AGI delta = -$8,300", hsaHit.whatIf.delta.adjustedGrossIncome, -8300, 1);
      checkTruthy("Case D15 HSA sensitivity present", hsaHit.whatIf.sensitivity != null);
    }
  }
}

// ── Case D16: G1.14 HSA max suppressed when at cap ───────────────────────
{
  const inputs = baseInputs();
  (inputs.client as { hsaIsFamilyCoverage: boolean }).hsaIsFamilyCoverage = true;
  inputs.adjustments = [adj("hsa_contribution", 8300, 16001)]; // already at family cap
  const computed = computeTaxReturnPure(inputs);
  const hits = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
  checkTruthy(
    "Case D16 HSA suppressed when at cap",
    hits.find((h) => h.strategyId === "G1.14") == null,
  );
}

// ── Case D17: G1.14 HSA catch-up adds $1,000 for age 55+ ─────────────────
{
  const inputs = baseInputs();
  (inputs.client as { hsaIsFamilyCoverage: boolean }).hsaIsFamilyCoverage = true;
  (inputs.client as { taxpayerAge: number }).taxpayerAge = 60;
  const computed = computeTaxReturnPure(inputs);
  const hits = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
  const hsaHit = hits.find((h) => h.strategyId === "G1.14");
  checkTruthy("Case D17 HSA hit fires (age 60 catch-up)", hsaHit != null);
  if (hsaHit) {
    // Cap should be $8,300 + $1,000 catch-up = $9,300
    check("Case D17 HSA cap = $9,300 (family + age-55 catch-up)", Number(hsaHit.inputs.cap), 9300, 1);
    if (hsaHit.whatIf) {
      check("Case D17 HSA AGI delta = -$9,300", hsaHit.whatIf.delta.adjustedGrossIncome, -9300, 1);
    }
  }
}

// ── Case D18: G1.15 NUA detector (catalog v1.3) ──────────────────────────
// Client has $300k employer stock in 401(k) with $50k cost basis. NUA = $250k.
// At 32% marginal vs 15% LTCG, savings ≈ $250k × (0.32 - 0.15) = $42,500.
{
  const inputs = baseInputs();
  // Boost income so marginal rate is in 32% band ($191,950+ taxable single).
  inputs.w2s = [{
    id: 1, clientId: 1, taxYear: 2024, documentId: null,
    employerName: "MegaCorp", employerEin: null,
    wagesBox1: "300000", federalWithholdingBox2: "0",
    socialSecurityWagesBox3: "168600", socialSecurityTaxBox4: "0",
    medicareWagesBox5: "300000", medicareTaxBox6: "0",
    socialSecurityTipsBox7: "0", allocatedTipsBox8: "0",
    dependentCareBenefitsBox10: "0", nonqualifiedPlansBox11: "0",
    box12aCode: null, box12aAmount: "0", box12bCode: null, box12bAmount: "0",
    box12cCode: null, box12cAmount: "0", box12dCode: null, box12dAmount: "0",
    statutoryEmployeeBox13: false, retirementPlanBox13: false, thirdPartySickPayBox13: false,
    box14Description: null, box14Amount: "0",
    stateBox15: "FL", stateWagesBox16: "300000", stateTaxBox17: "0",
    localWagesBox18: "0", localTaxBox19: "0", localityNameBox20: null,
    spouse: null, createdAt: new Date(), updatedAt: new Date(),
  } as unknown as TaxReturnInputs["w2s"][number]];
  inputs.assetBalances = [{
    taxYear: 2024,
    assetType: "employer_stock_in_401k",
    accountName: "MegaCorp 401k stock",
    balance: 300000,
    costBasis: 50000,
    afterTaxBasis: null,
    nuaEligible: true,
  } as unknown as TaxReturnInputs["assetBalances"][number]];
  const computed = computeTaxReturnPure(inputs);
  const hits = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
  const nuaHit = hits.find((h) => h.strategyId === "G1.15");
  checkTruthy("Case D18 NUA hit fires", nuaHit != null);
  if (nuaHit) {
    // NUA = $250k, marginal ~ 32%, LTCG 15% → savings = $250k × 17% ≈ $42,500.
    checkTruthy(
      "Case D18 NUA estSavings in $40,000-$50,000 range",
      nuaHit.estSavings >= 40000 && nuaHit.estSavings <= 50000,
    );
    // No whatIf (heuristic-only)
    checkTruthy("Case D18 NUA whatIf absent (heuristic only)", nuaHit.whatIf == null);
    checkTruthy("Case D18 NUA assumptions populated", (nuaHit.assumptions?.length ?? 0) >= 4);
  }
}

// ── Case D19: G1.15 NUA suppressed when nuaEligible=false ────────────────
{
  const inputs = baseInputs();
  inputs.assetBalances = [{
    taxYear: 2024,
    assetType: "employer_stock_in_401k",
    accountName: "Stock",
    balance: 300000,
    costBasis: 50000,
    afterTaxBasis: null,
    nuaEligible: false, // plan doesn't permit
  } as unknown as TaxReturnInputs["assetBalances"][number]];
  const computed = computeTaxReturnPure(inputs);
  const hits = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
  checkTruthy(
    "Case D19 NUA suppressed when plan not NUA-eligible",
    hits.find((h) => h.strategyId === "G1.15") == null,
  );
}

// ── Case D20: G1.16 Mega-Backdoor Roth detector ──────────────────────────
{
  const inputs = baseInputs();
  inputs.w2s = [{
    id: 1, clientId: 1, taxYear: 2024, documentId: null,
    employerName: "BigCo", employerEin: null,
    wagesBox1: "400000", federalWithholdingBox2: "0",
    socialSecurityWagesBox3: "168600", socialSecurityTaxBox4: "0",
    medicareWagesBox5: "400000", medicareTaxBox6: "0",
    socialSecurityTipsBox7: "0", allocatedTipsBox8: "0",
    dependentCareBenefitsBox10: "0", nonqualifiedPlansBox11: "0",
    box12aCode: null, box12aAmount: "0", box12bCode: null, box12bAmount: "0",
    box12cCode: null, box12cAmount: "0", box12dCode: null, box12dAmount: "0",
    statutoryEmployeeBox13: false, retirementPlanBox13: false, thirdPartySickPayBox13: false,
    box14Description: null, box14Amount: "0",
    stateBox15: "FL", stateWagesBox16: "400000", stateTaxBox17: "0",
    localWagesBox18: "0", localTaxBox19: "0", localityNameBox20: null,
    spouse: null, createdAt: new Date(), updatedAt: new Date(),
  } as unknown as TaxReturnInputs["w2s"][number]];
  inputs.assetBalances = [{
    taxYear: 2024,
    assetType: "401k_after_tax",
    accountName: "BigCo 401k after-tax bucket",
    balance: 0,
    costBasis: null,
    afterTaxBasis: null,
    nuaEligible: false,
  } as unknown as TaxReturnInputs["assetBalances"][number]];
  const computed = computeTaxReturnPure(inputs);
  const hits = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
  const megaHit = hits.find((h) => h.strategyId === "G1.16");
  checkTruthy("Case D20 Mega-Backdoor Roth fires (after-tax bucket present)", megaHit != null);
  if (megaHit) {
    checkTruthy("Case D20 estSavings > 0", megaHit.estSavings > 0);
    checkTruthy("Case D20 contribution > 0", Number(megaHit.inputs.contribution) > 0);
  }
}

// ── Case D21: G1.16 suppressed when no after-tax 401(k) bucket ───────────
{
  const inputs = baseInputs();
  inputs.assetBalances = [{
    taxYear: 2024,
    assetType: "traditional_ira",
    accountName: "Some IRA",
    balance: 100000,
    costBasis: null,
    afterTaxBasis: null,
    nuaEligible: false,
  } as unknown as TaxReturnInputs["assetBalances"][number]];
  const computed = computeTaxReturnPure(inputs);
  const hits = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
  checkTruthy(
    "Case D21 Mega-Backdoor suppressed without 401k_after_tax row",
    hits.find((h) => h.strategyId === "G1.16") == null,
  );
}

// ── Case D22: G1.18 REPS suppressed when no suspended PAL ────────────────
// Default baseInputs has no rentals → no suspended PAL → REPS skipped.
{
  const inputs = baseInputs();
  const computed = computeTaxReturnPure(inputs);
  const hits = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
  checkTruthy(
    "Case D22 REPS suppressed with no rental losses",
    hits.find((h) => h.strategyId === "G1.18") == null,
  );
}

// ── Case D23: G1.20 conservation easement only fires for >$1M AGI ────────
// Default $80k W-2 client should NOT trigger conservation easement.
{
  const inputs = baseInputs();
  const computed = computeTaxReturnPure(inputs);
  const hits = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
  checkTruthy(
    "Case D23 Conservation easement suppressed for AGI < $1M",
    hits.find((h) => h.strategyId === "G1.20") == null,
  );
}

// ── Case D24: G1.19 CRT framework fires for $500k+ AGI + large LTCG ──────
{
  const inputs = baseInputs();
  inputs.w2s = [{
    id: 1, clientId: 1, taxYear: 2024, documentId: null,
    employerName: "BigCo", employerEin: null,
    wagesBox1: "500000", federalWithholdingBox2: "0",
    socialSecurityWagesBox3: "168600", socialSecurityTaxBox4: "0",
    medicareWagesBox5: "500000", medicareTaxBox6: "0",
    socialSecurityTipsBox7: "0", allocatedTipsBox8: "0",
    dependentCareBenefitsBox10: "0", nonqualifiedPlansBox11: "0",
    box12aCode: null, box12aAmount: "0", box12bCode: null, box12bAmount: "0",
    box12cCode: null, box12cAmount: "0", box12dCode: null, box12dAmount: "0",
    statutoryEmployeeBox13: false, retirementPlanBox13: false, thirdPartySickPayBox13: false,
    box14Description: null, box14Amount: "0",
    stateBox15: "FL", stateWagesBox16: "500000", stateTaxBox17: "0",
    localWagesBox18: "0", localTaxBox19: "0", localityNameBox20: null,
    spouse: null, createdAt: new Date(), updatedAt: new Date(),
  } as unknown as TaxReturnInputs["w2s"][number]];
  inputs.form1099s = [{
    id: 1, clientId: 1, taxYear: 2024, documentId: null,
    formType: "b",
    payerName: "Brokerage", payerEin: null, payerAddress: null,
    longTermGainLoss: "200000", shortTermGainLoss: "0",
    proceeds: "500000", costBasis: "300000",
    federalTaxWithheld: "0", stateTaxWithheld: "0", stateCode: null,
    spouse: null, createdAt: new Date(), updatedAt: new Date(),
  } as unknown as TaxReturnInputs["form1099s"][number]];
  const computed = computeTaxReturnPure(inputs);
  const hits = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
  const crtHit = hits.find((h) => h.strategyId === "G1.19");
  checkTruthy("Case D24 CRT fires for HNW + large LTCG", crtHit != null);
  if (crtHit) {
    checkTruthy("Case D24 CRT estSavings > 0", crtHit.estSavings > 0);
    // Heuristic: min($200k, $500k cap) × 23.8% = $47,600
    check("Case D24 CRT estSavings ≈ $47,600", crtHit.estSavings, 47600, 200);
  }
}

// ── Case D9: H7 omitted when 0 stackable hits ────────────────────────────
// Pure-W-2 client with no SE / no investment / AGI ABOVE generic-credit
// caps (so G1.33 EV credit and G1.61 student loan both suppress) — only
// heuristic strategies remain. Cross-strategy needs >=2 stackable (H2
// "savings" semantics) hits; heuristic-only → undefined.
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 45, dependentsUnder17: 0 } as unknown as TaxReturnInputs["client"],
    w2s: [{ taxYear: 2024, wagesBox1: 250000, stateCode: "FL" } as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [], adjustments: [], taxYear: 2024,
  };
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
  // High-AGI pure-W-2: G1.33 + G1.61 suppressed (AGI > caps), G1.26
  // backdoor Roth fires (heuristic) — only 1 stackable max.
  checkTruthy("Case D9 cross-strategy undefined for high-AGI pure-W-2 client (< 2 stackable)",
    xstrat == null);
}

// ── Print results ─────────────────────────────────────────────────────────
console.log(`\nH2 What-If engine tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) {
  FAIL.forEach((f) => console.log(`    ${f}`));
}
process.exit(FAIL.length > 0 ? 1 : 0);
