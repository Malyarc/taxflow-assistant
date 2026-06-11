/**
 * FULL-APP MAXIMUM AUDIT — 2026-06-11 regression suite.
 *
 * Pins the correctness fixes from the 2026-06-11 audit (a 13-agent fan-out + the
 * NEW differential-oracle harness vs tenforty/OpenTaxSolver). Two themes:
 *
 *  A) The **qualifying-surviving-spouse (QSS) ≠ joint-return** cluster. The engine
 *     treated `qualifying_widow` as MFJ at several sites where the statute's
 *     "joint return" language EXCLUDES a §2(a) surviving spouse (who files
 *     singly). QSS correctly = MFJ for §1 brackets, §63(c)(2) std ded, and
 *     §1411 NIIT; but QSS = "any other case"/single for:
 *       - §3101(b)(2) Additional Medicare ($200k, not $250k)        [oracle-found]
 *       - §86(c) Social Security taxability ($25k/$34k base amounts)
 *       - §21(d)(1) dependent care (no spouse earned-income floor)
 *       - §25A(d)(2) education-credit MAGI band ($80–90k single)
 *       - §32(b)(2)(B) EITC (single/HoH column)
 *       - §221(b)(2)(B) student-loan-interest band (single)
 *
 *  B) **1099-INT box semantics.** Box 1 (taxable) and Box 8 (tax-exempt) are
 *     DISJOINT on the form; Box 8 must NOT be netted out of Box 1, and Box 3
 *     (US Savings Bond / Treasury interest) is federally TAXABLE and was being
 *     dropped entirely. Now: taxable interest = Box 1 + Box 3 (matches the
 *     @workspace/validation taxable-interest base + the AI extractor's mapping).
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 0.02) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}
function checkExact(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

function run(
  filingStatus: string,
  extraClient: Partial<TaxReturnInputs["client"]>,
  w2Wages: number,
  form1099s: TaxReturnInputs["form1099s"] = [],
  adjustments: TaxReturnInputs["adjustments"] = [],
  taxYear = 2024,
) {
  return computeTaxReturnPure({
    client: { filingStatus, state: "FL", taxYear, ...extraClient },
    w2s: w2Wages > 0
      ? [{ taxYear, wagesBox1: w2Wages, medicareWagesBox5: w2Wages, federalTaxWithheldBox2: 0, stateCode: "FL" }]
      : [],
    form1099s,
    adjustments,
    taxYear,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// A1 — QSS Additional Medicare Tax threshold = $200,000 (§3101(b)(2)(C)).
//   Form 8959 lists QSS with single/HoH; a §2(a) surviving spouse is NOT a
//   "joint return". (Found by the differential oracle: −$450 on every QSS
//   filer with Medicare wages in the $200k–$250k band.)
// ════════════════════════════════════════════════════════════════════════════
header("A1 — QSS Additional Medicare $200k threshold");
{
  // $307,274 Medicare wages: 0.9% × (307,274 − 200,000) = 0.9% × 107,274 = $965.466.
  check("QSS 2024 $307,274 wages → $965.47", run("qualifying_widow", {}, 307274).additionalMedicareTax, 965.47, 0.01);
  // Control: MFJ keeps $250k → 0.9% × (307,274 − 250,000) = $515.466.
  check("MFJ 2024 $307,274 wages → $515.47 (unchanged)", run("married_filing_jointly", {}, 307274).additionalMedicareTax, 515.47, 0.01);
  // Control: single is and stays $200k → identical to QSS now.
  check("single 2024 $307,274 wages → $965.47", run("single", {}, 307274).additionalMedicareTax, 965.47, 0.01);
  // QSS below $200k → $0.
  check("QSS 2024 $190,000 wages → $0", run("qualifying_widow", {}, 190000).additionalMedicareTax, 0, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// A2 — QSS Social Security taxability uses the single base amounts $25k/$34k
//   (§86(c)(1)(A) "any other case"), NOT the joint $32k/$44k. (Contrast §1411
//   NIIT, which DOES group QSS with joint.)
// ════════════════════════════════════════════════════════════════════════════
header("A2 — QSS SS taxability single thresholds ($25k/$34k)");
{
  // $30k wages + $20k SS. Provisional = 30,000 + 10,000 = 40,000.
  //  Single ($25k/$34k): over $34k → 0.85×(40k−34k) + min(½SS, ½×$9k) =
  //    5,100 + min(10,000, 4,500) = 5,100 + 4,500 = $9,600 taxable SS.
  //  → totalIncome = 30,000 + 9,600 = $39,600.
  const qss = run("qualifying_widow", { socialSecurityBenefits: 20000 }, 30000);
  const hoh = run("head_of_household", { socialSecurityBenefits: 20000 }, 30000);
  const mfj = run("married_filing_jointly", { socialSecurityBenefits: 20000 }, 30000);
  check("QSS taxable SS $9,600 (single base) → totalIncome $39,600", qss.totalIncome, 39600, 1);
  check("QSS == HoH (single base)", qss.totalIncome, hoh.totalIncome, 1);
  //  MFJ ($32k/$44k): provisional 40k under $44k → 50% tier =
  //    min(½SS, ½×(40k−32k)) = min(10,000, 4,000) = $4,000 → totalIncome $34,000.
  check("MFJ taxable SS $4,000 (joint base, unchanged) → totalIncome $34,000", mfj.totalIncome, 34000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// A3 — QSS dependent-care credit (§21(d)(1)): a surviving spouse is NOT married,
//   so only the TAXPAYER's earned income limits the credit (no spouse floor of
//   $0 that zeroed it). 1 child, $3,000 expenses, $40k wages.
//   AGI $40k → applicable % = 35% − ceil((40,000−15,000)/2,000)% = 35%−13% = 22%.
//   Credit = min($3,000, $3,000, $40,000) × 22% = $660.
// ════════════════════════════════════════════════════════════════════════════
header("A3 — QSS dependent-care credit (taxpayer earned income only)");
{
  const dep = [{ adjustmentType: "dependent_care_expenses", amount: 3000 }];
  const qss = run("qualifying_widow", { dependentsForCareCredit: 1, dependentsUnder17: 1 }, 40000, [], dep);
  const hoh = run("head_of_household", { dependentsForCareCredit: 1, dependentsUnder17: 1 }, 40000, [], dep);
  check("QSS dependent-care credit $660 (was $0)", qss.dependentCareCredit.appliedCredit, 660, 0.01);
  check("QSS == HoH", qss.dependentCareCredit.appliedCredit, hoh.dependentCareCredit.appliedCredit, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// A4 — QSS education credit MAGI band = single $80k–$90k (§25A(d)(2): the
//   doubled band is for "a joint return" only). MAGI $120k, $4,000 AOC expenses.
//   QSS: MAGI > $90k → fully phased out → $0. MFJ: $120k < $160k → full $2,500.
// ════════════════════════════════════════════════════════════════════════════
header("A4 — QSS education AOC single MAGI band");
{
  const aoc = [{ adjustmentType: "qualified_education_expenses_aoc", amount: 4000 }];
  const qss = run("qualifying_widow", {}, 120000, [], aoc);
  const hoh = run("head_of_household", {}, 120000, [], aoc);
  const mfj = run("married_filing_jointly", {}, 120000, [], aoc);
  check("QSS AOC $0 at $120k MAGI (single band; was $2,500)", qss.educationCredits.aocApplied, 0, 0.01);
  check("QSS == HoH", qss.educationCredits.aocApplied, hoh.educationCredits.aocApplied, 0.01);
  check("MFJ AOC $2,500 (joint band, unchanged)", mfj.educationCredits.aocApplied, 2500, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// A5 — QSS EITC uses the single/HoH phase-out column (§32(b)(2)(B): the higher
//   phase-out is for "a joint return"). 1 qualifying child, $25k earned.
//   The single column begins phase-out at $22,720 (2024); the MFJ column at
//   $29,640 (still on the plateau at $25k). So QSS == HoH < MFJ.
// ════════════════════════════════════════════════════════════════════════════
header("A5 — QSS EITC single/HoH column");
{
  const qss = run("qualifying_widow", { eitcQualifyingChildren: 1, dependentsUnder17: 1 }, 25000);
  const hoh = run("head_of_household", { eitcQualifyingChildren: 1, dependentsUnder17: 1 }, 25000);
  const mfj = run("married_filing_jointly", { eitcQualifyingChildren: 1, dependentsUnder17: 1 }, 25000);
  check("QSS EITC == HoH (single column)", qss.eitc.appliedCredit, hoh.eitc.appliedCredit, 0.01);
  checkExact("QSS EITC < MFJ (was wrongly on the MFJ plateau)", qss.eitc.appliedCredit < mfj.eitc.appliedCredit, true);
  checkExact("QSS EITC is partially phased out (< 2024 1-child max $4,213)", qss.eitc.appliedCredit < 4213, true);
}

// ════════════════════════════════════════════════════════════════════════════
// A6 — QSS student-loan-interest phase-out band = single $80k–$95k
//   (§221(b)(2)(B)). MAGI $120k → fully phased out → $0. MFJ band $165k–$195k →
//   $120k < $165k → full $2,500.
// ════════════════════════════════════════════════════════════════════════════
header("A6 — QSS student-loan-interest single band");
{
  const sli = [{ adjustmentType: "student_loan_interest", amount: 2500 }];
  const qss = run("qualifying_widow", {}, 120000, [], sli);
  const hoh = run("head_of_household", {}, 120000, [], sli);
  const mfj = run("married_filing_jointly", {}, 120000, [], sli);
  check("QSS SLI $0 at $120k MAGI (single band; was $2,500)", qss.studentLoanInterest.deductible, 0, 0.01);
  check("QSS == HoH", qss.studentLoanInterest.deductible, hoh.studentLoanInterest.deductible, 0.01);
  check("MFJ SLI $2,500 (joint band, unchanged)", mfj.studentLoanInterest.deductible, 2500, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// A7 — QSS §904(j) FTC de-minimis limit = $300 (single), not the $600 joint
//   limit (§904(j)(2)(C) "a joint return"). Found by /code-review (same class).
//   $450 foreign tax: QSS exceeds $300 → Form 1116 path (foreignTaxCredit ≤ the
//   §904 limit). MFJ stays under $600 → full $450 simplified credit.
// ════════════════════════════════════════════════════════════════════════════
header("A7 — QSS §904(j) simplified FTC limit $300");
{
  const ftc = [
    { adjustmentType: "foreign_tax_paid", amount: 450 },
    { adjustmentType: "foreign_source_taxable_income", amount: 20000 },
  ];
  const qss = run("qualifying_widow", {}, 120000, [], ftc).foreignTaxCredit;
  const mfj = run("married_filing_jointly", {}, 120000, [], ftc).foreignTaxCredit;
  check("QSS §904(j) simplified limit = $300 (single; was $600)", qss.simplifiedLimit, 300, 0.01);
  check("MFJ §904(j) simplified limit = $600 (unchanged)", mfj.simplifiedLimit, 600, 0.01);
  // $450 > $300 → QSS exceeds the simplified limit (Form 1116 path); MFJ stays under $600.
  checkExact("QSS exceeds $300 → Form 1116 path", qss.exceededSimplifiedLimit, true);
  checkExact("MFJ under $600 → simplified path (unchanged)", mfj.exceededSimplifiedLimit, false);
}

// ════════════════════════════════════════════════════════════════════════════
// A8 — QSS OBBBA senior deduction (TY2025): single caps/thresholds; the bonus
//   counts only the living taxpayer, not the deceased spouse. taxpayer 67,
//   "spouse" 70 (stale field), MAGI $60k (below the single $75k phase-out).
//   QSS → $6,000 (one senior). MFJ (two living 65+) → $12,000.
// ════════════════════════════════════════════════════════════════════════════
header("A8 — QSS OBBBA senior deduction (single, taxpayer-only)");
{
  const qss = run("qualifying_widow", { taxpayerAge: 67, spouseAge: 70 }, 60000, [], [], 2025);
  const mfj = run("married_filing_jointly", { taxpayerAge: 67, spouseAge: 70 }, 60000, [], [], 2025);
  check("QSS senior deduction $6,000 (one living senior; was $12,000)", qss.obbbaSchedule1A.senior, 6000, 1);
  check("MFJ senior deduction $12,000 (two living seniors, unchanged)", mfj.obbbaSchedule1A.senior, 12000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// B1 — 1099-INT Box 3 (US Savings Bond / Treasury interest) is federally
//   TAXABLE (Sch B line 1) and was being dropped entirely → $0 income.
// ════════════════════════════════════════════════════════════════════════════
header("B1 — 1099-INT Box 3 Treasury interest is taxable");
{
  const r = run("single", {}, 0, [{ formType: "int", usTreasuryInterest: 10000 }]);
  check("Box 3 $10,000 → totalIncome $10,000 (was $0)", r.totalIncome, 10000, 1);
  check("Box 3 → AGI $10,000", r.adjustedGrossIncome, 10000, 1);
  // Box 3 is federally taxable but STATE-exempt (federal preemption): a CA filer
  // with $10k Box 3 must owe the SAME CA tax as without it (the /code-review
  // caught that the new field wasn't wired to the state US-Treasury subtraction).
  const caBase = computeTaxReturnPure({
    client: { filingStatus: "single", state: "CA", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 0, stateCode: "CA" }],
    form1099s: [], adjustments: [], taxYear: 2024,
  }).stateTaxLiability;
  const caTreasury = computeTaxReturnPure({
    client: { filingStatus: "single", state: "CA", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 0, stateCode: "CA" }],
    form1099s: [{ formType: "int", usTreasuryInterest: 10000 }], adjustments: [], taxYear: 2024,
  });
  check("Box 3 Treasury raises federal AGI to $90,000", caTreasury.adjustedGrossIncome, 90000, 1);
  check("Box 3 Treasury is CA-state-exempt (CA tax unchanged vs base)", caTreasury.stateTaxLiability, caBase, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// B2 — 1099-INT Box 8 (tax-exempt) is DISJOINT from Box 1; it must NOT be netted
//   out of taxable interest. Box 1 $5,000 + Box 8 $3,000 → taxable interest
//   $5,000 (was $2,000), tax-exempt $3,000 tracked separately.
// ════════════════════════════════════════════════════════════════════════════
header("B2 — 1099-INT Box 8 not subtracted from Box 1");
{
  const r = run("single", {}, 0, [{ formType: "int", interestIncome: 5000, taxExemptInterest: 3000 }]);
  check("Box 1 $5k + Box 8 $3k → taxable interest $5,000 (was $2,000)", r.form1099Summary.interestIncome, 5000, 1);
  check("→ totalIncome $5,000", r.totalIncome, 5000, 1);
  check("tax-exempt interest tracked separately = $3,000", r.form1099Summary.taxExemptInterest, 3000, 1);
  // Per-payer Schedule B aggregation matches (Box 1 + Box 3, no Box 8 netting).
  const p = run("single", {}, 0, [{ formType: "int", payerName: "Brokerage", interestIncome: 700, usTreasuryInterest: 0, taxExemptInterest: 200 }]);
  check("Sch B payer taxable interest = Box 1 $700 (Box 8 not netted)", p.form1099Summary.scheduleBPayers[0]?.interestIncome ?? -1, 700, 1);
  // Control: Box 1 only is unchanged.
  check("Box 1 $5k only → $5,000 (no regression)", run("single", {}, 0, [{ formType: "int", interestIncome: 5000 }]).form1099Summary.interestIncome, 5000, 1);
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(70)}`);
for (const f of FAIL) console.log(f);
console.log(`AUDIT-2026-06-11: ${PASS.length} passed, ${FAIL.length} failed`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) process.exit(1);
