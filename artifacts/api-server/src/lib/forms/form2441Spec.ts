/**
 * T2.1 — Form 2441 substitute workpaper: Child and Dependent Care Expenses
 * (IRC §21). Line numbers follow the official TY2024 Form 2441 Part II
 * (lines 2–11).
 *
 * Every value traces to the engine's DependentCareCreditCalculation
 * (`ret.dependentCareCredit`):
 *   line 2/3 = expenses, capped at the $3,000 (one qualifying person) /
 *              $6,000 (two or more) limit (§21(c))
 *   line 4/5 = earnedIncomeLimit — the LESSER of the taxpayer's and (for a
 *              joint return) the spouse's earned income (§21(d))
 *   line 6   = eligibleExpenses = min(expenses, expense limit, earned-income
 *              limit)
 *   line 8   = rate — 35% phased down 1 point per $2,000 (or fraction) of AGI
 *              over $15,000, floored at 20% above $43,000 (§21(a)(2))
 *   line 9a  = appliedCredit = line 6 × line 8
 *   line 10  = Credit Limit Worksheet (reconstructed — income tax remaining
 *              after the foreign tax credit, matching the engine's ordering)
 *   line 11  = min(line 9c, line 10) → Schedule 3 line 2
 *
 * CPA review workpaper (Pub 1167 substitute conventions) — NOT a filed form.
 */

import type { ComputedTaxReturn } from "../taxReturnEngine";
import {
  checkLine,
  countLine,
  moneyLine,
  pctLine,
  textLine,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";

/** Regular income tax + AMT — exact inversion of the engine's liability assembly. */
function incomeTaxOnly(ret: ComputedTaxReturn): number {
  return (
    ret.federalTaxLiability -
    ret.selfEmploymentTax -
    ret.niitTax -
    ret.additionalMedicareTax -
    ret.earlyWithdrawalPenalty -
    ret.hsaExcessExcise -
    ret.scheduleH.total -
    Math.max(0, -ret.premiumTaxCredit.netPtc)
  );
}

export function buildForm2441(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  const dc = ret.dependentCareCredit;

  if (!(dc.appliedCredit > 0)) return null;

  const isJoint =
    ret.filingStatus === "married_filing_jointly" || ret.filingStatus === "qualifying_widow";

  const partI: FormLine[] = [
    textLine("1", "Care provider name / address / TIN / amount paid", null, {
      note: "(not modeled — CPA supplies the provider detail; the credit is disallowed without it per §21(e)(9))",
    }),
  ];

  const line3 = Math.min(Math.max(0, dc.expenses), dc.expenseLimit);
  const partII: FormLine[] = [
    countLine("2", "Qualifying persons (column (a)/(b))", dc.qualifyingChildren, {
      note: "Qualifying-person SSNs and the under-13/incapacity tests are CPA-verified facts.",
    }),
    moneyLine("2(d)", "Qualified expenses incurred and paid this year", dc.expenses),
    moneyLine("3", `Expenses limited to $${dc.expenseLimit.toLocaleString("en-US")} (${dc.qualifyingChildren === 1 ? "one qualifying person" : "two or more qualifying persons"})`, line3, {
      note: "§21(c): $3,000 for one qualifying person; $6,000 for two or more.",
    }),
    moneyLine("4/5", "Earned-income limit — lesser of taxpayer's and spouse's earned income", dc.earnedIncomeLimit, {
      note: isJoint
        ? "Joint return: the credit caps at the LOWER-earning spouse's earned income (§21(d)(1)). Engine: household earned income (W-2 + net SE − ½ SE tax) split via the client's spouseEarnedIncome field."
        : "Unmarried filer: the taxpayer's earned income (W-2 wages + net SE earnings − ½ SE tax).",
    }),
    moneyLine("6", "Smallest of line 3, line 4, or line 5 (eligible expenses)", dc.eligibleExpenses, {
      emphasis: true,
    }),
    checkLine("Line 6 ties: min(line 3, earned-income limit)", Math.min(line3, dc.earnedIncomeLimit), dc.eligibleExpenses),
    moneyLine("7", "Adjusted gross income (Form 1040 line 11)", ret.adjustedGrossIncome),
    pctLine("8", "Applicable percentage (35% → 20% by AGI)", dc.rate, {
      note: "§21(a)(2): 35% less 1 point per $2,000 (or fraction) of AGI over $15,000; 20% floor above $43,000.",
    }),
    moneyLine("9a", "Tentative credit (line 6 × line 8)", dc.appliedCredit, { emphasis: true }),
    checkLine("Line 9a ties: line 6 × line 8", dc.eligibleExpenses * dc.rate, dc.appliedCredit),
    textLine("9b", "Credit for prior-year expenses paid this year", null, {
      note: "(not modeled — CPA supplies; line 9c = line 9a + line 9b)",
    }),
  ];

  // Line 10 — Credit Limit Worksheet: income tax less the foreign tax credit
  // (the only credit the engine applies ahead of dependent care).
  const line10 = Math.max(0, incomeTaxOnly(ret) - ret.foreignTaxCredit.credit);
  const line11 = Math.min(dc.appliedCredit, line10);
  partII.push(
    moneyLine("10", "Credit Limit Worksheet — income tax remaining before this credit", line10, {
      note: "Income tax (regular + AMT) less the foreign tax credit, per the engine's Schedule-3 ordering.",
    }),
    moneyLine("11", "Credit for child and dependent care expenses — smaller of line 9c or line 10 (Schedule 3 line 2)", line11, {
      emphasis: true,
      note: line11 < dc.appliedCredit - 0.005
        ? "⚠ The tax-liability limit binds — the excess is lost (nonrefundable for TY2022+, no carryforward)."
        : undefined,
    }),
  );

  return {
    formId: "2441",
    formNumber: "Form 2441",
    title: "Child and Dependent Care Expenses",
    subtitle: "Dependent care credit (IRC §21) — substitute workpaper (TY2024 line layout)",
    taxYear: ret.taxYear,
    parts: [
      { title: "Part I — Persons or Organizations Providing the Care", lines: partI },
      { title: "Part II — Credit for Child and Dependent Care Expenses (lines 2–11)", lines: partII },
    ],
    footnotes: [
      "MARRIED FILING SEPARATELY: §21(e)(2) generally BARS the credit for MFS filers — the engine returns $0 unless the client's mfsLivedApartAllYear flag invokes the §21(e)(4) treated-as-not-married exception (lived apart the last 6 months + furnished the qualifying person's household).",
      "Part III employer-provided dependent care benefits (W-2 box 10 / FSA) are NOT modeled — line 2 expenses must already be NET of reimbursed/excluded benefits, and the $3,000/$6,000 limit is NOT reduced by an exclusion here. CPA reconciles when box 10 is present.",
      "Both-spouses-working rule: the engine derives household earned income from W-2 + net SE and attributes the spouse's share via the client's spouseEarnedIncome field; the student/disabled deemed-earned-income rule ($250/$500 per month, §21(d)(2)) is not modeled.",
      "Line 9b (prior-year expenses paid this year) is not modeled — line 9c is treated as equal to line 9a.",
      "Workpaper amounts are engine-exact (cents); the official form rounds to whole dollars.",
    ],
  };
}
