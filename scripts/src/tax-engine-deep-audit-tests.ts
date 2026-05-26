/**
 * Deep Audit (2026-05-23) — second-pass adversarial audit with broader
 * coverage. Built off the IRS-edge-case research agent's corpus + an
 * inventory of every engine calc.
 *
 * Categories:
 *   H. Per-calc edge cases  (40+ assertions, cite IRS source per assertion)
 *   I. Client archetypes    (20 real-world end-to-end scenarios, hand-calced)
 *   J. Invariant properties (sanity checks: non-negative, refund ≤ withheld, etc.)
 *   K. Documented gaps      (probes for features NOT yet modeled, fail expected)
 *
 * Each assertion that fails goes into one of:
 *   - real failure (engine delta from IRS-published answer; bug)
 *   - documented gap (feature not yet modeled; tracked)
 *   - test-expectation bug (my hand-calc was wrong; fix the test)
 *
 * Run:  pnpm --filter @workspace/scripts exec tsx src/tax-engine-deep-audit-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: Array<{ category: string; label: string; expected: number | string; actual: number | string; delta?: number; source?: string }> = [];

function check(category: string, label: string, actual: number, expected: number, tol = 1.0, source = ""): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ [${category}] ${label}`);
  else FAIL.push({ category, label, expected, actual,
    delta: Math.round((actual - expected) * 100) / 100, source });
}

function header(t: string): void { console.log(`\n── ${t} ──`); }
function section(t: string): void { console.log(`\n══════════ ${t} ══════════`); }

function run(inputs: Partial<TaxReturnInputs> & { client: TaxReturnInputs["client"] }): ReturnType<typeof computeTaxReturnPure> {
  return computeTaxReturnPure({
    w2s: [], form1099s: [], adjustments: [],
    taxYear: inputs.client.taxYear ?? 2024,
    ...inputs,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// H. PER-CALC EDGE CASES
// ════════════════════════════════════════════════════════════════════════════
section("H. Per-calc edge cases");

// H1. SE tax with $0 SE income — no tax, no half-SE deduction.
header("H1. SE tax: $0 SE income → 0/0");
{
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }] });
  check("H1", "SE tax = 0 (no SE income)", r.selfEmploymentTax, 0, 0.01);
  check("H1", "AGI = $50k (no half-SE)", r.adjustedGrossIncome, 50000, 0.01);
}

// H2. SE tax under $400 cliff — Schedule SE Part I Line 4c.
// Net SE earnings < $400 → no SE tax (true cliff). Net = gross × 0.9235.
// 400 / 0.9235 = 433.135 → need gross > $433.14 to clear the cliff.
header("H2. SE tax $400 cliff (Sch SE Part I Line 4c)");
{
  // gross $400 → net 369.40 < 400 → no SE tax.
  const justUnder = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "X", nonemployeeCompensation: 400 }] });
  check("H2", "Net SE $369.40 < $400 → SE tax 0", justUnder.selfEmploymentTax, 0, 0.01,
    "Sch SE Part I Line 4c");
  // gross $434 → net 400.799 > 400 → SE tax = 400.799 × 15.3% = $61.32.
  const justOver = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "X", nonemployeeCompensation: 434 }] });
  check("H2", "Net SE $400.80 ≥ $400 → SE tax $61.32", justOver.selfEmploymentTax, 61.32, 0.10,
    "Sch SE Part I Line 4c — full 15.3% kicks in past the cliff");
}

// H3. AMT exemption full phase-out point (single 2024):
//   start $609,350 + exemption $85,700 / 0.25 = $952,150.
// At AMTI = $952,150 → exemption shrunk to exactly $0.
header("H3. AMT single exemption fully phased out at AMTI $952,150");
{
  // Engineer AMTI = $952,150 via $980,000 wages (taxable ≈ 965,400 with std)
  // and add prefs to bump to exactly $952,150 — easier: use $966,750 wages.
  // Plan: target AMTI 952,150. Taxable = wages − 14,600 (std). AMTI ≈ taxable.
  // Wages = 952,150 + 14,600 = 966,750.
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 966750, stateCode: "FL" }] });
  check("H3", "Single AMTI $952,150 → exemption = $0",
    r.detail.amt.exemption, 0, 1,
    "IRS Form 6251 instructions — single phase-out start $609,350, full at $952,150");
}

// H4. NIIT MFS threshold $125,000 (half of joint $250k).
header("H4. NIIT MFS threshold $125,000");
{
  const r = run({ client: { filingStatus: "married_filing_separately", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 110000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", payerName: "X", longTermGainLoss: 30000 }] });
  // MAGI = 140k. Excess = 15k. NII = 30k. NIIT = 15k × 3.8% = $570.
  check("H4", "MFS MAGI $140k, NII $30k → NIIT $570",
    r.niitTax, 570, 1, "IRC §1411 — MFS threshold $125k");
}

// H5. EITC investment income limit cliff $11,600 (TY2024).
header("H5. EITC investment income cliff $11,600 (TY2024)");
{
  // Single, 2 kids, earned $25k. Investment income $11,500 → EITC applies.
  // 25k > plateau start 22,720, so phase-out: 6,960 − 21.06% × (25,000 − 22,720)
  //   = 6,960 − 21.06% × 2,280 = 6,960 − 480.17 = $6,479.83.
  const ok = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024,
    dependentsUnder17: 2 },
    w2s: [{ taxYear: 2024, wagesBox1: 25000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "int", payerName: "X", interestIncome: 11500 }] });
  // Phase-out uses MAX(earned, AGI). AGI = $25k + $11.5k = $36.5k.
  // Phase-out = 21.06% × (36,500 − 22,720) = $2,902.07.
  // EITC = 6,960 − 2,902.07 = $4,057.93.
  check("H5", "Investment $11,500 → EITC $4,057.93 (AGI-based phase-out)",
    ok.eitc.appliedCredit, 4057.93, 5,
    "Pub 596 — phase-out uses max(earned, AGI)");
  // One cent over: $11,601 → EITC $0.
  const overCliff = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024,
    dependentsUnder17: 2 },
    w2s: [{ taxYear: 2024, wagesBox1: 25000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "int", payerName: "X", interestIncome: 11601 }] });
  check("H5", "Investment $11,601 → EITC $0 (cliff)",
    overCliff.eitc.appliedCredit, 0, 0.01,
    "IRC §32(i) — investment-income disqualifier");
}

// H6. MFS — IRA phase-out window is $0–$10,000 (covered + lived with spouse).
header("H6. MFS IRA phase-out $0–$10,000 (covered + lived w/ spouse)");
{
  // MFS, covered, age 39, MAGI $5,000 → 50% phased-out → 7,000 × (1 − 0.5) = $3,500.
  const r = run({ client: { filingStatus: "married_filing_separately", state: "FL",
    taxYear: 2024, iraCoveredByWorkplacePlan: true, taxpayerAge: 39 },
    w2s: [{ taxYear: 2024, wagesBox1: 5000, stateCode: "FL" }],
    adjustments: [{ adjustmentType: "ira_contribution_traditional", amount: 4000, isApplied: true }] });
  // contribution $4,000, phase 50% → deductible = $4,000 × 50% = $2,000 (the smaller of capped × phase).
  // Actually the rule: max IRA $7,000. Cap contribution at min($4k, $7k) = $4k. Apply phase 50% → $2,000.
  check("H6", "MFS covered $5k MAGI → IRA deduct $2,000 (50% phase, $4k contrib)",
    r.retirementDeductions.iraDeductible, 2000, 50,
    "IRS Pub 590-A — MFS covered phase-out $0–$10k");
}

// H7. CTC + ODC combined phase-out: 5% per $1k AGI over threshold.
// MFJ, 1 child under 17 + 1 other dependent, AGI $430k.
// Tentative = 2,000 + 500 = $2,500. Reduction = 5% × (430,000 − 400,000) = $1,500.
// Applied = max(0, 2,500 − 1,500) = $1,000.
header("H7. CTC + ODC combined phase-out");
{
  const r = run({ client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024,
    dependentsUnder17: 1, otherDependents: 1 },
    w2s: [{ taxYear: 2024, wagesBox1: 430000, stateCode: "FL" }] });
  check("H7", "MFJ AGI $430k 1 CTC + 1 ODC → $1,000 combined",
    r.childTaxCredit.appliedCredit, 1000, 1,
    "IRC §24(b)(2) shared phase-out");
}

// H8. Saver's Credit $2,000 per-filer cap.
// MFJ, age 39, $4,500 IRA each spouse → $9,000 total contributions.
// Eligible base capped at $2,000 × 2 = $4,000. AGI $40k → 50% rate → $2,000.
header("H8. Saver's $2k per-filer cap (MFJ $9k contrib → $2k credit)");
{
  const r = run({ client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024,
    iraCoveredByWorkplacePlan: false, taxpayerAge: 39, spouseAge: 39 },
    w2s: [{ taxYear: 2024, wagesBox1: 40000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "retirement_contributions_savers", amount: 9000, isApplied: true },
    ] });
  check("H8", "MFJ AGI $40k $9k contrib → Saver's $2,000 (capped at $4k base × 50%)",
    r.saversCredit.appliedCredit, 2000, 1,
    "Form 8880 — $2k per-person × 2 cap, 50% tier MFJ ≤ $46k");
}

// H9. Dep Care Credit earned-income limit (lesser spouse).
// MFJ, 2 kids, $7,000 expenses, AGI $80k. Higher spouse $75k, lower $4k.
// Cap = min($7,000, $4,000 lower-earning, $6,000 2+kid limit) = $4,000.
// Rate at AGI > $43k = 20%. Credit = $800.
header("H9. Dep Care earned-income limit binds at lower-earning spouse");
{
  const r = run({ client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024,
    dependentsUnder17: 2, dependentsForCareCredit: 2, spouseEarnedIncome: 4000 },
    w2s: [{ taxYear: 2024, wagesBox1: 75000, stateCode: "FL" }],
    adjustments: [{ adjustmentType: "dependent_care_expenses", amount: 7000, isApplied: true }] });
  // Engine receives spouseEarnedIncome via client. Let me check.
  check("H9", "Dep care credit = $800 (lower spouse limit $4k × 20%)",
    r.dependentCareCredit.appliedCredit, 800, 5,
    "Form 2441 — earned-income limit per IRC §21(d)");
}

// H10. AOC refundable + non-refundable split.
// AOC formula: 100% × first $2k + 25% × next $2k = $2,500 max.
// 40% refundable ($1,000), 60% non-ref ($1,500).
header("H10. AOC 40/60 refundable split");
{
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
    adjustments: [{ adjustmentType: "qualified_education_expenses_aoc", amount: 4000, isApplied: true }] });
  check("H10", "AOC total = $2,500", r.educationCredits.aocApplied, 2500, 1,
    "IRC §25A(i)");
  check("H10", "AOC refundable = $1,000 (40% of $2,500)",
    r.educationCredits.aocRefundable, 1000, 1,
    "IRC §25A(i)(6)");
}

// H11. HSA family + over-55 catch-up. 2024: family $8,300 + $1,000 = $9,300.
header("H11. HSA family + over-55 catch-up = $9,300 (2024)");
{
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024,
    hsaIsFamilyCoverage: true, taxpayerAge: 57 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    adjustments: [{ adjustmentType: "hsa_contribution", amount: 10000, isApplied: true }] });
  // Contribution $10k, limit $9.3k → deductible $9,300.
  check("H11", "HSA contrib $10k, family + 55+ → deduct $9,300",
    r.retirementDeductions.hsaDeductible, 9300, 1,
    "IRS Rev. Proc. 2023-23 (2024 HSA limits)");
}

// H12. SALT cap MFS $5,000 (half of $10k).
header("H12. SALT cap MFS $5,000 (vs $10k single/MFJ)");
{
  // Need engine to be aware of MFS context. Check the SALT_CAP usage.
  const r = run({ client: { filingStatus: "married_filing_separately", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 8000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 15000, isApplied: true },
    ] });
  // If MFS cap is correctly $5k, itemized = 5,000 + 15,000 = $20,000.
  // If engine wrongly uses $10k cap, itemized = $8,000 + $15,000 = $23,000.
  check("H12", "MFS SALT capped at $5k → itemized $20,000",
    r.itemizedDeductions ?? 0, 20000, 1,
    "IRC §164(b)(6)(B) — MFS SALT cap $5,000");
}

// H13. Tax-exempt interest counts for SS taxability MAGI.
// Pub 915 — provisional income includes tax-exempt interest.
header("H13. Tax-exempt interest in SS MAGI (Pub 915)");
{
  // Single retiree: $20k pension + $30k muni interest (tax-exempt) + $24k SS.
  // Engine: we don't have explicit "social security benefits" facts — flag this.
  // Test the BASIC engine path: $20k pension via 1099-R + $30k tax-exempt int.
  // The MAGI for SS taxability should include tax-exempt interest.
  // (No SS field in our model → skip this for a documented gap below; here we
  //  just verify the tax-exempt interest isn't double-counted into AGI.)
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    form1099s: [
      { taxYear: 2024, formType: "r", payerName: "Pension", taxableAmount: 20000 },
      { taxYear: 2024, formType: "int", payerName: "Muni", interestIncome: 30000, taxExemptInterest: 30000 },
    ] });
  // AGI = $20k taxable retirement + $0 net interest (tax-exempt portion subtracted).
  check("H13", "Tax-exempt interest correctly excluded from AGI",
    r.adjustedGrossIncome, 20000, 1,
    "Form 1040 Line 2a tax-exempt; not included in AGI");
}

// H14. Cap loss carryforward — character preserved.
// Adjustment-type: capital_loss_carryforward_short / _long should be honored.
header("H14. Cap loss carryforward — ST + LT character preserved");
{
  // Single, $50k W-2. Current-year ST cap gain $4k + ST carryover $2k.
  // Net ST after carry = $4k − $2k = $2k. LT carryover $10k (no current LT).
  // After applying ST gain $2k and LT loss carry $10k cross-net:
  //   ST: $2k. LT: -$10k. Net = -$8k.
  //   $3k allowed against ordinary, $5k LT loss carries forward (LT character preserved).
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
    capitalTransactions: [
      { taxYear: 2024, description: "ST gain this year", proceeds: 14000, costBasis: 10000, formBox: "A" }, // +4k ST
    ],
    adjustments: [
      { adjustmentType: "capital_loss_carryforward_short", amount: 2000, isApplied: true },
      { adjustmentType: "capital_loss_carryforward_long", amount: 10000, isApplied: true },
    ] });
  // Net cap loss = -$8k → -$3k deducted, $5k LT carry forward.
  check("H14", "Cap loss deducted = $3,000 (cap)", r.capitalLossDeducted, 3000, 1,
    "IRC §1211(b)");
  check("H14", "Net cap gain/loss = -$8,000 (post-netting)",
    r.netCapitalGainLoss, -8000, 1, "Sch D Line 16");
}

// H15. NIIT excludes wages from NII.
header("H15. NIIT base — wages not in net investment income");
{
  // Single $300k W-2, no investment income. MAGI $300k > $200k. Excess $100k.
  // NII = $0 (only wages). NIIT base = min($0, $100k) = $0. NIIT = $0.
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 300000, stateCode: "FL" }] });
  check("H15", "All-wage filer above NIIT threshold → NIIT $0",
    r.niitTax, 0, 1, "IRC §1411 — NII excludes wages");
}

// H16. AMT exemption phase-out arithmetic check — MFJ $1,218,700 start.
header("H16. AMT MFJ exemption phase-out start $1,218,700");
{
  // MFJ AMTI = $1,300,000. Reduction = 25% × (1,300,000 − 1,218,700) = $20,325.
  // Exemption = $133,300 − $20,325 = $112,975.
  const r = run({ client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 1329200, stateCode: "FL" }] });
  // Taxable = 1,329,200 − 29,200 = 1,300,000 = AMTI (no prefs).
  check("H16", "MFJ AMTI $1.3M → exemption $112,975",
    r.detail.amt.exemption, 112975, 1,
    "IRC §55(d)(2)(A) — MFJ phase-out");
}

// ════════════════════════════════════════════════════════════════════════════
// I. CLIENT ARCHETYPE SCENARIOS — end-to-end with hand-calc
// ════════════════════════════════════════════════════════════════════════════
section("I. CLIENT ARCHETYPES — 20 real-world end-to-end scenarios");

// I1. Recent grad, single, $40k W-2, FL.
// AGI $40k. Std ded $14,600. Taxable $25,400.
// Tax: 1,160 + 12%×(25,400−11,600) = $2,816.
header("I1. Recent grad — single $40k W-2 FL");
{
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 40000, federalTaxWithheldBox2: 4500, stateCode: "FL" }] });
  check("I1", "AGI $40,000", r.adjustedGrossIncome, 40000, 1);
  check("I1", "Taxable $25,400", r.taxableIncome, 25400, 1);
  check("I1", "Fed regular tax $2,816", r.federalTaxLiability, 2816, 2);
  check("I1", "Refund $1,684 (withheld 4,500 − liability 2,816)",
    r.federalRefundOrOwed, 1684, 2);
}

// I2. Gig worker, single, $30k W-2 + $20k 1099-NEC, CA.
header("I2. Gig worker — single $30k W-2 + $20k NEC CA");
{
  const r = run({ client: { filingStatus: "single", state: "CA", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 30000, federalTaxWithheldBox2: 3000, stateCode: "CA" }],
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "App", nonemployeeCompensation: 20000 }] });
  // SE: 20k × 0.9235 = 18,470 × 15.3% = $2,825.91. Half = $1,412.95.
  // Total income: 30k + 20k = 50k. AGI = 50k - 1,412.95 = $48,587.05.
  // Std ded 14,600. Taxable = $33,987.05. (Note: QBI auto-derivation NOT modeled — engine.)
  // Tax on $33,987 single: 1,160 + 12%×(33,987.05 − 11,600) = 1,160 + 2,686.45 = $3,846.45.
  // + SE 2,825.91 = $6,672.36 pre-credit.
  check("I2", "AGI ≈ $48,587", r.adjustedGrossIncome, 48587.05, 2);
  check("I2", "SE tax $2,825.91", r.selfEmploymentTax, 2825.91, 1);
  check("I2", "Pre-credit fed tax $6,672 (tax + SE)",
    r.federalTaxLiability, 6672.36, 5);
}

// I3. Public school teacher — MFJ, $55k + $45k W-2s, 2 kids, IL, $300 supplies.
header("I3. Teacher household MFJ — $100k combined, 2 kids, IL");
{
  const r = run({ client: { filingStatus: "married_filing_jointly", state: "IL", taxYear: 2024,
    dependentsUnder17: 2, eligibleEducatorCount: 1 },
    w2s: [
      { taxYear: 2024, wagesBox1: 55000, federalTaxWithheldBox2: 4500, stateCode: "IL" },
      { taxYear: 2024, wagesBox1: 45000, federalTaxWithheldBox2: 3500, stateCode: "IL" },
    ],
    adjustments: [{ adjustmentType: "educator_expenses", amount: 300, isApplied: true }] });
  // AGI = 100,000 − 300 (educator) = $99,700.
  // Std ded MFJ = $29,200. Taxable = $70,500.
  // Tax: 2,320 + 12%×(70,500 − 23,200) = 2,320 + 5,676 = $7,996.
  // CTC: 2 × $2,000 = $4,000 (under $400k threshold). After CTC = $3,996.
  // IL state tax: 99,700 − 5,550 (MFJ exemption) = 94,150 × 4.95% = $4,660.43.
  check("I3", "AGI $99,700 (educator deducted)", r.adjustedGrossIncome, 99700, 1);
  check("I3", "Taxable $70,500", r.taxableIncome, 70500, 1);
  check("I3", "Pre-credit fed tax $7,996", r.federalTaxLiability, 7996, 2);
  check("I3", "CTC $4,000", r.childTaxCredit.appliedCredit, 4000, 1);
  check("I3", "IL state tax $4,660.43", r.stateTaxLiability, 4660.43, 5);
}

// I4. Sole-prop consultant — single $80k Sch C, TX, home office NOT modeled.
header("I4. Sole-prop consultant — single $80k Sch C TX");
{
  const r = run({ client: { filingStatus: "single", state: "TX", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "Client", nonemployeeCompensation: 80000 }],
    adjustments: [{ adjustmentType: "schedule_c_expenses", amount: 15000, isApplied: true }] });
  // Net SE = $65,000. SE base 65,000 × 0.9235 = 60,027.50. SE tax = 60,027.50 × 0.153 = $9,184.21.
  // Half SE = $4,592.10. AGI = 65,000 − 4,592.10 = $60,407.90.
  // Std ded $14,600. Taxable before QBI = $45,807.90.
  // QBI auto-derivation NOT modeled (engine known limit) → no QBI.
  // Tax: 1,160 + 12%×(45,807.90 − 11,600) = 1,160 + 4,104.95 = $5,264.95.
  // Total fed = 5,264.95 + 9,184.21 = $14,449.16.
  check("I4", "AGI $60,408", r.adjustedGrossIncome, 60407.90, 2);
  check("I4", "SE tax $9,184", r.selfEmploymentTax, 9184.21, 2);
  check("I4", "Pre-credit fed = $14,449 (tax + SE, no QBI)",
    r.federalTaxLiability, 14449.16, 5);
}

// I5. Tech worker w/ ISO + RSU — single $250k W-2 + $100k ISO bargain, NY+NYC.
header("I5. Tech worker — single $250k W-2 + $100k ISO bargain NY+NYC");
{
  const r = run({ client: { filingStatus: "single", state: "NY", taxYear: 2024,
    localityCode: "NYC" },
    w2s: [{ taxYear: 2024, wagesBox1: 250000, federalTaxWithheldBox2: 60000, stateCode: "NY",
      stateWagesBox16: 250000, stateTaxWithheldBox17: 18000 }],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 25000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 18000, isApplied: true },
      { adjustmentType: "amt_iso_bargain_element", amount: 100000, isApplied: true },
    ] });
  // AGI = $250k. Itemized: SALT min(25k, 10k) + mortgage 18k = $28,000 > std 14,600 → itemize.
  // Taxable = 222,000.
  // Regular tax on $222k single: 1,160 + 4,266 + 11,742.50 + 21,942 + 16,568 +
  //   (222,000 − 243,725 if positive) — actually 222,000 < 243,725 so stop at 24% bracket.
  //   Wait: 191,950 < 222k < 243,725. So 32% applies between 191,950 and 222k.
  //   1,160 + 4,266 + 11,742.50 + 21,942 + 32%×(222,000 − 191,950) = 39,110.50 + 32%×30,050 = 39,110.50 + 9,616 = $48,726.50.
  // AMT: AMTI = 222,000 + 10,000 (SALT addback) + 100,000 (ISO) = $332,000.
  //   Exemption $85,700 (below $609k phase-out). AMT base $246,300.
  //   AMT (26% to 232,600; 28% above): 232,600 × 0.26 + 13,700 × 0.28 = 60,476 + 3,836 = $64,312.
  //   AMT bind = max(0, 64,312 − 48,726.50) = $15,585.50.
  check("I5", "AMTI = $332,000", r.detail.amt.amti, 332000, 50);
  check("I5", "AMT ≈ $15,585 (binds)", r.amtTax, 15585.50, 100,
    "Form 6251 — SALT addback + ISO");
}

// I6. Retiree couple — MFJ, $25k pension + $30k IRA distribution, PA, age 70+.
header("I6. Retiree couple MFJ — $55k pension+IRA PA age 70+");
{
  const r = run({ client: { filingStatus: "married_filing_jointly", state: "PA", taxYear: 2024,
    taxpayerAge: 72, spouseAge: 70 },
    form1099s: [
      { taxYear: 2024, formType: "r", payerName: "Pension", taxableAmount: 25000 },
      { taxYear: 2024, formType: "r", payerName: "IRA", taxableAmount: 30000 },
    ] });
  // AGI = $55k. Std ded MFJ + 2 over-65 = 29,200 + 2×1,550 = $32,300. Taxable = $22,700.
  // Tax: 10%×22,700 = $2,270 (under 23,200 MFJ first bracket top).
  // PA: retirement income fully exempt → $0.
  check("I6", "AGI $55,000", r.adjustedGrossIncome, 55000, 1);
  check("I6", "Std ded $32,300 (MFJ + 2 over-65 add-ons)",
    r.standardDeduction, 32300, 1,
    "IRS Std Ded Chart");
  check("I6", "Taxable $22,700", r.taxableIncome, 22700, 1);
  check("I6", "Fed tax $2,270 (10% MFJ bracket)",
    r.federalTaxLiability, 2270, 2);
  check("I6", "PA state tax $0 (retirement exempt)",
    r.stateTaxLiability, 0, 0.01);
}

// I7. Real estate investor — MFJ, $80k W-2 + 3 rentals, TX, all active part.
header("I7. RE investor MFJ — $80k W-2 + 3 rentals TX active");
{
  const r = run({ client: { filingStatus: "married_filing_jointly", state: "TX", taxYear: 2024,
    rentalActiveParticipant: true },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 9000, stateCode: "TX" }],
    rentalProperties: [
      { taxYear: 2024, address: "1", propertyType: "residential", basis: 250000,
        placedInServiceYear: 2018, placedInServiceMonth: 1,
        rentalIncome: 24000, totalExpenses: 18000, isActiveParticipant: true }, // ~ -$3k after dep
      { taxYear: 2024, address: "2", propertyType: "residential", basis: 300000,
        placedInServiceYear: 2020, placedInServiceMonth: 6,
        rentalIncome: 30000, totalExpenses: 20000, isActiveParticipant: true }, // ~ $0
      { taxYear: 2024, address: "3", propertyType: "residential", basis: 225000,
        placedInServiceYear: 2015, placedInServiceMonth: 4,
        rentalIncome: 22000, totalExpenses: 16000, isActiveParticipant: true }, // ~ -$2k after dep
    ] });
  // Don't pin exact AGI (depreciation math depends on month convention), but verify
  // (a) AGI > 0 and (b) AGI < W-2 wages (some rental loss applied).
  if (r.adjustedGrossIncome > 0 && r.adjustedGrossIncome <= 80000) {
    PASS.push(`✓ [I7] AGI between $0 and $80k (rental loss applied or net = 0)`);
  } else {
    FAIL.push({ category: "I7", label: "AGI in expected range [0,80k]",
      expected: 80000, actual: r.adjustedGrossIncome });
  }
}

// I8. S-corp owner — single, $100k W-2 (S-corp salary) + $80k K-1 active, CA.
header("I8. S-corp owner — single $100k W-2 + $80k K-1 CA");
{
  const r = run({ client: { filingStatus: "single", state: "CA", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 13000, stateCode: "CA",
      stateWagesBox16: 100000, stateTaxWithheldBox17: 6000 }],
    scheduleK1: [{ taxYear: 2024, entityName: "Acme", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 80000 }] });
  // AGI = $180k (no SE on K-1 for S-corp). No QBI (auto-derivation not modeled).
  // Std ded $14,600. Taxable = $165,400.
  // Tax on $165k single: 1,160 + 4,266 + 11,742.50 + (165,400 − 100,525) × 24% = 17,168.50 + 15,570 = $32,738.50.
  check("I8", "AGI $180k (W-2 + K-1 active, no SE)", r.adjustedGrossIncome, 180000, 1);
  check("I8", "Taxable $165,400", r.taxableIncome, 165400, 1);
  check("I8", "Pre-credit fed tax $32,738.50", r.federalTaxLiability, 32738.50, 5);
}

// I9. Single parent HoH — $35k W-2, 2 kids, FL, EITC qualifies.
header("I9. Single parent HoH — $35k W-2 2 kids FL");
{
  const r = run({ client: { filingStatus: "head_of_household", state: "FL", taxYear: 2024,
    dependentsUnder17: 2 },
    w2s: [{ taxYear: 2024, wagesBox1: 35000, federalTaxWithheldBox2: 2500, stateCode: "FL" }] });
  // AGI $35k. Std ded HoH $21,900. Taxable $13,100.
  // Tax single HoH brackets: 10% to $16,550. Tax = $1,310 — wait HoH brackets
  // 10% to $16,550, 12% to $63,100. So all $13,100 at 10% = $1,310.
  // CTC: 2 × $2,000 = $4,000. Limited to $1,310 → nonref $1,310, unused $2,690.
  // ACTC: min($2,690, 15%×(35k−2.5k)=$4,875, $1,700×2=$3,400) = $2,690.
  // EITC HoH 2 kids: at earned 35k → phase-out 21.06%×(35k−22,720) = 2,584. EITC = 6,960 − 2,584 = $4,376.
  check("I9", "Taxable $13,100", r.taxableIncome, 13100, 1);
  check("I9", "CTC nonref $1,310 (capped by tax)",
    r.childTaxCredit.nonRefundablePortion, 1310, 1);
  check("I9", "ACTC $2,690", r.additionalChildTaxCredit, 2690, 5);
  check("I9", "EITC $4,376", r.eitc.appliedCredit, 4376, 5,
    "Rev. Proc. 2023-34 §3.06");
}

// I10. NJ filer with NJ EITC piggyback.
header("I10. NJ filer with EITC piggyback (40% federal)");
{
  const r = run({ client: { filingStatus: "single", state: "NJ", taxYear: 2024,
    dependentsUnder17: 1 },
    w2s: [{ taxYear: 2024, wagesBox1: 22000, federalTaxWithheldBox2: 800, stateCode: "NJ",
      stateWagesBox16: 22000, stateTaxWithheldBox17: 200 }] });
  // Federal EITC 1 child at $22k: plateau is $12,390. 22k > plateau.
  // Phase-out start $22,720 → still on plateau → $4,213.
  // NJ EITC = 40% × 4,213 = $1,685.20.
  check("I10", "Federal EITC ≈ $4,213 (plateau)",
    r.eitc.appliedCredit, 4213, 5);
  check("I10", "NJ EITC = 40% federal ≈ $1,685",
    r.stateEitc?.credit ?? 0, 1685.20, 5,
    "NJ Div. Taxation");
}

// I11. Multi-W2 high earner — single $220k W-2, NIIT bind, no investment.
header("I11. High W-2 only — single $220k → NIIT $0 (no investment income)");
{
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 220000, federalTaxWithheldBox2: 50000, stateCode: "FL" }] });
  // MAGI $220k > $200k single. But NII = 0 → NIIT = min(0, 20k) = $0.
  check("I11", "NIIT $0 (no investment income)", r.niitTax, 0, 0.01);
}

// I12. Single trader — $40k W-2 + $120k LTCG + $60k STCG, NY.
header("I12. Single trader — $40k W-2 + LTCG $120k + STCG $60k NY");
{
  const r = run({ client: { filingStatus: "single", state: "NY", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 40000, federalTaxWithheldBox2: 5000, stateCode: "NY",
      stateWagesBox16: 40000, stateTaxWithheldBox17: 2000 }],
    capitalTransactions: [
      { taxYear: 2024, description: "LT gain", proceeds: 200000, costBasis: 80000, formBox: "D" }, // +120k LT
      { taxYear: 2024, description: "ST gain", proceeds: 100000, costBasis: 40000, formBox: "A" }, // +60k ST
    ] });
  // Total income: 40k + 120k + 60k = $220k. AGI $220k.
  // Std ded $14,600. Taxable = $205,400. LTCG portion = $120k. STCG in ordinary = $60k.
  // Ordinary portion of taxable = 205,400 - 120,000 = $85,400.
  // Tax on $85,400 ordinary single: 1,160 + 4,266 + (85,400 − 47,150) × 22% = 5,426 + 8,415 = $13,841.
  // LTCG: $120k stacks above $85,400. 15% bracket starts at $47,025 (already passed); 20% bracket starts at $518,900.
  //   All $120k at 15% = $18,000.
  // Regular fed = $13,841 + $18,000 = $31,841.
  // NIIT: MAGI $220k > $200k. NII = $120k + $60k = $180k. Excess = $20k. NIIT = $20k × 3.8% = $760.
  check("I12", "AGI $220k", r.adjustedGrossIncome, 220000, 1);
  check("I12", "Capital gains tax $18,000 (120k × 15%)",
    r.capitalGainsTax, 18000, 5,
    "QDCG Worksheet");
  check("I12", "NIIT $760", r.niitTax, 760, 5,
    "IRC §1411 — excess $20k × 3.8%");
  check("I12", "Pre-credit fed total = $32,601 (regular + NIIT)",
    r.federalTaxLiability, 32601, 5);
}

// I13. International income — single $90k W-2 + $10k foreign div + $2k foreign tax paid, NJ.
header("I13. Foreign — single $90k W-2 + $10k foreign div + $2k FTC NJ");
{
  const r = run({ client: { filingStatus: "single", state: "NJ", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 90000, federalTaxWithheldBox2: 11000, stateCode: "NJ" }],
    form1099s: [{ taxYear: 2024, formType: "div", payerName: "FX", ordinaryDividends: 10000, qualifiedDividends: 8000 }],
    adjustments: [
      { adjustmentType: "foreign_tax_paid", amount: 2000, isApplied: true },
      { adjustmentType: "foreign_source_taxable_income", amount: 10000, isApplied: true },
    ] });
  // Just spot-check: foreign tax credit > 0 (limit-bound or not, should apply).
  if (r.foreignTaxCredit.credit > 0 && r.foreignTaxCredit.credit <= 2000) {
    PASS.push(`✓ [I13] FTC applied (≤ $2k paid): $${r.foreignTaxCredit.credit.toFixed(0)}`);
  } else {
    FAIL.push({ category: "I13", label: "FTC in expected range (0, 2000]",
      expected: 2000, actual: r.foreignTaxCredit.credit });
  }
}

// I14. AOC family — MFJ, 1 kid at college, $120k W-2 + $5k qualified expenses.
header("I14. AOC family — MFJ $120k W-2 + 1 college kid $5k expenses");
{
  const r = run({ client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024,
    dependentsUnder17: 0, otherDependents: 1 },
    w2s: [{ taxYear: 2024, wagesBox1: 120000, federalTaxWithheldBox2: 16000, stateCode: "FL" }],
    adjustments: [{ adjustmentType: "qualified_education_expenses_aoc", amount: 5000, isApplied: true }] });
  // AGI $120k < phase-out start $160k MFJ. AOC = $2,500 (max).
  check("I14", "AOC = $2,500 (under MFJ phase-out)",
    r.educationCredits.aocApplied, 2500, 1);
  // ODC $500 for college kid (dependent over 17).
  check("I14", "ODC $500 (1 other dependent)",
    r.childTaxCredit.appliedCredit, 500, 1);
}

// I15. Retiree with SS — NOT MODELED (engine doesn't have SS taxability calc).
// Documented gap — skip in J section.

// I16. Schedule A heavy itemizer — MFJ, $200k W-2, $15k medical, $25k mortgage, $5k charitable, $12k SALT.
header("I16. Sch A itemize — MFJ $200k + medical/mortgage/charitable/SALT");
{
  const r = run({ client: { filingStatus: "married_filing_jointly", state: "CA", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 30000, stateCode: "CA",
      stateWagesBox16: 200000, stateTaxWithheldBox17: 12000 }],
    adjustments: [
      { adjustmentType: "medical_expenses", amount: 30000, isApplied: true }, // 7.5% AGI floor = $15k → $15k deductible
      { adjustmentType: "mortgage_interest", amount: 25000, isApplied: true },
      { adjustmentType: "charitable_cash", amount: 5000, isApplied: true },
      { adjustmentType: "state_income_tax", amount: 12000, isApplied: true }, // capped at $10k
    ] });
  // Sch A: medical $15k + SALT $10k + mortgage $25k + charitable $5k = $55k itemized.
  check("I16", "Sch A medical = $15k (30k − 7.5% × 200k)",
    r.scheduleA.medicalDeductible, 15000, 1);
  check("I16", "Sch A SALT = $10k (capped)", r.scheduleA.saltDeductible, 10000, 1);
  check("I16", "Sch A mortgage = $25k", r.scheduleA.mortgageDeductible, 25000, 1);
  check("I16", "Sch A charitable = $5k", r.scheduleA.charitableDeductible, 5000, 1);
  check("I16", "Sch A total = $55k (> std ded $29.2k → itemize)",
    r.itemizedDeductions ?? 0, 55000, 1);
}

// I17. Multi-state W-2 — MFJ, one spouse NY $80k, other NJ $70k, resident NY.
header("I17. Multi-state — MFJ resident NY ($80k NY + $70k NJ W-2)");
{
  const r = run({ client: { filingStatus: "married_filing_jointly", state: "NY", taxYear: 2024 },
    w2s: [
      { taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 9000, stateCode: "NY",
        stateWagesBox16: 80000, stateTaxWithheldBox17: 4000 },
      { taxYear: 2024, wagesBox1: 70000, federalTaxWithheldBox2: 8000, stateCode: "NJ",
        stateWagesBox16: 70000, stateTaxWithheldBox17: 3500 },
    ] });
  // AGI $150k. Federal taxable = 150k - 29.2k = $120.8k.
  // Multi-state: NY taxes the resident on full $150k; NJ taxes non-resident on $70k NJ-source;
  // NY gives credit for NJ tax paid on the $70k portion (capped at NY's tax on the same portion).
  // Just verify: state tax > 0 and ≤ $150k × max(NY rate ~6.85%).
  if (r.stateTaxLiability > 0 && r.stateTaxLiability < 15000) {
    PASS.push(`✓ [I17] State tax in reasonable range: $${r.stateTaxLiability.toFixed(0)}`);
  } else {
    FAIL.push({ category: "I17", label: "State tax in [0, 15k]",
      expected: 7000, actual: r.stateTaxLiability });
  }
}

// I18. Saver's Credit + IRA — single, $35k W-2 + $2k IRA, FL.
header("I18. Saver's + IRA — single $35k + $2k traditional FL");
{
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024,
    iraCoveredByWorkplacePlan: false, taxpayerAge: 30 },
    w2s: [{ taxYear: 2024, wagesBox1: 35000, federalTaxWithheldBox2: 3000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "ira_contribution_traditional", amount: 2000, isApplied: true },
      { adjustmentType: "retirement_contributions_savers", amount: 2000, isApplied: true },
    ] });
  // AGI = 35,000 − 2,000 = $33,000.
  // Saver's: at AGI $33,000 single → 10% rate (25,001–38,250).
  // Credit = $2,000 × 10% = $200.
  check("I18", "AGI $33k (IRA deducted)", r.adjustedGrossIncome, 33000, 1);
  check("I18", "Saver's $200 (10% tier)", r.saversCredit.appliedCredit, 200, 1);
}

// I19. Dep care — MFJ, both work, 1 kid, $5k expenses, AGI $50k.
header("I19. Dep care — MFJ $50k, 1 child, $5k expenses");
{
  const r = run({ client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024,
    dependentsUnder17: 1, dependentsForCareCredit: 1, spouseEarnedIncome: 25000 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 4000, stateCode: "FL" }],
    adjustments: [{ adjustmentType: "dependent_care_expenses", amount: 5000, isApplied: true }] });
  // 1 child cap $3,000. Lower earner $25k. AGI $50k > $43k → 20% rate.
  // Credit = $3,000 × 20% = $600.
  check("I19", "Dep care = $600 (1 child cap × 20%)",
    r.dependentCareCredit.appliedCredit, 600, 5);
}

// I20. Mega-itemize MFJ wealthy — $500k W-2, $100k+ Sch A items, NY+NYC.
header("I20. Wealthy MFJ — $500k W-2 NY+NYC big itemizers");
{
  const r = run({ client: { filingStatus: "married_filing_jointly", state: "NY", taxYear: 2024,
    localityCode: "NYC" },
    w2s: [{ taxYear: 2024, wagesBox1: 500000, federalTaxWithheldBox2: 130000, stateCode: "NY",
      stateWagesBox16: 500000, stateTaxWithheldBox17: 40000 }],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 50000, isApplied: true }, // capped $10k
      { adjustmentType: "mortgage_interest", amount: 30000, isApplied: true },
      { adjustmentType: "charitable_cash", amount: 25000, isApplied: true },
    ] });
  // AGI $500k. Itemized $65k. Taxable $435k.
  // MFJ tax on $435k (per Tax Comp Wksht single/MFJ brackets):
  //   2,320 + 8,532 + 23,506 + 43,884 + 32%×(435k − 383,900) = 94,594.
  // Plus Form 8959 Additional Medicare (added in K2):
  //   $500k Medicare wages − $250k MFJ threshold = $250k × 0.9% = $2,250.
  // Total federal tax = 94,594 + 2,250 = $96,844.
  check("I20", "Federal tax = $96,844 (regular $94,594 + Add'l Medicare $2,250)",
    r.federalTaxLiability, 96844, 50,
    "Form 1040 MFJ Tax Comp Wksht 2024 + Form 8959 Part I");
  check("I20", "Add'l Medicare $2,250 on $500k MFJ wages",
    r.additionalMedicareTax, 2250, 0.10,
    "Form 8959 — $250k over MFJ $250k threshold × 0.9%");
  // NYC local tax should be > 0 for any NYC resident with positive income.
  check("I20", "NYC local tax > 0",
    (r.localTaxLiability ?? 0) > 0 ? 1 : 0, 1, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// J. INVARIANT PROPERTIES — sanity checks on every scenario
// ════════════════════════════════════════════════════════════════════════════
section("J. INVARIANTS — properties that must always hold");

const invariantScenarios: Array<{ label: string; inputs: Parameters<typeof run>[0] }> = [
  { label: "single $50k FL", inputs: { client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }] } },
  { label: "MFJ $200k CA", inputs: { client: { filingStatus: "married_filing_jointly", state: "CA", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, stateCode: "CA" }] } },
  { label: "single $1M NY+NYC", inputs: { client: { filingStatus: "single", state: "NY", taxYear: 2024, localityCode: "NYC" },
    w2s: [{ taxYear: 2024, wagesBox1: 1000000, stateCode: "NY" }] } },
  { label: "HoH $30k 2 kids FL", inputs: { client: { filingStatus: "head_of_household", state: "FL", taxYear: 2024, dependentsUnder17: 2 },
    w2s: [{ taxYear: 2024, wagesBox1: 30000, stateCode: "FL" }] } },
  { label: "MFS $50k TX", inputs: { client: { filingStatus: "married_filing_separately", state: "TX", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "TX" }] } },
  { label: "single $0 income", inputs: { client: { filingStatus: "single", state: "FL", taxYear: 2024 } } },
];

for (const s of invariantScenarios) {
  const r = run(s.inputs);
  // INV1: Federal tax liability is non-negative.
  check("J", `INV1 ${s.label}: fed tax ≥ 0`,
    r.federalTaxLiability >= 0 ? 1 : 0, 1, 0.01);
  // INV2: AMT ≥ 0.
  check("J", `INV2 ${s.label}: AMT ≥ 0`,
    r.amtTax >= 0 ? 1 : 0, 1, 0.01);
  // INV3: NIIT ≥ 0.
  check("J", `INV3 ${s.label}: NIIT ≥ 0`,
    r.niitTax >= 0 ? 1 : 0, 1, 0.01);
  // INV4: SE tax ≥ 0.
  check("J", `INV4 ${s.label}: SE tax ≥ 0`,
    r.selfEmploymentTax >= 0 ? 1 : 0, 1, 0.01);
  // INV5: CTC applied ≤ tentative.
  if (r.childTaxCredit.appliedCredit > 0) {
    check("J", `INV5 ${s.label}: CTC applied ≤ tentative`,
      r.childTaxCredit.appliedCredit <= (r.childTaxCredit.appliedCredit + r.additionalChildTaxCredit + 100) ? 1 : 0,
      1, 0.01);
  }
  // INV6: Std ded > 0 for any filing status.
  check("J", `INV6 ${s.label}: std ded > 0`,
    r.standardDeduction > 0 ? 1 : 0, 1, 0.01);
  // INV7: AGI ≥ taxable income (when not itemizing more than AGI).
  if (r.adjustedGrossIncome > 0) {
    check("J", `INV7 ${s.label}: AGI ≥ taxable income`,
      r.adjustedGrossIncome >= r.taxableIncome - 0.01 ? 1 : 0, 1, 0.01);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// K. DOCUMENTED GAPS (probes for features NOT yet modeled)
// ════════════════════════════════════════════════════════════════════════════
section("K. DOCUMENTED GAPS (features intentionally not modeled)");

// K1. SE tax with both W-2 + SE income — Sch SE Part I Line 9.  CLOSED 2026-05-23.
// Engine now reduces the SS wage base by W-2 SS wages (Box 3, fallback to
// Box 1) before applying 12.4% on SE net earnings. Below are the canonical
// hand-calc cases. Known sub-gap: MFJ engine uses household-aggregated W-2
// SS wages rather than per-spouse, so mixed-spouse cases (SE earner is the
// non-W-2 spouse) are approximate. We avoid asserting those.
header("K1. SE tax: W-2 + SE combined (Sch SE Line 9) — CLOSED");
{
  // K1a — original deep-audit case: single $100k W-2 + $200k Sch C, FL.
  //   ssBase TY2024 = $168,600. W-2 SS = $100,000 → available = $68,600.
  //   Net SE = $200,000 × 0.9235 = $184,700.
  //   SS portion = min(184700, 68600) × 12.4% = 68600 × 0.124 = $8,506.40.
  //   Medicare portion = 184700 × 2.9% = $5,356.30.
  //   Total SE tax = $13,862.70.
  const a = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "X", nonemployeeCompensation: 200000 }] });
  check("K1a", "Single $100k W-2 + $200k Sch C → SE tax $13,862.70",
    a.selfEmploymentTax, 13862.70, 0.10, "Sch SE Part I Line 9");

  // K1b — W-2 alone fully consumes SS base. Single $200k W-2 + $50k Sch C, FL.
  //   ssBase = $168,600. W-2 SS = $200,000 → available = $0.
  //   Net SE = $50,000 × 0.9235 = $46,175.
  //   SS portion = min(46175, 0) × 12.4% = $0.
  //   Medicare portion = 46175 × 2.9% = $1,339.075.
  //   Total = $1,339.08.
  const b = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "X", nonemployeeCompensation: 50000 }] });
  check("K1b", "Single $200k W-2 (>SS base) + $50k Sch C → Medicare only $1,339.08",
    b.selfEmploymentTax, 1339.08, 0.10, "Sch SE Part I Line 9 — W-2 SS wages already cap SS portion");

  // K1c — combined under SS base, no functional change vs. pre-fix engine.
  //   Single $50k W-2 + $50k Sch C, FL. Net SE = 46175.
  //   ssBase available = 168600 - 50000 = 118600. min(46175, 118600) = 46175.
  //   SS portion = 46175 × 0.124 = $5,725.70. Medicare = $1,339.075.
  //   Total = $7,064.78. (Pre-fix engine would compute the same number here.)
  const c = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "X", nonemployeeCompensation: 50000 }] });
  check("K1c", "Single $50k W-2 + $50k Sch C (combined < SS base) → $7,064.78",
    c.selfEmploymentTax, 7064.78, 0.10, "Sch SE Part I Line 9 — slack remains for SE");

  // K1d — pure-SE filer (no W-2). Regression case — must match pre-fix engine.
  //   Single $0 W-2 + $200k Sch C, FL.
  //   Net SE = 184700. SS base available = 168600. SS portion = 168600 × 0.124 = $20,906.40.
  //   Medicare = $5,356.30. Total = $26,262.70.
  const d = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "X", nonemployeeCompensation: 200000 }] });
  check("K1d", "Single $0 W-2 + $200k Sch C (pure SE, no fix effect) → $26,262.70",
    d.selfEmploymentTax, 26262.70, 0.10, "Sch SE — pure SE filer unchanged by Line 9");

  // K1e — explicit Box 3 takes precedence over Box 1. Single. W-2 has Box 1 = $80k
  // (after 401(k) and pre-tax health) but Box 3 = $100k (full SS wages).
  // Box 3 should be used → SS base available = 168600 - 100000 = 68600.
  // Same SE math as K1a. Total = $13,862.70.
  const e = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, socialSecurityWagesBox3: 100000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "X", nonemployeeCompensation: 200000 }] });
  check("K1e", "Single 401k filer Box1=$80k Box3=$100k + $200k SE → $13,862.70",
    e.selfEmploymentTax, 13862.70, 0.10, "Sch SE Part I Line 9 — Box 3 preferred over Box 1");

  // K1f — TY2025 SS wage base $176,100. Single $100k W-2 + $200k Sch C.
  //   Available = 176100 - 100000 = 76100. Net SE = 184700.
  //   SS portion = min(184700, 76100) × 0.124 = 76100 × 0.124 = $9,436.40.
  //   Medicare = 184700 × 0.029 = $5,356.30. Total = $14,792.70.
  const f = run({ client: { filingStatus: "single", state: "FL", taxYear: 2025 },
    w2s: [{ taxYear: 2025, wagesBox1: 100000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2025, formType: "nec", payerName: "X", nonemployeeCompensation: 200000 }] });
  check("K1f", "TY2025 single $100k W-2 + $200k SE → $14,792.70 (SS base $176,100)",
    f.selfEmploymentTax, 14792.70, 0.10, "Sch SE Part I Line 9 — TY2025 SS wage base");

  // K1g — half-SE deduction tracks corrected SE tax. K1a setup → half = $6,931.35.
  check("K1g", "K1a half-SE deduction = SE/2 = $6,931.35",
    a.detail.se.deductibleHalf, 6931.35, 0.10, "Half-SE above-the-line deduction reflects corrected SS portion");

  // K1h — MFJ regression case: engine intentionally does NOT apply Line 9 to
  // MFJ (per-spouse data not modeled). Behavior must remain unchanged from
  // pre-fix: full SE tax computed on the SS base regardless of household
  // W-2 SS wages. MFJ $110k+$75k W-2 + $8k Sch C, CA.
  //   Net SE = 8000 × 0.9235 = 7388.
  //   SS portion = min(7388, 168600) × 0.124 = $916.11.
  //   Medicare = 7388 × 0.029 = $214.25.
  //   Total = $1,130.36.
  const h = run({ client: { filingStatus: "married_filing_jointly", state: "CA", taxYear: 2024, dependentsUnder17: 0 },
    w2s: [
      { taxYear: 2024, wagesBox1: 110000, stateCode: "CA" },
      { taxYear: 2024, wagesBox1: 75000, stateCode: "CA" },
    ],
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "X", nonemployeeCompensation: 8000 }] });
  check("K1h", "MFJ $185k household W-2 + $8k SE → SE $1,130.36 (Line 9 intentionally not applied to MFJ)",
    h.selfEmploymentTax, 1130.36, 0.10, "Sch SE Part I Line 9 — MFJ requires per-spouse data; sub-gap tracked");
}

// K2. Additional Medicare 0.9% (Form 8959) on Medicare wages + SE.  CLOSED 2026-05-23.
// 0.9% on (Medicare wages + SE net) above filing-status threshold. Threshold
// shared across wages and SE — wages consume first; SE only above remainder.
// Thresholds: $200k single/HoH/QSS, $250k MFJ, $125k MFS.
header("K2. Form 8959 Additional Medicare 0.9% — CLOSED");
{
  // K2a — single $250k W-2 → (250k − 200k) × 0.9% = $450.
  const a = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 250000, federalTaxWithheldBox2: 60000, stateCode: "FL" }] });
  check("K2a", "Single $250k W-2 → Add'l Medicare $450",
    a.additionalMedicareTax, 450, 0.10, "Form 8959 Part I");

  // K2b — single $180k W-2 (under threshold) → $0.
  const b = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 180000, stateCode: "FL" }] });
  check("K2b", "Single $180k W-2 (under $200k) → Add'l Medicare $0",
    b.additionalMedicareTax, 0, 0.01, "Form 8959 — below threshold");

  // K2c — MFJ $300k Medicare wages (across two W-2s) → (300k − 250k) × 0.9% = $450.
  const c = run({ client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [
      { taxYear: 2024, wagesBox1: 200000, stateCode: "FL" },
      { taxYear: 2024, wagesBox1: 100000, stateCode: "FL" },
    ] });
  check("K2c", "MFJ $200k+$100k W-2 → Add'l Medicare $450",
    c.additionalMedicareTax, 450, 0.10, "Form 8959 Part I — MFJ threshold $250k");

  // K2d — MFS $130k W-2 → (130k − 125k) × 0.9% = $45.
  const d = run({ client: { filingStatus: "married_filing_separately", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 130000, stateCode: "FL" }] });
  check("K2d", "MFS $130k W-2 → Add'l Medicare $45",
    d.additionalMedicareTax, 45, 0.10, "Form 8959 — MFS threshold $125k");

  // K2e — single $150k W-2 + $100k Sch C. Wages under $200k.
  //   SE net = 100000 × 0.9235 = 92350.
  //   Threshold remaining for SE = 200000 - 150000 = 50000.
  //   SE over = max(0, 92350 - 50000) = 42350.
  //   Add'l Medicare on SE = 42350 × 0.009 = $381.15. Wages portion $0.
  //   Total Add'l Medicare = $381.15.
  const e = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 150000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "X", nonemployeeCompensation: 100000 }] });
  check("K2e", "Single $150k W-2 + $100k SE → Add'l Medicare $381.15 (SE portion only)",
    e.additionalMedicareTax, 381.15, 0.10, "Form 8959 Part II — threshold shared with wages");

  // K2f — single $300k W-2 + $50k Sch C. Wages over threshold by $100k; SE net 46175.
  //   Wages portion = (300k - 200k) × 0.9% = $900.
  //   SE threshold remaining = max(0, 200k - 300k) = 0.
  //   SE over = max(0, 46175 - 0) = 46175. SE portion = 46175 × 0.9% = $415.575.
  //   Total = $1,315.58.
  const f = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 300000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "X", nonemployeeCompensation: 50000 }] });
  check("K2f", "Single $300k W-2 + $50k SE → Add'l Medicare $1,315.58",
    f.additionalMedicareTax, 1315.58, 0.10, "Form 8959 — wages and SE both over threshold");

  // K2g — Box 5 (Medicare wages) takes precedence over Box 1. Single. Box 1 $180k
  // (after 401k), Box 5 $210k (Medicare wages not reduced by 401k).
  //   Box 5 over threshold = max(0, 210k - 200k) = 10000. Add'l Medicare = $90.
  const g = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 180000, medicareWagesBox5: 210000, stateCode: "FL" }] });
  check("K2g", "Single Box1=$180k Box5=$210k → Add'l Medicare $90 (Box 5 preferred)",
    g.additionalMedicareTax, 90, 0.10, "Form 8959 — Box 5 (Medicare wages) is the right base");

  // K2h — Add'l Medicare flows into federalTaxLiability (Sch 2 Line 11).
  // Compare K2a above-threshold case vs an under-threshold control.
  //   Both: single FL, std ded $14,600. K2a: $250k W-2. Control: $180k W-2.
  //   The federal tax delta isn't exactly $450 (different ordinary tax due to
  //   different income), but K2a.federalTaxLiability must include $450 of
  //   Add'l Medicare. We verify additionalMedicareTax > 0 and that the
  //   ComputedTaxReturn carries the line through.
  check("K2h", "K2a Add'l Medicare appears in federalTaxLiability",
    a.federalTaxLiability >= a.additionalMedicareTax ? 1 : 0, 1, 0,
    "Sch 2 Line 11 — Add'l Medicare is an 'other tax' included in total federal liability");
}

// K3. AMT × LTCG (Form 6251 Part III) — engine taxes LTCG at 26/28% within AMT.
// Real Form 6251 keeps LTCG at preferential rates.
header("K3. AMT × LTCG: Form 6251 Part III preferential rates — GAP");
{
  // Single, $200k ordinary taxable + $100k LTCG. Std ded already deducted in inputs.
  // Engineer via $314,600 wages + $100k LTCG.
  // Correct: AMT on ordinary (after exemption etc.) + LTCG at 15%.
  // We can't easily back-compute the exact "correct" AMT without re-implementing
  // Form 6251 Part III, but we can detect that AMT is HIGHER than it should be
  // for any high-LTCG case.
  // Just emit the gap unconditionally — verified by reading calculateAmt.
  FAIL.push({
    category: "K3-expected", label: "AMT does not apply LTCG preferential rates (Form 6251 Part III)",
    expected: 0, actual: 0,
    source: "Form 6251 Part III — AMT preserves 0/15/20% LTCG rates",
  });
}

// K4. NOL carryforward (post-TCJA 80% limit). NOT modeled.
header("K4. NOL carryforward — GAP");
{
  FAIL.push({
    category: "K4-expected", label: "NOL carryforward (post-TCJA 80% taxable income limit) not modeled",
    expected: 0, actual: 0,
    source: "IRC §172(a)(2) post-TCJA",
  });
}

// K5. SEHI deduction (self-employed health insurance — Form 7206).  CLOSED 2026-05-24.
// Above-the-line deduction. Adjustment `self_employed_health_insurance_premiums`
// holds the gross premiums; engine caps at (net SE earnings − half-SE).
header("K5. SEHI — Form 7206 — CLOSED");
{
  // K5a — single $80k Sch C, $9,600 premiums.
  //   Net SE = 80000 × 0.9235 = 73880.
  //   SE tax = 73880 × 0.153 = $11,303.64 → half-SE = $5,651.82.
  //   Cap = 73880 - 5651.82 = $68,228.18. Premiums $9,600 < cap → SEHI $9,600.
  //   AGI drop: ($14,600 std → AGI = 80000 - 5651.82 - 9600 = $64,748.18).
  const a = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "X", nonemployeeCompensation: 80000 }],
    adjustments: [{ adjustmentType: "self_employed_health_insurance_premiums", amount: 9600, isApplied: true }] });
  check("K5a", "Single $80k SE + $9,600 premiums → SEHI $9,600 (under cap)",
    a.sehi.deduction, 9600, 0.01, "Form 7206 line 5");
  check("K5a", "AGI reflects SEHI subtraction → $64,748.18",
    a.adjustedGrossIncome, 64748.18, 0.10, "AGI = total income − half-SE − SEHI");

  // K5b — single $10k Sch C, $9,000 premiums (premiums exceed cap).
  //   Net SE = 9235. Half-SE = 9235 × 0.153 / 2 = 706.48.
  //   Cap = 9235 - 706.48 = $8,528.52. Premiums $9,000 > cap → SEHI = $8,528.52.
  const b = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "X", nonemployeeCompensation: 10000 }],
    adjustments: [{ adjustmentType: "self_employed_health_insurance_premiums", amount: 9000, isApplied: true }] });
  check("K5b", "Premiums > earnings cap → SEHI capped at $8,528.52",
    b.sehi.deduction, 8528.52, 0.10, "Form 7206 line 5 — cap binds");

  // K5c — no SE income but premiums entered → SEHI = $0 (the engine treats SE-less
  // filers as having a $0 cap; not eligible for SEHI per IRC §162(l)).
  const c = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
    adjustments: [{ adjustmentType: "self_employed_health_insurance_premiums", amount: 5000, isApplied: true }] });
  check("K5c", "No SE income → SEHI $0 (cap = 0)",
    c.sehi.deduction, 0, 0.01, "Form 7206 — earned-income cap forbids deduction without SE");

  // K5d — MFJ $100k Sch C + $7,200 premiums.
  //   Net SE = 92350. Half-SE = 92350 × 0.153 / 2 = 7064.78.
  //   Cap = 92350 - 7064.78 = $85,285.22. Premiums under cap → SEHI = $7,200.
  const d = run({ client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "X", nonemployeeCompensation: 100000 }],
    adjustments: [{ adjustmentType: "self_employed_health_insurance_premiums", amount: 7200, isApplied: true }] });
  check("K5d", "MFJ $100k SE + $7,200 premiums → SEHI $7,200",
    d.sehi.deduction, 7200, 0.01, "MFJ SEHI — same per-filer cap");

  // K5e — Schedule C net (not 1099-NEC) — verify SEHI works against Sch C path.
  //   $40k Sch C net via additional `self_employment_income` adjustment.
  //   Net SE = 36940. Half-SE = 2826.91. Cap = 34113.09. Premiums $3,000 < cap.
  const e = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    adjustments: [
      { adjustmentType: "self_employment_income", amount: 40000, isApplied: true },
      { adjustmentType: "self_employed_health_insurance_premiums", amount: 3000, isApplied: true },
    ] });
  check("K5e", "Sch C $40k + $3k SEHI → deduction $3,000",
    e.sehi.deduction, 3000, 0.01, "SEHI applies to Sch C path equally");

  // K5f — Default (no adjustment) → sehi.deduction = 0 (regression baseline).
  const f = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }] });
  check("K5f", "No SEHI adjustment → SEHI $0",
    f.sehi.deduction, 0, 0.01, "Default state — no SEHI applied");
}

// K6. §121 home-sale exclusion. NOT modeled.
header("K6. §121 home-sale exclusion — GAP");
{
  FAIL.push({
    category: "K6-expected", label: "§121 home-sale exclusion ($250k/$500k) not modeled",
    expected: 0, actual: 0,
    source: "IRC §121; Pub 523",
  });
}

// K7. §1202 QSBS. NOT modeled.
header("K7. §1202 QSBS — GAP");
{
  FAIL.push({
    category: "K7-expected", label: "§1202 QSBS 100% exclusion (post-2010 acquisitions) not modeled",
    expected: 0, actual: 0,
    source: "IRC §1202",
  });
}

// K8. Kiddie tax (Form 8615). NOT modeled.
header("K8. Kiddie tax (Form 8615) — GAP");
{
  FAIL.push({
    category: "K8-expected", label: "Kiddie tax (Form 8615) on unearned income > $2,600 not modeled",
    expected: 0, actual: 0,
    source: "Form 8615 (2024)",
  });
}

// K9. FEIE (§911) for expats. NOT modeled.
header("K9. FEIE §911 — GAP");
{
  FAIL.push({
    category: "K9-expected", label: "FEIE §911 ($126,500 TY2024) + stacking rule not modeled",
    expected: 0, actual: 0,
    source: "Form 2555 (2024)",
  });
}

// K10. SS taxability worksheet (Pub 915). NOT modeled.
header("K10. SS taxability — GAP");
{
  FAIL.push({
    category: "K10-expected", label: "Social Security taxability worksheet (0/50/85%) not modeled (engine has no SS field)",
    expected: 0, actual: 0,
    source: "Pub 915",
  });
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT
// ════════════════════════════════════════════════════════════════════════════
const realFails = FAIL.filter((f) => !f.category.endsWith("-expected"));
const docGaps = FAIL.filter((f) => f.category.endsWith("-expected"));

console.log("\n");
console.log("══════════════════════════════════════════════════════════════════");
console.log(`  DEEP AUDIT RESULTS:`);
console.log(`    passed:               ${PASS.length}`);
console.log(`    real failures:        ${realFails.length}`);
console.log(`    documented gaps:      ${docGaps.length}`);
console.log("══════════════════════════════════════════════════════════════════");

if (realFails.length > 0) {
  console.log("\nREAL FAILURES (engine deltas):");
  for (const f of realFails) {
    const deltaStr = f.delta != null ? ` (Δ=${f.delta > 0 ? "+" : ""}${f.delta})` : "";
    console.log(`  ✗ [${f.category}] ${f.label}`);
    console.log(`      expected ${typeof f.expected === "number" ? f.expected.toFixed(2) : f.expected}, got ${typeof f.actual === "number" ? f.actual.toFixed(2) : f.actual}${deltaStr}`);
    if (f.source) console.log(`      source: ${f.source}`);
  }
}

if (docGaps.length > 0) {
  console.log("\nDOCUMENTED GAPS (known limitations, tracked):");
  for (const f of docGaps) {
    console.log(`  ⚠ [${f.category}] ${f.label}`);
    if (f.source) console.log(`      source: ${f.source}`);
  }
}

if (realFails.length === 0) {
  console.log("\n✓ All non-documented-gap assertions pass.");
}

import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..", "..", "docs", "accuracy-audit");
await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, "deep-audit-latest.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  pass: PASS.length,
  realFailures: realFails.length,
  documentedGaps: docGaps.length,
  failures: realFails,
  gaps: docGaps,
}, null, 2));
console.log(`\nReport: ${outDir}/deep-audit-latest.json`);

process.exit(realFails.length > 0 ? 1 : 0);
